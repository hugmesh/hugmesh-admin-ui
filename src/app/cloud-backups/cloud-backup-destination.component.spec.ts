import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CloudBackupDestinationComponent } from './cloud-backup-destination.component';
import {
  BackupDestination,
  CloudBackupApiError,
  CloudBackupsService,
} from './cloud-backups.service';
import { SessionService } from '../session.service';

describe('CloudBackupDestinationComponent', () => {
  let fixture: ComponentFixture<CloudBackupDestinationComponent>;
  let component: CloudBackupDestinationComponent;
  let api: jasmine.SpyObj<CloudBackupsService>;

  function dest(over: Partial<BackupDestination> = {}): BackupDestination {
    return { id: 'd1', kind: 'object_store', destinationRef: 's3://x', secretRef: 'vault:cred', domain: 'acme.test', updatedBy: 'root', createdAt: 'T', updatedAt: 'T', ...over };
  }

  async function mount(isSuperadmin = false, existing: BackupDestination | undefined = undefined): Promise<void> {
    localStorage.clear();
    localStorage.setItem('snap.session', JSON.stringify({ roles: [] }));
    api = jasmine.createSpyObj<CloudBackupsService>('CloudBackupsService', ['getDestination', 'putDestination']);
    api.getDestination.and.resolveTo(existing);
    api.putDestination.and.resolveTo(dest());
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [CloudBackupDestinationComponent],
        providers: [
          { provide: CloudBackupsService, useValue: api },
          { provide: SessionService, useValue: { isSuperadmin: () => isSuperadmin } },
        ],
      })
      .compileComponents();
    fixture = TestBed.createComponent(CloudBackupDestinationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  afterEach(() => localStorage.clear());

  it('shows the unset note when no destination is configured', async () => {
    await mount(false, undefined);
    expect(el().querySelector('[data-testid="cloud-backup-destination-unset"]')).not.toBeNull();
  });

  it('prefills the form from an existing destination', async () => {
    await mount(false, dest({ destinationRef: 's3://acme/bk' }));
    expect(component.destinationRef()).toBe('s3://acme/bk');
    expect((el().querySelector('#cb-dest-ref') as HTMLInputElement).value).toBe('s3://acme/bk');
  });

  it('an admin does NOT see the superadmin targetDomain field; a superadmin does', async () => {
    await mount(false);
    expect(el().querySelector('#cb-dest-target')).toBeNull();
    await mount(true);
    expect(el().querySelector('#cb-dest-target')).not.toBeNull();
  });

  it('save (admin) PUTs without a targetDomain (own brand stamped server-side)', async () => {
    await mount(false);
    component.destinationRef.set('s3://x');
    await component.save();
    const body = api.putDestination.calls.mostRecent().args[0];
    expect(body.targetDomain).toBeNull();
    expect('domain' in body).toBeFalse();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-destination-notice"]')!.textContent).toContain('Saved');
  });

  it('node_storage hides the secretRef field and sends none', async () => {
    await mount(false);
    component.kind.set('node_storage');
    fixture.detectChanges();
    expect(el().querySelector('#cb-dest-secret')).toBeNull();
    component.destinationRef.set('pool-1');
    await component.save();
    expect(api.putDestination.calls.mostRecent().args[0].secretRef).toBeNull();
  });

  it('gracefully surfaces a 403 on save', async () => {
    await mount(false);
    api.putDestination.and.rejectWith(new CloudBackupApiError(403, 'forbidden'));
    component.destinationRef.set('s3://x');
    await component.save();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="cloud-backup-destination-form-error"]')!.textContent).toContain('denied');
  });

  it('a11y: the save control carries an accessible name', async () => {
    await mount(false);
    expect(el().querySelector('[data-testid="cloud-backup-destination-save"]')!.getAttribute('aria-label')).toBe('Save destination');
  });
});
