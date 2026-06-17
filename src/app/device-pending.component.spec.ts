import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DevicePendingComponent } from './device-pending.component';
import { BffService, DeviceRegistration, PendingNode, RegisterDeviceInput } from './bff.service';

/** A three-node fixture: one already-registered, two pending (enrolled-but-unassigned). */
const fixtureNodes = (): PendingNode[] => [
  {
    machineKeyFp: 'nodekey:REGD+OPAQUE/==',
    hostname: 'pi-edge-01',
    user: 'brand-a',
    meshId: 'tag:mesh_1',
    registered: true,
    domain: 'brand-a',
    ownerType: 'ADMIN',
  },
  {
    machineKeyFp: 'nodekey:PEND1+OPAQUE/==',
    hostname: 'pi-edge-02',
    user: 'brand-a',
    meshId: 'tag:mesh_1',
    registered: false,
    domain: null,
    ownerType: null,
  },
  {
    machineKeyFp: 'nodekey:PEND2+OPAQUE/==',
    hostname: 'pi-edge-03',
    user: 'brand-b',
    meshId: 'tag:mesh_2',
    registered: false,
    domain: null,
    ownerType: null,
  },
];

const savedDevice = (): DeviceRegistration => ({
  id: 'dev-new',
  machine_key_fp: 'nodekey:PEND1+OPAQUE/==',
  hostname: 'pi-edge-02',
  tailnet_id: null,
  image_type: 'mesh-extension',
  owner_type: 'ADMIN',
  physical_owner: 'alice@gmail.com',
  domain: 'brand-a',
  mesh_id: 'tag:mesh_1',
  last_seen_at: null,
  licenses: [],
});

describe('DevicePendingComponent', () => {
  let fixture: ComponentFixture<DevicePendingComponent>;
  let component: DevicePendingComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['pendingNodes', 'registerFromPending']);
    bff.pendingNodes.and.resolveTo(fixtureNodes());
    await TestBed.configureTestingModule({
      imports: [DevicePendingComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(DevicePendingComponent);
    component = fixture.componentInstance;
  });

  it('loads enrolled nodes on init, lists all, and preselects the FIRST UNREGISTERED', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.pendingNodes).toHaveBeenCalledTimes(1);
    expect(component.nodes().length).toBe(3);
    // The select only offers UNREGISTERED nodes (registered ones already have a residency).
    expect(component.pendingOnly().map((n) => n.machineKeyFp))
      .toEqual(['nodekey:PEND1+OPAQUE/==', 'nodekey:PEND2+OPAQUE/==']);
    expect(component.selectedFp).toBe('nodekey:PEND1+OPAQUE/==');

    const el: HTMLElement = fixture.nativeElement;
    // ALL nodes appear in the status list (registered + pending).
    expect(el.querySelector('[data-fp="nodekey:REGD+OPAQUE/=="]')).not.toBeNull();
    expect(el.querySelector('[data-fp="nodekey:PEND1+OPAQUE/=="]')).not.toBeNull();
    // The registered one is tagged registered, the pending one tagged pending.
    expect(el.querySelector('[data-testid="dp-registered"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="dp-pending"]')).not.toBeNull();
  });

  it('shows the fingerprint READ-ONLY and NEVER as an editable input (opaque token)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    // The fp is rendered in a read-only <code>, reflecting the selection verbatim.
    const fpValue = el.querySelector('[data-testid="dp-fp-value"]')!;
    expect(fpValue.tagName.toLowerCase()).toBe('code');
    expect(fpValue.textContent!.trim()).toBe('nodekey:PEND1+OPAQUE/==');

    // CONTRACT: there is NO text/editable input bound to the fingerprint anywhere — the
    // operator can never type or edit it. Every <input> is for an assignment field only.
    const inputs = Array.from(el.querySelectorAll('input'));
    for (const input of inputs) {
      expect(['dp-domain', 'dp-physical-owner', 'dp-mesh'])
        .withContext(`input ${input.getAttribute('data-testid')} must not be the fp`)
        .toContain(input.getAttribute('data-testid')!);
    }
  });

  it('registers the picked node, passing the OPAQUE fp VERBATIM (never re-typed/normalised)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.registerFromPending.and.resolveTo(savedDevice());

    component.selectedFp = 'nodekey:PEND1+OPAQUE/==';
    component.ownerType = 'ADMIN';
    component.imageType = 'mesh-extension';
    component.domain = 'Brand-A';        // trimmed + lowercased
    component.physicalOwner = ' Alice@Gmail.com ';
    component.meshId = 'tag:mesh_1';
    await component.register();

    expect(bff.registerFromPending).toHaveBeenCalledTimes(1);
    const arg = bff.registerFromPending.calls.mostRecent().args[0] as RegisterDeviceInput;
    // The fp is byte-for-byte the picked node's token.
    expect(arg.machineKeyFp).toBe('nodekey:PEND1+OPAQUE/==');
    expect(arg.domain).toBe('brand-a');
    expect(arg.physicalOwner).toBe('alice@gmail.com');
    expect(arg.ownerType).toBe('ADMIN');
    expect(arg.imageType).toBe('mesh-extension');
    expect(arg.meshId).toBe('tag:mesh_1');
    // Re-fetches the list after a successful register.
    expect(bff.pendingNodes).toHaveBeenCalledTimes(2);
  });

  it('validates: missing owner/domain/mesh announces an error and never registers', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectedFp = 'nodekey:PEND1+OPAQUE/==';
    component.domain = '';
    component.physicalOwner = '';
    component.meshId = '';
    await component.register();

    expect(component.formError()).not.toBe('');
    expect(bff.registerFromPending).not.toHaveBeenCalled();
  });

  it('surfaces a BFF 409 fail-closed error message to the operator', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.registerFromPending.and.rejectWith(
      new Error('device registration rejected: offered fingerprint is NOT currently enrolled in headscale'));
    component.selectedFp = 'nodekey:PEND1+OPAQUE/==';
    component.domain = 'brand-a';
    component.physicalOwner = 'alice@gmail.com';
    component.meshId = 'tag:mesh_1';
    await component.register();

    expect(component.formError()).toContain('NOT currently enrolled');
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="device-pending-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('dp-heading');
      expect(el.querySelector('#dp-heading')).not.toBeNull();
    });

    it('associates every form control with a visible <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['dp-node', 'dp-owner-type', 'dp-image-type', 'dp-domain', 'dp-physical-owner', 'dp-mesh']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('announces a validation error in role=alert/assertive and sets aria-invalid', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.selectedFp = 'nodekey:PEND1+OPAQUE/==';
      component.domain = '';
      component.physicalOwner = '';
      component.meshId = '';
      await component.register();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="dp-error"]')!;
      expect(alert).withContext('error live region rendered').not.toBeNull();
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#dp-domain')!.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector<HTMLInputElement>('#dp-domain')!.getAttribute('aria-describedby')).toBe('dp-error');
    });
  });
});
