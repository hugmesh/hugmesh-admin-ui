import { Component, computed, input } from '@angular/core';

/**
 * The capabilities a console can be gated on. Each maps to one runtime probe in the
 * {@code GET /bff/admin/platform-capabilities} envelope.
 */
export type GatedCapability = 'argocd' | 'velero' | 'images' | 'buildNode';

/**
 * A shared, reusable graceful-degradation banner (the {@code .notice notice--warn} pattern
 * reused from the Anubis console). A console renders this — instead of erroring — when a
 * foundational-infra capability it depends on is NOT present, and suppresses / disables its own
 * actions alongside it.
 *
 * <h2>Two distinct states (the requirement: reflect ABSENCE accurately)</h2>
 * <ul>
 *   <li><b>probed-absent</b> (no {@code warning} for this capability) — the probe RAN and the infra
 *       is genuinely not installed. The banner asserts the factual "…not present on this
 *       deployment" copy.</li>
 *   <li><b>undetectable</b> (a {@code warning} IS present for this capability — the probe is not
 *       enabled / RBAC-denied / errored / the DB is down) — the probe could NOT determine presence.
 *       The banner shows DISTINCT "couldn't determine whether … is present" copy and surfaces the
 *       warning text, and does NOT assert factual absence. Actions stay suppressed either way (the
 *       console gates on the {@code *Present} signal, which is fail-closed-false while undetected),
 *       so nothing errors.</li>
 * </ul>
 *
 * <p>The banner is authoritative for DISPLAY only — the BFF remains the gate on every action
 * (defence-in-depth).
 *
 * <p>a11y: {@code role="status"} (a non-error degraded state, announced politely) plus an
 * explicit {@code aria-label} accessible name so assistive tech announces the unavailability
 * even when the visible text is styled as a banner.
 */
@Component({
  selector: 'hug-capability-gate',
  standalone: true,
  template: `
    <div
      class="notice notice--warn"
      role="status"
      data-testid="capability-gate"
      [attr.data-capability]="capability()"
      [attr.data-state]="undetectable() ? 'undetectable' : 'absent'"
      [attr.aria-label]="accessibleName()"
    >
      <strong class="cap-gate-headline">
        @if (undetectable()) {
          We couldn't verify which foundational infra (x86 build node + ArgoCD + generated images)
          is present on this deployment, so this console is hidden until it can be verified.
        } @else {
          This requires an x86 build node + ArgoCD + generated images, which aren't present on this
          deployment.
        }
      </strong>
      <span class="cap-gate-detail">{{ detail() }}</span>
      @if (undetectable()) {
        <span class="cap-gate-warning" data-testid="capability-gate-warning">{{ warning() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .notice {
        border-inline-start: 4px solid;
        padding: 0.75rem 1rem;
        border-radius: 4px;
        margin-block-end: 1rem;
        display: block;
      }
      .notice--warn {
        border-color: var(--snap-color-warn, #f57c00);
        background: var(--snap-color-warn-bg, #fff8e1);
      }
      .cap-gate-headline {
        display: block;
        margin-block-end: 0.25rem;
      }
      .cap-gate-detail {
        display: block;
      }
      .cap-gate-warning {
        display: block;
        margin-block-start: 0.25rem;
        font-size: 0.85em;
        opacity: 0.85;
      }
    `,
  ],
})
export class CapabilityGateComponent {
  /** Which foundational capability is missing — drives the tailored detail line. */
  readonly capability = input.required<GatedCapability>();

  /**
   * The BFF warning that pertains to this capability, when the probe could NOT determine its
   * presence (probe not enabled / RBAC-denied / probe error / DB down). When set (non-null/empty)
   * the banner switches to the DISTINCT "couldn't determine" copy and surfaces the warning text
   * instead of asserting factual absence. {@code null} (the default) = genuinely probed-absent.
   */
  readonly warning = input<string | null>(null);

  /** True when a warning is present for this capability — i.e. presence is UNDETECTABLE, not absent. */
  readonly undetectable = computed(() => {
    const w = this.warning();
    return w !== null && w.trim().length > 0;
  });

  /** The tailored detail sentence — distinct copy for undetectable vs probed-absent. */
  readonly detail = computed(() => {
    if (this.undetectable()) {
      return this.undetectableDetail();
    }
    return this.absentDetail();
  });

  /**
   * "couldn't determine" copy: the capability probe isn't enabled or lacks permission, so we
   * cannot say whether the infra is present — the console is hidden until it can be verified.
   */
  private undetectableDetail(): string {
    switch (this.capability()) {
      case 'velero':
        return "Couldn't determine whether Velero (the backup operator) is present (the capability "
          + 'probe isn\'t enabled or lacks permission). This console is hidden until it can be '
          + 'verified.';
      case 'argocd':
        return "Couldn't determine whether ArgoCD (the GitOps reconciler) is present (the "
          + "capability probe isn't enabled or lacks permission). This console is hidden until it "
          + 'can be verified.';
      case 'images':
        return "Couldn't determine whether generated platform images are present (the capability "
          + "probe couldn't read the images table). This console is hidden until it can be "
          + 'verified.';
      case 'buildNode':
        return "Couldn't determine whether the x86 build node is present (the capability probe "
          + "isn't enabled or lacks permission). This console is hidden until it can be verified.";
    }
  }

  /** The factual "not present on this deployment" copy — used only when genuinely probed-absent. */
  private absentDetail(): string {
    switch (this.capability()) {
      case 'velero':
        return 'Backup & recovery needs the Velero backup operator on the cluster. '
          + 'Install Velero (a CRD + the velero deployment) to enable backups here.';
      case 'argocd':
        return 'This console needs ArgoCD, the GitOps reconciler, on the cluster. '
          + 'It is provisioned by the x86 build node and is not connected on this deployment.';
      case 'images':
        return 'This console needs generated platform images, which are built by the x86 build '
          + 'node and published through ArgoCD. None have been generated on this deployment yet.';
      case 'buildNode':
        return 'This console needs the x86/amd64 build node, the foundation for ArgoCD and '
          + 'generated images. No build node is present on this deployment.';
    }
  }

  /** Explicit accessible name announcing the state (unverifiable vs unavailable) + the detail. */
  readonly accessibleName = computed(() =>
    this.undetectable()
      ? `Could not verify on this deployment: ${this.detail()}`
      : `Unavailable on this deployment: ${this.detail()}`,
  );
}
