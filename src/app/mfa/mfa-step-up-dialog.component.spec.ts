import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MfaStepUpDialogComponent } from './mfa-step-up-dialog.component';
import { MfaService } from './mfa.service';
import { MfaResult } from './mfa.types';

function ok<T>(data: T): MfaResult<T> {
  return { ok: true, dark: false, status: 200, data };
}
function dark<T>(): MfaResult<T> {
  return { ok: false, dark: true, status: 503 };
}
function fail<T>(status: number, error = 'nope'): MfaResult<T> {
  return { ok: false, dark: false, status, error };
}

describe('MfaStepUpDialogComponent', () => {
  let fixture: ComponentFixture<MfaStepUpDialogComponent>;
  let component: MfaStepUpDialogComponent;
  let mfa: jasmine.SpyObj<MfaService>;

  function configure() {
    mfa = jasmine.createSpyObj<MfaService>('MfaService', [
      'challenge', 'assertWebauthnOptions',
    ]);
    TestBed.configureTestingModule({
      imports: [MfaStepUpDialogComponent],
      providers: [{ provide: MfaService, useValue: mfa }],
    });
    fixture = TestBed.createComponent(MfaStepUpDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => configure());

  it('defaults to the TOTP method with the code form visible', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mfa-stepup-code"]')).not.toBeNull();
    expect((el.querySelector('[data-testid="mfa-stepup-method-totp"]') as HTMLInputElement).checked).toBe(true);
  });

  it('rejects a non-6-digit TOTP code without calling the BFF', async () => {
    component.code = '123';
    await component.submitCode();
    expect(mfa.challenge).not.toHaveBeenCalled();
    expect(component.error()).toContain('6-digit');
  });

  it('submits a valid TOTP code and emits satisfied on success', async () => {
    mfa.challenge.and.resolveTo(ok({ mfaSatisfied: true }));
    const spy = jasmine.createSpy('satisfied');
    component.satisfied.subscribe(spy);
    component.code = '123456';
    await component.submitCode();
    expect(mfa.challenge).toHaveBeenCalledWith('totp', '123456');
    expect(spy).toHaveBeenCalled();
  });

  it('accepts a non-empty recovery code once the method is switched', async () => {
    mfa.challenge.and.resolveTo(ok({ mfaSatisfied: true }));
    component.setMethod('recovery');
    component.code = 'ABCD-EFGH-IJKL-MNOP';
    await component.submitCode();
    expect(mfa.challenge).toHaveBeenCalledWith('recovery', 'ABCD-EFGH-IJKL-MNOP');
  });

  it('surfaces a 401 (bad code) as a non-terminal error, not a crash', async () => {
    mfa.challenge.and.resolveTo(fail(401));
    component.code = '000000';
    await component.submitCode();
    expect(component.error()).toContain('did not verify');
    expect(component.dark()).toBeFalse();
  });

  it('flips to the terminal dark state on a 503', async () => {
    mfa.challenge.and.resolveTo(dark());
    component.code = '123456';
    await component.submitCode();
    expect(component.dark()).toBeTrue();
  });

  it('runs the webauthn ceremony and submits the assertion as a challenge', async () => {
    mfa.assertWebauthnOptions.and.resolveTo(ok({ challenge: 'Y2hhbGxlbmdl', rpId: 'hugmesh.systems', rpName: 'HugMesh' }));
    mfa.challenge.and.resolveTo(ok({ mfaSatisfied: true }));
    spyOn(navigator.credentials, 'get').and.resolveTo({
      id: 'cred-1',
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([2]).buffer,
        authenticatorData: new Uint8Array([3]).buffer,
        signature: new Uint8Array([4]).buffer,
      },
    } as unknown as PublicKeyCredential);
    const spy = jasmine.createSpy('satisfied');
    component.satisfied.subscribe(spy);
    await component.useWebauthn();
    expect(mfa.challenge).toHaveBeenCalledWith('webauthn', jasmine.any(String));
    expect(spy).toHaveBeenCalled();
  });

  it('emits dismissed and clears the field when cancelled', () => {
    const spy = jasmine.createSpy('dismissed');
    component.dismissed.subscribe(spy);
    component.code = 'abc';
    component.cancel();
    expect(spy).toHaveBeenCalled();
    expect(component.code).toBe('');
  });

  it('renders the caller-supplied action description in the intro', () => {
    fixture.componentRef.setInput('action', 'downloading this keys bundle');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mfa-stepup-intro"]').textContent)
      .toContain('downloading this keys bundle');
  });
});
