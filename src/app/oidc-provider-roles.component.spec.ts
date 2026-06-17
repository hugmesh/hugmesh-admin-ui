import { TestBed } from '@angular/core/testing';
import { OidcProviderRolesComponent } from './oidc-provider-roles.component';
import { BffService, OidcProviderMapping } from './bff.service';

describe('OidcProviderRolesComponent', () => {
  let bff: jasmine.SpyObj<BffService>;

  function setup(providers: OidcProviderMapping[] = []) {
    bff = jasmine.createSpyObj<BffService>('BffService', [
      'oidcProviderRoles', 'setOidcProviderRoles', 'clearOidcProviderRoles',
    ]);
    bff.oidcProviderRoles.and.resolveTo(providers);
    bff.setOidcProviderRoles.and.resolveTo(undefined);
    bff.clearOidcProviderRoles.and.resolveTo(undefined);
    TestBed.configureTestingModule({
      imports: [OidcProviderRolesComponent],
      providers: [{ provide: BffService, useValue: bff }],
    });
    const fixture = TestBed.createComponent(OidcProviderRolesComponent);
    return fixture.componentInstance;
  }

  it('loads providers on init', async () => {
    const c = setup([{ provider: 'google', roles: ['user'] }]);
    await c.ngOnInit();
    expect(c.providers().length).toBe(1);
    expect(c.providers()[0].provider).toBe('google');
  });

  it('rejects blank provider name', async () => {
    const c = setup();
    c.provider = '  ';
    await c.save();
    expect(c.formError()).toBeTruthy();
    expect(bff.setOidcProviderRoles).not.toHaveBeenCalled();
  });

  it('rejects invalid provider name characters', async () => {
    const c = setup();
    c.provider = 'UPPERCASE';
    await c.save();
    expect(c.formError()).toBeTruthy();
  });

  it('saves provider roles and reloads list', async () => {
    const updated = [{ provider: 'google', roles: ['user', 'mod'] }];
    bff.oidcProviderRoles.and.returnValues(
      Promise.resolve([]),
      Promise.resolve(updated),
    );
    const c = setup();
    await c.ngOnInit();
    c.provider = 'google';
    c.selectedRoles = ['user', 'mod'];
    await c.save();
    expect(bff.setOidcProviderRoles).toHaveBeenCalledWith('google', ['user', 'mod']);
    expect(c.providers()).toEqual(updated);
    expect(c.provider).toBe('');
  });

  it('removes a provider mapping and reloads list', async () => {
    bff.oidcProviderRoles.and.returnValues(
      Promise.resolve([{ provider: 'github', roles: ['user'] }]),
      Promise.resolve([]),
    );
    const c = setup();
    await c.ngOnInit();
    await c.remove('github');
    expect(bff.clearOidcProviderRoles).toHaveBeenCalledWith('github');
    expect(c.providers()).toEqual([]);
  });

  it('toggleRole adds and removes from selectedRoles', () => {
    const c = setup();
    c.selectedRoles = ['user'];
    c.toggleRole('mod');
    expect(c.selectedRoles).toContain('mod');
    c.toggleRole('user');
    expect(c.selectedRoles).not.toContain('user');
  });
});
