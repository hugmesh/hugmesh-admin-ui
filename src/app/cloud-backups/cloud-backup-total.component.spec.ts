import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupTotalComponent } from './cloud-backup-total.component';
import {
  BackupSet,
  CloudBackupApiError,
  CloudBackupsService,
  RunningService,
} from './cloud-backups.service';

describe('CloudBackupTotalComponent (superadmin)', () => {
  let fixture: ComponentFixture<CloudBackupTotalComponent>;
  let component: CloudBackupTotalComponent;
  let api: jasmine.SpyObj<CloudBackupsService>;

  const menu: RunningService[] = [
    { key: 'etcd', displayName: 'etcd', defaultKind: 'pv_snapshot', optional: false },
    { key: 'postgres', displayName: 'Postgres', defaultKind: 'db_dump', optional: false },
  ];

  function totalSet(): BackupSet {
    return {
      id: 'set-t', setKey: 'total', version: 1, scope: 'TOTAL', domain: 'root.test',
      createdBy: 'google:root', services: ['etcd'], destinationKind: 'object_store',
      destinationRef: 's3://x', sizeBytes: null, encryptionMeta: null, status: 'pending',
      createdAt: 'T', startedAt: null, completedAt: null,
    };
  }

  async function mount(): Promise<void> {
    localStorage.clear();
    localStorage.setItem('hug.session', JSON.stringify({ roles: [] }));
    api = jasmine.createSpyObj<CloudBackupsService>('CloudBackupsService', ['services', 'createTotal']);
    api.services.and.resolveTo(menu);
    api.createTotal.and.resolveTo(totalSet());
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupTotalComponent],
        providers: [{ provide: CloudBackupsService, useValue: api }],
      })
      .compileComponents();
    fixture = TestBed.createComponent(CloudBackupTotalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  afterEach(() => localStorage.clear());

  it('renders the superadmin warning + the service menu', async () => {
    await mount();
    expect(el().querySelector('[data-testid="cloud-backup-total-warning"]')!.textContent).toContain('Superadmin only');
    expect(el().querySelector('[data-testid="cloud-backup-total-service-etcd"]')).not.toBeNull();
  });

  it('create POSTs to the TOTAL endpoint with no scope/domain field', async () => {
    await mount();
    component.toggle(menu[0]);
    component.destinationRef.set('s3://x');
    await component.create();
    expect(api.createTotal).toHaveBeenCalled();
    const body = api.createTotal.calls.mostRecent().args[0] as any;
    expect(body.services).toEqual(['etcd']);
    expect('scope' in body).toBeFalse();
    expect('domain' in body).toBeFalse();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-total-notice"]')!.textContent).toContain('TOTAL-CLOUD');
  });

  it('gracefully surfaces a 403 — superadmin required (bff authoritative)', async () => {
    await mount();
    api.createTotal.and.rejectWith(new CloudBackupApiError(403, 'forbidden'));
    component.toggle(menu[0]);
    component.destinationRef.set('s3://x');
    await component.create();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-total-form-error"]')!.textContent).toContain('superadmin');
  });

  it('a11y: the create control carries an accessible name', async () => {
    await mount();
    expect(el().querySelector('[data-testid="cloud-backup-total-submit"]')!.getAttribute('aria-label')).toBe('Create total-cloud backup');
  });
});
