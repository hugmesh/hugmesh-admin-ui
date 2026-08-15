import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DelegationComponent } from './delegation.component';
import { DelegationStore } from './delegation-store.service';
import {
  AccessSuspension,
  BffService,
  DomainCapability,
  DomainLock,
} from '../bff.service';

/**
 * DelegationComponent tests — the ADMIN-only access-roles + domain-lock +
 * namespace-access console. Role-matrixed: the admin's WIRED actions, the
 * no-endpoint GAP controls rendered disabled+helptext (defence-in-depth), and
 * the a11y contract. Delineated USER-SITUATIONAL / MULTIUSER / CROSS-USER /
 * CONCURRENT per the test standard.
 */

const suspension: AccessSuspension = {
  id: 's1', casdoorUser: 'google:bob@gmail.com', localpart: 'bob', role: 'ROLE_MATRIX',
  state: 'active', suspendedAt: '2026-06-12T00:00:00Z', expiresAt: null, restoreRole: false,
  propagationState: 'pending', reason: null, setBy: 'admin',
};
const lock: DomainLock = {
  id: 'l1', casdoorUser: 'google:carol@gmail.com', localpart: 'carol', role: 'ROLE_MASTODON_DOMAINLOCKED',
  state: 'active', createdAt: '2026-06-12T00:00:00Z', propagationState: 'pending', reason: null, setBy: 'admin',
};

/** An `external-client-grant` gate row for this admin's own domain, with both keys settable. */
function capability(granted: boolean, enabled: boolean): DomainCapability {
  return {
    id: 'c1', domain: 'default', capability: BffService.EXTERNAL_CLIENT_GRANT,
    granted, enabled, updatedBy: 'root', updatedAt: '2026-06-12T00:00:00Z', generation: 1,
  };
}

describe('DelegationComponent', () => {
  let fixture: ComponentFixture<DelegationComponent>;
  let component: DelegationComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'accessRoles', 'suspendAccessRole', 'clearAccessRole',
      'domainLocks', 'lockDomain', 'unlockDomain',
      'namespaceAccess', 'grantNamespace', 'revokeNamespace',
      'searchUsers', 'domainCapabilities', 'grantRole', 'revokeRole',
    ]);
    // The user pickers are typeaheads now; every one of them injects BffService and calls
    // searchUsers on a debounce, so the spy must answer or the component throws on input.
    bff.searchUsers.and.resolveTo([]);
    // Default: the external-client capability is fully active, so the wired-path tests
    // exercise the live control. The greyed-path tests override this per case.
    bff.domainCapabilities.and.resolveTo([capability(true, true)]);
    bff.grantRole.and.resolveTo({ granted: 'ROLE_MATRIX_EXTERNAL_CLIENT', user: 'bob' });
    bff.revokeRole.and.resolveTo({ revoked: 'ROLE_MATRIX_EXTERNAL_CLIENT', user: 'bob' });
    bff.accessRoles.and.resolveTo({ suspensions: [suspension] });
    bff.domainLocks.and.resolveTo({ domainLocks: [lock] });
    bff.namespaceAccess.and.resolveTo({
      namespaces: ['hugmesh-pki', 'observability'],
      grants: [{ user: 'bob', namespaces: ['observability'] }],
    });
    bff.suspendAccessRole.and.resolveTo({ suspended: suspension, suspensions: [suspension] });
    bff.clearAccessRole.and.resolveTo({ suspensions: [] });
    bff.lockDomain.and.resolveTo({ locked: lock, domainLocks: [lock] });
    bff.unlockDomain.and.resolveTo({ domainLocks: [] });
    bff.grantNamespace.and.resolveTo({
      namespaces: ['hugmesh-pki', 'observability'],
      grants: [{ user: 'bob', namespaces: ['observability'] }, { user: 'eve', namespaces: ['hugmesh-pki'] }],
    });
    bff.revokeNamespace.and.resolveTo({ namespaces: ['hugmesh-pki', 'observability'], grants: [] });

    await TestBed.configureTestingModule({
      imports: [DelegationComponent],
      providers: [DelegationStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(DelegationComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();        // triggers ngOnInit
    await component.ngOnInit();      // deterministically await the full async load chain
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function el(): HTMLElement { return fixture.nativeElement; }

  // ── USER-SITUATIONAL (the admin's allowed actions + per-tab views) ─────
  describe('USER-SITUATIONAL', () => {
    it('loads both desired-state tables + namespaces on init', async () => {
      await init();
      expect(bff.accessRoles).toHaveBeenCalled();
      expect(bff.domainLocks).toHaveBeenCalled();
      expect(bff.namespaceAccess).toHaveBeenCalled();
      expect(el().querySelector('[data-suspension="s1"]')).not.toBeNull();
    });

    it('a PERMANENT ban (blank TTL) calls the BFF with null ttlSeconds', async () => {
      await init();
      component.suspendUser = 'google:bob@gmail.com';
      component.suspendTtl = '';
      await component.suspend();
      expect(bff.suspendAccessRole).toHaveBeenCalledWith(
        'ROLE_MATRIX', 'google:bob@gmail.com', { ttlSeconds: null, reason: null });
    });

    it('a TIMED ban parses ttlSeconds to a number', async () => {
      await init();
      component.suspendRole = 'ROLE_MASTODON';
      component.suspendUser = 'bob';
      component.suspendTtl = '3600';
      component.suspendReason = 'cooldown';
      await component.suspend();
      expect(bff.suspendAccessRole).toHaveBeenCalledWith(
        'ROLE_MASTODON', 'bob', { ttlSeconds: 3600, reason: 'cooldown' });
    });

    it('rejects a non-positive / non-integer TTL with an inline error and no BFF call', async () => {
      await init();
      component.suspendUser = 'bob';
      component.suspendTtl = '-5';
      await component.suspend();
      expect(bff.suspendAccessRole).not.toHaveBeenCalled();
      expect(component.suspendError()).toContain('positive whole number');
    });

    it('blocks an empty-user suspend and announces it', async () => {
      await init();
      component.suspendUser = '   ';
      await component.suspend();
      expect(bff.suspendAccessRole).not.toHaveBeenCalled();
      expect(component.suspendError()).toContain('Enter a user');
    });

    it('lifting a suspension calls clear with the row role+user', async () => {
      await init();
      await component.clearSuspension(suspension);
      expect(bff.clearAccessRole).toHaveBeenCalledWith('ROLE_MATRIX', 'google:bob@gmail.com');
    });

    it('domain-lock add posts role+user(+reason) and remove deletes', async () => {
      await init();
      component.select('domain-lock');
      component.lockRole = 'ROLE_MATRIX_DOMAINLOCKED';
      component.lockUser = 'carol';
      component.lockReason = 'mod';
      await component.lock();
      expect(bff.lockDomain).toHaveBeenCalledWith('ROLE_MATRIX_DOMAINLOCKED', 'carol', 'mod');
      await component.unlock(lock);
      expect(bff.unlockDomain).toHaveBeenCalledWith('ROLE_MASTODON_DOMAINLOCKED', 'google:carol@gmail.com');
    });

    it('namespace grant lower-cases the user + revoke calls through', async () => {
      await init();
      component.select('namespaces');
      component.nsUser = '  EVE  ';
      component.nsNamespace = 'hugmesh-pki';
      await component.grantNamespace();
      expect(bff.grantNamespace).toHaveBeenCalledWith('eve', 'hugmesh-pki');
      await component.revokeNamespace('bob', 'observability');
      expect(bff.revokeNamespace).toHaveBeenCalledWith('bob', 'observability');
    });

    it('exposes only the closed access-role + domain-lock vocabularies in the selects', async () => {
      await init();
      expect(component.accessRoles.map((r) => r.value)).toEqual(['ROLE_MATRIX', 'ROLE_MASTODON', 'PROFILE']);
      expect(component.domainLockRoles.map((r) => r.value))
        .toEqual(['ROLE_MATRIX_DOMAINLOCKED', 'ROLE_MASTODON_DOMAINLOCKED']);
    });
  });

  // ── MULTIUSER-SITUATIONAL (one admin acting over MANY users; honest state) ──
  describe('MULTIUSER-SITUATIONAL', () => {
    it('renders an honest pending-reconcile note after a ban (role=status/polite)', async () => {
      await init();
      component.suspendUser = 'bob';
      await component.suspend();
      fixture.detectChanges();
      const note = el().querySelector('[data-testid="dg-note"]')!;
      expect(note.getAttribute('role')).toBe('status');
      expect(note.getAttribute('aria-live')).toBe('polite');
      expect(note.textContent).toContain('pending reconcile');
    });

    it('renders a BFF reject in a role=alert/assertive region', async () => {
      bff.suspendAccessRole.and.rejectWith(new Error('role must be one of ROLE_MATRIX, ROLE_MASTODON, PROFILE'));
      await init();
      component.suspendUser = 'mallory';
      await component.suspend();
      fixture.detectChanges();
      const alert = el().querySelector('[data-testid="dg-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(alert.textContent).toContain('role must be one of');
    });

    it('shows each suspended user as their own row', async () => {
      bff.accessRoles.and.resolveTo({
        suspensions: [suspension, { ...suspension, id: 's2', casdoorUser: 'dave', role: 'ROLE_MASTODON' }],
      });
      await init();
      expect(el().querySelector('[data-suspension="s1"]')).not.toBeNull();
      expect(el().querySelector('[data-suspension="s2"]')).not.toBeNull();
    });
  });

  // ── CROSS-USER (the defence-in-depth GAP controls + isolation) ─────────
  describe('CROSS-USER (no-endpoint controls are disabled+helptext, never wired)', () => {
    it('renders the GAP controls aria-disabled with aria-describedby helptext', async () => {
      await init();
      for (const id of ['dg-gap-appeals', 'dg-gap-federate']) {
        const btn = el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
        expect(btn).withContext(id).not.toBeNull();
        // aria-disabled, NOT the native disabled attribute (AT must reach the helptext).
        expect(btn.getAttribute('aria-disabled')).withContext(id).toBe('true');
        expect(btn.hasAttribute('disabled')).withContext(id).toBeFalse();
        const describedBy = btn.getAttribute('aria-describedby')!;
        expect(describedBy).withContext(id).toBeTruthy();
        const help = el().querySelector(`#${describedBy}`)!;
        expect(help).withContext(`${id} help`).not.toBeNull();
        expect(help.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('the federate-instance gap names the build-time setting rather than implying a missing switch', async () => {
      await init();
      // The honesty requirement: the greyed control must say WHY nothing can flip it here,
      // not merely that it is unavailable.
      const help = el().querySelector('#dg-gap-federate-help')!;
      expect(help.textContent).toContain('allow_federation');
      expect(help.textContent).toContain('BUILD-TIME');
    });

    it('appeals adjudication still has no BFF method wired', async () => {
      await init();
      expect((bff as unknown as Record<string, unknown>)['decideAppeal']).toBeUndefined();
    });

    it('uses the shared accessibleName helper for user aria-labels on action buttons', async () => {
      await init();
      const lift = el().querySelector<HTMLButtonElement>('[data-clear="s1"]')!;
      expect(lift.getAttribute('aria-label')).toContain('google:bob@gmail.com');
      expect(lift.getAttribute('aria-label')).toContain('ROLE_MATRIX');
    });
  });

  // ── CONCURRENT (double-submit / interleaved tab actions) ───────────────
  describe('CONCURRENT', () => {
    it('a double-submitted ban issues two calls and the table reflects the last server snapshot', async () => {
      await init();
      component.suspendUser = 'bob';
      await Promise.all([component.suspend(), component.suspend()]);
      expect(bff.suspendAccessRole).toHaveBeenCalledTimes(2);
      expect(component.store.suspensions().length).toBe(1);
      expect(component.store.error()).toBe('');
    });
  });

  // ── EXTERNAL-CLIENT GRANT (capability-gated, wired to a real endpoint) ──
  describe('external-client grant', () => {
    /** Switch to the external-client tab and settle the view. */
    async function openTab(): Promise<void> {
      component.select('external-client');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('grants the platform-matched role for the picked user', async () => {
      await init();
      await openTab();
      component.externalPlatform = 'mastodon';
      component.externalUser = 'bob';
      await component.grantExternalClient();
      expect(bff.grantRole).toHaveBeenCalledWith('ROLE_MASTODON_EXTERNAL_CLIENT', 'bob');
    });

    it('revokes the platform-matched role', async () => {
      await init();
      await openTab();
      component.externalUser = 'bob';
      await component.revokeExternalClient();
      expect(bff.revokeRole).toHaveBeenCalledWith('ROLE_MATRIX_EXTERNAL_CLIENT', 'bob');
    });

    it('blocks an empty user with an inline error and no BFF call', async () => {
      await init();
      await openTab();
      component.externalUser = '  ';
      await component.grantExternalClient();
      expect(bff.grantRole).not.toHaveBeenCalled();
      expect(component.externalError()).toContain('Pick or enter a user');
    });

    it('surfaces a server denial verbatim and never claims the grant landed', async () => {
      bff.grantRole.and.rejectWith(
        new Error('external-client grants are not enabled for this domain'));
      await init();
      await openTab();
      component.externalUser = 'bob';
      await component.grantExternalClient();
      expect(component.externalError()).toContain('not enabled for this domain');
      expect(component.externalNote()).toBe('');
    });

    it('re-reads the capability after a denial so the greyed state catches up', async () => {
      bff.grantRole.and.rejectWith(new Error('nope'));
      await init();
      const before = bff.domainCapabilities.calls.count();
      await openTab();
      component.externalUser = 'bob';
      await component.grantExternalClient();
      expect(bff.domainCapabilities.calls.count()).toBeGreaterThan(before);
    });

    it('is live only when BOTH capability keys are set', async () => {
      await init();
      expect(component.externalGrantActive()).withContext('granted+enabled').toBeTrue();
      expect(component.externalGrantBlockedReason()).toBe('');
    });

    it('greys the controls with a superadmin-grant reason when the row is absent', async () => {
      bff.domainCapabilities.and.resolveTo([]);
      await init();
      await openTab();
      expect(component.externalGrantActive()).toBeFalse();
      expect(component.externalGrantBlockedReason()).toContain('superadmin has not granted');
      const grant = el().querySelector<HTMLButtonElement>('[data-testid="dg-ext-grant"]')!;
      expect(grant.disabled).toBeTrue();
    });

    it('greys the controls with an opt-in reason when granted but not enabled', async () => {
      bff.domainCapabilities.and.resolveTo([capability(true, false)]);
      await init();
      await openTab();
      expect(component.externalGrantActive()).toBeFalse();
      expect(component.externalGrantBlockedReason()).toContain('has not opted in');
    });

    it('greys the controls with a withdrawn reason when the superadmin key is off', async () => {
      bff.domainCapabilities.and.resolveTo([capability(false, true)]);
      await init();
      await openTab();
      expect(component.externalGrantBlockedReason()).toContain('withdrawn');
    });

    it('ignores the global sentinel row when resolving this domain\'s gate', async () => {
      // A superadmin session gets the ' global' kill row back too; treating it as the
      // own-domain row would misreport the gate.
      bff.domainCapabilities.and.resolveTo([
        { ...capability(true, false), domain: ' global' },
        capability(true, true),
      ]);
      await init();
      expect(component.externalGrantActive()).toBeTrue();
    });
  });

  // ── USER PICKERS (typeahead, domain-scoped server-side) ────────────────
  describe('user pickers', () => {
    it('renders every user field as a combobox, not a bare text input', async () => {
      await init();
      for (const id of ['dg-suspend-user', 'dg-lock-user', 'dg-ns-user']) {
        component.select(id === 'dg-suspend-user' ? 'suspensions'
          : id === 'dg-lock-user' ? 'domain-lock' : 'namespaces');
        fixture.detectChanges();
        const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
        expect(input).withContext(id).not.toBeNull();
        expect(input.getAttribute('role')).withContext(id).toBe('combobox');
        expect(input.getAttribute('aria-controls')).withContext(id).toBe(`${id}-listbox`);
        // The label association the previous plain input had must survive the swap.
        expect(el().querySelector(`label[for="${id}"]`)).withContext(`label for ${id}`).not.toBeNull();
      }
    });

    it('the picker never sends a domain — scoping is the server\'s job', async () => {
      await init();
      const picker = fixture.debugElement.nativeElement
        .querySelector('#dg-suspend-user') as HTMLInputElement;
      picker.value = 'ali';
      picker.dispatchEvent(new Event('input'));
      // searchUsers' signature carries no domain at all; assert the call shape rather
      // than trusting the component not to have invented one.
      expect(bff.searchUsers.calls.allArgs().every(args => args.length <= 3)).toBeTrue();
    });
  });

  // ── ACCESSIBILITY (labels, tables, live regions) ───────────────────────
  describe('accessibility', () => {
    it('associates the suspend-form controls with <label for>', async () => {
      await init();
      for (const id of ['dg-suspend-role', 'dg-suspend-user', 'dg-suspend-ttl', 'dg-suspend-reason']) {
        expect(el().querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el().querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('the blank-permanent TTL field carries explanatory helptext via aria-describedby', async () => {
      await init();
      const ttl = el().querySelector('#dg-suspend-ttl')!;
      const describedBy = ttl.getAttribute('aria-describedby')!;
      expect(describedBy).toContain('dg-ttl-help');
      expect(el().querySelector('#dg-ttl-help')!.textContent).toContain('PERMANENT');
    });

    it('every table uses a semantic thead with th[scope=col]', async () => {
      await init();
      component.select('domain-lock');
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-testid="dg-domain-locks-table"] thead th[scope="col"]').length)
        .toBeGreaterThanOrEqual(3);
    });

    it('gives each row action button a descriptive aria-label', async () => {
      await init();
      component.select('domain-lock');
      fixture.detectChanges();
      const remove = el().querySelector<HTMLButtonElement>('[data-unlock="l1"]')!;
      expect(remove.getAttribute('type')).toBe('button');
      expect(remove.getAttribute('aria-label')).toContain('ROLE_MASTODON_DOMAINLOCKED');
    });
  });

  // ── KEYBOARD (the tablist is a WAI-ARIA APG roving-tabindex composite) ──
  describe('KEYBOARD operability (tablist roving tabindex + Arrow keys)', () => {
    function tabs(): HTMLButtonElement[] {
      return Array.from(el().querySelectorAll('[data-testid="dg-tabs"] [role="tab"]'));
    }

    it('exposes a roving tabindex: only the selected tab is tabbable', async () => {
      document.body.appendChild(fixture.nativeElement);
      await init();
      await fixture.whenStable();
      const t = tabs();
      expect(t[0].tabIndex).toBe(0);
      expect(t.slice(1).every((b) => b.tabIndex === -1)).toBeTrue();
      fixture.nativeElement.remove();
    });

    it('End jumps roving focus to the last tab, Home back to the first', async () => {
      document.body.appendChild(fixture.nativeElement);
      await init();
      await fixture.whenStable();
      const t = tabs();
      t[0].focus();
      const list = el().querySelector('[data-testid="dg-tabs"]')!;
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      fixture.detectChanges();
      expect(document.activeElement).toBe(t[t.length - 1]);
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      fixture.detectChanges();
      expect(document.activeElement).toBe(t[0]);
      fixture.nativeElement.remove();
    });

    it('clicking a tab (native button = Enter/Space) selects its panel', async () => {
      await init();
      const nsTab = el().querySelector<HTMLButtonElement>('[data-tab="namespaces"]')!;
      nsTab.click();
      fixture.detectChanges();
      expect(component.tab()).toBe('namespaces');
      expect(el().querySelector('[data-testid="dg-panel-namespaces"]')).not.toBeNull();
    });
  });
});
