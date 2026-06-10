import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminComponent } from './admin.component';
import { BffService } from './bff.service';

describe('AdminComponent', () => {
  let fixture: ComponentFixture<AdminComponent>;
  let component: AdminComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['allowlist', 'invite']);
    bff.allowlist.and.resolveTo({ emails: ['a@gmail.com'], discord: ['bob'] });
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      // The landing view now carries the admin menu (routerLinks), so the test
      // module supplies a router.
      providers: [{ provide: BffService, useValue: bff }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
  });

  it('renders an admin menu linking to the Backup, Recovery and Backups modules', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const menu = el.querySelector('[data-testid="admin-menu"]');
    expect(menu).withContext('admin menu nav').not.toBeNull();
    expect(menu!.getAttribute('aria-label')).toBe('Admin modules');
    expect(el.querySelector('[data-menu="backup"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="recovery"]')).not.toBeNull();
    expect(el.querySelector('[data-menu="backups"]')).not.toBeNull();
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
