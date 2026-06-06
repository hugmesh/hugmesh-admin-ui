import { ComponentFixture, TestBed } from '@angular/core/testing';
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
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
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
});
