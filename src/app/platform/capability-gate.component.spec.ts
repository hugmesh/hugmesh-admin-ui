import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CapabilityGateComponent, GatedCapability } from './capability-gate.component';

/**
 * The shared graceful-degradation banner. Two distinct states (reflect ABSENCE accurately):
 *  - probed-absent (no warning) → the factual "not present on this deployment" copy;
 *  - undetectable (a warning IS present) → the DISTINCT "couldn't determine" copy + the warning
 *    text, NOT a factual-absence assertion.
 * Plus the reused {@code .notice notice--warn} look and an explicit accessible name in both states.
 */
describe('CapabilityGateComponent', () => {
  let fixture: ComponentFixture<CapabilityGateComponent>;

  function mount(capability: GatedCapability, warning: string | null = null): HTMLElement {
    fixture = TestBed.createComponent(CapabilityGateComponent);
    fixture.componentRef.setInput('capability', capability);
    fixture.componentRef.setInput('warning', warning);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the warn notice with the constant infra headline', () => {
    const el = mount('argocd');
    const gate = el.querySelector('[data-testid="capability-gate"]')!;
    expect(gate.classList).toContain('notice');
    expect(gate.classList).toContain('notice--warn');
    expect(gate.textContent).toContain("aren't present on this deployment");
  });

  it('tailors the detail line per missing capability', () => {
    expect(mount('velero').textContent!.toLowerCase()).toContain('velero');
    expect(mount('argocd').textContent!.toLowerCase()).toContain('argocd');
    expect(mount('images').textContent!.toLowerCase()).toContain('images');
    expect(mount('buildNode').textContent!.toLowerCase()).toContain('build node');
  });

  it('exposes the missing capability via data-capability', () => {
    expect(mount('velero').querySelector('[data-testid="capability-gate"]')!
      .getAttribute('data-capability')).toBe('velero');
  });

  it('carries an explicit accessible name (role=status + aria-label)', () => {
    const gate = mount('velero').querySelector('[data-testid="capability-gate"]')!;
    expect(gate.getAttribute('role')).toBe('status');
    const name = gate.getAttribute('aria-label') ?? '';
    expect(name.trim().length).toBeGreaterThan(0);
    expect(name.toLowerCase()).toContain('unavailable');
  });

  // ── probed-absent (no warning) → factual "not present" copy ──────────────────────────────

  it('with NO warning, asserts the factual probed-absent copy (data-state=absent)', () => {
    const gate = mount('argocd').querySelector('[data-testid="capability-gate"]')!;
    expect(gate.getAttribute('data-state')).toBe('absent');
    expect(gate.textContent).toContain('not connected on this deployment');
    expect(gate.textContent!.toLowerCase()).not.toContain("couldn't determine");
    // no warning element is rendered when there is nothing undetectable to surface.
    expect(gate.querySelector('[data-testid="capability-gate-warning"]')).toBeNull();
  });

  // ── undetectable (warning present) → DISTINCT "couldn't determine" copy ────────────────────

  it('with a warning, switches to the DISTINCT "couldn\'t determine" copy (data-state=undetectable)', () => {
    const probeWarning =
      'Platform-capability k8s probe is not enabled on this deployment; ArgoCD / Velero / '
      + 'build-node presence cannot be detected and are reported absent.';
    const gate = mount('argocd', probeWarning).querySelector('[data-testid="capability-gate"]')!;
    expect(gate.getAttribute('data-state')).toBe('undetectable');
    expect(gate.textContent!.toLowerCase()).toContain("couldn't determine");
    // It must NOT assert factual absence in this state.
    expect(gate.textContent).not.toContain('not connected on this deployment');
  });

  it('surfaces the underlying warning text when undetectable', () => {
    const probeWarning = 'Velero presence could not be detected (Kubernetes read failed or was '
      + 'denied); reported absent.';
    const gate = mount('velero', probeWarning).querySelector('[data-testid="capability-gate"]')!;
    const surfaced = gate.querySelector('[data-testid="capability-gate-warning"]');
    expect(surfaced).not.toBeNull();
    expect(surfaced!.textContent).toContain('could not be detected');
  });

  it('keeps an accessible name in the undetectable state (role=status + aria-label, "verify")', () => {
    const gate = mount('velero', 'Velero presence could not be detected; reported absent.')
      .querySelector('[data-testid="capability-gate"]')!;
    expect(gate.getAttribute('role')).toBe('status');
    const name = gate.getAttribute('aria-label') ?? '';
    expect(name.trim().length).toBeGreaterThan(0);
    expect(name.toLowerCase()).toContain('verify');
  });

  it('treats a blank/whitespace warning as probed-absent (not undetectable)', () => {
    const gate = mount('argocd', '   ').querySelector('[data-testid="capability-gate"]')!;
    expect(gate.getAttribute('data-state')).toBe('absent');
  });
});
