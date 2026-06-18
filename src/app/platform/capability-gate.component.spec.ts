import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CapabilityGateComponent, GatedCapability } from './capability-gate.component';

/**
 * The shared graceful-degradation banner: the constant headline, a TAILORED detail per missing
 * capability, the reused {@code .notice notice--warn} look, and an explicit accessible name.
 */
describe('CapabilityGateComponent', () => {
  let fixture: ComponentFixture<CapabilityGateComponent>;

  function mount(capability: GatedCapability): HTMLElement {
    fixture = TestBed.createComponent(CapabilityGateComponent);
    fixture.componentRef.setInput('capability', capability);
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
});
