import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { AdminComponent } from './admin.component';
import { BffService } from './bff.service';
import { SessionService } from './session.service';
import { ADMIN_ROUTES } from './admin.routes';

describe('AdminComponent', () => {
  let fixture: ComponentFixture<AdminComponent>;
  let component: AdminComponent;
  let bff: jasmine.SpyObj<BffService>;
  // The menu hides superadmin-only items unless the session is a superadmin; this
  // signal lets each test choose the role the component sees.
  const superadmin = signal(false);

  beforeEach(async () => {
    superadmin.set(false);
    bff = jasmine.createSpyObj<BffService>('BffService', ['allowlist', 'invite']);
    bff.allowlist.and.resolveTo({ emails: ['a@gmail.com'], discord: ['bob'] });
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      // The landing view now carries the admin menu (routerLinks), so the test
      // module supplies a router. A stub SessionService drives the superadmin gate.
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: { isSuperadmin: superadmin } },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
  });

  it('renders an admin menu linking to the Backup, Recovery, Backups, Announcements, Test reports and Forum modules', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const menu = el.querySelector('[data-testid="admin-menu"]');
    expect(menu).withContext('admin menu nav').not.toBeNull();
    expect(menu!.getAttribute('aria-label')).toBe('Admin modules');
    expect(el.querySelector('[data-menu="backup"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="recovery"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="backups"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="announcements"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="test-reports"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="forum"]')).not.toBeNull();
  });

  it('renders the Appeals menu item (the appeals-decide console) for an ADMIN', () => {
    superadmin.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('[data-menu="appeals"]');
    expect(link).withContext('appeals menu link').not.toBeNull();
    expect(link!.textContent!.trim()).toBe('Appeals');
  });

  it('hides the superadmin-only Device licenses menu item from a non-superadmin', () => {
    superadmin.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-menu="device-licenses"]')).toBeNull();
  });

  it('surfaces the Device licenses menu item for a superadmin', () => {
    superadmin.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('[data-menu="device-licenses"]');
    expect(link).not.toBeNull();
    expect(link!.textContent!.trim()).toBe('Device licenses');
  });

  it('hides the superadmin-only Pending devices menu item from a non-superadmin', () => {
    superadmin.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-menu="device-pending"]')).toBeNull();
  });

  it('surfaces the Pending devices menu item for a superadmin', () => {
    superadmin.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('[data-menu="device-pending"]');
    expect(link).not.toBeNull();
    expect(link!.textContent!.trim()).toBe('Pending devices');
  });

  it('hides the superadmin-only Egress VPN menu item from a non-superadmin', () => {
    superadmin.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-menu="egress-vpn"]')).toBeNull();
  });

  it('surfaces the Egress VPN menu item for a superadmin', () => {
    superadmin.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('[data-menu="egress-vpn"]');
    expect(link).not.toBeNull();
    expect(link!.textContent!.trim()).toBe('Egress VPN');
  });

  it('hides the superadmin-only Domains menu item from a non-superadmin (admin/mod/user)', () => {
    superadmin.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-menu="superadmin/domains"]')).toBeNull();
  });

  it('surfaces the Domains menu item for a superadmin', () => {
    superadmin.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('[data-menu="superadmin/domains"]');
    expect(link).not.toBeNull();
    expect(link!.textContent!.trim()).toBe('Domains');
  });

  it('loads the allowlist on init and renders both lists', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(bff.allowlist).toHaveBeenCalledTimes(1);
    expect(component.emails()).toEqual(['a@gmail.com']);
    expect(component.discordUsers()).toEqual(['bob']);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-email="a@gmail.com"]')).not.toBeNull();
    expect(el.querySelector('[data-discord="bob"]')).not.toBeNull();
  });

  it('trims + lowercases a Gmail invite, calls the BFF, and clears the input', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.invite.and.resolveTo({ emails: ['a@gmail.com', 'new@gmail.com'], discord: [] });

    component.email = '  New@Gmail.com  ';
    await component.inviteEmail();

    expect(bff.invite).toHaveBeenCalledWith('email', 'new@gmail.com');
    expect(component.email).toBe('');
    expect(component.emails()).toContain('new@gmail.com');
  });

  it('trims + lowercases a Discord invite via the discord channel', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.invite.and.resolveTo({ emails: [], discord: ['carol'] });

    component.discord = '  Carol ';
    await component.inviteDiscord();

    expect(bff.invite).toHaveBeenCalledWith('discord', 'carol');
    expect(component.discord).toBe('');
  });

  it('does not call the BFF when the invite input is blank/whitespace', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.invite.calls.reset();

    component.email = '   ';
    await component.inviteEmail();
    component.discord = '';
    await component.inviteDiscord();

    expect(bff.invite).not.toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('associates each text input with a visible <label for>', () => {
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['admin-email', 'admin-discord']) {
        const input = el.querySelector<HTMLInputElement>(`#${id}`);
        const label = el.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        expect(input).withContext(`#${id} input`).not.toBeNull();
        expect(label).withContext(`label for #${id}`).not.toBeNull();
        expect(label!.textContent!.trim().length).toBeGreaterThan(0);
      }
    });

    it('marks a blank Gmail submit invalid and announces the error in role=alert/assertive', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.email = '   ';
      await component.inviteEmail();
      fixture.detectChanges();

      expect(component.emailError()).not.toBe('');
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="admin-email-error"]');
      expect(alert).withContext('error live region rendered').not.toBeNull();
      expect(alert!.getAttribute('role')).toBe('alert');
      expect(alert!.getAttribute('aria-live')).toBe('assertive');

      const input = el.querySelector<HTMLInputElement>('#admin-email')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('admin-email-error');
    });

    it('clears aria-invalid + the alert once a valid invite succeeds', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      // first trip the error
      component.email = '';
      await component.inviteEmail();
      fixture.detectChanges();
      expect(component.emailError()).not.toBe('');

      bff.invite.and.resolveTo({ emails: ['ok@gmail.com'], discord: [] });
      component.email = 'ok@gmail.com';
      await component.inviteEmail();
      fixture.detectChanges();

      expect(component.emailError()).toBe('');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="admin-email-error"]')).toBeNull();
      expect(el.querySelector<HTMLInputElement>('#admin-email')!.getAttribute('aria-invalid')).toBeNull();
    });
  });
});
/**
 * Regression coverage for a real bug: the menu's routerLink used
 * `['/', item.path]`, an ABSOLUTE navigation from the router root (e.g.
 * `/usage`) rather than a link relative to where AdminComponent is actually
 * mounted (`/admin`, per admin.routes.ts's own doc comment). Every existing
 * AdminComponent spec above used `provideRouter([])` (an EMPTY route table),
 * which asserts the `data-menu` attribute is present but can never catch a
 * wrong TARGET — an absolute-vs-relative regression renders identically
 * either way when there is nothing for the router to actually resolve
 * against. This suite mounts the REAL `ADMIN_ROUTES` under `/admin` (mirroring
 * how the snapdragon.systems host actually mounts this remote) and asserts
 * the rendered anchors resolve to `/admin/<path>`, not `/<path>`.
 */
describe('AdminComponent menu — resolved navigation targets', () => {
  beforeEach(async () => {
    const bff = jasmine.createSpyObj<BffService>('BffService', ['allowlist', 'invite']);
    bff.allowlist.and.resolveTo({ emails: [], discord: [] });
    await TestBed.configureTestingModule({
      providers: [
        { provide: BffService, useValue: bff },
        { provide: SessionService, useValue: { isSuperadmin: signal(true) } },
        provideRouter([{ path: 'admin', children: ADMIN_ROUTES }]),
      ],
    }).compileComponents();
  });

  it('resolves the Usage analytics menu link to /admin/usage, not /usage', async () => {
    const harness = await RouterTestingHarness.create('/admin');
    harness.detectChanges();
    const el: HTMLElement = harness.routeNativeElement!;
    const link = el.querySelector<HTMLAnchorElement>('[data-menu="usage"]');
    expect(link).withContext('usage menu link').not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/admin/usage');
  });

  it('resolves the Namespace access menu link to /admin/namespaces, not /namespaces', async () => {
    const harness = await RouterTestingHarness.create('/admin');
    harness.detectChanges();
    const el: HTMLElement = harness.routeNativeElement!;
    const link = el.querySelector<HTMLAnchorElement>('[data-menu="namespaces"]');
    expect(link).withContext('namespaces menu link').not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/admin/namespaces');
  });

  it('resolves a nested-path menu link (superadmin/domains) to /admin/superadmin/domains', async () => {
    const harness = await RouterTestingHarness.create('/admin');
    harness.detectChanges();
    const el: HTMLElement = harness.routeNativeElement!;
    const link = el.querySelector<HTMLAnchorElement>('[data-menu="superadmin/domains"]');
    expect(link).withContext('superadmin/domains menu link').not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/admin/superadmin/domains');
  });
});
