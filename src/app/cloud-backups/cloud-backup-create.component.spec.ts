import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupCreateComponent } from './cloud-backup-create.component';
import {
  BackupSet,
  CloudBackupApiError,
  CloudBackupsService,
  RunningService,
} from './cloud-backups.service';

describe('CloudBackupCreateComponent', () => {
  let fixture: ComponentFixture<CloudBackupCreateComponent>;
  let component: CloudBackupCreateComponent;
  let api: jasmine.SpyObj<CloudBackupsService>;

  const menu: RunningService[] = [
    { key: 'postgres', displayName: 'Postgres', defaultKind: 'db_dump', optional: false },
    { key: 'matrix', displayName: 'Matrix', defaultKind: 'pv_snapshot', optional: true }, // not installed → greyed
  ];

  function createdSet(): BackupSet {
    return {
      id: 'set-9', setKey: 'nightly', version: 1, scope: 'DOMAIN', domain: 'acme.test',
      createdBy: 'google:root', services: ['postgres'], destinationKind: 'object_store',
      destinationRef: 's3://x', sizeBytes: null, encryptionMeta: null, status: 'pending',
      createdAt: 'T', startedAt: null, completedAt: null,
    };
  }

  async function mount(): Promise<void> {
    localStorage.clear();
    localStorage.setItem('snap.session', JSON.stringify({ bffToken: 'tok' }));
    api = jasmine.createSpyObj<CloudBackupsService>('CloudBackupsService', ['services', 'getDestination', 'createSet']);
    api.services.and.resolveTo(menu);
    api.getDestination.and.resolveTo(undefined);
    api.createSet.and.resolveTo(createdSet());
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupCreateComponent],
        providers: [{ provide: CloudBackupsService, useValue: api }],
      })
      .compileComponents();
    fixture = TestBed.createComponent(CloudBackupCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  afterEach(() => localStorage.clear());

  it('renders the per-service menu from the bff', async () => {
    await mount();
    expect(el().querySelector('[data-testid="cloud-backup-service-postgres"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="cloud-backup-service-matrix"]')).not.toBeNull();
  });

  it('greys out (disables) an OPTIONAL not-installed service', async () => {
    await mount();
    const matrix = el().querySelector('[data-testid="cloud-backup-service-matrix"]') as HTMLInputElement;
    const postgres = el().querySelector('[data-testid="cloud-backup-service-postgres"]') as HTMLInputElement;
    expect(matrix.disabled).toBeTrue();
    expect(postgres.disabled).toBeFalse();
    // a disabled service cannot be toggled into the selection
    component.toggle(menu[1]);
    expect(component.isSelected('matrix')).toBeFalse();
  });

  it('the create flow POSTs only the request intent — NO domain/createdBy/scope field', async () => {
    await mount();
    component.toggle(menu[0]); // select postgres
    component.destinationRef.set('s3://acme/backups');
    fixture.detectChanges();
    await component.create();
    const body = api.createSet.calls.mostRecent().args[0] as any;
    expect(body.services).toEqual(['postgres']);
    expect(body.destinationKind).toBe('object_store');
    expect(body.destinationRef).toBe('s3://acme/backups');
    expect('domain' in body).toBeFalse();
    expect('createdBy' in body).toBeFalse();
    expect('scope' in body).toBeFalse();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-create-notice"]')!.textContent).toContain('Created backup');
  });

  it('blocks create with no service selected (validation, no call)', async () => {
    await mount();
    component.destinationRef.set('s3://x');
    await component.create();
    expect(api.createSet).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-create-services-error"]')).not.toBeNull();
  });

  it('gracefully surfaces a 403 on create (server-authoritative deny)', async () => {
    await mount();
    api.createSet.and.rejectWith(new CloudBackupApiError(403, 'forbidden'));
    component.toggle(menu[0]);
    component.destinationRef.set('s3://x');
    await component.create();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-create-form-error"]')!.textContent).toContain('denied');
  });

  it('a11y: each service checkbox + the submit carry accessible names', async () => {
    await mount();
    const pg = el().querySelector('[data-testid="cloud-backup-service-postgres"]')!;
    const matrix = el().querySelector('[data-testid="cloud-backup-service-matrix"]')!;
    expect(pg.getAttribute('aria-label')).toBe('Postgres');
    expect(matrix.getAttribute('aria-label')).toContain('not installed');
    expect(el().querySelector('[data-testid="cloud-backup-create-submit"]')!.getAttribute('aria-label')).toBe('Create backup');
  });
});
