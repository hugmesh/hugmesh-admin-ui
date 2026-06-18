import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupComponent, scorePassword } from './backup.component';
import { BackupStore } from './backup-store.service';
import { BffService, UsbDevice, PLATFORM_CAPABILITIES_ABSENT } from '../bff.service';

describe('BackupComponent', () => {
  let fixture: ComponentFixture<BackupComponent>;
  let component: BackupComponent;
  let bff: jasmine.SpyObj<BffService>;

  const usb: UsbDevice = {
    id: 'usb-1', label: 'BACKUP', mount_point: '/mnt/usb',
    size_bytes: 1, free_bytes: 1, writable: true, backups: [],
  };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['backupHistory', 'usbDevices', 'startBackup', 'startRestore', 'streamJobEvents',
        'platformCapabilities']);
    bff.backupHistory.and.resolveTo([]);
    bff.usbDevices.and.resolveTo([usb]);
    bff.startBackup.and.resolveTo({ id: 'job-1', status: 'QUEUED' });
    bff.streamJobEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ jobId: 'job-1', phase: 'complete', percent: 100, message: 'done', done: true });
    });
    // Default: Velero present, so the existing behaviour specs see the live backup form.
    bff.platformCapabilities.and.resolveTo({ ...PLATFORM_CAPABILITIES_ABSENT, veleroPresent: true });

    await TestBed.configureTestingModule({
      imports: [BackupComponent],
      providers: [BackupStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(BackupComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    // ngOnInit now chains platform.load() -> store refresh (two async hops); flush BOTH.
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders a checkbox per backup scope and loads USB devices on init', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    for (const s of component.store.scopes) {
      expect(el.querySelector(`[data-scope="${s.value}"]`)).withContext(s.value).not.toBeNull();
    }
    expect(bff.usbDevices).toHaveBeenCalled();
  });

  it('shows the USB device picker only when the USB target is chosen', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="backup-usb-picker"]')).toBeNull();
    component.setTarget('USB');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="backup-usb-picker"]')).not.toBeNull();
  });

  it('reveals the password + confirm fields only when encryption is enabled', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="backup-password"]')).toBeNull();
    component.encrypt.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="backup-password"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="backup-confirm"]')).not.toBeNull();
  });

  it('blocks an encrypted backup when the passwords do not match (no BFF call)', async () => {
    await init();
    component.toggleScope('postgres');
    component.encrypt.set(true);
    component.password = 'longenough1';
    component.confirm = 'different99';
    await component.start();
    fixture.detectChanges();
    expect(bff.startBackup).not.toHaveBeenCalled();
    expect(component.error()).toContain('do not match');
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="backup-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('blocks a USB backup with no device selected', async () => {
    await init();
    component.setTarget('USB');
    await component.start();
    expect(bff.startBackup).not.toHaveBeenCalled();
    expect(component.error()).toContain('USB');
  });

  it('starts a backup with the selected scope + target and clears the password', async () => {
    await init();
    component.toggleScope('postgres'); // now etcd + postgres
    component.encrypt.set(true);
    component.password = 'correct-horse';
    component.confirm = 'correct-horse';
    await component.start();
    await fixture.whenStable();

    expect(bff.startBackup).toHaveBeenCalledWith(jasmine.objectContaining({
      scope: ['etcd', 'postgres'], target: 'CLUSTER', encrypt: true, password: 'correct-horse',
    }));
    // password is never retained after handing it to the BFF.
    expect(component.password).toBe('');
    expect(component.store.activeJobId()).toBe('job-1');
  });

  it('renders the streamed progress in a progressbar + aria-live region', async () => {
    await init();
    await component.start();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const bar = el.querySelector('[data-testid="backup-progressbar"]')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    const events = el.querySelector('[data-testid="backup-events"]')!;
    expect(events.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('[data-testid="backup-done"]')).not.toBeNull();
  });

  it('surfaces a BFF error message when the start fails', async () => {
    bff.startBackup.and.rejectWith(new Error('USB device not found'));
    await init();
    await component.start();
    fixture.detectChanges();
    expect(component.error()).toBe('USB device not found');
  });

  describe('scorePassword', () => {
    it('rates by length + character variety', () => {
      expect(scorePassword('').label).toBe('');
      expect(scorePassword('short').level).toBe(0);
      expect(scorePassword('Abcdef1!longenough').level).toBeGreaterThanOrEqual(4);
    });
  });

  describe('capability gate (Velero absent → graceful degradation)', () => {
    async function mountVelero(present: boolean): Promise<HTMLElement> {
      bff.platformCapabilities.and.resolveTo({ ...PLATFORM_CAPABILITIES_ABSENT, veleroPresent: present });
      await TestBed.resetTestingModule()
        .configureTestingModule({
          imports: [BackupComponent],
          providers: [BackupStore, { provide: BffService, useValue: bff }],
        })
        .compileComponents();
      fixture = TestBed.createComponent(BackupComponent);
      component = fixture.componentInstance;
      await init();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the capability-gate notice and hides the form + start action when Velero is absent', async () => {
      const el = await mountVelero(false);
      const gate = el.querySelector('[data-testid="capability-gate"]')!;
      expect(gate).withContext('gate notice present').not.toBeNull();
      expect(gate.getAttribute('data-capability')).toBe('velero');
      expect(gate.classList).toContain('notice--warn');
      // actions suppressed: no form, no start button.
      expect(el.querySelector('form')).toBeNull();
      expect(el.querySelector('[data-testid="backup-start"]')).toBeNull();
      // and we never fetched history / devices.
      expect(bff.usbDevices).not.toHaveBeenCalled();
    });

    it('renders the backup form (no gate) when Velero is present', async () => {
      const el = await mountVelero(true);
      expect(el.querySelector('[data-testid="capability-gate"]')).toBeNull();
      expect(el.querySelector('[data-testid="backup-start"]')).not.toBeNull();
      expect(bff.usbDevices).toHaveBeenCalled();
    });

    it('start() is a no-op (never calls the BFF) when Velero is absent', async () => {
      await mountVelero(false);
      bff.startBackup.calls.reset();
      await component.start();
      expect(bff.startBackup).not.toHaveBeenCalled();
    });

    it('gives the gate notice an accessible name', async () => {
      const el = await mountVelero(false);
      const name = el.querySelector('[data-testid="capability-gate"]')!.getAttribute('aria-label') ?? '';
      expect(name.trim().length).toBeGreaterThan(0);
    });
  });
});
