import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageGenWorklistWizardComponent } from './image-gen-worklist-wizard.component';
import { ImageGenStore } from './image-gen-store.service';
import { BffService, DomainResponse, ImageBuildBatchResult, WorklistEnvelope } from '../bff.service';
import { buildWorklistEnvelope, newEntry } from './worklist-entry.model';

function domain(clusterDomain: string, over: Partial<DomainResponse> = {}): DomainResponse {
  return {
    id: 'id-' + clusterDomain,
    clusterDomain,
    brand: clusterDomain.split('.')[0],
    org: 'Org',
    caRef: '',
    nsPrefix: '',
    casdoorOrg: '',
    meshTag: '',
    enabled: true,
    createdAt: '2026-06-01T00:00:00Z',
    createdBySubject: 'admin',
    updatedAt: '2026-06-01T00:00:00Z',
    caProvisioned: false,
    appsetRegistered: false,
    lastReconciledGeneration: 0,
    ...over,
  };
}

function batchResult(n: number): ImageBuildBatchResult {
  return {
    batchId: 'batch-x',
    builds: Array.from({ length: n }, (_, i) => ({
      id: `bb${i}`,
      status: 'QUEUED' as const,
      imageType: 'client' as const,
      domain: 'brand',
      sshKeysAllowed: false,
    })),
  };
}

describe('ImageGenWorklistWizardComponent', () => {
  let fixture: ComponentFixture<ImageGenWorklistWizardComponent>;
  let component: ImageGenWorklistWizardComponent;
  let bff: jasmine.SpyObj<BffService>;

  const DOMAINS = [
    domain('acme.example'),
    domain('beta.example'),
    domain('old.example', { enabled: false }),
  ];

  function configure(roles: string[] = ['admin']): void {
    // Reset first so a test may re-configure (e.g. to switch roles) within one spec.
    TestBed.resetTestingModule();
    localStorage.setItem('hug.session', JSON.stringify({
      id: 'x', label: 'x', provider: 'google', roles, registrationComplete: true,
    }));
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'listDomains', 'submitWorklistBatch', 'imageBuildEvents', 'listImageBuilds',
    ]);
    bff.listDomains.and.resolveTo(DOMAINS);
    bff.submitWorklistBatch.and.resolveTo(batchResult(2));
    bff.imageBuildEvents.and.returnValue(new Promise<void>(() => { /* pending */ }));
    bff.listImageBuilds.and.resolveTo({ builds: [], launchReal: true });

    TestBed.configureTestingModule({
      imports: [ImageGenWorklistWizardComponent],
      providers: [ImageGenStore, { provide: BffService, useValue: bff }],
    });
    fixture = TestBed.createComponent(ImageGenWorklistWizardComponent);
    component = fixture.componentInstance;
  }

  async function init(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => localStorage.removeItem('hug.session'));

  // ── STEP NAV ──────────────────────────────────────────────────────────────
  describe('step navigation', () => {
    beforeEach(() => configure());

    it('renders the 4-step rail and starts on Images', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('[data-testid="wl-step-rail"] li').length).toBe(4);
      expect(el.querySelector('[data-testid="wl-step-images"]')).not.toBeNull();
      expect(component.currentStep()).toBe('images');
    });

    it('BLOCKS next when an entry is missing its target user / role', async () => {
      await init();
      component.next();
      expect(component.stepIndex()).toBe(0);
      expect(component.error()).toContain('valid target user');
    });

    it('advances to Domains once the entry is valid', async () => {
      await init();
      component.entries.set([newEntry({ targetUser: 'alice@acme', role: 'laptop' })]);
      component.next();
      expect(component.currentStep()).toBe('domains');
      expect(component.error()).toBe('');
    });

    it('back() returns to the previous step', async () => {
      await init();
      component.entries.set([newEntry({ targetUser: 'alice@acme', role: 'laptop' })]);
      component.next();
      component.back();
      expect(component.currentStep()).toBe('images');
    });
  });

  // ── ENTRIES (item 1: add/remove, cap 16, enumerated platform) ─────────────
  describe('entries', () => {
    beforeEach(() => configure());

    it('adds and removes entries, keeping at least one', async () => {
      await init();
      expect(component.entries().length).toBe(1);
      component.addEntry();
      expect(component.entries().length).toBe(2);
      const key = component.entries()[0].key;
      component.removeEntry(key);
      expect(component.entries().length).toBe(1);
      component.removeEntry(component.entries()[0].key); // last one is protected
      expect(component.entries().length).toBe(1);
    });

    it('caps the worklist at 16 images', async () => {
      await init();
      for (let i = 0; i < 20; i++) component.addEntry();
      expect(component.entries().length).toBe(16);
      expect(component.canAddEntry()).toBeFalse();
    });

    it('offers ONLY the six enumerated platforms (no free-text hardware class)', async () => {
      await init();
      expect(component.platformOptions.map((p) => p.value)).toEqual([
        'x86', 'rpi5', 'frite', 'jetson', 'orangepi5', 'orangepizero2',
      ]);
    });
  });

  // ── DESKTOP-ONLY sub-forms (items 2/3/7) ──────────────────────────────────
  describe('desktop-only gating', () => {
    it('HIDES the desktop sub-forms for a node-class entry', async () => {
      configure();
      await init();
      component.entries.set([newEntry({ role: 'be', imageClass: 'node', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-desktop-subform]')).toBeNull();
    });

    it('SHOWS branding + home sub-forms for a desktop-class entry', async () => {
      configure();
      await init();
      component.entries.set([newEntry({ role: 'laptop', imageClass: 'desktop', imageType: 'client', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-desktop-subform]')).not.toBeNull();
      expect(el.querySelector('[data-branding-preset-radio]')).not.toBeNull();
      expect(el.querySelector('[data-home]')).not.toBeNull();
    });

    it('branding is a strict preset XOR custom toggle', async () => {
      configure();
      await init();
      const e = newEntry({ role: 'laptop', imageClass: 'desktop', imageType: 'client', targetUser: 'a@acme' });
      component.entries.set([e]);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      // Default preset → preset field shown, custom hidden.
      expect(el.querySelector('[data-branding-preset]')).not.toBeNull();
      expect(el.querySelector('[data-branding-custom]')).toBeNull();
      component.patchEntry(e.key, { brandingMode: 'custom' });
      fixture.detectChanges();
      expect(el.querySelector('[data-branding-preset]')).toBeNull();
      expect(el.querySelector('[data-branding-custom]')).not.toBeNull();
    });
  });

  // ── SUPERADMIN gating of the cross-tenant tailnet/SSO sub-form (item 3) ────
  describe('tailnet/SSO superadmin gating', () => {
    function desktopEntry() {
      return newEntry({ role: 'laptop', imageClass: 'desktop', imageType: 'client', targetUser: 'a@acme' });
    }

    it('HIDES tailnet/SSO for a non-superadmin admin even on an eligible branded desktop', async () => {
      configure(['admin']);
      await init();
      component.entries.set([desktopEntry()]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-tailnet-subform]')).toBeNull();
    });

    it('SHOWS tailnet/SSO for a superadmin on an eligible branded desktop', async () => {
      configure(['admin', 'superadmin']);
      await init();
      component.entries.set([desktopEntry()]);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-tailnet-subform]')).not.toBeNull();
      expect(el.querySelector('[data-tailnet]')).not.toBeNull();
      expect(el.querySelector('[data-sso]')).not.toBeNull();
    });

    it('HIDES tailnet/SSO for the unaffiliated standalone role even as superadmin', async () => {
      configure(['admin', 'superadmin']);
      await init();
      component.entries.set([newEntry({ role: 'standalone-unaffiliated', imageClass: 'desktop', imageType: 'client', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-tailnet-subform]')).toBeNull();
    });
  });

  // ── Tor onion toggle visibility (x86 NODE only) ───────────────────────────
  describe('Tor onion toggle gating', () => {
    it('SHOWS the Tor onion toggle for an x86 node image', async () => {
      configure(['admin']);
      await init();
      component.entries.set([newEntry({ role: 'be', platform: 'x86', imageClass: 'node', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-tor-onion-subform]')).not.toBeNull();
      expect(el.querySelector('[data-tor-onion]')).not.toBeNull();
    });

    it('HIDES the Tor onion toggle for a non-x86 node image', async () => {
      configure(['admin']);
      await init();
      component.entries.set([newEntry({ role: 'be', platform: 'rpi5', imageClass: 'node', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-tor-onion-subform]')).toBeNull();
    });

    it('HIDES the Tor onion toggle for an x86 desktop/client image', async () => {
      configure(['admin']);
      await init();
      component.entries.set([newEntry({ role: 'laptop', platform: 'x86', imageClass: 'desktop', imageType: 'client', targetUser: 'a@acme' })]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-tor-onion-subform]')).toBeNull();
    });
  });

  // ── DOMAINS step (item 4, fed by listDomains, enabled only, NO games) ─────
  describe('domains step', () => {
    async function toDomains(roles: string[] = ['admin']) {
      configure(roles);
      await init();
      component.entries.set([newEntry({ targetUser: 'a@acme', role: 'laptop' })]);
      component.next(); // → domains
      fixture.detectChanges();
    }

    it('lists ONLY enabled registry domains', async () => {
      await toDomains();
      expect(component.enabledDomains().map((d) => d.clusterDomain)).toEqual(['acme.example', 'beta.example']);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-attach]')).not.toBeNull();
      // The disabled domain is not rendered as a checkbox.
      expect(el.querySelector('[data-attach$="old.example"]')).toBeNull();
    });

    it('shows the own-domain note for a non-superadmin, hides it for superadmin', async () => {
      await toDomains(['admin']);
      expect(fixture.nativeElement.querySelector('[data-testid="wl-domains-owndomain-note"]')).not.toBeNull();
      await toDomains(['admin', 'superadmin']);
      expect(fixture.nativeElement.querySelector('[data-testid="wl-domains-owndomain-note"]')).toBeNull();
    });

    it('toggling a domain attaches it to that entry only', async () => {
      await toDomains();
      const key = component.entries()[0].key;
      component.toggleEntryDomain(key, 'acme.example', true);
      expect(component.entries()[0].attachedDomains).toEqual(['acme.example']);
      component.toggleEntryDomain(key, 'acme.example', false);
      expect(component.entries()[0].attachedDomains).toEqual([]);
    });
  });

  // ── USERS step (item 6) ───────────────────────────────────────────────────
  describe('users step', () => {
    beforeEach(() => configure());

    it('adds, edits and removes user rows', async () => {
      await init();
      component.addUser();
      component.patchUser(0, { username: 'alice', domain: 'acme.example', role: 'user', email: 'a@x' });
      expect(component.users()[0].username).toBe('alice');
      component.removeUser(0);
      expect(component.users().length).toBe(0);
    });
  });

  // ── SUBMIT → envelope assembly + single step-up (items 1/1b/4/6) ──────────
  describe('submit', () => {
    it('assembles the frozen envelope (enumerated platform, no domain field, inverted domains) and submits with ONE step-up token', async () => {
      configure(['admin', 'superadmin']);
      await init();
      const e = newEntry({
        role: 'laptop', platform: 'x86', imageClass: 'desktop', imageType: 'client',
        targetUser: 'alice@acme', sshKeysAllowed: true, encryptRoot: 'on',
        packagesAdd: 'app-editors/vim', attachedDomains: ['acme.example'],
      });
      component.entries.set([e]);
      component.users.set([{ username: 'alice', domain: 'acme.example', role: 'user', email: 'a@x' }]);
      component.maxConcurrent = 2;
      component.stepUpToken = 'stepup-1';

      await component.build();

      expect(bff.submitWorklistBatch).toHaveBeenCalledTimes(1);
      const [env, token] = bff.submitWorklistBatch.calls.mostRecent().args as [WorklistEnvelope, string];
      expect(token).toBe('stepup-1');
      expect(env.schema).toBe('hugmesh-worklist/v1');
      expect(env.maxConcurrent).toBe(2);
      expect(env.entries.length).toBe(1);
      const spec = env.entries[0];
      expect(spec.hardwareClass).toBe('x86'); // enumerated platform, NOT free-text
      expect(spec.targetUser).toBe('alice@acme');
      expect((spec as unknown as Record<string, unknown>)['domain']).toBeUndefined(); // never a client-picked tenant
      expect(spec.imageSpec).toEqual(jasmine.objectContaining({ role: 'laptop', platform: 'x86', encrypt_root: 'on', packages_add: 'app-editors/vim' }));
      // domains inverted → base.domains[].images entry-id refs
      const base = env.base as Record<string, unknown>;
      expect(base['domains']).toEqual([{ name: 'acme.example', images: ['laptop.x86'] }]);
      expect(base['users']).toEqual([{ username: 'alice', domain: 'acme.example', role: 'user', email: 'a@x' }]);
      expect(component.submitted()).toBeTrue();
    });

    it('refuses to submit an invalid worklist without calling the BFF', async () => {
      configure();
      await init();
      component.entries.set([newEntry({ targetUser: '', role: '' })]);
      await component.build();
      expect(bff.submitWorklistBatch).not.toHaveBeenCalled();
      expect(component.submitted()).toBeFalse();
    });

    it('offers the inline step-up dialog on a "requires step-up" 403, then retries on satisfied', async () => {
      configure();
      await init();
      component.entries.set([newEntry({ targetUser: 'a@acme', role: 'be' })]);
      component.stepIndex.set(3); // Review step, where the dialog renders
      bff.submitWorklistBatch.and.rejectWith(new Error('image build requires step-up re-authentication (present X-ImageGen-StepUp)'));
      await component.build();
      fixture.detectChanges();
      expect(component.stepUpChallenge()).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();

      bff.submitWorklistBatch.and.resolveTo(batchResult(1));
      await component.onStepUpSatisfied();
      expect(component.stepUpChallenge()).toBeNull();
      expect(bff.submitWorklistBatch).toHaveBeenCalledTimes(2);
      expect(component.submitted()).toBeTrue();
    });
  });

  // ── PROGRESS SCREEN (item 8: N cards over the store Map) ──────────────────
  describe('progress screen', () => {
    beforeEach(() => configure());

    it('renders one card per build after submit, then resets on "build another"', async () => {
      await init();
      component.entries.set([newEntry({ targetUser: 'a@acme', role: 'be' })]);
      await component.build();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="wl-progress-screen"]')).not.toBeNull();
      expect(el.querySelectorAll('[data-testid="wl-build-cards"] [data-build]').length).toBe(2);
      // The form is swapped out.
      expect(el.querySelector('[data-testid="wl-step-images"]')).toBeNull();

      component.buildAnother();
      fixture.detectChanges();
      expect(component.submitted()).toBeFalse();
      expect(component.stepIndex()).toBe(0);
      expect(component.store.buildIds()).toEqual([]);
      expect(fixture.nativeElement.querySelector('[data-testid="wl-step-images"]')).not.toBeNull();
    });
  });
});

// ── Pure assembly unit (item 1b content channel) ────────────────────────────
describe('buildWorklistEnvelope', () => {
  it('emits imageSpec CONTENT with no secret / no domain field, desktop fields only for desktop', () => {
    const node = newEntry({ role: 'be', platform: 'rpi5', imageClass: 'node', targetUser: 'n@acme' });
    const desk = newEntry({ role: 'laptop', platform: 'x86', imageClass: 'desktop', imageType: 'client', targetUser: 'd@acme', homeEnabled: true });
    const env = buildWorklistEnvelope([node, desk], [], 1);
    expect(env.entries[0].imageSpec).toEqual({ role: 'be', platform: 'rpi5' });
    // desktop entry carries the home flag; no branding preset set → not present
    expect(env.entries[1].imageSpec).toEqual(jasmine.objectContaining({ role: 'laptop', platform: 'x86', home: true }));
    // never any *_pass / secret keys
    for (const spec of env.entries) {
      expect(JSON.stringify(spec.imageSpec)).not.toMatch(/pass|password|luks/i);
    }
  });

  it('collapses an empty base to null', () => {
    const env = buildWorklistEnvelope([newEntry({ role: 'be', targetUser: 'n@acme' })], [], 1);
    expect(env.base).toBeNull();
  });

  // ── Tor onion (x86 node → tor_onion_service; the generator folds it to --with-tor) ──
  it('emits tor_onion_service for an x86 NODE entry with torOnion on', () => {
    const e = newEntry({ role: 'be', platform: 'x86', imageClass: 'node', targetUser: 'n@acme', torOnion: true });
    const env = buildWorklistEnvelope([e], [], 1);
    expect(env.entries[0].imageSpec).toEqual(jasmine.objectContaining({ tor_onion_service: true }));
  });

  it('OMITS tor_onion_service when torOnion is off (fail-closed default)', () => {
    const e = newEntry({ role: 'be', platform: 'x86', imageClass: 'node', targetUser: 'n@acme' });
    const env = buildWorklistEnvelope([e], [], 1);
    expect(env.entries[0].imageSpec).not.toEqual(jasmine.objectContaining({ tor_onion_service: jasmine.anything() }));
  });

  it('DROPS tor_onion_service on a non-x86 node even if torOnion is on (no dead flag; rpi5 tor rides --optional-services, not offered here)', () => {
    const e = newEntry({ role: 'be', platform: 'rpi5', imageClass: 'node', targetUser: 'n@acme', torOnion: true });
    const env = buildWorklistEnvelope([e], [], 1);
    expect(env.entries[0].imageSpec).not.toEqual(jasmine.objectContaining({ tor_onion_service: jasmine.anything() }));
  });

  it('DROPS tor_onion_service on an x86 CLIENT/desktop image even if torOnion is on (the onion is a NODE service)', () => {
    const e = newEntry({ role: 'laptop', platform: 'x86', imageClass: 'desktop', imageType: 'client', targetUser: 'd@acme', torOnion: true });
    const env = buildWorklistEnvelope([e], [], 1);
    expect(env.entries[0].imageSpec).not.toEqual(jasmine.objectContaining({ tor_onion_service: jasmine.anything() }));
  });
});
