import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, DomainResponse, ImagePlatform, ImageType } from '../bff.service';
import { ImageGenStore } from './image-gen-store.service';
import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';
import {
  EncryptRoot,
  ENCRYPT_ROOT_OPTIONS,
  IMAGE_TYPE_OPTIONS,
  ImageClass,
  MAX_ENTRIES,
  PLATFORM_OPTIONS,
  WorklistEntry,
  WorklistEntrySelection,
  WorklistUser,
  applySelection,
  buildWorklistEnvelope,
  entryWireId,
  isDesktopClass,
  isTailnetSsoEligible,
  isTorOnionEligible,
  newEntry,
} from './worklist-entry.model';

/** The wizard step ids, in order. */
type StepId = 'images' | 'domains' | 'users' | 'review';

/** Same charset the BFF's BatchImageSpec enforces on targetUser (defence-in-depth mirror). */
const TARGET_USER_RE = /^[A-Za-z0-9._@\/-]{1,400}$/;

/**
 * The admin worklist BATCH wizard (items 1,2,3,4,6,7,8) — the multi-image successor to the old
 * single-trigger form. Reuses the admin-task-wizard's step-rail UX (progress line + numbered rail +
 * next/back) but NOT its data-driven FieldDef renderer, because each step here has a bespoke body
 * (per-entry sub-forms, a domain multi-select, a Users grid, a review + progress screen).
 *
 * <p>FLOW: <b>Images</b> (1..16 role×platform entries, each with the desktop-only sub-forms for
 * branding/tailnet-SSO/home gated on catalog image-class) → <b>Domains</b> (attach registry
 * domains per entry, item 4) → <b>Users</b> (mesh users with a registry domain dropdown, item 6) →
 * <b>Review</b> (assemble the envelope, ONE step-up, submit the batch). After submit the
 * <b>progress screen</b> renders one card per build over the store's N-stream Map (item 8).
 *
 * <p>ROUTE / TENANCY: the console stays ADMIN/SUPERADMIN. The own-domain wall is re-enforced
 * server-side, so the cross-tenant affordances (tailnet/SSO on branded desktops, cross-brand
 * composition) are gated to SUPERADMIN in-wizard as a UX affordance — the BFF is authoritative.
 * The superdomain is SERVER-derived (&lt;brand&gt;.internal, NON_ARGV) and shown read-only in Review;
 * this UI never lets a client pick a tenant, a superdomain, or a per-build domain.
 *
 * <p>PACKAGES (item 9): the rich tree lives in the package-catalog-modal (a sibling workstream).
 * This wizard exposes {@link editPackages} (emits the entry key when its "Edit packages" control is
 * used) and the public {@link applyCatalogSelection} callback so the host can wire the modal in;
 * inline package-atom fields are the functional fallback when the modal is not mounted.
 */
@Component({
  selector: 'hug-image-gen-worklist-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './image-gen-worklist-wizard.component.html',
  styleUrl: './image-gen-worklist-wizard.component.scss',
})
export class ImageGenWorklistWizardComponent implements OnInit {
  readonly store = inject(ImageGenStore);
  private readonly bff = inject(BffService);
  private readonly session = inject(SessionService);

  /** SUPERADMIN unlocks the cross-tenant affordances (tailnet/SSO, cross-brand composition). */
  readonly isSuperadmin = this.session.isSuperadmin;

  readonly maxEntries = MAX_ENTRIES;
  readonly imageTypeOptions = IMAGE_TYPE_OPTIONS;
  readonly platformOptions = PLATFORM_OPTIONS;
  readonly encryptRootOptions = ENCRYPT_ROOT_OPTIONS;

  /** The wizard steps, in order (visual rail + a11y progress). */
  readonly steps: ReadonlyArray<{ id: StepId; title: string }> = [
    { id: 'images', title: 'Images' },
    { id: 'domains', title: 'Domains' },
    { id: 'users', title: 'Users' },
    { id: 'review', title: 'Review & build' },
  ];
  readonly stepIndex = signal(0);
  readonly currentStep = computed<StepId>(() => this.steps[this.stepIndex()].id);
  readonly isLastStep = computed(() => this.stepIndex() >= this.steps.length - 1);

  /** The worklist entries (starts with one blank row). */
  readonly entries = signal<WorklistEntry[]>([newEntry()]);
  /** The mesh users (item 6). */
  readonly users = signal<WorklistUser[]>([]);
  /** The registered domains (fed by bff.listDomains); the picker uses only enabled ones. */
  readonly domains = signal<DomainResponse[]>([]);
  readonly enabledDomains = computed(() => this.domains().filter((d) => d.enabled));

  /** Bounded launch concurrency (1..16, default 1 = sequential). */
  maxConcurrent = 1;
  /** Optional step-up token (X-ImageGen-StepUp); never logged/persisted. */
  stepUpToken = '';

  readonly error = signal('');
  readonly submitting = signal(false);
  /** True once the batch was submitted — swaps the form for the N-card progress screen. */
  readonly submitted = signal(false);

  /** A pending step-up challenge, or null. `retry` re-runs the SAME submit once satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  /** Emitted (with the entry key) when the user asks to edit packages via the catalog modal. */
  @Output() readonly editPackages = new EventEmitter<string>();

  readonly canAddEntry = computed(() => this.entries().length < MAX_ENTRIES);

  async ngOnInit(): Promise<void> {
    this.domains.set(await this.bff.listDomains());
  }

  /** trackBy for the entry rows — preserves DOM (and focus) across immutable array updates. */
  trackEntry = (_: number, e: WorklistEntry): string => e.key;

  // ── step navigation ───────────────────────────────────────────────────────
  next(): void {
    if (!this.stepValid(this.currentStep())) {
      this.error.set(this.stepError(this.currentStep()));
      return;
    }
    this.error.set('');
    if (!this.isLastStep()) this.stepIndex.set(this.stepIndex() + 1);
  }

  back(): void {
    if (this.stepIndex() > 0) {
      this.error.set('');
      this.stepIndex.set(this.stepIndex() - 1);
    }
  }

  // ── entry operations ──────────────────────────────────────────────────────
  addEntry(): void {
    if (this.canAddEntry()) this.entries.update((es) => [...es, newEntry()]);
  }

  removeEntry(key: string): void {
    this.entries.update((es) => (es.length > 1 ? es.filter((e) => e.key !== key) : es));
  }

  /** Immutably patch one entry (keeps computeds + trackBy reactive). */
  patchEntry(key: string, patch: Partial<WorklistEntry>): void {
    this.entries.update((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  setEntryImageType(key: string, imageType: ImageType): void {
    this.patchEntry(key, { imageType });
  }

  setEntryPlatform(key: string, platform: ImagePlatform): void {
    this.patchEntry(key, { platform });
  }

  setEntryImageClass(key: string, imageClass: ImageClass): void {
    this.patchEntry(key, { imageClass });
  }

  setEntryEncryptRoot(key: string, encryptRoot: EncryptRoot): void {
    this.patchEntry(key, { encryptRoot });
  }

  /** Toggle a domain attachment on an entry (item 4 multi-select). */
  toggleEntryDomain(key: string, name: string, checked: boolean): void {
    this.entries.update((es) =>
      es.map((e) => {
        if (e.key !== key) return e;
        const set = new Set(e.attachedDomains);
        if (checked) set.add(name);
        else set.delete(name);
        return { ...e, attachedDomains: [...set] };
      }),
    );
  }

  entryHasDomain(e: WorklistEntry, name: string): boolean {
    return e.attachedDomains.includes(name);
  }

  /** Ask the host to open the package-catalog modal for one entry (item 9 coupling). */
  requestEditPackages(key: string): void {
    this.editPackages.emit(key);
  }

  /** Apply a catalog-modal selection onto an entry (item 9 coupling — called by the host/modal). */
  applyCatalogSelection(key: string, sel: WorklistEntrySelection): void {
    this.entries.update((es) => es.map((e) => (e.key === key ? applySelection(e, sel) : e)));
  }

  isDesktop(e: WorklistEntry): boolean {
    return isDesktopClass(e);
  }

  /** Whether the tailnet/SSO sub-form shows: an eligible branded desktop AND caller is superadmin
   *  (cross-tenant affordance). The BFF re-enforces regardless. */
  showTailnetSso(e: WorklistEntry): boolean {
    return this.isSuperadmin() && isTailnetSsoEligible(e);
  }

  /** Whether the Tor-onion toggle shows: an x86 NODE image (the onion is an x86-only NODE
   *  service, folded via the builder's --with-tor). The BFF/generator spec channel carries the
   *  emitted tor_onion_service through to the builder. */
  showTorOnion(e: WorklistEntry): boolean {
    return isTorOnionEligible(e);
  }

  wireId(e: WorklistEntry): string {
    return entryWireId(e);
  }

  // ── users operations (item 6) ─────────────────────────────────────────────
  addUser(): void {
    this.users.update((us) => [...us, { username: '', domain: '', role: '', email: '' }]);
  }

  removeUser(index: number): void {
    this.users.update((us) => us.filter((_, i) => i !== index));
  }

  patchUser(index: number, patch: Partial<WorklistUser>): void {
    this.users.update((us) => us.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }

  // ── validation ────────────────────────────────────────────────────────────
  private entryValid(e: WorklistEntry): boolean {
    const t = e.targetUser.trim();
    return t.length > 0 && t.length <= 400 && TARGET_USER_RE.test(t) && e.role.trim().length > 0;
  }

  entriesValid(): boolean {
    const es = this.entries();
    return es.length >= 1 && es.length <= MAX_ENTRIES && es.every((e) => this.entryValid(e));
  }

  private usersValid(): boolean {
    // A user row with a username must also carry a domain (mesh residency).
    return this.users().every((u) => u.username.trim().length === 0 || u.domain.trim().length > 0);
  }

  stepValid(step: StepId): boolean {
    switch (step) {
      case 'images':
        return this.entriesValid();
      case 'users':
        return this.usersValid();
      case 'domains':
      case 'review':
        return true;
    }
  }

  private stepError(step: StepId): string {
    switch (step) {
      case 'images':
        return this.entries().length > MAX_ENTRIES
          ? `A batch may build at most ${MAX_ENTRIES} images.`
          : 'Every image needs a valid target user (letters, digits, . _ @ / -) and a role.';
      case 'users':
        return 'Every named user needs a domain.';
      default:
        return '';
    }
  }

  /** All-green gate for the Build button (entries + users valid, at least one entry). */
  canBuild(): boolean {
    return this.entriesValid() && this.usersValid() && !this.submitting();
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async build(): Promise<void> {
    if (!this.canBuild()) {
      this.error.set(this.stepError('images'));
      return;
    }
    this.error.set('');
    this.submitting.set(true);
    const envelope = buildWorklistEnvelope(this.entries(), this.users(), this.maxConcurrent);
    try {
      await this.store.submitWorklistBatch(envelope, this.stepUpToken.trim() || undefined);
      this.submitted.set(true);
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp('Building this worklist', () => this.build());
        return;
      }
      this.error.set(e instanceof Error ? e.message : 'Could not start the batch.');
    } finally {
      this.submitting.set(false);
    }
  }

  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  /** Start a fresh worklist after a batch finished (tears down the streams). */
  buildAnother(): void {
    this.store.reset();
    this.submitted.set(false);
    this.stepIndex.set(0);
    this.entries.set([newEntry()]);
    this.users.set([]);
    this.maxConcurrent = 1;
    this.stepUpToken = '';
    this.error.set('');
  }

  /** Stable, AT-friendly status label for a live build (never colour-alone). */
  liveStatusText(status: string): string {
    switch (status) {
      case 'QUEUED': return 'queued';
      case 'RUNNING': return 'running';
      case 'COMPLETED': return 'completed';
      case 'ERROR': return 'error (inconclusive)';
      default: return status;
    }
  }

  /** The image-type label for a live build card heading. */
  typeLabel(imageType: ImageType | ''): string {
    return this.imageTypeOptions.find((o) => o.value === imageType)?.label ?? imageType;
  }
}
