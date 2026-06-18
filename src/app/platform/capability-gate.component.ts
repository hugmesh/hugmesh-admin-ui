import { Component, computed, input } from '@angular/core';

/**
 * The capabilities a console can be gated on. Each maps to one runtime probe in the
 * {@code GET /bff/admin/platform-capabilities} envelope.
 */
export type GatedCapability = 'argocd' | 'velero' | 'images' | 'buildNode';

/**
 * A shared, reusable graceful-degradation banner (the {@code .notice notice--warn} pattern
 * reused from the Anubis console). A console renders this — instead of erroring — when a
 * foundational-infra capability it depends on is ABSENT on this deployment, and suppresses /
 * disables its own actions alongside it.
 *
 * <p>The headline is constant ("This requires an x86 build node + ArgoCD + generated images,
 * which aren't present on this deployment") and the detail is TAILORED to the specific missing
 * capability, so an operator knows exactly which foundational piece to enable. The banner is
 * authoritative for DISPLAY only — the BFF remains the gate on every action (defence-in-depth).
 *
 * <p>a11y: {@code role="status"} (a non-error degraded state, announced politely) plus an
 * explicit {@code aria-label} accessible name so assistive tech announces the unavailability
 * even when the visible text is styled as a banner.
 */
@Component({
  selector: 'snap-capability-gate',
  standalone: true,
  template: `
    <div
      class="notice notice--warn"
      role="status"
      data-testid="capability-gate"
      [attr.data-capability]="capability()"
      [attr.aria-label]="accessibleName()"
    >
      <strong class="cap-gate-headline">
        This requires an x86 build node + ArgoCD + generated images, which aren't present on this
        deployment.
      </strong>
      <span class="cap-gate-detail">{{ detail() }}</span>
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
    `,
  ],
})
export class CapabilityGateComponent {
  /** Which foundational capability is missing — drives the tailored detail line. */
  readonly capability = input.required<GatedCapability>();

  /** The tailored detail sentence per missing capability. */
  readonly detail = computed(() => {
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
  });

  /** Explicit accessible name announcing the unavailability + the missing capability. */
  readonly accessibleName = computed(
    () => `Unavailable on this deployment: ${this.detail()}`,
  );
}
