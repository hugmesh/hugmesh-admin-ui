import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageGenComponent } from './image-gen.component';
import { ImageGenStore } from './image-gen-store.service';
import {
  BffService,
  ImageBuild,
  PLATFORM_CAPABILITIES_ABSENT,
} from '../bff.service';

function build(id: string, over: Partial<ImageBuild> = {}): ImageBuild {
  return {
    id,
    createdAt: '2026-06-17T00:00:00Z',
    requestedBy: 'admin@brand',
    targetUser: 'alice@brand',
    domain: 'brand',
    imageType: 'primary',
    hardwareClass: 'rpi5',
    deviceId: null,
    status: 'COMPLETED',
    sshKeysAllowed: false,
    jobName: null,
    imageRef: 'builds/x/image.img',
    keysRef: null,
    startedAt: '2026-06-17T00:00:00Z',
    finishedAt: '2026-06-17T00:05:00Z',
    error: null,
    ...over,
  };
}

describe('ImageGenComponent (worklist host shell)', () => {
  let fixture: ComponentFixture<ImageGenComponent>;
  let component: ImageGenComponent;
  let bff: jasmine.SpyObj<BffService>;

  // A completed build with keys ALLOWED + a keys artifact → keys-download control shown.
  const withKeys = build('k1', { sshKeysAllowed: true, keysRef: 'builds/k1/keys.tar.gz' });
  // A completed build with keys NOT allowed → keys-download control hidden.
  const noKeys = build('n1', { sshKeysAllowed: false, keysRef: null });

  function configure(caps: Partial<typeof PLATFORM_CAPABILITIES_ABSENT> = { buildNodePresent: true }) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'listImageBuilds', 'imageBuildDetail', 'downloadImage', 'downloadImageKeys',
      'platformCapabilities', 'listDomains', 'submitWorklistBatch', 'imageBuildEvents',
    ]);
    bff.listImageBuilds.and.resolveTo({ builds: [withKeys, noKeys], launchReal: true });
    bff.imageBuildDetail.and.resolveTo(withKeys);
    bff.downloadImage.and.resolveTo(true);
    bff.downloadImageKeys.and.resolveTo(true);
    bff.listDomains.and.resolveTo([]);
    bff.submitWorklistBatch.and.resolveTo({ batchId: 'x', builds: [] });
    bff.imageBuildEvents.and.returnValue(new Promise<void>(() => { /* pending */ }));
    bff.platformCapabilities.and.resolveTo({ ...PLATFORM_CAPABILITIES_ABSENT, ...caps });

    TestBed.configureTestingModule({
      imports: [ImageGenComponent],
      providers: [ImageGenStore, { provide: BffService, useValue: bff }],
    });
    fixture = TestBed.createComponent(ImageGenComponent);
    component = fixture.componentInstance;
  }

  async function init() {
    fixture.detectChanges();
    // ngOnInit chains platform.load() -> store refresh (async hops); flush.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── CAPABILITY-GATE (image generation needs an x86 build node) ────────────
  describe('CAPABILITY-GATE', () => {
    it('greys out the console (gate notice, no wizard, no table) when the build node is absent', async () => {
      configure({ buildNodePresent: false });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate).not.toBeNull();
      expect(gate.getAttribute('data-capability')).toBe('buildNode');
      expect(gate.getAttribute('data-state')).toBe('absent');
      expect(el.querySelector('[data-testid="ig-wizard"]')).toBeNull();
      expect(el.querySelector('[data-testid="ig-table"]')).toBeNull();
      expect(bff.listImageBuilds).not.toHaveBeenCalled();
    });

    it('switches to the "could not determine" state + surfaces the warning when undetectable', async () => {
      configure({ buildNodePresent: false, warnings: ['x86 build-node presence could not be detected.'] });
      await init();
      const gate = fixture.nativeElement.querySelector('[data-testid="capability-gate"]')!;
      expect(gate.getAttribute('data-state')).toBe('undetectable');
      expect(gate.querySelector('[data-testid="capability-gate-warning"]')!.textContent).toContain('build-node');
    });

    it('shows the wizard + history table (no gate) when the build node is present', async () => {
      configure({ buildNodePresent: true });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="capability-gate"]')).toBeNull();
      expect(el.querySelector('[data-testid="ig-wizard"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="ig-table"]')).not.toBeNull();
      expect(bff.listImageBuilds).toHaveBeenCalled();
    });
  });

  // ── DARK-SHIPS notice ─────────────────────────────────────────────────────
  describe('SHIPS-DARK', () => {
    it('announces the dark/stub seam when the launcher is not real', async () => {
      configure({ buildNodePresent: true });
      bff.listImageBuilds.and.resolveTo({ builds: [], launchReal: false });
      await init();
      expect(fixture.nativeElement.querySelector('[data-testid="ig-launch-stub"]')).not.toBeNull();
    });
  });

  // ── HISTORY table + detail + downloads ────────────────────────────────────
  describe('HISTORY', () => {
    beforeEach(() => configure({ buildNodePresent: true }));

    it('invokes the image-download bff method for a completed build', async () => {
      await init();
      await component.downloadImage(withKeys);
      expect(bff.downloadImage).toHaveBeenCalledWith(withKeys.id);
    });

    it('surfaces an honest note when an image download is unavailable', async () => {
      bff.downloadImage.and.resolveTo(false);
      await init();
      await component.downloadImage(withKeys);
      expect(component.downloadNote()).toContain('No image');
    });

    it('opens and closes the inline build detail', async () => {
      await init();
      await component.toggleDetail(withKeys);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ig-detail"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="ig-detail-keys-allowed"]')!.textContent).toContain('yes');
      expect(el.querySelector('[data-testid="ig-key-safety"]')).not.toBeNull();

      await component.toggleDetail(withKeys);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="ig-detail"]')).toBeNull();
    });
  });

  // ── KEYS-DOWNLOAD CONTROL (conditional on ssh_keys_allowed + step-up) ─────
  describe('KEYS-DOWNLOAD', () => {
    beforeEach(() => configure({ buildNodePresent: true }));

    it('HIDES the keys-download control when ssh_keys_allowed is false', async () => {
      await init();
      expect(fixture.nativeElement.querySelector(`[data-download-keys="${noKeys.id}"]`)).toBeNull();
    });

    it('SHOWS the keys-download control (a11y: names step-up + non-secret) when allowed + completed', async () => {
      await init();
      const ctrl = fixture.nativeElement.querySelector(`[data-download-keys="${withKeys.id}"]`)!;
      expect(ctrl).not.toBeNull();
      expect(ctrl.getAttribute('aria-label')).toContain('step-up');
    });

    it('attempts the keys download (the BFF is the step-up gate; no client token)', async () => {
      await init();
      await component.downloadKeys(withKeys);
      expect(bff.downloadImageKeys).toHaveBeenCalledWith(withKeys.id, undefined);
    });

    it('offers the inline MFA step-up dialog when a keys download 403s "requires step-up", then retries', async () => {
      bff.downloadImageKeys.and.rejectWith(
        new Error('keys download requires step-up re-authentication (present X-ImageGen-StepUp)'),
      );
      await init();
      await component.downloadKeys(withKeys);
      fixture.detectChanges();
      expect(component.stepUpChallenge()).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();
      expect(component.downloadNote()).toBe('');

      bff.downloadImageKeys.and.resolveTo(true);
      await component.onStepUpSatisfied();
      expect(component.stepUpChallenge()).toBeNull();
      expect(bff.downloadImageKeys).toHaveBeenCalledTimes(2);
    });

    it('dismissing the step-up dialog drops the pending retry', async () => {
      bff.downloadImageKeys.and.rejectWith(new Error('keys download requires step-up re-authentication'));
      await init();
      await component.downloadKeys(withKeys);
      expect(component.stepUpChallenge()).not.toBeNull();
      component.onStepUpDismissed();
      expect(component.stepUpChallenge()).toBeNull();
      expect(bff.downloadImageKeys).toHaveBeenCalledTimes(1);
    });

    it('surfaces a non-step-up download failure as a note, not a crash', async () => {
      bff.downloadImageKeys.and.rejectWith(new Error('image generation is disabled on this deployment'));
      await init();
      await component.downloadKeys(withKeys);
      expect(component.downloadNote()).toContain('disabled');
      expect(component.stepUpChallenge()).toBeNull();
    });

    it('canDownloadKeys is false for a build that did not allow keys', () => {
      // Uses the component configured in beforeEach (a pure method — no init needed).
      expect(component.canDownloadKeys(noKeys)).toBe(false);
      expect(component.canDownloadKeys(withKeys)).toBe(true);
    });
  });

  // ── CONCURRENT (teardown resets the N-stream store) ───────────────────────
  describe('CONCURRENT', () => {
    it('resets the live-batch streams on destroy', async () => {
      configure({ buildNodePresent: true });
      await init();
      const spy = spyOn(component.store, 'reset').and.callThrough();
      component.ngOnDestroy();
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── item 9: host mediates the package-catalog modal (the WIZARD↔MODAL seam) ─
  describe('PACKAGE MODAL', () => {
    beforeEach(async () => {
      configure({ buildNodePresent: true });
      await init();
    });

    it('seeds the modal from an entry and folds the applied selection back onto it', () => {
      const wiz = component['wizard']()!;
      expect(wiz).withContext('wizard must render under the capability gate').toBeTruthy();
      const key = wiz.entries()[0].key;
      wiz.patchEntry(key, { packagesAdd: 'app-editors/vim', packagesDrop: '' });

      component.onEditPackages(key);
      expect(component.pkgModalOpen()).toBeTrue();
      expect(component.pkgModalPlatform()).toBe(wiz.entries()[0].platform);
      // atoms round-trip string -> array for the modal
      expect(component.pkgModalSelection()!.add).toEqual(['app-editors/vim']);

      // modal applies atom ARRAYS; the host adapts to space-joined strings on the entry
      component.onPackagesApplied({ add: ['app-misc/tmux'], drop: ['games-util/steam'], options: [] });
      expect(component.pkgModalOpen()).toBeFalse();
      const e = wiz.entries()[0];
      expect(e.packagesAdd).toBe('app-misc/tmux');
      expect(e.packagesDrop).toBe('games-util/steam');
    });

    it('ignores an edit request for an unknown entry key (no throw, stays closed)', () => {
      expect(() => component.onEditPackages('nope.nope')).not.toThrow();
      expect(component.pkgModalOpen()).toBeFalse();
    });

    it('labels the modal with the entry wire id (role.platform), not the opaque row key', () => {
      const wiz = component['wizard']()!;
      const key = wiz.entries()[0].key;
      wiz.patchEntry(key, { role: 'be', platform: 'x86' });
      component.onEditPackages(key);
      expect(component.pkgModalImageLabel()).toBe('be.x86');
      expect(component.pkgModalImageLabel()).not.toBe(key); // key is an opaque wle-N-xxxx
      // The entry's role is seeded too — the modal needs it to pick the catalog's
      // per-(platform, role) tier baseline (locked floor / removable defaults).
      expect(component.pkgModalRole()).toBe('be');
    });

    it('round-trips adhoc option keys through the seam (seeds from the entry, persists on apply)', () => {
      const wiz = component['wizard']()!;
      const key = wiz.entries()[0].key;
      wiz.patchEntry(key, { packagesAdd: 'net-vpn/tor', options: ['tor'] });
      component.onEditPackages(key);
      expect(component.pkgModalSelection()!.options).toEqual(['tor']); // seeded, not cleared to []
      component.onPackagesApplied({ add: ['net-vpn/tor'], drop: [], options: ['tor'] });
      expect(wiz.entries()[0].options).toEqual(['tor']); // persisted back onto the entry
    });
  });
});
