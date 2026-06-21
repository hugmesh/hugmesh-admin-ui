import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SuperadminDomainsComponent } from './superadmin-domains.component';
import { BffService, DomainResponse } from './bff.service';

/**
 * A two-domain fixture: one enabled + FULLY PROVISIONED brand (caProvisioned &&
 * appsetRegistered), one soft-disabled brand in another org that is registered but
 * NOT yet provisioned (the band-190 defaults false/false/0 — the honest at-rest
 * state until the domain-reconcile effector runs).
 */
const fixtureDomains = (): DomainResponse[] => [
  {
    id: 'dom-1',
    clusterDomain: 'brand-a.example.com',
    brand: 'brand-a',
    org: 'Brand A Inc.',
    caRef: 'pki/brand-a',
    nsPrefix: 'branda',
    casdoorOrg: 'brand-a-org',
    meshTag: 'tag:brand-a',
    enabled: true,
    createdAt: '2026-06-01T00:00:00Z',
    createdBySubject: 'root',
    updatedAt: '2026-06-01T00:00:00Z',
    caProvisioned: true,
    appsetRegistered: true,
    lastReconciledGeneration: 3,
  },
  {
    id: 'dom-2',
    clusterDomain: 'brand-b.example.com',
    brand: 'brand-b',
    org: 'Brand B LLC',
    caRef: 'generate',
    nsPrefix: 'brandb',
    casdoorOrg: 'brand-b-org',
    meshTag: 'tag:brand-b',
    enabled: false,
    createdAt: '2026-06-02T00:00:00Z',
    createdBySubject: 'root',
    updatedAt: '2026-06-02T00:00:00Z',
    caProvisioned: false,
    appsetRegistered: false,
    lastReconciledGeneration: 0,
  },
];

describe('SuperadminDomainsComponent', () => {
  let fixture: ComponentFixture<SuperadminDomainsComponent>;
  let component: SuperadminDomainsComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['listDomains', 'createDomain']);
    bff.listDomains.and.resolveTo(fixtureDomains());
    await TestBed.configureTestingModule({
      imports: [SuperadminDomainsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(SuperadminDomainsComponent);
    component = fixture.componentInstance;
  });

  it('lists the registered domains on init, hitting the BFF list endpoint once', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.listDomains).toHaveBeenCalledTimes(1);
    expect(component.domains().length).toBe(2);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-cluster-domain="brand-a.example.com"]')).not.toBeNull();
    expect(el.querySelector('[data-cluster-domain="brand-b.example.com"]')).not.toBeNull();
    // the disabled brand renders its disabled status
    const disabled = el.querySelector('[data-cluster-domain="brand-b.example.com"]')!;
    expect(disabled.textContent).toContain('disabled');
  });

  describe('provisioning-state chip (band-190 / admin-bff #118)', () => {
    it('shows the degraded "registered — not yet provisioned" chip + helptext for a not-yet-provisioned domain', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      // brand-b: caProvisioned=false / appsetRegistered=false → degraded chip.
      const row = el.querySelector('[data-cluster-domain="brand-b.example.com"]')!;
      const chip = row.querySelector<HTMLElement>('[data-testid="sd-provisioning"]')!;
      expect(chip).withContext('provisioning chip rendered').not.toBeNull();
      expect(chip.classList).toContain('is-degraded');
      expect(chip.textContent).toContain('Registered');
      expect(chip.textContent).toContain('not yet provisioned');

      // a11y: greyed/disabled state is announced (not colour-only) + named + described.
      expect(chip.getAttribute('aria-disabled')).toBe('true');
      expect(chip.getAttribute('aria-label')).toContain('registered but not yet provisioned');
      const describedBy = chip.getAttribute('aria-describedby');
      expect(describedBy).withContext('aria-describedby set').toBeTruthy();
      const help = row.querySelector<HTMLElement>('[data-testid="sd-provisioning-help"]')!;
      expect(help).withContext('helptext rendered').not.toBeNull();
      expect(help.id).toBe(describedBy!);
      expect(help.textContent!.trim().length).toBeGreaterThan(0);
    });

    it('shows the subtle "Provisioned" state (no helptext) for a fully-provisioned domain', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      // brand-a: caProvisioned=true && appsetRegistered=true → provisioned.
      const row = el.querySelector('[data-cluster-domain="brand-a.example.com"]')!;
      const chip = row.querySelector<HTMLElement>('[data-testid="sd-provisioning"]')!;
      expect(chip).withContext('provisioning chip rendered').not.toBeNull();
      expect(chip.classList).toContain('is-provisioned');
      expect(chip.textContent).toContain('Provisioned');
      expect(chip.getAttribute('aria-label')).toContain(': provisioned');
      // no degraded helptext for a provisioned domain
      expect(row.querySelector('[data-testid="sd-provisioning-help"]')).toBeNull();
    });

    it('isProvisioned requires BOTH caProvisioned and appsetRegistered', () => {
      const base = fixtureDomains()[0];
      expect(component.isProvisioned({ ...base, caProvisioned: true, appsetRegistered: true })).toBe(true);
      expect(component.isProvisioned({ ...base, caProvisioned: true, appsetRegistered: false })).toBe(false);
      expect(component.isProvisioned({ ...base, caProvisioned: false, appsetRegistered: true })).toBe(false);
      expect(component.isProvisioned({ ...base, caProvisioned: false, appsetRegistered: false })).toBe(false);
    });
  });

  it('registers a domain (trimmed/lowercased cluster_domain + brand descriptors) and prepends it', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.createDomain.and.resolveTo({
      id: 'dom-3',
      clusterDomain: 'brand-c.example.com',
      brand: 'brand-c',
      org: 'Brand C',
      caRef: 'pki/brand-c',
      nsPrefix: 'brandc',
      casdoorOrg: 'brand-c-org',
      meshTag: 'tag:brand-c',
      enabled: true,
      createdAt: '2026-06-13T00:00:00Z',
      createdBySubject: 'root',
      updatedAt: '2026-06-13T00:00:00Z',
      caProvisioned: false,
      appsetRegistered: false,
      lastReconciledGeneration: 0,
    });

    component.clusterDomain = '  Brand-C.Example.com ';
    component.brand = ' brand-c ';
    component.org = 'Brand C';
    component.caRef = 'pki/brand-c';
    component.nsPrefix = 'brandc';
    component.casdoorOrg = 'brand-c-org';
    component.meshTag = 'tag:brand-c';
    await component.register();

    expect(bff.createDomain).toHaveBeenCalledWith({
      clusterDomain: 'brand-c.example.com',
      brand: 'brand-c',
      org: 'Brand C',
      caRef: 'pki/brand-c',
      nsPrefix: 'brandc',
      casdoorOrg: 'brand-c-org',
      meshTag: 'tag:brand-c',
    });
    // prepended to the list and the form cleared
    expect(component.domains()[0].clusterDomain).toBe('brand-c.example.com');
    expect(component.clusterDomain).toBe('');
    expect(component.brand).toBe('');
    expect(component.formError()).toBe('');
  });

  it('sends null (not empty strings) for omitted optional descriptors', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.createDomain.and.resolveTo(fixtureDomains()[0]);

    component.clusterDomain = 'brand-x.example.com';
    await component.register();

    expect(bff.createDomain).toHaveBeenCalledWith({
      clusterDomain: 'brand-x.example.com',
      brand: null,
      org: null,
      caRef: null,
      nsPrefix: null,
      casdoorOrg: null,
      meshTag: null,
    });
  });

  it('does not call the BFF and surfaces an error when cluster_domain is blank', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.clusterDomain = '   ';
    await component.register();

    expect(bff.createDomain).not.toHaveBeenCalled();
    expect(component.formError()).not.toBe('');
  });

  it('surfaces the BFF 409 duplicate-cluster_domain error in the form (does not throw)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.createDomain.and.rejectWith(new Error("domain 'brand-a.example.com' is already registered"));

    component.clusterDomain = 'brand-a.example.com';
    await component.register();
    fixture.detectChanges();

    expect(component.formError()).toContain('already registered');
    // the duplicate input is NOT cleared (so the operator can correct it)
    expect(component.clusterDomain).toBe('brand-a.example.com');

    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="sd-error"]')!;
    expect(alert).withContext('409 error live region rendered').not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(el.querySelector<HTMLInputElement>('#sd-cluster-domain')!.getAttribute('aria-invalid')).toBe('true');
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="superadmin-domains-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('sd-heading');
      expect(el.querySelector('#sd-heading')).not.toBeNull();
    });

    it('associates every register-form control with a visible <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['sd-cluster-domain', 'sd-brand', 'sd-org', 'sd-ca-ref', 'sd-ns-prefix', 'sd-casdoor-org', 'sd-mesh-tag']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('gives the domains list a programmatic name (aria-labelledby)', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const list = el.querySelector('[data-testid="sd-domains"]')!;
      expect(list.getAttribute('aria-labelledby')).toBe('sd-list-heading');
      expect(el.querySelector('#sd-list-heading')).not.toBeNull();
    });
  });
});
