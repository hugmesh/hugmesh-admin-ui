import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceRadiosComponent } from './device-radios.component';
import {
  BffService,
  NodeRadio,
  DeviceRegistration,
} from './bff.service';

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

const fixtureRadios = (): NodeRadio[] => [
  {
    id: 'radio-1',
    deviceId: 'dev-1',
    transport: 'serial',
    serialPath: '/dev/ttyUSB0',
    radioId: 'lora-0',
    meshChannel: 0,
    state: 'active',
    domain: 'brand-a',
    propagationState: 'applied',
    generation: 1,
    createdBy: 'alice@gmail.com',
  },
  {
    id: 'radio-2',
    deviceId: 'dev-1',
    transport: 'mqtt',
    host: 'mqtt.example.org',
    port: 1883,
    topicRoot: 'msh/US',
    channelName: 'LongFast',
    gatewayNodeId: '!0a1b2c3d',
    radioId: 'wan-0',
    meshChannel: 1,
    state: 'active',
    domain: 'brand-a',
    propagationState: 'pending',
    generation: 2,
    createdBy: 'alice@gmail.com',
  },
];

describe('DeviceRadiosComponent', () => {
  let fixture: ComponentFixture<DeviceRadiosComponent>;
  let component: DeviceRadiosComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService',
      ['radios', 'devices', 'attachRadio', 'detachRadio']);
    bff.radios.and.resolveTo(fixtureRadios());
    bff.devices.and.resolveTo(fixtureDevices());
    await TestBed.configureTestingModule({
      imports: [DeviceRadiosComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(DeviceRadiosComponent);
    component = fixture.componentInstance;
  });

  /** Trigger the component lifecycle (which runs ngOnInit ONCE) then flush BOTH awaited
   *  load boundaries before rendering. Flushing whenStable twice covers the two sequential
   *  awaits in ngOnInit (radios, then devices) deterministically. */
  async function init(): Promise<void> {
    fixture.detectChanges();           // fires ngOnInit via the lifecycle (once)
    await fixture.whenStable();        // radios() resolved
    await fixture.whenStable();        // devices() resolved (second await boundary)
    fixture.detectChanges();           // render with the loaded data
  }

  /** Switch the transport THROUGH the real select (value + change event), the way a user
   *  does. Mutating `component.transport` directly never re-renders here: under the
   *  notification-based change-detection scheduler only views MARKED dirty get refreshed
   *  by detectChanges(), and a bare property write from test code marks nothing — the DOM
   *  event is what marks the view (and is also what drives ngModel + onTransportChange
   *  in production). */
  function switchTransport(value: 'serial' | 'tcp' | 'mqtt'): void {
    const select = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLSelectElement>('#dr-transport')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('loads radios/devices on init and defaults the node select', async () => {
    await init();

    expect(bff.radios).toHaveBeenCalledTimes(1);
    expect(bff.devices).toHaveBeenCalledTimes(1);
    expect(component.radios().length).toBe(2);
    expect(component.attachDeviceId).toBe('dev-1');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-radio-id="radio-1"]')).not.toBeNull();
    expect(el.querySelector('[data-radio-id="radio-2"]')).not.toBeNull();
  });

  it('renders an empty state when no radios are attached', async () => {
    bff.radios.and.resolveTo([]);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="dr-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-radio-id]')).toBeNull();
  });

  it('summarises each transport for the radio row (serial path / broker+topic)', async () => {
    await init();
    expect(component.transportSummary(fixtureRadios()[0])).toBe('/dev/ttyUSB0');
    expect(component.transportSummary(fixtureRadios()[1]))
      .toBe('mqtt.example.org:1883 · msh/US/LongFast · gw !0a1b2c3d');
    expect(component.transportSummary({
      ...fixtureRadios()[0], transport: 'tcp', host: 'radio.local', port: 4403,
    })).toBe('radio.local:4403');
  });

  it('renders a propagation chip carrying the reconcile state', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    const chip = el.querySelector('[data-prop="applied"]')!;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toContain('applied');
  });

  it('shows ONLY the selected transport\'s inputs and resets the default port on change', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    // serial (the default): serial path only, no host/port/topic inputs.
    expect(el.querySelector('#dr-serial-path')).not.toBeNull();
    expect(el.querySelector('#dr-host')).toBeNull();
    expect(el.querySelector('#dr-topic-root')).toBeNull();

    // tcp: host+port appear, serial path disappears; port defaults 4403.
    switchTransport('tcp');
    expect(el.querySelector('#dr-serial-path')).toBeNull();
    expect(el.querySelector('#dr-host')).not.toBeNull();
    expect(el.querySelector('#dr-port')).not.toBeNull();
    expect(el.querySelector('#dr-topic-root')).toBeNull();
    expect(component.transport).toBe('tcp');
    expect(component.port).toBe(4403);

    // mqtt: topic root + channel name + optional gateway appear; port defaults 1883.
    switchTransport('mqtt');
    expect(el.querySelector('#dr-topic-root')).not.toBeNull();
    expect(el.querySelector('#dr-channel-name')).not.toBeNull();
    expect(el.querySelector('#dr-gateway')).not.toBeNull();
    expect(component.transport).toBe('mqtt');
    expect(component.port).toBe(1883);
  });

  it('attaches a serial radio and clears the one-shot inputs', async () => {
    await init();
    bff.attachRadio.and.resolveTo(fixtureRadios()[0]);

    component.attachDeviceId = 'dev-1';
    component.transport = 'serial';
    component.serialPath = ' /dev/ttyUSB0 ';
    component.radioId = ' lora-0 ';
    component.meshChannel = 0;
    await component.attach();

    expect(bff.attachRadio).toHaveBeenCalledWith('dev-1', {
      transport: 'serial',
      serialPath: '/dev/ttyUSB0',
      radioId: 'lora-0',
      meshChannel: 0,
    });
    expect(component.radioId).toBe('');
    expect(component.serialPath).toBe('');
  });

  it('attaches a tcp radio carrying host+port only', async () => {
    await init();
    bff.attachRadio.and.resolveTo(fixtureRadios()[0]);

    component.transport = 'tcp';
    component.onTransportChange();
    component.host = 'radio.local';
    component.radioId = 'lora-wifi-0';
    component.meshChannel = 2;
    await component.attach();

    expect(bff.attachRadio).toHaveBeenCalledWith('dev-1', {
      transport: 'tcp',
      host: 'radio.local',
      port: 4403,
      radioId: 'lora-wifi-0',
      meshChannel: 2,
    });
  });

  it('attaches an mqtt radio carrying broker+topic+channel (+optional gateway)', async () => {
    await init();
    bff.attachRadio.and.resolveTo(fixtureRadios()[1]);

    component.transport = 'mqtt';
    component.onTransportChange();
    component.host = 'mqtt.example.org';
    component.topicRoot = ' msh/US ';
    component.channelName = 'LongFast';
    component.gatewayNodeId = '!0a1b2c3d';
    component.radioId = 'wan-0';
    component.meshChannel = 1;
    await component.attach();

    expect(bff.attachRadio).toHaveBeenCalledWith('dev-1', {
      transport: 'mqtt',
      host: 'mqtt.example.org',
      port: 1883,
      topicRoot: 'msh/US',
      channelName: 'LongFast',
      gatewayNodeId: '!0a1b2c3d',
      radioId: 'wan-0',
      meshChannel: 1,
    });
  });

  it('omits the optional gateway node id from the mqtt payload when blank', async () => {
    await init();
    bff.attachRadio.and.resolveTo(fixtureRadios()[1]);

    component.transport = 'mqtt';
    component.onTransportChange();
    component.host = 'mqtt.example.org';
    component.topicRoot = 'msh/US';
    component.channelName = 'LongFast';
    component.radioId = 'wan-1';
    await component.attach();

    const body = bff.attachRadio.calls.mostRecent().args[1];
    expect('gatewayNodeId' in body).toBeFalse();
  });

  it('does not call the BFF and surfaces an error when the radio id is missing', async () => {
    await init();
    component.radioId = '';
    await component.attach();
    expect(bff.attachRadio).not.toHaveBeenCalled();
    expect(component.attachError()).not.toBe('');
  });

  it('blocks a serial attach whose path is not an absolute /dev/… path (client-side)', async () => {
    await init();
    component.transport = 'serial';
    component.serialPath = 'ttyUSB0';
    component.radioId = 'lora-0';
    await component.attach();
    expect(bff.attachRadio).not.toHaveBeenCalled();
    expect(component.attachError()).toContain('/dev/');
  });

  it('blocks an mqtt attach missing the topic root / channel name (client-side)', async () => {
    await init();
    component.transport = 'mqtt';
    component.onTransportChange();
    component.host = 'mqtt.example.org';
    component.topicRoot = '';
    component.channelName = '';
    component.radioId = 'wan-0';
    await component.attach();
    expect(bff.attachRadio).not.toHaveBeenCalled();
    expect(component.attachError()).toContain('topic root');
  });

  it('surfaces a BFF mixed-shape 422 error on attach without throwing', async () => {
    await init();
    bff.attachRadio.and.rejectWith(new Error('serial transport must not carry host/port (mixed transport shape)'));

    component.transport = 'serial';
    component.serialPath = '/dev/ttyUSB0';
    component.radioId = 'lora-0';
    await component.attach();

    expect(component.attachError()).toContain('mixed transport shape');
  });

  it('detaches a radio and reloads', async () => {
    await init();
    bff.detachRadio.and.resolveTo({ detached: 1 });
    bff.radios.and.resolveTo([]);

    await component.detach('radio-1');
    fixture.detectChanges();

    expect(bff.detachRadio).toHaveBeenCalledWith('radio-1');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-radio-id="radio-1"]')).toBeNull();
  });

  describe('accessibility', () => {
    it('labels the section heading via aria-labelledby', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="device-radios-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('dr-heading');
      expect(el.querySelector('#dr-heading')).not.toBeNull();
    });

    it('associates every visible form control with a visible <label for>', async () => {
      await init();
      switchTransport('mqtt');   // the widest field set
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['dr-device', 'dr-transport', 'dr-host', 'dr-port', 'dr-topic-root',
        'dr-channel-name', 'dr-gateway', 'dr-radio-id', 'dr-mesh-channel']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('announces a validation error in role=alert/assertive and sets aria-invalid', async () => {
      await init();
      component.transport = 'serial';
      component.serialPath = '';
      component.radioId = 'lora-0';
      await component.attach();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="dr-attach-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#dr-serial-path')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('gives each detach button a radio-specific accessible name', async () => {
      await init();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-detach="radio-1"]')!.getAttribute('aria-label')).toContain('lora-0');
      expect(el.querySelector('[data-detach="radio-2"]')!.getAttribute('aria-label')).toContain('wan-0');
    });
  });
});
