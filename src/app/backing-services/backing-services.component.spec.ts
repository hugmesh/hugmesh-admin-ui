import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BackingServicesComponent } from './backing-services.component';
import {
  BackingServiceApiError,
  BackingServicesCatalog,
  BackingServicesService,
} from './backing-services.service';

/**
 * Component-layer specs for the managed backing-services console. The service is MOCKED so the
 * view logic (catalog render, tier-3 read-only, mode-edit form, step-up prompt, dark note) is
 * isolated. Cloned from the cloud-backups component specs.
 */
describe('BackingServicesComponent', () => {
  let fixture: ComponentFixture<BackingServicesComponent>;
  let component: BackingServicesComponent;
  let api: jasmine.SpyObj<BackingServicesService>;

  function catalog(over: Partial<BackingServicesCatalog> = {}): BackingServicesCatalog {
    return {
      enabled: true,
      note: 'intent recorded only — self-hosted is the byte-identical default',
      services: [
        {
          id: 'postgres-admin-bff', kind: 'postgres', tier: 2, docsOnly: false,
          displayName: 'admin-bff database', awsTarget: 'RDS', azureTarget: 'Azure DB',
          notes: 'dual URLs', currentMode: 'self-hosted', endpoint: null, credsRef: null, generation: 0,
        },
        {
          id: 'vault-pki', kind: 'pki', tier: 3, docsOnly: true,
          displayName: 'Vault PKI', awsTarget: 'ACM Private CA', azureTarget: 'Key Vault certs',
          notes: 'docs only — architecturally blocked', currentMode: 'self-hosted',
          endpoint: null, credsRef: null, generation: 0,
        },
      ],
      ...over,
    };
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function boot(): Promise<void> {
    fixture = TestBed.createComponent(BackingServicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<BackingServicesService>('BackingServicesService', ['getCatalog', 'setMode']);
    TestBed.configureTestingModule({
      imports: [BackingServicesComponent],
      providers: [{ provide: BackingServicesService, useValue: api }],
    });
  });

  it('renders the catalog table with a row per service', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    expect(el().querySelector('[data-testid="backing-services-table"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="backing-services-row-postgres-admin-bff"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="backing-services-mode-postgres-admin-bff"]')!.textContent)
      .toContain('self-hosted');
  });

  it('renders a tier-3 service READ-ONLY (docs-only badge, no edit button)', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    expect(el().querySelector('[data-testid="backing-services-docsonly-vault-pki"]')).not.toBeNull();
    // no edit button for the docs-only row
    expect(el().querySelector('[data-testid="backing-services-edit-vault-pki"]')).toBeNull();
    // but the tier-1/2 row DOES have one
    expect(el().querySelector('[data-testid="backing-services-edit-postgres-admin-bff"]')).not.toBeNull();
  });

  it('startEdit on a docs-only row is a no-op (defence-in-depth)', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    component.startEdit(component.services()[1]); // vault-pki, docsOnly
    fixture.detectChanges();
    expect(component.editing()).toBeNull();
    expect(el().querySelector('[data-testid="backing-services-form"]')).toBeNull();
  });

  it('opens the mode-edit form and requires an endpoint for managed', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    component.startEdit(component.services()[0]);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="backing-services-form"]')).not.toBeNull();

    component.mode.set('managed');
    component.endpoint.set('');
    expect(component.canSave()).toBeFalse(); // managed with no endpoint
    component.endpoint.set('db.rds.amazonaws.com:5432');
    expect(component.canSave()).toBeTrue();
  });

  it('save records the mode, shows a notice, and reloads', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    component.startEdit(component.services()[0]);
    component.mode.set('managed');
    component.endpoint.set('db.rds.amazonaws.com:5432');
    component.credsRef.set('snapdragon/postgres-admin-bff');
    api.setMode.and.resolveTo({
      id: 'bsm-1', serviceId: 'postgres-admin-bff', mode: 'managed',
      endpoint: 'db.rds.amazonaws.com:5432', credsRef: 'snapdragon/postgres-admin-bff',
      requestedBySubject: 'root', createdAt: 'T', generation: 1, note: 'intent only',
    });
    // second load reflects the new managed mode
    api.getCatalog.and.resolveTo(catalog({
      services: [{ ...catalog().services[0], currentMode: 'managed', endpoint: 'db.rds.amazonaws.com:5432' },
        catalog().services[1]],
    }));

    await component.save();
    fixture.detectChanges();

    expect(api.setMode).toHaveBeenCalledWith('postgres-admin-bff',
      jasmine.objectContaining({ mode: 'managed', endpoint: 'db.rds.amazonaws.com:5432' }), undefined);
    expect(component.editing()).toBeNull();
    expect(el().querySelector('[data-testid="backing-services-notice"]')!.textContent).toContain('managed');
  });

  it('reveals the step-up token field on a step-up-required 403', async () => {
    api.getCatalog.and.resolveTo(catalog());
    await boot();
    component.startEdit(component.services()[0]);
    component.mode.set('managed');
    component.endpoint.set('db.rds:5432');
    api.setMode.and.rejectWith(new BackingServiceApiError(403,
      'changing a backing-service mode requires step-up re-authentication (present X-BackingServices-StepUp)'));
    await component.save();
    fixture.detectChanges();

    expect(component.stepUpRequired()).toBeTrue();
    expect(el().querySelector('[data-testid="backing-services-stepup"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="backing-services-form-error"]')!.textContent)
      .toContain('step-up');
  });

  it('shows the ships-dark note when the feature is disabled', async () => {
    api.getCatalog.and.resolveTo(catalog({ enabled: false }));
    await boot();
    expect(el().querySelector('[data-testid="backing-services-dark"]')).not.toBeNull();
  });

  it('surfaces a forbidden catalog load gracefully (no throw)', async () => {
    api.getCatalog.and.rejectWith(new BackingServiceApiError(403, 'forbidden'));
    await boot();
    expect(el().querySelector('[data-testid="backing-services-load-error"]')!.textContent)
      .toContain('superadmin');
  });
});
