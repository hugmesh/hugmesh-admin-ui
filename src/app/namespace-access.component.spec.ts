import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NamespaceAccessComponent } from './namespace-access.component';
import { BffService } from './bff.service';

describe('NamespaceAccessComponent', () => {
  let fixture: ComponentFixture<NamespaceAccessComponent>;
  let component: NamespaceAccessComponent;
  let bff: jasmine.SpyObj<BffService>;

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['namespaceAccess', 'grantNamespace']);
    bff.namespaceAccess.and.resolveTo({
      namespaces: ['team-a', 'team-b'],
      grants: [{ user: 'alice@gmail.com', namespaces: ['team-a'] }],
    });
    await TestBed.configureTestingModule({
      imports: [NamespaceAccessComponent],
      providers: [{ provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(NamespaceAccessComponent);
    component = fixture.componentInstance;
  });

  it('loads namespaces + grants on init and defaults the select to the first namespace', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bff.namespaceAccess).toHaveBeenCalledTimes(1);
    expect(component.namespaces()).toEqual(['team-a', 'team-b']);
    expect(component.namespace).toBe('team-a');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-user="alice@gmail.com"]')).not.toBeNull();
  });

  it('grants access for a trimmed/lowercased user and clears the input', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    bff.grantNamespace.and.resolveTo({ namespaces: ['team-a'], grants: [{ user: 'bob', namespaces: ['team-a'] }] });

    component.user = '  Bob ';
    component.namespace = 'team-a';
    await component.grant();

    expect(bff.grantNamespace).toHaveBeenCalledWith('bob', 'team-a');
    expect(component.user).toBe('');
  });

  describe('accessibility', () => {
    it('associates the user input and namespace select with <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['ns-user', 'ns-select']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('announces a missing-user error in role=alert/assertive and sets aria-invalid', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.user = '';
      await component.grant();
      fixture.detectChanges();

      expect(bff.grantNamespace).not.toHaveBeenCalled();
      expect(component.userError()).not.toBe('');
      const el: HTMLElement = fixture.nativeElement;
      const alert = el.querySelector('[data-testid="ns-user-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.getAttribute('aria-live')).toBe('assertive');
      expect(el.querySelector<HTMLInputElement>('#ns-user')!.getAttribute('aria-invalid')).toBe('true');
    });
  });
});
