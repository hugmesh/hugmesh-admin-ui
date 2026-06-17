import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EgressVpnComponent } from './egress-vpn.component';
import { BffService, VpnConfigRow, VpnNodeAssignmentRow } from './bff.service';

const fixtureConfigs = (): VpnConfigRow[] => [
  {
    id: 'cfg-1',
    domain: 'brand-a',
    name: 'proton-us',
    kind: 'wireguard',
    provider: 'protonvpn',
    endpoint: '1.2.3.4:51820',
    secretRef: 'egress-vpn-brand-a-proton-us',
    state: 'active',
    createdBy: 'root',
    createdAt: null,
    propagationState: 'pending',
    generation: 1,
  },
  {
    id: 'cfg-2',
    domain: 'brand-a',
    name: 'old-config',
    kind: 'openvpn',
    provider: null,
    endpoint: '5.6.7.8:1194',
    secretRef: null,
    state: 'revoked',
    createdBy: 'root',
    createdAt: null,
    propagationState: 'applied',
    generation: 2,
  },
];

const fixtureAssignments = (): VpnNodeAssignmentRow[] => [
  {
    id: 'asg-1',
    configId: 'cfg-1',
    scopeType: 'DEVICE',
    targetNodeId: 'mkey:1',
    targetDomain: null,
    serviceSlug: 'coturn',
    state: 'active',
    assignedBy: 'root',
    domain: 'brand-a',
    propagationState: 'pending',
  },
];

describe('EgressVpnComponent', () => {
  let fixture: ComponentFixture<EgressVpnComponent>;
  let component: EgressVpnComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'egressVpn',
      'importVpnConfig',
      'revokeVpnConfig',
      'assignVpnNode',
      'assignVpnDomain',
      'revokeVpnAssignment',
    ]);
    bff.egressVpn.and.resolveTo({ configs: fixtureConfigs(), assignments: fixtureAssignments() });
    await TestBed.configureTestingModule({
      imports: [EgressVpnComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(EgressVpnComponent);
    component = fixture.componentInstance;
  });

  it('loads configs + assignments on init and renders them; the assign picker defaults to an active config', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.egressVpn).toHaveBeenCalledTimes(1);
    expect(component.configs().length).toBe(2);
    expect(component.assignments().length).toBe(1);
    // only the ACTIVE config is offered for assignment.
    expect(component.activeConfigs().map((c) => c.id)).toEqual(['cfg-1']);
    expect(component.assignConfigId).toBe('cfg-1');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-config-id="cfg-1"]')).not.toBeNull();
    expect(el.querySelector('[data-config-id="cfg-2"]')).not.toBeNull();
    expect(el.querySelector('[data-assignment-id="asg-1"]')).not.toBeNull();
    // a revoked config offers NO revoke button.
    expect(el.querySelector('[data-revoke-config="cfg-2"]')).toBeNull();
    expect(el.querySelector('[data-revoke-config="cfg-1"]')).not.toBeNull();
  });

  it('imports a config (sends the parsed body) and clears the inputs', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.importVpnConfig.and.resolveTo(fixtureConfigs()[0]);

    component.importDomain = 'brand-a';
    component.importName = 'proton-uk';
    component.importProvider = 'protonvpn';
    component.importConfigText = '[Interface]\nPrivateKey = s\n[Peer]\nPublicKey = p\nEndpoint = 1.2.3.4:51820\n';
    await component.import();

    expect(bff.importVpnConfig).toHaveBeenCalledWith({
      domain: 'brand-a',
      name: 'proton-uk',
      provider: 'protonvpn',
      config: '[Interface]\nPrivateKey = s\n[Peer]\nPublicKey = p\nEndpoint = 1.2.3.4:51820\n',
    });
    expect(component.importName).toBe('');
    expect(component.importConfigText).toBe('');
  });

  it('surfaces a BFF 422 (malformed config) in the import error live region and does NOT clear the config text', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.importVpnConfig.and.rejectWith(new Error('unrecognised VPN config'));

    component.importDomain = 'brand-a';
    component.importName = 'bad';
    component.importConfigText = 'not a vpn config';
    await component.import();

    expect(component.importError()).toBe('unrecognised VPN config');
    expect(component.importConfigText).toBe('not a vpn config'); // kept so the user can fix it
  });

  it('validates the import form locally (no BFF call when required fields are missing)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.importDomain = '';
    component.importName = 'x';
    component.importConfigText = 'cfg';
    await component.import();
    expect(bff.importVpnConfig).not.toHaveBeenCalled();
    expect(component.importError()).not.toBe('');
  });

  it('reads an uploaded .conf file into the config text and defaults the name from the filename', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const file = new File(['[Interface]\nPrivateKey = s\n'], 'proton-us.conf', { type: 'text/plain' });
    const input = { files: [file] } as unknown as HTMLInputElement;
    await component.onConfigFile({ target: input } as unknown as Event);
    expect(component.importConfigText).toContain('[Interface]');
    expect(component.importName).toBe('proton-us');
  });

  it('assigns a config to a NODE (with a service narrowing) and clears the node input', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.assignVpnNode.and.resolveTo(fixtureAssignments()[0]);

    component.assignConfigId = 'cfg-1';
    component.assignScope = 'NODE';
    component.assignNodeFp = 'mkey:9';
    component.assignService = 'coturn';
    await component.assign();

    expect(bff.assignVpnNode).toHaveBeenCalledWith('cfg-1', 'mkey:9', 'coturn');
    expect(bff.assignVpnDomain).not.toHaveBeenCalled();
    expect(component.assignNodeFp).toBe('');
  });

  it('assigns a config to a DOMAIN through the domain endpoint', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.assignVpnDomain.and.resolveTo(fixtureAssignments()[0]);

    component.assignConfigId = 'cfg-1';
    component.assignScope = 'DOMAIN';
    component.assignDomain = 'brand-a';
    component.assignService = '';
    await component.assign();

    expect(bff.assignVpnDomain).toHaveBeenCalledWith('cfg-1', 'brand-a', undefined);
    expect(bff.assignVpnNode).not.toHaveBeenCalled();
  });

  it('surfaces a cross-tenant assign rejection (BFF 422) in the assign error region', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.assignVpnNode.and.rejectWith(new Error('cross-tenant assignment refused'));

    component.assignConfigId = 'cfg-1';
    component.assignScope = 'NODE';
    component.assignNodeFp = 'mkey:other';
    await component.assign();

    expect(component.assignError()).toBe('cross-tenant assignment refused');
  });

  it('revokes a config and an assignment, reloading the lists', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.revokeVpnConfig.and.resolveTo(1);
    bff.revokeVpnAssignment.and.resolveTo(1);

    await component.revokeConfig('cfg-1');
    expect(bff.revokeVpnConfig).toHaveBeenCalledWith('cfg-1');
    await component.unassign('asg-1');
    expect(bff.revokeVpnAssignment).toHaveBeenCalledWith('asg-1');
    // a reload after each mutation (init + 2).
    expect(bff.egressVpn).toHaveBeenCalledTimes(3);
  });

  describe('accessibility', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('labels the section heading via aria-labelledby', () => {
      const el: HTMLElement = fixture.nativeElement;
      const section = el.querySelector('[data-testid="egress-vpn-view"]')!;
      expect(section.getAttribute('aria-labelledby')).toBe('ev-heading');
      expect(el.querySelector('#ev-heading')).not.toBeNull();
    });

    it('associates every form control with a visible <label for>', () => {
      const el: HTMLElement = fixture.nativeElement;
      const ids = [
        'ev-import-domain', 'ev-import-name', 'ev-import-provider', 'ev-import-file', 'ev-import-config',
        'ev-assign-config', 'ev-assign-scope', 'ev-assign-node', 'ev-assign-domain', 'ev-assign-service',
      ];
      for (const id of ids) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('announces a validation error in role=alert/assertive and sets aria-invalid', async () => {
      component.importDomain = '';
      component.importName = '';
      component.importConfigText = '';
      await component.import();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="ev-import-error"]')!;
      expect(alert).not.toBeNull();
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#ev-import-domain')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('gives each revoke / un-assign button a target-specific accessible name', () => {
      const el: HTMLElement = fixture.nativeElement;
      const revoke = el.querySelector('[data-revoke-config="cfg-1"]')!;
      expect(revoke.getAttribute('aria-label')).toContain('proton-us');
      const unassign = el.querySelector('[data-unassign="asg-1"]')!;
      expect(unassign.getAttribute('aria-label')).toContain('coturn');
    });

    it('gives both lists a heading-associated label', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ev-configs"]')!.getAttribute('aria-labelledby')).toBe('ev-configs-heading');
      expect(el.querySelector('[data-testid="ev-assignments"]')!.getAttribute('aria-labelledby')).toBe('ev-assignments-heading');
    });
  });
});
