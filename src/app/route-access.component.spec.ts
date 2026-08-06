import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteAccessComponent } from './route-access.component';
import { BffService, RouteRule } from './bff.service';

describe('RouteAccessComponent', () => {
  let fixture: ComponentFixture<RouteAccessComponent>;
  let component: RouteAccessComponent;
  let bff: jasmine.SpyObj<BffService>;

  const rule: RouteRule = {
    id: 'r1',
    gateway: 'snapdragon-be-gateway',
    url_pattern: '/api/admin/**',
    role: 'ROLE_ADMIN',
    allow: true,
    mfa_required: false,
  };

  // A seeded privileged-floor row (/bff/admin/** and /bff/superadmin/** rows ship
  // with mfa_required=true) — the MFA column must make this state visible.
  const seededFloorRule: RouteRule = {
    id: 'r2',
    gateway: 'snapdragon-be-gateway',
    url_pattern: '/bff/admin/**',
    role: 'ROLE_ADMIN',
    allow: true,
    mfa_required: true,
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['routeAccess', 'addRouteRule', 'removeRouteRule']);
    bff.routeAccess.and.resolveTo([rule]);
    await TestBed.configureTestingModule({
      imports: [RouteAccessComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteAccessComponent);
    component = fixture.componentInstance;
  });

  it('loads the existing rules on init and renders a row per rule', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.routeAccess).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-rule-id="r1"]')).not.toBeNull();
  });

  it('adds a trimmed rule and clears the URL pattern input', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.addRouteRule.and.resolveTo([rule]);

    component.urlPattern = '  /api/x/**  ';
    component.role = 'ROLE_USER';
    await component.add();

    expect(bff.addRouteRule).toHaveBeenCalledWith(jasmine.objectContaining({
      url_pattern: '/api/x/**', role: 'ROLE_USER',
    }));
    expect(component.urlPattern).toBe('');
  });

  describe('per-route MFA floor', () => {
    it('renders the MFA column: "required" on a seeded floor row, "off" otherwise', async () => {
      bff.routeAccess.and.resolveTo([rule, seededFloorRule]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const off = el.querySelector('[data-rule-id="r1"] .ra-mfa')!;
      const required = el.querySelector('[data-rule-id="r2"] .ra-mfa')!;
      expect(off.textContent!.trim()).toBe('off');
      expect(off.getAttribute('data-mfa')).toBe('off');
      expect(required.textContent!.trim()).toBe('required');
      expect(required.getAttribute('data-mfa')).toBe('required');
    });

    it('points a required row at the runbook: the tooltip says relaxing is possible but MFA-ROLLOUT.md governs it', async () => {
      bff.routeAccess.and.resolveTo([rule, seededFloorRule]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-rule-id="r2"] .ra-mfa')!.getAttribute('title')).toContain('MFA-ROLLOUT.md');
      expect(el.querySelector('[data-rule-id="r1"] .ra-mfa')!.getAttribute('title')).toBeNull();
    });

    it('sends the flag through add() under the wire spelling mfa_required, same path as allow', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      bff.addRouteRule.and.resolveTo([rule]);

      component.urlPattern = '/bff/admin/**';
      component.role = 'ROLE_ADMIN';
      component.mfaRequired = true;
      await component.add();

      expect(bff.addRouteRule).toHaveBeenCalledWith(jasmine.objectContaining({
        url_pattern: '/bff/admin/**', role: 'ROLE_ADMIN', allow: true, mfa_required: true,
      }));
    });

    it('defaults the add-form flag to false, mirroring the DB DEFAULT', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      bff.addRouteRule.and.resolveTo([rule]);

      component.urlPattern = '/api/x/**';
      await component.add();

      expect(bff.addRouteRule).toHaveBeenCalledWith(jasmine.objectContaining({ mfa_required: false }));
    });
  });

  it('removes a rule by id through the BFF', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.removeRouteRule.and.resolveTo([]);
    await component.remove('r1');
    expect(bff.removeRouteRule).toHaveBeenCalledWith('r1');
  });

  describe('accessibility', () => {
    it('associates every form control with a <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['ra-gateway', 'ra-pattern', 'ra-role', 'ra-allow', 'ra-mfa']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('gives each row remove button a descriptive aria-label (icon/text button)', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-remove="r1"]')!;
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('aria-label')).toContain('ROLE_ADMIN');
      expect(btn.getAttribute('aria-label')).toContain('/api/admin/**');
    });

    it('announces a blank-form submit in role=alert/assertive and blocks the BFF call', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      bff.addRouteRule.calls.reset();
      component.urlPattern = '';
      await component.add();
      fixture.detectChanges();

      expect(bff.addRouteRule).not.toHaveBeenCalled();
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="ra-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
    });

    it('uses a semantic thead with th[scope=col] for the rules table', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('table thead th[scope="col"]').length).toBeGreaterThanOrEqual(4);
    });

    it('announces the seeded-floor semantics WITH the MFA checkbox (aria-describedby -> field-help)', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const checkbox = el.querySelector('#ra-mfa')!;
      const helpId = checkbox.getAttribute('aria-describedby')!;
      const help = el.querySelector(`#${helpId}`)!;
      expect(help.classList).toContain('field-help');
      // The honest floor vocabulary + the runbook pointer, not a bare label.
      expect(help.textContent).toContain('mod relaxable');
      expect(help.textContent).toContain('/bff/superadmin/**');
      expect(help.textContent).toContain('MFA-ROLLOUT.md');
    });
  });
});
