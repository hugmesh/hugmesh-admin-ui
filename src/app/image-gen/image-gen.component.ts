import { Component, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageBuild, PackageSelection } from '../bff.service';
import { ImageGenStore } from './image-gen-store.service';
import { ImageGenWorklistWizardComponent } from './image-gen-worklist-wizard.component';
import { PackageCatalogModalComponent } from './package-catalog-modal.component';
import { WorklistEntrySelection, entryWireId } from './worklist-entry.model';
import { CapabilityGateComponent } from '../platform/capability-gate.component';
import { PlatformCapabilitiesService } from '../platform/platform-capabilities.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';

/** Split a space-separated Portage-atom string into a clean array (drops empties). */
function splitAtoms(s: string): string[] {
  return (s || '').split(/\s+/).filter(Boolean);
}

/**
 * Admin "Image generation" console (ADMIN/SUPERADMIN only, route-guarded). The build surface is
 * now the {@link ImageGenWorklistWizardComponent} — a worklist BATCH wizard (up to 16 images, one
 * step-up) replacing the old single-trigger form. This shell keeps the read/history side: the
 * capability gate, the dark-ships notice, the recent-builds table with inline detail, and the
 * (step-up-gated) image + NON-SECRET keys downloads.
 *
 * <p>Wired to the EXISTING admin-bff ImageBuildController: GET /bff/admin/image-builds (history),
 * GET /{id} (detail), POST /batch (worklist trigger — see the wizard), GET /{id}/events (SSE),
 * GET /{id}/image (download), GET /{id}/keys (keys download, X-ImageGen-StepUp). Gating is
 * defence-in-depth (gateway + resource-server filter + @PreAuthorize + own-domain wall); the
 * admin-bff is the source of truth.
 *
 * <p>CAPABILITY-GATE / SHIPS DARK: image generation needs an x86 build node, so the whole console
 * is gated on the platform-capability {@code buildNode} signal — when absent the wizard + table are
 * suppressed and the capability-gate notice is shown, never a broken console. The backend also
 * ships dark (imagegen.launch.enabled=false): {@code launchReal} false surfaces an honest stub
 * notice.
 *
 * <p>SECURITY: a private key is NEVER displayed or persisted in the UI; the keys download streams
 * a backend-guaranteed-non-secret bundle — the UI only triggers the save. The keys download is
 * step-up gated; a "requires step-up" 403 opens the inline {@link MfaStepUpDialogComponent} and the
 * SAME download is retried once the dialog reports success (no token needed — the BFF reads the
 * freshness off this session).
 */
@Component({
  selector: 'snap-image-gen',
  standalone: true,
  imports: [
    CommonModule,
    CapabilityGateComponent,
    MfaStepUpDialogComponent,
    ImageGenWorklistWizardComponent,
    PackageCatalogModalComponent,
  ],
  templateUrl: './image-gen.component.html',
  styleUrl: './image-gen.component.scss',
})
export class ImageGenComponent implements OnInit, OnDestroy {
  readonly store = inject(ImageGenStore);
  private readonly platform = inject(PlatformCapabilitiesService);

  /** The worklist wizard instance — the host mediates the package-catalog modal (item 9): the
   *  wizard emits (editPackages)=key, this host opens the modal for that entry, and folds the
   *  modal's PackageSelection back through applyCatalogSelection(). undefined until the console's
   *  capability gate renders the wizard, but (editPackages) only fires while it is present. */
  private readonly wizard = viewChild(ImageGenWorklistWizardComponent);

  // ── item 9: per-image package-catalog modal, host-mediated ────────────────
  readonly pkgModalOpen = signal(false);
  readonly pkgModalPlatform = signal('');
  /** The edited entry's Studio role id — lets the modal pick the catalog's per-(platform, role)
   *  tier baseline (locked floor / removable defaults) when the catalog carries one. */
  readonly pkgModalRole = signal('');
  readonly pkgModalImageLabel = signal('');
  readonly pkgModalSelection = signal<PackageSelection | null>(null);
  private pkgEditingKey = '';

  /** Wizard asked to edit one entry's packages — seed the modal from the entry's current atoms
   *  and open it (the modal lazily self-fetches the catalog for the entry's platform). */
  onEditPackages(key: string): void {
    const entry = this.wizard()?.entries().find((e) => e.key === key);
    if (!entry) return;
    this.pkgEditingKey = key;
    this.pkgModalPlatform.set(entry.platform);
    this.pkgModalRole.set(entry.role);
    // The human-facing modal heading is the entry's wire id (role.platform), NOT the opaque
    // internal row key (wle-N-xxxx) — matching the wizard's own per-entry title.
    this.pkgModalImageLabel.set(entryWireId(entry));
    this.pkgModalSelection.set({
      add: splitAtoms(entry.packagesAdd),
      drop: splitAtoms(entry.packagesDrop),
      // Seed the enabled adhoc-option keys so the modal restores those checkboxes on re-edit
      // (and can un-tick them to remove their atoms) instead of showing them all cleared.
      options: entry.options,
    });
    this.pkgModalOpen.set(true);
  }

  /** Modal applied — adapt PackageSelection (atom arrays) to the wizard's WorklistEntrySelection
   *  (space-joined strings + the entry's role/platform/imageClass) and fold it onto the entry. */
  onPackagesApplied(sel: PackageSelection): void {
    const entry = this.wizard()?.entries().find((e) => e.key === this.pkgEditingKey);
    if (entry) {
      const selection: WorklistEntrySelection = {
        role: entry.role,
        platform: entry.platform,
        imageClass: entry.imageClass,
        packagesAdd: sel.add.join(' '),
        packagesDrop: sel.drop.join(' '),
        // Persist the enabled option keys so the next re-edit restores the checkboxes.
        options: sel.options,
      };
      this.wizard()?.applyCatalogSelection(this.pkgEditingKey, selection);
    }
    this.pkgModalOpen.set(false);
  }

  onPackagesDismissed(): void {
    this.pkgModalOpen.set(false);
  }

  /** Whether the x86 build node is present. When absent the wizard + table are suppressed and the
   *  capability-gate notice is shown — graceful degradation, never an error. The BFF stays the
   *  authoritative gate on every action. */
  readonly buildNodePresent = this.platform.buildNodePresent;
  /** True once the capability probe has resolved (avoids flashing the notice while loading). */
  readonly capabilitiesReady = this.platform.ready;
  /** The warning (if any) explaining the build-node presence could NOT be determined. */
  readonly buildNodeWarning = this.platform.warningFor('buildNode');

  readonly downloadNote = signal('');

  /** A pending step-up challenge for a keys download, or null when none is in flight. `retry`
   *  re-attempts the SAME download once the inline dialog reports the challenge satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  async ngOnInit(): Promise<void> {
    await this.platform.load();
    // When the build node is absent, degrade: show the notice, do not fetch build history.
    if (this.buildNodePresent()) {
      await this.store.refreshHistory();
    }
  }

  ngOnDestroy(): void {
    this.store.reset();
  }

  /** A build offers an image download only once it has reported a (non-secret) imageRef. */
  canDownloadImage(build: ImageBuild): boolean {
    return build.status === 'COMPLETED' && !!build.imageRef;
  }

  /** The keys-download control is shown ONLY when the build allowed a keys bundle AND it produced
   *  one. The BFF re-enforces ssh_keys_allowed + step-up regardless. */
  canDownloadKeys(build: ImageBuild): boolean {
    return build.sshKeysAllowed && build.status === 'COMPLETED' && !!build.keysRef;
  }

  async toggleDetail(build: ImageBuild): Promise<void> {
    if (this.store.detail()?.id === build.id) {
      this.store.closeDetail();
      return;
    }
    await this.store.openDetail(build.id);
  }

  async downloadImage(build: ImageBuild): Promise<void> {
    this.downloadNote.set('');
    const ok = await this.store.downloadImage(build.id);
    if (!ok) {
      this.downloadNote.set('No image is available for this build yet.');
    }
  }

  async downloadKeys(build: ImageBuild): Promise<void> {
    this.downloadNote.set('');
    try {
      const ok = await this.store.downloadKeys(build.id);
      if (!ok) {
        this.downloadNote.set('The keys bundle could not be downloaded (not available yet).');
      }
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp('Downloading this keys bundle', () => this.downloadKeys(build));
        return;
      }
      this.downloadNote.set(e instanceof Error ? e.message : 'The keys bundle could not be downloaded.');
    }
  }

  /** Offer the inline MFA step-up dialog for a keys download that 403'd. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the gated download it was blocking. */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  /** Stable, AT-friendly summary text for a build's status (never colour-alone). */
  statusText(build: ImageBuild): string {
    switch (build.status) {
      case 'QUEUED': return 'queued';
      case 'RUNNING': return 'running';
      case 'COMPLETED': return 'completed';
      case 'FAILED': return 'failed';
      case 'ERROR': return 'error (inconclusive)';
      default: return build.status;
    }
  }
}
