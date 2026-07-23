import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StoragePoolsComponent } from './storage-pools.component';
import {
  BffService,
  StoragePool,
  ServiceAssignment,
  DeviceRegistration,
} from './bff.service';

const GiB = 1024 * 1024 * 1024;

const fixtureDevices = (): DeviceRegistration[] => [
  {
    id: 'dev-1',
    machine_key_fp: 'mkey:1',
    hostname: 'pi-edge-01',
    image_type: 'mesh-extension',
    owner_type: 'ADMIN',
    physical_owner: 'alice@gmail.com',
    domain: 'brand-a',
    licenses: [],
  },
];

const fixturePools = (): StoragePool[] => [
  {
    id: 'pool-1',
    deviceId: 'dev-1',
    diskSerial: 'WWN-AAA',
    poolPath: '/var/hugmesh/storage/pool-1',
    reservedBytes: 100 * GiB,
    isExclusive: false,
    filesystem: 'ext4',
    state: 'active',
    domain: 'brand-a',
    propagationState: 'applied',
    generation: 1,
    createdBy: 'alice@gmail.com',
  },
];

const fixtureAssignments = (): ServiceAssignment[] => [
  {
    id: 'a-1',
    poolId: 'pool-1',
    serviceName: 'owncast',
    pvcName: 'owncast-data',
    requestedBytes: 40 * GiB,
    state: 'active',
    assignedBy: 'alice@gmail.com',
    domain: 'brand-a',
    propagationState: 'applied',
    generation: 1,
  },
];

describe('StoragePoolsComponent', () => {
  let fixture: ComponentFixture<StoragePoolsComponent>;
  let component: StoragePoolsComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['storagePools', 'devices', 'attachPool', 'assignService', 'detachPool', 'revokeAssignment']);
    bff.storagePools.and.resolveTo({ pools: fixturePools(), assignments: fixtureAssignments() });
    bff.devices.and.resolveTo(fixtureDevices());
    await TestBed.configureTestingModule({
      imports: [StoragePoolsComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(StoragePoolsComponent);
    component = fixture.componentInstance;
  });

  /** Trigger the component lifecycle (which runs ngOnInit ONCE) then flush BOTH awaited
   *  load boundaries before rendering. Flushing whenStable twice covers the two sequential
   *  awaits in ngOnInit (storagePools, then devices) deterministically. */
  async function init(): Promise<void> {
    fixture.detectChanges();           // fires ngOnInit via the lifecycle (once)
    await fixture.whenStable();        // storagePools() resolved
    await fixture.whenStable();        // devices() resolved (second await boundary)
    fixture.detectChanges();           // render with the loaded data
  }

  it('loads pools/assignments/devices on init and defaults the selects', async () => {
    await init();

    expect(bff.storagePools).toHaveBeenCalledTimes(1);
    expect(bff.devices).toHaveBeenCalledTimes(1);
    expect(component.pools().length).toBe(1);
    expect(component.attachDeviceId).toBe('dev-1');
    expect(component.assignPoolId).toBe('pool-1');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-pool-id="pool-1"]')).not.toBeNull();
    expect(el.querySelector('[data-assignment-id="a-1"]')).not.toBeNull();
  });

  it('computes committed bytes + capacity fraction from active assignments', async () => {
    await init();
    expect(component.committedBytes('pool-1')).toBe(40 * GiB);
    expect(component.committedFraction(fixturePools()[0])).toBeCloseTo(0.4, 5);
  });

  it('renders a capacity meter with aria-valuenow/max reflecting committed/reserved', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const meter = el.querySelector('[data-capacity="pool-1"]')!;
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe(String(40 * GiB));
    expect(meter.getAttribute('aria-valuemax')).toBe(String(100 * GiB));
  });

  it('renders a propagation chip carrying the reconcile state', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const chip = el.querySelector('[data-prop="applied"]')!;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toContain('applied');
  });

  it('attaches a pool (GiB -> bytes) and clears the disk/path inputs', async () => {
    await init();
    bff.attachPool.and.resolveTo(fixturePools()[0]);

    component.attachDeviceId = 'dev-1';
    component.diskSerial = ' WWN-BBB ';
    component.poolPath = '/var/hugmesh/storage/x';
    component.reservedGiB = 50;
    component.exclusive = true;
    component.filesystem = 'xfs';
    await component.attach();

    expect(bff.attachPool).toHaveBeenCalledWith('dev-1', {
      diskSerial: 'WWN-BBB',
      poolPath: '/var/hugmesh/storage/x',
      reservedBytes: 50 * GiB,
      exclusive: true,
      filesystem: 'xfs',
    });
    expect(component.diskSerial).toBe('');
    expect(component.poolPath).toBe('');
  });

  it('does not call the BFF and surfaces an error when attach fields are missing', async () => {
    await init();
    component.diskSerial = '';
    component.poolPath = '';
    await component.attach();
    expect(bff.attachPool).not.toHaveBeenCalled();
    expect(component.attachError()).not.toBe('');
  });

  it('assigns a service (GiB -> bytes) through the pool endpoint', async () => {
    await init();
    bff.assignService.and.resolveTo(fixtureAssignments()[0]);

    component.assignPoolId = 'pool-1';
    component.serviceName = ' owncast ';
    component.pvcName = 'owncast-data';
    component.requestedGiB = 10;
    await component.assign();

    expect(bff.assignService).toHaveBeenCalledWith('pool-1', {
      serviceName: 'owncast',
      pvcName: 'owncast-data',
      requestedBytes: 10 * GiB,
    });
  });

  it('surfaces a BFF over-subscription error on assign without throwing', async () => {
    await init();
    bff.assignService.and.rejectWith(new Error('over-subscription: pool pool-1 reserved=...'));

    component.assignPoolId = 'pool-1';
    component.serviceName = 'big-svc';
    component.pvcName = 'big-pvc';
    component.requestedGiB = 200;
    await component.assign();

    expect(component.assignError()).toContain('over-subscription');
  });

  it('WARNS when a likely-stateful (database) service is assigned to a node-pinned pool', () => {
    fixture.detectChanges();
    component.serviceName = 'postgres-primary';
    expect(component.assignWarning()).toContain('NO HA');
    component.serviceName = 'owncast';
    expect(component.assignWarning()).toBe('');
  });

  it('revokes an assignment and reloads', async () => {
    await init();
    bff.revokeAssignment.and.resolveTo({ revoked: 1 });
    bff.storagePools.and.resolveTo({ pools: fixturePools(), assignments: [] });

    await component.revoke('a-1');
    fixture.detectChanges();

    expect(bff.revokeAssignment).toHaveBeenCalledWith('a-1');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-assignment-id="a-1"]')).toBeNull();
  });

  it('detaches a pool', async () => {
    await init();
    bff.detachPool.and.resolveTo({ detached: 1 });
    bff.storagePools.and.resolveTo({ pools: [], assignments: [] });

    await component.detach('pool-1');
    expect(bff.detachPool).toHaveBeenCalledWith('pool-1');
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="storage-pools-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('sp-heading');
      expect(el.querySelector('#sp-heading')).not.toBeNull();
    });

    it('associates every form control with a visible <label for>', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['sp-device', 'sp-disk', 'sp-path', 'sp-reserved', 'sp-fs', 'sp-exclusive',
        'sp-pool', 'sp-service', 'sp-pvc', 'sp-requested']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('announces a validation error in role=alert/assertive and sets aria-invalid', async () => {
      await init();
      component.diskSerial = '';
      component.poolPath = '';
      await component.attach();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="sp-attach-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#sp-disk')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('gives each revoke/detach button a service/pool-specific accessible name', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-revoke="a-1"]')!.getAttribute('aria-label')).toContain('owncast');
      expect(el.querySelector('[data-detach="pool-1"]')!.getAttribute('aria-label')).toContain('WWN-AAA');
    });
  });
});
