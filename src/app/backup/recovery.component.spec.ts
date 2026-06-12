import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecoveryComponent } from './recovery.component';
import { BackupStore } from './backup-store.service';
import { BackupRecord, BffService } from '../bff.service';

describe('RecoveryComponent', () => {
  let fixture: ComponentFixture<RecoveryComponent>;
  let component: RecoveryComponent;
  let bff: jasmine.SpyObj<BffService>;

  const plain: BackupRecord = {
    id: '11111111-2222-3333-4444-555555555555', created_at: '2026-06-10T00:00:00Z',
    requested_by: 'admin', scope: 'etcd,postgres', target: 'CLUSTER', encrypted: false,
    status: 'COMPLETED', size_bytes: 4096, location_ref: 'cluster://x',
  };
  const encrypted: BackupRecord = { ...plain, id: '22222222-2222-3333-4444-555555555555', scope: 'secrets', encrypted: true };
  const running: BackupRecord = { ...plain, id: '33333333-2222-3333-4444-555555555555', status: 'RUNNING' };

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['backupHistory', 'usbDevices', 'startRestore', 'streamJobEvents']);
    bff.backupHistory.and.resolveTo([plain, encrypted, running]);
    bff.usbDevices.and.resolveTo([]);
    bff.startRestore.and.resolveTo({ id: 'restore-1', status: 'QUEUED' });
    bff.streamJobEvents.and.callFake(async (_id, onEvent) => {
      onEvent({ jobId: 'restore-1', phase: 'complete', percent: 100, message: 'restored', done: true });
    });

    await TestBed.configureTestingModule({
      imports: [RecoveryComponent],
      providers: [BackupStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(RecoveryComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists only COMPLETED backups as restorable sources', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector(`[data-backup="${plain.id}"]`)).not.toBeNull();
    expect(el.querySelector(`[data-backup="${encrypted.id}"]`)).not.toBeNull();
    // the RUNNING backup is not a restorable source
    expect(el.querySelector(`[data-backup="${running.id}"]`)).toBeNull();
  });

  it('shows a scope preview when a backup is selected', async () => {
    await init();
    component.select(plain);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="recovery-preview"]')).not.toBeNull();
    expect(el.querySelector('[data-scope="etcd"]')).not.toBeNull();
    expect(el.querySelector('[data-scope="postgres"]')).not.toBeNull();
  });

  it('prompts for the decryption password only for an encrypted backup', async () => {
    await init();
    component.select(plain);
    fixture.detectChanges();
    let el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="recovery-password-fields"]')).toBeNull();

    component.select(encrypted);
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(el.querySelector('[data-testid="recovery-password-fields"]')).not.toBeNull();
  });

  it('blocks restoring an encrypted backup without a password (no BFF call)', async () => {
    await init();
    component.select(encrypted);
    await component.start();
    expect(bff.startRestore).not.toHaveBeenCalled();
    expect(component.error()).toContain('encrypted');
  });

  it('restores a plain backup and streams progress', async () => {
    await init();
    component.select(plain);
    await component.start();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.startRestore).toHaveBeenCalledWith(jasmine.objectContaining({
      backupId: plain.id, password: null,
    }));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="recovery-done"]')).not.toBeNull();
  });

  it('surfaces the BFF wrong-password 403 message', async () => {
    bff.startRestore.and.rejectWith(new Error('incorrect decryption password'));
    await init();
    component.select(encrypted);
    component.password = 'wrong-but-long';
    await component.start();
    fixture.detectChanges();
    expect(component.error()).toBe('incorrect decryption password');
    expect(component.password).toBe('wrong-but-long'); // not cleared on failure
  });

  describe('help text (sighted + low/no-sight)', () => {
    it('wires the backup-select buttons to list help and gives each an accessible name', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const help = el.querySelector('[data-testid="recovery-list-help"]')!;
      expect(help).withContext('visible list help present').not.toBeNull();
      expect(help.id).toBe('recovery-list-help');
      expect(help.textContent!.trim().length).toBeGreaterThan(40);

      const button = el.querySelector<HTMLButtonElement>(`[data-backup="${encrypted.id}"] .backup-button`)!;
      expect(button.getAttribute('aria-describedby')).toBe('recovery-list-help');
      // The button's only visible text is scope/meta spans; an explicit accessible name
      // tells a screen-reader user which backup it selects + that it is encrypted.
      const label = button.getAttribute('aria-label')!;
      expect(label).withContext('select button accessible name').toContain('Select backup');
      expect(label).toContain('encrypted');
    });

    it('describes the decryption password input and submit with wired, informative help', async () => {
      await init();
      component.select(encrypted);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      const input = el.querySelector<HTMLInputElement>('[data-testid="recovery-password"]')!;
      expect(input.getAttribute('aria-describedby')).toBe('recovery-password-help');
      const pwHelp = el.querySelector('#recovery-password-help')!;
      expect(pwHelp).withContext('password help target exists').not.toBeNull();
      expect(pwHelp.textContent!).toContain('8 characters');

      const submit = el.querySelector<HTMLButtonElement>('[data-testid="recovery-start"]')!;
      expect(submit.getAttribute('aria-describedby')).toBe('recovery-start-help');
      expect(el.querySelector('#recovery-start-help')).withContext('submit help target exists').not.toBeNull();
    });

    it('marks the password input aria-invalid when an error is shown', async () => {
      await init();
      component.select(encrypted);
      component.error.set('This backup is encrypted — enter its decryption password.');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const input = el.querySelector<HTMLInputElement>('[data-testid="recovery-password"]')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });
  });
});
