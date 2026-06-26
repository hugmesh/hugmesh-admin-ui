import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupSetsComponent } from './cloud-backup-sets.component';
import {
  BackupArtifact,
  BackupSet,
  CloudBackupApiError,
  CloudBackupsService,
} from './cloud-backups.service';
import { SessionService } from '../session.service';

describe('CloudBackupSetsComponent', () => {
  let fixture: ComponentFixture<CloudBackupSetsComponent>;
  let component: CloudBackupSetsComponent;
  let api: jasmine.SpyObj<CloudBackupsService>;

  function set(over: Partial<BackupSet> = {}): BackupSet {
    return {
      id: 'set-1', setKey: 'nightly', version: 2, scope: 'DOMAIN', domain: 'acme.test',
      createdBy: 'google:root', services: ['postgres'], destinationKind: 'object_store',
      destinationRef: 's3://x', sizeBytes: null, encryptionMeta: null, status: 'complete',
      createdAt: '2026-06-17T00:00:00Z', startedAt: null, completedAt: null, ...over,
    };
  }
  function artifact(over: Partial<BackupArtifact> = {}): BackupArtifact {
    return { id: 'a1', setId: 'set-1', service: 'postgres', kind: 'db_dump', sizeBytes: null, status: 'complete', createdAt: 'T', completedAt: null, ...over };
  }

  async function mount(isSuperadmin = false): Promise<void> {
    localStorage.clear();
    localStorage.setItem('snap.session', JSON.stringify({ roles: [] }));
    api = jasmine.createSpyObj<CloudBackupsService>('CloudBackupsService', [
      'listSets', 'versions', 'artifacts', 'restore',
    ]);
    api.listSets.and.resolveTo([set()]);
    api.versions.and.resolveTo([set({ id: 'set-0', version: 1 }), set()]);
    api.artifacts.and.resolveTo([artifact()]);
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupSetsComponent],
        providers: [
          { provide: CloudBackupsService, useValue: api },
          { provide: SessionService, useValue: { isSuperadmin: () => isSuperadmin } },
        ],
      })
      .compileComponents();
    fixture = TestBed.createComponent(CloudBackupSetsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  afterEach(() => localStorage.clear());

  it('renders the set list with a DOMAIN scope badge', async () => {
    await mount();
    expect(el().querySelector('[data-testid="cloud-backup-sets-list"]')).not.toBeNull();
    const badge = el().querySelector('[data-testid="cloud-backup-scope-DOMAIN"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('DOMAIN');
  });

  it('an admin does NOT see the superadmin domain filter; a superadmin does', async () => {
    await mount(false);
    expect(el().querySelector('#cb-sets-domain')).toBeNull();
    await mount(true);
    expect(el().querySelector('#cb-sets-domain')).not.toBeNull();
  });

  it('does not send a domain filter for an admin (cross-domain: own brand only)', async () => {
    await mount(false);
    expect(api.listSets).toHaveBeenCalledWith(undefined);
  });

  it('expanding a set loads its version chain + per-service artifacts', async () => {
    await mount();
    // Await the async toggle directly so the version+artifact Promise.all resolves
    // before we assert the rendered detail (a bare click() does not await it).
    await component.toggle(set());
    fixture.detectChanges();
    expect(api.versions).toHaveBeenCalledWith('set-1');
    expect(api.artifacts).toHaveBeenCalledWith('set-1');
    expect(el().querySelector('[data-testid="cloud-backup-versions"]')!.textContent).toContain('v1');
    expect(el().querySelector('[data-testid="cloud-backup-artifacts"]')!.textContent).toContain('postgres');
  });

  it('restore is a deliberate two-step: confirm panel requires a step-up token', async () => {
    await mount();
    expect(el().querySelector('[data-testid="cloud-backup-restore-confirm"]')).toBeNull();
    (el().querySelector('[data-testid="cloud-backup-restore-set-1"]') as HTMLElement).click();
    fixture.detectChanges();
    const confirm = el().querySelector('[data-testid="cloud-backup-restore-confirm"]');
    expect(confirm).not.toBeNull();
    // the confirm button is disabled until a token is pasted
    const btn = el().querySelector('[data-testid="cloud-backup-restore-confirm-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
    expect(component.canRestore()).toBeFalse();
  });

  it('a satisfied step-up restore sends the token and queues the restore', async () => {
    await mount();
    api.restore.and.resolveTo({ id: 'set-1', version: 2, status: 'RESTORE_QUEUED' });
    component.askRestore(set());
    component.stepUpToken = 'good-token';
    fixture.detectChanges();
    await component.confirmRestore();
    fixture.detectChanges();
    expect(api.restore).toHaveBeenCalledWith('set-1', 'good-token');
    expect(el().querySelector('[data-testid="cloud-backup-sets-notice"]')!.textContent).toContain('Restore queued');
  });

  it('a step-up 403 keeps the panel open and prompts for a fresh token (restore-needs-step-up)', async () => {
    await mount();
    api.restore.and.rejectWith(new CloudBackupApiError(403, 'restore requires step-up: present a valid step-up token in the X-Backup-StepUp header'));
    component.askRestore(set());
    component.stepUpToken = 'stale';
    await component.confirmRestore();
    fixture.detectChanges();
    expect(component.restoreStepUpNeeded()).toBeTrue();
    // panel still open, not dismissed
    expect(el().querySelector('[data-testid="cloud-backup-restore-confirm"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="cloud-backup-restore-error"]')!.textContent).toContain('step-up');
  });

  it('gracefully degrades on a 403 from the list (server-authoritative deny)', async () => {
    await mount();
    api.listSets.and.rejectWith(new CloudBackupApiError(403, 'forbidden'));
    await component.load();
    fixture.detectChanges();
    expect(component.rows()).toEqual([]);
    expect(el().querySelector('[data-testid="cloud-backup-sets-list-error"]')!.textContent).toContain('denied');
  });

  it('a11y: the restore + details controls carry accessible names', async () => {
    await mount();
    const restore = el().querySelector('[data-testid="cloud-backup-restore-set-1"]');
    const details = el().querySelector('[data-testid="cloud-backup-toggle-set-1"]');
    expect(restore!.getAttribute('aria-label')).toContain('Restore');
    expect(details!.getAttribute('aria-label')).toContain('details');
    // the destructive confirm is an alertdialog with a described warning
    component.askRestore(set());
    fixture.detectChanges();
    const dlg = el().querySelector('[role="alertdialog"]');
    expect(dlg!.getAttribute('aria-labelledby')).toBe('cb-restore-title');
    expect(dlg!.getAttribute('aria-describedby')).toBe('cb-restore-warning');
  });
});
