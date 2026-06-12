import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DelegationComponent } from './delegation.component';
import { DelegationStore } from './delegation-store.service';
import {
  AccessSuspension,
  BffService,
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

describe('DelegationComponent', () => {
  let fixture: ComponentFixture<DelegationComponent>;
  let component: DelegationComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'accessRoles', 'suspendAccessRole', 'clearAccessRole',
      'domainLocks', 'lockDomain', 'unlockDomain',
      'namespaceAccess', 'grantNamespace', 'revokeNamespace',
    ]);
    bff.accessRoles.and.resolveTo({ suspensions: [suspension] });
    bff.domainLocks.and.resolveTo({ domainLocks: [lock] });
    bff.namespaceAccess.and.resolveTo({
      namespaces: ['snapdragon-pki', 'observability'],
      grants: [{ user: 'bob', namespaces: ['observability'] }],
    });
    bff.suspendAccessRole.and.resolveTo({ suspended: suspension, suspensions: [suspension] });
    bff.clearAccessRole.and.resolveTo({ suspensions: [] });
    bff.lockDomain.and.resolveTo({ locked: lock, domainLocks: [lock] });
    bff.unlockDomain.and.resolveTo({ domainLocks: [] });
    bff.grantNamespace.and.resolveTo({
      namespaces: ['snapdragon-pki', 'observability'],
      grants: [{ user: 'bob', namespaces: ['observability'] }, { user: 'eve', namespaces: ['snapdragon-pki'] }],
    });
    bff.revokeNamespace.and.resolveTo({ namespaces: ['snapdragon-pki', 'observability'], grants: [] });

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
      component.nsNamespace = 'snapdragon-pki';
      await component.grantNamespace();
      expect(bff.grantNamespace).toHaveBeenCalledWith('eve', 'snapdragon-pki');
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
    it('renders the three GAP controls aria-disabled with aria-describedby helptext', async () => {
      await init();
      for (const id of ['dg-gap-role-grant', 'dg-gap-external-client', 'dg-gap-appeals']) {
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

    it('the GAP controls have no BFF method wired (the component never grants arbitrary roles)', async () => {
      await init();
      // No method on the component or BffService grants an arbitrary role /
      // external-client / adjudicates appeals — assert the surface is absent.
      expect((component as unknown as Record<string, unknown>)['grantRole']).toBeUndefined();
      expect((bff as unknown as Record<string, unknown>)['grantRole']).toBeUndefined();
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
});
