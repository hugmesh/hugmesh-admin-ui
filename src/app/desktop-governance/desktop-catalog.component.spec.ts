import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DesktopCatalogComponent } from './desktop-catalog.component';
import { BffService, DesktopCatalogEntry } from '../bff.service';

const entry = (over: Partial<DesktopCatalogEntry> = {}): DesktopCatalogEntry => ({
  id: 'e-1',
  appRef: 'org.mozilla.firefox',
  displayName: 'Firefox',
  source: 'FLATPAK',
  enabled: false,
  addedBy: 'admin@brand-a',
  domain: 'brand-a',
  createdAt: null,
  updatedAt: null,
  ...over,
});

describe('DesktopCatalogComponent (Discover curation)', () => {
  let fixture: ComponentFixture<DesktopCatalogComponent>;
  let component: DesktopCatalogComponent;
  let bff: jasmine.SpyObj<BffService>;

  function setup(initial: DesktopCatalogEntry[]) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'desktopCatalog', 'desktopCatalogAdd', 'desktopCatalogEnable',
      'desktopCatalogDisable', 'desktopCatalogRemove',
    ]);
    bff.desktopCatalog.and.resolveTo(initial);
    TestBed.configureTestingModule({
      imports: [DesktopCatalogComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    fixture = TestBed.createComponent(DesktopCatalogComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── user-situational: the single-admin happy paths ───────────────────────────
  describe('user-situational', () => {
    it('loads the catalog on init and renders each row with its domain + state', async () => {
      setup([entry({ id: 'e-1', enabled: false }), entry({ id: 'e-2', appRef: 'org.gimp.GIMP', enabled: true })]);
      await init();

      expect(bff.desktopCatalog).toHaveBeenCalledTimes(1);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-entry-id="e-1"]')).not.toBeNull();
      expect(el.querySelector('[data-entry-id="e-2"]')).not.toBeNull();
      // domain scoping is surfaced.
      expect(el.querySelector('[data-entry-id="e-1"] [data-testid="dc-domain"]')!.textContent)
        .toContain('brand-a');
    });

    it('ADD sends the ref/displayName/source and ADD != ENABLE (the new row is not enabled)', async () => {
      setup([]);
      await init();
      bff.desktopCatalogAdd.and.resolveTo(entry({ id: 'e-new', enabled: false }));

      component.appRef = ' org.mozilla.firefox ';
      component.displayName = ' Firefox ';
      component.source = 'OCI';
      await component.add();

      // trimmed args; source forwarded.
      expect(bff.desktopCatalogAdd).toHaveBeenCalledWith('org.mozilla.firefox', 'Firefox', 'OCI');
      // form cleared on success.
      expect(component.appRef).toBe('');
      expect(component.displayName).toBe('');
      // NEVER auto-enables on add.
      expect(bff.desktopCatalogEnable).not.toHaveBeenCalled();
    });

    it('ENABLE then DISABLE flips the store visibility (add != enable made explicit)', async () => {
      setup([entry({ id: 'e-1', enabled: false })]);
      await init();
      bff.desktopCatalogEnable.and.resolveTo({ updated: 1, enabled: true });
      bff.desktopCatalogDisable.and.resolveTo({ updated: 1, enabled: false });

      await component.enable('e-1');
      expect(bff.desktopCatalogEnable).toHaveBeenCalledWith('e-1');
      await component.disable('e-1');
      expect(bff.desktopCatalogDisable).toHaveBeenCalledWith('e-1');
      // a reload after each mutation (init + 2).
      expect(bff.desktopCatalog).toHaveBeenCalledTimes(3);
    });

    it('REMOVE deletes the row entirely', async () => {
      setup([entry({ id: 'e-1' })]);
      await init();
      bff.desktopCatalogRemove.and.resolveTo({ removed: 1 });
      await component.remove('e-1');
      expect(bff.desktopCatalogRemove).toHaveBeenCalledWith('e-1');
    });

    it('validates locally (no BFF call) when the app ref or display name is blank', async () => {
      setup([]);
      await init();
      component.appRef = '';
      component.displayName = 'Firefox';
      await component.add();
      expect(bff.desktopCatalogAdd).not.toHaveBeenCalled();
      expect(component.addError()).not.toBe('');

      component.appRef = 'org.x';
      component.displayName = '';
      await component.add();
      expect(bff.desktopCatalogAdd).not.toHaveBeenCalled();
    });

    it('surfaces a BFF reject (duplicate / bad source) and KEEPS the form for a fix', async () => {
      setup([]);
      await init();
      bff.desktopCatalogAdd.and.rejectWith(new Error('app already in the catalog'));
      component.appRef = 'org.x';
      component.displayName = 'X';
      await component.add();
      expect(component.addError()).toBe('app already in the catalog');
      expect(component.appRef).toBe('org.x'); // kept
    });
  });

  // ── default-NONE: the store-empty signal ─────────────────────────────────────
  describe('default-NONE store behaviour', () => {
    it('flags the store as empty when every row is disabled (serves nothing)', async () => {
      setup([entry({ id: 'e-1', enabled: false }), entry({ id: 'e-2', enabled: false })]);
      await init();
      expect(component.storeEmpty()).toBeTrue();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dc-store-empty"]')).not.toBeNull();
    });

    it('does NOT flag the store empty once a row is enabled', async () => {
      setup([entry({ id: 'e-1', enabled: true }), entry({ id: 'e-2', enabled: false })]);
      await init();
      expect(component.storeEmpty()).toBeFalse();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="dc-store-empty"]')).toBeNull();
    });
  });

  // ── multiuser / cross-domain isolation (SUPERADMIN sees multiple brands) ─────
  describe('multiuser / cross-domain', () => {
    it('renders rows from MULTIPLE domains for a superadmin (the BFF scoped the read)', async () => {
      setup([entry({ id: 'e-a', domain: 'brand-a' }), entry({ id: 'e-b', domain: 'brand-b' })]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-entry-id="e-a"] [data-testid="dc-domain"]')!.textContent)
        .toContain('brand-a');
      expect(el.querySelector('[data-entry-id="e-b"] [data-testid="dc-domain"]')!.textContent)
        .toContain('brand-b');
    });

    it('a scoped admin only ever receives own-domain rows (no cross-domain leak) — the table renders exactly what the BFF returned', async () => {
      // The BFF returns ONLY brand-a for a scoped brand-a admin; the table never invents others.
      setup([entry({ id: 'e-a', domain: 'brand-a' })]);
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('tbody tr[data-entry-id]').length).toBe(1);
      expect(el.querySelector('[data-entry-id="e-b"]')).toBeNull();
    });
  });

  // ── accessibility ─────────────────────────────────────────────────────────
  describe('accessibility', () => {
    beforeEach(async () => {
      setup([entry({ id: 'e-1', enabled: false }), entry({ id: 'e-2', enabled: true })]);
      await init();
    });

    it('labels the section + table via aria-labelledby', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="desktop-catalog-view"]')!.getAttribute('aria-labelledby'))
        .toBe('dc-heading');
      expect(el.querySelector('[data-testid="dc-table"]')!.getAttribute('aria-labelledby'))
        .toBe('dc-table-heading');
    });

    it('associates every add-form control with a visible <label for>', () => {
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['dc-app-ref', 'dc-display-name', 'dc-source']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('announces an add error in role=alert/assertive and sets aria-invalid', async () => {
      component.appRef = '';
      component.displayName = '';
      await component.add();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="dc-add-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#dc-app-ref')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('gives each enable / disable / remove button a target-specific accessible name', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-enable="e-1"]')!.getAttribute('aria-label')).toContain('Firefox');
      expect(el.querySelector('[data-disable="e-2"]')!.getAttribute('aria-label')).toContain('brand-a');
      expect(el.querySelector('[data-remove="e-1"]')!.getAttribute('aria-label')).toContain('Remove');
    });
  });
});
