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

describe('ImageGenComponent', () => {
  let fixture: ComponentFixture<ImageGenComponent>;
  let component: ImageGenComponent;
  let bff: jasmine.SpyObj<BffService>;

  // A completed build with keys ALLOWED + a keys artifact → keys-download control shown.
  const withKeys = build('k1', { sshKeysAllowed: true, keysRef: 'builds/k1/keys.tar.gz' });
  // A completed build with keys NOT allowed → keys-download control hidden.
  const noKeys = build('n1', { sshKeysAllowed: false, keysRef: null });

  function configure(caps: Partial<typeof PLATFORM_CAPABILITIES_ABSENT> = { buildNodePresent: true }) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'listImageBuilds', 'imageBuildDetail', 'triggerImageBuild', 'imageBuildEvents',
      'downloadImage', 'downloadImageKeys', 'platformCapabilities',
    ]);
    bff.listImageBuilds.and.resolveTo({ builds: [withKeys, noKeys], launchReal: true });
    bff.imageBuildDetail.and.resolveTo(withKeys);
    bff.triggerImageBuild.and.resolveTo({
      id: 'b2', status: 'QUEUED', imageType: 'primary', domain: 'brand', sshKeysAllowed: true,
    });
    bff.downloadImage.and.resolveTo(true);
    bff.downloadImageKeys.and.resolveTo(true);
    bff.imageBuildEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ buildId: 'b2', phase: 'running', percent: 40, message: 'debootstrap', imageRef: null, keysRef: null, done: false, error: null });
      onEvent({ buildId: 'b2', phase: 'complete', percent: 100, message: 'done', imageRef: 'builds/b2/image.img', keysRef: null, done: true, error: null });
    });
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
    // ngOnInit chains platform.load() -> store refresh (two async hops); flush BOTH.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── CAPABILITY-GATE (image generation needs an x86 build node) ────────────
  describe('CAPABILITY-GATE', () => {
    it('greys out the console (gate notice, no form) when the build node is absent', async () => {
      configure({ buildNodePresent: false });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate).not.toBeNull();
      expect(gate.getAttribute('data-capability')).toBe('buildNode');
      expect(gate.getAttribute('data-state')).toBe('absent');
      // The trigger form + history are suppressed entirely.
      expect(el.querySelector('[data-testid="ig-trigger-form"]')).toBeNull();
      expect(el.querySelector('[data-testid="ig-table"]')).toBeNull();
      // History is NOT fetched when the console is dark.
      expect(bff.listImageBuilds).not.toHaveBeenCalled();
    });

    it('switches to the "could not determine" state + surfaces the warning when undetectable', async () => {
      configure({ buildNodePresent: false, warnings: ['x86 build-node presence could not be detected.'] });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate.getAttribute('data-state')).toBe('undetectable');
      expect(gate.querySelector('[data-testid="capability-gate-warning"]')!.textContent)
        .toContain('build-node');
    });

    it('shows the console (no gate) when the build node is present', async () => {
      configure({ buildNodePresent: true });
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="capability-gate"]')).toBeNull();
      expect(el.querySelector('[data-testid="ig-trigger-form"]')).not.toBeNull();
      expect(bff.listImageBuilds).toHaveBeenCalled();
    });
  });

  // ── USER-SITUATIONAL (the admin's allowed actions + the disabled states) ──
  describe('USER-SITUATIONAL', () => {
    beforeEach(() => configure({ buildNodePresent: true }));

    it('renders a radio per image type with its hint (not colour alone)', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      for (const it of component.store.imageTypes) {
        expect(el.querySelector(`[data-image-type="${it.value}"]`)).withContext(it.value).not.toBeNull();
      }
    });

    it('rejects an empty target user without calling the BFF', async () => {
      await init();
      component.targetUser = '   ';
      component.stepUpToken = 'tok';
      await component.triggerBuild();
      expect(bff.triggerImageBuild).not.toHaveBeenCalled();
      expect(component.error()).toContain('target user');
    });

    it('requires a step-up token before triggering', async () => {
      await init();
      component.targetUser = 'alice@brand';
      component.stepUpToken = '';
      await component.triggerBuild();
      expect(bff.triggerImageBuild).not.toHaveBeenCalled();
      expect(component.error()).toContain('step-up');
    });

    it('triggers a build with the exact contract body + step-up header token', async () => {
      await init();
      component.targetUser = 'alice@brand';
      component.imageType = 'mesh-extension';
      component.hardwareClass = 'x86-64';
      component.sshKeysAllowed = true;
      component.stepUpToken = 'step-up-123';
      await component.triggerBuild();
      expect(bff.triggerImageBuild).toHaveBeenCalledWith(
        { targetUser: 'alice@brand', imageType: 'mesh-extension', hardwareClass: 'x86-64', sshKeysAllowed: true },
        'step-up-123',
      );
    });

    it('renders live SSE progress + a done message when a build completes', async () => {
      await init();
      component.targetUser = 'alice@brand';
      component.stepUpToken = 'tok';
      await component.triggerBuild();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ig-progressbar"]')).not.toBeNull();
      // Both streamed events rendered into the aria-live list.
      expect(el.querySelectorAll('[data-testid="ig-events"] li').length).toBe(2);
      expect(el.querySelector('[data-testid="ig-events"]')!.textContent).toContain('debootstrap');
      expect(el.querySelector('[data-testid="ig-done"]')).not.toBeNull();
      // Live status reaches COMPLETED.
      expect(component.store.liveStatus()).toBe('COMPLETED');
    });

    it('surfaces a 503/dark trigger failure as an error, not a crash', async () => {
      bff.triggerImageBuild.and.rejectWith(new Error('image generation is disabled on this deployment'));
      await init();
      component.targetUser = 'alice@brand';
      component.stepUpToken = 'tok';
      await component.triggerBuild();
      expect(component.error()).toContain('disabled');
    });

    it('announces the dark/stub seam when the launcher is not real', async () => {
      bff.listImageBuilds.and.resolveTo({ builds: [], launchReal: false });
      await init();
      expect(fixture.nativeElement.querySelector('[data-testid="ig-launch-stub"]')).not.toBeNull();
    });

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
      // The key-safety note is always present in detail (never displays a key).
      expect(el.querySelector('[data-testid="ig-key-safety"]')).not.toBeNull();

      await component.toggleDetail(withKeys); // toggle off
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="ig-detail"]')).toBeNull();
    });
  });

  // ── KEYS-DOWNLOAD CONTROL (conditional on ssh_keys_allowed + step-up) ─────
  describe('KEYS-DOWNLOAD', () => {
    beforeEach(() => configure({ buildNodePresent: true }));

    it('HIDES the keys-download control when ssh_keys_allowed is false', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector(`[data-download-keys="${noKeys.id}"]`)).toBeNull();
    });

    it('SHOWS the keys-download control when ssh_keys_allowed is true (completed + keysRef)', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const ctrl = el.querySelector(`[data-download-keys="${withKeys.id}"]`)!;
      expect(ctrl).not.toBeNull();
      // a11y: the control names that it is the non-secret bundle + step-up gated.
      expect(ctrl.getAttribute('aria-label')).toContain('step-up');
    });

    it('is step-up-gated: refuses the keys download without a token (no bff call)', async () => {
      await init();
      component.stepUpToken = '';
      await component.downloadKeys(withKeys);
      expect(bff.downloadImageKeys).not.toHaveBeenCalled();
      expect(component.downloadNote()).toContain('step-up');
    });

    it('passes the step-up token to the keys-download bff method when present', async () => {
      await init();
      component.stepUpToken = 'step-up-xyz';
      await component.downloadKeys(withKeys);
      expect(bff.downloadImageKeys).toHaveBeenCalledWith(withKeys.id, 'step-up-xyz');
    });

    it('canDownloadKeys is false for a build that did not allow keys', () => {
      expect(component.canDownloadKeys(noKeys)).toBe(false);
      expect(component.canDownloadKeys(withKeys)).toBe(true);
    });
  });

  // ── A11Y (accessible names, disabled+helptext) ────────────────────────────
  describe('A11Y', () => {
    beforeEach(() => configure({ buildNodePresent: true }));

    it('labels every trigger field + ties helptext via aria-describedby', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const target = el.querySelector('#ig-target')!;
      expect(el.querySelector('label[for="ig-target"]')).not.toBeNull();
      expect(target.getAttribute('aria-describedby')).toBe('ig-target-help');
      const ssh = el.querySelector('#ig-ssh-keys')!;
      expect(ssh.getAttribute('aria-describedby')).toBe('ig-ssh-keys-help');
      const stepup = el.querySelector('#ig-stepup')!;
      expect(stepup.getAttribute('type')).toBe('password');
      expect(stepup.getAttribute('aria-describedby')).toBe('ig-stepup-help');
    });

    it('disables the trigger button + announces busy while triggering', async () => {
      await init();
      component.triggering.set(true);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector('[data-testid="ig-trigger"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-describedby')).toBe('ig-trigger-busy');
    });

    it('surfaces a validation error in an assertive live region', async () => {
      await init();
      component.error.set('A target user is required.');
      fixture.detectChanges();
      const err = fixture.nativeElement.querySelector('[data-testid="ig-trigger-error"]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.getAttribute('aria-live')).toBe('assertive');
    });
  });

  // ── CONCURRENT (teardown aborts the live stream) ──────────────────────────
  describe('CONCURRENT', () => {
    it('resets the live-build stream on destroy', async () => {
      configure({ buildNodePresent: true });
      await init();
      component.targetUser = 'alice@brand';
      component.stepUpToken = 'tok';
      await component.triggerBuild();
      const spy = spyOn(component.store, 'reset').and.callThrough();
      component.ngOnDestroy();
      expect(spy).toHaveBeenCalled();
    });
  });
});
