import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageBuild, ImageType } from '../bff.service';
import { ImageGenStore } from './image-gen-store.service';
import { CapabilityGateComponent } from '../platform/capability-gate.component';
import { PlatformCapabilitiesService } from '../platform/platform-capabilities.service';
import { MfaStepUpDialogComponent } from '../mfa/mfa-step-up-dialog.component';
import { isStepUpRequiredError } from '../mfa/step-up-error';

/**
 * Admin "Image generation" console (ADMIN/SUPERADMIN only, route-guarded). Trigger an image
 * build for a target user (primary / mesh-extension / client), watch LIVE SSE progress, then
 * download the built image and — only when the build allowed it — the NON-SECRET SSH-keys
 * bundle (step-up gated).
 *
 * <p>Wired to the EXISTING admin-bff ImageBuildController: GET /bff/admin/image-builds (history),
 * GET /{id} (detail), POST (trigger), GET /{id}/events (SSE), GET /{id}/image (download),
 * GET /{id}/keys (keys download, X-ImageGen-StepUp). Gating is defence-in-depth (gateway +
 * resource-server filter + @PreAuthorize + own-domain wall); the admin-bff is the source of truth.
 *
 * <p>CAPABILITY-GATE / SHIPS DARK: image generation needs an x86 build node, so the whole console
 * is gated on the platform-capability {@code buildNode} signal — when absent the trigger form +
 * actions are suppressed and the capability-gate notice is shown (greyed-out "requires an x86
 * build node + ArgoCD + generated images" state), never a broken console. The backend also ships
 * dark (imagegen.launch.enabled=false): {@code launchReal} false surfaces an honest stub notice,
 * and a trigger that 503s degrades to an error message rather than crashing.
 *
 * <p>SECURITY: a private key is NEVER displayed or persisted in the UI; the keys download streams
 * a backend-guaranteed-non-secret bundle — the UI only triggers the save.
 *
 * <p>STEP-UP: the trigger + keys download are gated on the BFF's "A5 UNIFIED step-up"
 * ({@code ImageGenStepUpGate}) — EITHER the manual step-up-confirmation token below OR a fresh
 * Casdoor-MFA stamp. A caller with no token (the common case for a plain ADMIN, who has no
 * first-class way to mint one — see {@code ImageGenStepUpGate}'s security-review flag) can
 * instead just submit; a "requires step-up" 403 ({@link isStepUpRequiredError}) opens the inline
 * {@link MfaStepUpDialogComponent}, and the SAME action is retried automatically once the
 * dialog reports success — no token needed on the retry, since the BFF reads the freshness off
 * this session.
 */
@Component({
  selector: 'snap-image-gen',
  standalone: true,
  imports: [CommonModule, FormsModule, CapabilityGateComponent, MfaStepUpDialogComponent],
  templateUrl: './image-gen.component.html',
  styleUrl: './image-gen.component.scss',
})
export class ImageGenComponent implements OnInit, OnDestroy {
  readonly store = inject(ImageGenStore);
  private readonly platform = inject(PlatformCapabilitiesService);

  /** Whether the x86 build node is present. When absent the trigger form + actions are suppressed
   *  and the capability-gate notice is shown — graceful degradation, never an error. The BFF stays
   *  the authoritative gate on every action. */
  readonly buildNodePresent = this.platform.buildNodePresent;
  /** True once the capability probe has resolved (avoids flashing the notice while loading). */
  readonly capabilitiesReady = this.platform.ready;
  /** The warning (if any) explaining the build-node presence could NOT be determined — drives the
   *  gate's distinct "couldn't determine" copy vs the factual "not present" copy. */
  readonly buildNodeWarning = this.platform.warningFor('buildNode');

  // ── Trigger form fields ──────────────────────────────────────────────────
  targetUser = '';
  imageType: ImageType = 'primary';
  hardwareClass = '';
  sshKeysAllowed = false;
  /** The platform step-up token (required by the BFF for the privileged trigger + keys download).
   *  Held only in the component field; never logged or persisted. */
  stepUpToken = '';

  readonly error = signal('');
  readonly triggering = signal(false);
  /** A polite note when a download has no artifact yet (build not finished). */
  readonly downloadNote = signal('');

  /** A pending step-up challenge for the trigger or a keys download, or null when none is in
   *  flight. `retry` re-attempts the SAME privileged call once the inline
   *  {@link MfaStepUpDialogComponent} reports the challenge satisfied. */
  readonly stepUpChallenge = signal<null | { action: string; retry: () => Promise<void> }>(null);

  /** Hint for the active build's image-type label (for the progress heading). */
  readonly activeTypeLabel = computed(() => {
    const t = this.store.activeBuild()?.imageType;
    return this.store.imageTypes.find((it) => it.value === t)?.label ?? t ?? '';
  });

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

  async triggerBuild(): Promise<void> {
    // Defence-in-depth: never trigger when the build node is absent (the form is not rendered
    // then; the BFF is the authoritative gate regardless).
    if (!this.buildNodePresent()) return;
    const target = this.targetUser.trim();
    if (!target) {
      this.error.set('A target user is required.');
      return;
    }
    if (target.length > 400) {
      this.error.set('Target user is too long (max 400 characters).');
      return;
    }
    if (this.hardwareClass.trim().length > 64) {
      this.error.set('Hardware class is too long (max 64 characters).');
      return;
    }
    this.error.set('');
    this.triggering.set(true);
    try {
      await this.store.trigger(
        {
          targetUser: target,
          imageType: this.imageType,
          hardwareClass: this.hardwareClass.trim() || null,
          sshKeysAllowed: this.sshKeysAllowed,
        },
        this.stepUpToken.trim() || undefined,
      );
    } catch (e) {
      if (isStepUpRequiredError(e)) {
        this.offerStepUp('Triggering this image build', () => this.triggerBuild());
        return;
      }
      this.error.set(e instanceof Error ? e.message : 'Could not start the build.');
    } finally {
      this.triggering.set(false);
    }
  }

  /** Offer the inline MFA step-up dialog for a privileged call that just 403'd with the
   *  "requires step-up" contract. `retry` is invoked once the dialog reports success. */
  private offerStepUp(action: string, retry: () => Promise<void>): void {
    this.stepUpChallenge.set({ action, retry });
  }

  /** The inline step-up dialog reported success — retry the gated call it was blocking (the
   *  BFF now reads a fresh MFA stamp off this session; no token is needed on the retry). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending retry. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
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
      const ok = await this.store.downloadKeys(build.id, this.stepUpToken.trim() || undefined);
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
