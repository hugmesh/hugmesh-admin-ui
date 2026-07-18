import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceLicensesComponent } from './device-licenses.component';
import { AdminSshIssueResult, AdminSshIssuedKey, BffService, DeviceRegistration } from './bff.service';

const fixtureIssuedKeys = (): AdminSshIssuedKey[] => [
  {
    id: 'ssh-1',
    deviceId: 'dev-1',
    licenseId: 'lic-1',
    operator: 'alice@gmail.com',
    keyType: 'ssh-ed25519',
    publicKey: 'ssh-ed25519 AAAA... alice@gmail.com',
    fingerprint: 'SHA256:zzz',
    issuedBy: 'root',
    issuedAt: '2026-07-18T00:00:00Z',
    downloadedAt: null,
    state: 'issued',
    domain: 'brand-a',
    revokedAt: null,
    revokedBy: null,
  },
];

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
      ['devices', 'grantDeviceLicense', 'grantDomainLicense', 'revokeLicense',
        'issuedSshKeys', 'issueSshKey', 'downloadSshPrivateKey', 'revokeSshKey']);
    bff.devices.and.resolveTo(fixtureDevices());
    bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
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

  describe('ssh key issuance', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('fetches and renders the issued-keys panel on expand, and hides it again on collapse', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });

      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      expect(bff.issuedSshKeys).toHaveBeenCalledWith('dev-1');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-ssh-panel="dev-1"]')).not.toBeNull();
      expect(el.querySelector('[data-issued-key-id="ssh-1"]')).not.toBeNull();

      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();
      expect(el.querySelector('[data-ssh-panel="dev-1"]')).toBeNull();
    });

    it('shows a ships-dark notice and disables Issue new key when the feature is not enabled', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: false, issuedKeys: [] });

      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ssh-dark-dev-1"]')).not.toBeNull();
      const issueBtn = el.querySelector<HTMLButtonElement>('[data-ssh-issue="dev-1"]')!;
      expect(issueBtn.disabled).toBeTrue();
    });

    it('issues a new key and refreshes the panel', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
      await component.toggleSshPanel('dev-1');
      bff.issueSshKey.and.resolveTo({
        issuedKeyId: 'ssh-2', fingerprint: 'SHA256:new', publicKey: 'ssh-ed25519 AAAA...',
        deviceLastSeenAt: null, deviceStale: true,
      });
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });

      await component.issueSshKey('dev-1');
      fixture.detectChanges();

      expect(bff.issueSshKey).toHaveBeenCalledWith('dev-1');
      expect(component.sshNote()?.kind).toBe('ok');
      expect(component.sshNote()?.text).toContain('SHA256:new');
      expect(bff.issuedSshKeys).toHaveBeenCalledTimes(2); // initial expand + post-issue refresh
    });

    it('the issue button fails CLOSED (disabled) while the ships-dark flag is still unknown, before the first fetch resolves', () => {
      // No toggleSshPanel awaited here — assert the pre-fetch, in-flight state directly.
      const el: HTMLElement = fixture.nativeElement;
      expect(component.sshIssueEnabled()).toBeUndefined();
      void component.toggleSshPanel('dev-1'); // fire and leave pending
      fixture.detectChanges();
      const issueBtn = el.querySelector<HTMLButtonElement>('[data-ssh-issue="dev-1"]')!;
      expect(issueBtn.disabled).toBeTrue();
    });

    it('downloads a private key', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      bff.downloadSshPrivateKey.and.resolveTo(true);

      await component.downloadSshKey('dev-1', 'ssh-1');

      expect(bff.downloadSshPrivateKey).toHaveBeenCalledWith('ssh-1');
    });

    it('disables download once a key has already been downloaded, even though state stays "issued"', async () => {
      const downloaded = fixtureIssuedKeys();
      downloaded[0].downloadedAt = '2026-07-18T01:00:00Z';
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: downloaded });
      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const downloadBtn = el.querySelector<HTMLButtonElement>('[data-ssh-download="ssh-1"]')!;
      const revokeBtn = el.querySelector<HTMLButtonElement>('[data-ssh-revoke="ssh-1"]')!;
      expect(downloadBtn.disabled).toBeTrue();
      expect(revokeBtn.disabled).toBeFalse(); // revoke must stay available after a download
    });

    it('disables download and revoke (not just issue) once the ships-dark notice is showing', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: false, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-ssh-download="ssh-1"]')!.disabled).toBeTrue();
      expect(el.querySelector<HTMLButtonElement>('[data-ssh-revoke="ssh-1"]')!.disabled).toBeTrue();
    });

    it('revokes an issued key after confirmation and refreshes the panel', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      bff.revokeSshKey.and.resolveTo({ revoked: true, id: 'ssh-1' });

      await component.revokeSshKey('dev-1', 'ssh-1');

      expect(window.confirm).toHaveBeenCalled();
      expect(bff.revokeSshKey).toHaveBeenCalledWith('ssh-1');
      expect(component.sshNote()?.kind).toBe('ok');
      expect(bff.issuedSshKeys).toHaveBeenCalledTimes(2); // initial expand + post-revoke refresh
    });

    it('does not revoke when the confirmation is declined', async () => {
      spyOn(window, 'confirm').and.returnValue(false);
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');

      await component.revokeSshKey('dev-1', 'ssh-1');

      expect(bff.revokeSshKey).not.toHaveBeenCalled();
    });

    it('surfaces a ships-dark revoke refusal as an error, distinct from an ordinary "already revoked"', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      bff.revokeSshKey.and.resolveTo({ revoked: false, id: 'ssh-1', dark: true });

      await component.revokeSshKey('dev-1', 'ssh-1');

      expect(component.sshNote()?.kind).toBe('err');
      expect(component.sshNote()?.text).toContain('not enabled yet');
    });

    it('opens the inline MFA step-up dialog on a "requires step-up" 403 and retries the SAME action on success, without re-prompting confirm()', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      bff.revokeSshKey.and.rejectWith(new Error('revoke requires step-up re-authentication (present X-SshKeyIssue-StepUp)'));

      await component.revokeSshKey('dev-1', 'ssh-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();
      expect((window.confirm as jasmine.Spy).calls.count()).toBe(1);

      // The dialog reports success — the SAME revoke call is retried, this time succeeding, and
      // confirm() is NOT shown a second time (a blind retry never re-prompts the operator).
      bff.revokeSshKey.and.resolveTo({ revoked: true, id: 'ssh-1' });
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });

      await component.onSshStepUpSatisfied();
      fixture.detectChanges();

      expect(bff.revokeSshKey).toHaveBeenCalledTimes(2);
      expect((window.confirm as jasmine.Spy).calls.count()).toBe(1);
      expect(component.sshNote()?.kind).toBe('ok');
      expect(el.querySelector('[data-testid="mfa-stepup-dialog"]')).toBeNull();
    });

    it('dismisses the step-up dialog without retrying on cancel', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
      await component.toggleSshPanel('dev-1');
      bff.issueSshKey.and.rejectWith(new Error('issue requires step-up re-authentication (present X-SshKeyIssue-StepUp)'));
      await component.issueSshKey('dev-1');

      component.onSshStepUpDismissed();

      expect(bff.issueSshKey).toHaveBeenCalledTimes(1);
    });

    it('a busy action on the expanded device disables every gated control, not just the one clicked', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      await component.toggleSshPanel('dev-1');
      let resolveIssue!: (v: AdminSshIssueResult) => void;
      bff.issueSshKey.and.returnValue(new Promise<AdminSshIssueResult>((res) => { resolveIssue = res; }));

      const pending = component.issueSshKey('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector<HTMLButtonElement>('[data-ssh-issue="dev-1"]')!.disabled).toBeTrue();
      expect(el.querySelector<HTMLButtonElement>('[data-ssh-download="ssh-1"]')!.disabled).toBeTrue();
      expect(el.querySelector<HTMLButtonElement>('[data-ssh-revoke="ssh-1"]')!.disabled).toBeTrue();

      resolveIssue({ issuedKeyId: 'ssh-9', fingerprint: 'SHA256:x', publicKey: 'k', deviceLastSeenAt: null, deviceStale: false });
      await pending;
    });
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

    it('the ssh-issuance toggle exposes aria-expanded + aria-controls pointing at the panel it reveals', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const toggle = el.querySelector('[data-ssh-toggle="dev-1"]')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const controls = toggle.getAttribute('aria-controls')!;
      expect(controls).toBeTruthy();
      expect(el.querySelector(`#${controls}`)).not.toBeNull();
    });

    it('gives each issued-key download/revoke button an operator-specific accessible name', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: fixtureIssuedKeys() });
      fixture.detectChanges();
      await fixture.whenStable();
      await component.toggleSshPanel('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const download = el.querySelector('[data-ssh-download="ssh-1"]')!;
      const revoke = el.querySelector('[data-ssh-revoke="ssh-1"]')!;
      expect(download.getAttribute('aria-label')).toContain('alice@gmail.com');
      expect(revoke.getAttribute('aria-label')).toContain('alice@gmail.com');
    });

    it('an ssh-issuance error note announces role=alert/assertive; a success note is role=status/polite', async () => {
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
      fixture.detectChanges();
      await fixture.whenStable();
      await component.toggleSshPanel('dev-1');
      bff.issueSshKey.and.rejectWith(new Error('device is not in your domain'));

      await component.issueSshKey('dev-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const errNote = el.querySelector('[data-testid="ssh-note-dev-1"]')!;
      expect(errNote.getAttribute('role')).toBe('alert');
      expect(errNote.getAttribute('aria-live')).toBe('assertive');

      bff.issueSshKey.and.resolveTo({
        issuedKeyId: 'ssh-9', fingerprint: 'SHA256:ok', publicKey: 'k', deviceLastSeenAt: null, deviceStale: false,
      });
      bff.issuedSshKeys.and.resolveTo({ deviceId: 'dev-1', enabled: true, issuedKeys: [] });
      await component.issueSshKey('dev-1');
      fixture.detectChanges();

      const okNote = el.querySelector('[data-testid="ssh-note-dev-1"]')!;
      expect(okNote.getAttribute('role')).toBe('status');
      expect(okNote.getAttribute('aria-live')).toBe('polite');
    });
  });
});
