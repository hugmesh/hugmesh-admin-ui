import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceLicensesComponent } from './device-licenses.component';
import { BffService, DeviceRegistration } from './bff.service';

/** A two-device fixture: one mesh-extension with an active per-device license, one
 *  superadmin-owned core node in another domain with no licenses. */
const fixtureDevices = (): DeviceRegistration[] => [
  {
    id: 'dev-1',
    machine_key_fp: 'mkey:1',
    hostname: 'pi-edge-01',
    tailnet_id: 'ts-1',
    image_type: 'mesh-extension',
    owner_type: 'ADMIN',
    physical_owner: 'alice@gmail.com',
    domain: 'brand-a',
    mesh_id: 'mesh-a',
    last_seen_at: null,
    licenses: [
      {
        id: 'lic-1',
        operator: 'alice@gmail.com',
        scope_type: 'DEVICE',
        device_id: 'dev-1',
        target_domain: null,
        key_fingerprints: ['SHA256:aaa'],
        state: 'active',
        granted_by: 'root',
        granted_at: null,
      },
    ],
  },
  {
    id: 'dev-2',
    machine_key_fp: 'mkey:2',
    hostname: 'core-01',
    tailnet_id: 'ts-2',
    image_type: 'primary',
    owner_type: 'SUPERADMIN',
    physical_owner: 'root',
    domain: 'brand-b',
    mesh_id: 'mesh-core',
    last_seen_at: null,
    licenses: [],
  },
];

describe('DeviceLicensesComponent', () => {
  let fixture: ComponentFixture<DeviceLicensesComponent>;
  let component: DeviceLicensesComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['devices', 'grantDeviceLicense', 'grantDomainLicense', 'revokeLicense']);
    bff.devices.and.resolveTo(fixtureDevices());
    await TestBed.configureTestingModule({
      imports: [DeviceLicensesComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(DeviceLicensesComponent);
    component = fixture.componentInstance;
  });

  it('loads devices on init, renders them, and defaults the device + domain selects', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.devices).toHaveBeenCalledTimes(1);
    expect(component.devices().length).toBe(2);
    expect(component.deviceId).toBe('dev-1');
    expect(component.domain).toBe('brand-a');
    expect(component.domains()).toEqual(['brand-a', 'brand-b']);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-device-id="dev-1"]')).not.toBeNull();
    expect(el.querySelector('[data-device-id="dev-2"]')).not.toBeNull();
    expect(el.querySelector('[data-license-id="lic-1"]')).not.toBeNull();
  });

  it('grants a per-DEVICE license (trimmed/lowercased operator, parsed fingerprints) and clears the inputs', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.grantDeviceLicense.and.resolveTo(fixtureDevices());

    component.scope = 'DEVICE';
    component.deviceId = 'dev-1';
    component.operator = '  Bob@Gmail.com ';
    component.keyFingerprints = 'SHA256:aaa, SHA256:bbb';
    await component.grant();

    expect(bff.grantDeviceLicense).toHaveBeenCalledWith('dev-1', 'bob@gmail.com', ['SHA256:aaa', 'SHA256:bbb']);
    expect(bff.grantDomainLicense).not.toHaveBeenCalled();
    expect(component.operator).toBe('');
    expect(component.keyFingerprints).toBe('');
  });

  it('grants a per-DOMAIN license through the domain endpoint', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.grantDomainLicense.and.resolveTo(fixtureDevices());

    component.scope = 'DOMAIN';
    component.domain = 'brand-a';
    component.operator = 'carol';
    component.keyFingerprints = 'SHA256:ccc';
    await component.grant();

    expect(bff.grantDomainLicense).toHaveBeenCalledWith('brand-a', 'carol', ['SHA256:ccc']);
    expect(bff.grantDeviceLicense).not.toHaveBeenCalled();
  });

  it('does not call the BFF and surfaces an error when operator or fingerprints are missing', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.operator = '   ';
    component.keyFingerprints = 'SHA256:aaa';
    await component.grant();
    expect(bff.grantDeviceLicense).not.toHaveBeenCalled();
    expect(component.formError()).not.toBe('');

    component.operator = 'bob';
    component.keyFingerprints = '   ';
    await component.grant();
    expect(bff.grantDeviceLicense).not.toHaveBeenCalled();
  });

  it('revokes a license and removes it from the DOM', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-license-id="lic-1"]')).not.toBeNull();

    // the refreshed registry no longer carries the (now-revoked) active license
    const withoutLicense = fixtureDevices();
    withoutLicense[0].licenses = [];
    bff.revokeLicense.and.resolveTo(withoutLicense);

    await component.revoke('lic-1');
    fixture.detectChanges();

    expect(bff.revokeLicense).toHaveBeenCalledWith('lic-1');
    expect(el.querySelector('[data-license-id="lic-1"]')).toBeNull();
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="device-licenses-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('dl-heading');
      expect(el.querySelector('#dl-heading')).not.toBeNull();
    });

    it('associates every form control with a visible <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['dl-scope', 'dl-device-id', 'dl-domain', 'dl-operator', 'dl-fingerprints']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('gives the device list a descriptive aria-label', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const list = el.querySelector('[data-testid="dl-devices"]')!;
      expect(list.getAttribute('aria-label')).toBeTruthy();
    });

    it('announces a validation error in role=alert/assertive and sets aria-invalid', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.operator = '';
      component.keyFingerprints = '';
      await component.grant();
      fixture.detectChanges();

      expect(component.formError()).not.toBe('');
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="dl-error"]')!;
      expect(alert).withContext('error live region rendered').not.toBeNull();
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#dl-operator')!.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector<HTMLInputElement>('#dl-operator')!.getAttribute('aria-describedby')).toBe('dl-error');
    });

    it('gives each revoke button an operator-specific accessible name', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector('[data-revoke="lic-1"]')!;
      expect(btn.getAttribute('aria-label')).toContain('alice@gmail.com');
      expect(btn.getAttribute('aria-label')).toContain('pi-edge-01');
    });
  });
});
