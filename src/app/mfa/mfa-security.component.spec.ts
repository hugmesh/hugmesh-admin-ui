import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MfaSecurityComponent } from './mfa-security.component';
import { MfaService } from './mfa.service';
import { MfaFactor, MfaResult } from './mfa.types';
import { SessionService } from '../session.service';

function ok<T>(data: T): MfaResult<T> {
  return { ok: true, dark: false, status: 200, data };
}
function dark<T>(): MfaResult<T> {
  return { ok: false, dark: true, status: 503 };
}
function fail<T>(status: number, error = 'nope'): MfaResult<T> {
  return { ok: false, dark: false, status, error };
}

function factor(over: Partial<MfaFactor> = {}): MfaFactor {
  return { id: 'f1', type: 'TOTP', enabled: true, createdAt: '2026-01-01T00:00:00Z', ...over };
}

describe('MfaSecurityComponent', () => {
  let fixture: ComponentFixture<MfaSecurityComponent>;
  let component: MfaSecurityComponent;
  let mfa: jasmine.SpyObj<MfaService>;

  async function configure(factorsResult: MfaResult<{ factors: MfaFactor[] }> = ok({ factors: [factor()] })) {
    TestBed.resetTestingModule();
    mfa = jasmine.createSpyObj<MfaService>('MfaService', [
      'factors', 'removeFactor', 'regenerateRecovery',
      'enrollTotp', 'verifyTotp', 'enrollWebauthnOptions', 'verifyWebauthn',
    ]);
    mfa.factors.and.resolveTo(factorsResult);
    TestBed.configureTestingModule({
      imports: [MfaSecurityComponent],
      providers: [
        { provide: MfaService, useValue: mfa },
        { provide: SessionService, useValue: { session: () => ({ label: 'admin@brand' }) } },
      ],
    });
    fixture = TestBed.createComponent(MfaSecurityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => configure());

  it('loads and lists the caller\'s own factors', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mfa-factor-list"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mfa-security-empty"]')).toBeNull();
  });

  it('shows the empty state when there are no factors', async () => {
    await configure(ok({ factors: [] }));
    expect(fixture.nativeElement.querySelector('[data-testid="mfa-security-empty"]')).not.toBeNull();
  });

  it('flips to the terminal dark state on a 503 and hides the list', async () => {
    await configure(dark());
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="mfa-security-dark"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="mfa-factor-list"]')).toBeNull();
  });

  it('removing a factor that succeeds updates the list without a step-up prompt', async () => {
    mfa.removeFactor.and.resolveTo(ok({ removed: true }));
    await component.remove(factor());
    expect(component.factors().length).toBe(0);
    expect(component.stepUpChallenge()).toBeNull();
  });

  it('offers the inline step-up dialog when removal 403s, then retries on satisfied', async () => {
    mfa.removeFactor.and.resolveTo(fail(403));
    await component.remove(factor());
    fixture.detectChanges();
    expect(component.stepUpChallenge()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mfa-stepup-dialog"]')).not.toBeNull();

    // Once the challenge is satisfied, the SAME mutation is retried and now succeeds.
    mfa.removeFactor.and.resolveTo(ok({ removed: true }));
    await component.onStepUpSatisfied();
    expect(component.stepUpChallenge()).toBeNull();
    expect(component.factors().length).toBe(0);
    expect(mfa.removeFactor).toHaveBeenCalledTimes(2);
  });

  it('dismissing the step-up dialog drops the pending mutation (no retry)', async () => {
    mfa.removeFactor.and.resolveTo(fail(403));
    await component.remove(factor());
    expect(component.stepUpChallenge()).not.toBeNull();
    component.onStepUpDismissed();
    expect(component.stepUpChallenge()).toBeNull();
    expect(mfa.removeFactor).toHaveBeenCalledTimes(1);
  });

  it('regenerate() shows display-once codes on success', async () => {
    mfa.regenerateRecovery.and.resolveTo(ok({ recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'] }));
    await component.regenerate();
    expect(component.newRecoveryCodes()).toEqual(['AAAA-BBBB-CCCC-DDDD']);
  });

  it('regenerate() offers the step-up dialog on a 403', async () => {
    mfa.regenerateRecovery.and.resolveTo(fail(403));
    await component.regenerate();
    expect(component.stepUpChallenge()?.description).toContain('recovery codes');
  });

  it('walks the TOTP enroll wizard end to end and returns to the list refreshed', async () => {
    mfa.enrollTotp.and.resolveTo(ok({ factorId: 'f2', otpauthUri: 'otpauth://totp/x?secret=ABCDEFGH', secret: 'ABCDEFGH' }));
    mfa.verifyTotp.and.resolveTo(ok({ enabled: true, recoveryCodes: ['XXXX-YYYY-ZZZZ-WWWW'] }));
    mfa.factors.and.resolveTo(ok({ factors: [factor(), factor({ id: 'f2' })] }));

    component.startEnroll();
    expect(component.view()).toBe('enroll');
    await component.startTotp();
    expect(component.enrollStep()).toBe('totp-show');
    expect(component.secret()).toBe('ABCDEFGH');

    component.passcode = '123456';
    await component.verifyTotp();
    expect(component.enrollStep()).toBe('recovery');
    expect(component.recoveryCodes()).toEqual(['XXXX-YYYY-ZZZZ-WWWW']);
    // Secret is forgotten once the factor is enabled (display-once).
    expect(component.secret()).toBe('');

    await component.finishEnroll();
    expect(component.view()).toBe('list');
    expect(component.factors().length).toBe(2);
  });

  it('rejects a non-6-digit code before calling verifyTotp', async () => {
    component.startEnroll();
    component.passcode = '12';
    await component.verifyTotp();
    expect(mfa.verifyTotp).not.toHaveBeenCalled();
    expect(component.enrollError()).toContain('6-digit');
  });

  it('cancelEnroll returns to the list view without enrolling', () => {
    component.startEnroll();
    component.cancelEnroll();
    expect(component.view()).toBe('list');
  });

  // ── --hug-* palette regression guard ─────────────────────────────────────────
  // mfa.component.scss (shared by this console AND the inline step-up dialog)
  // was once written against a --snap-color-* token family defined NOWHERE in
  // the fleet, so every value collapsed to its light-theme fallback: #fff button
  // surfaces under the shell's near-white inherited --hug-text — white-on-white
  // controls on a security-critical surface. These assertions resolve the REAL
  // computed colors against the :root --hug-* contract (karma loads
  // src/styles.scss, same as the app), so a reintroduced foreign token family —
  // whose var() lookups would miss and re-fire light fallbacks — fails here.
  describe('renders on the --hug-* palette (no foreign token families)', () => {
    /** The computed style of the first element matching a testid. */
    function styleOf(testid: string): CSSStyleDeclaration {
      const el = fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
      expect(el).withContext(`${testid} must render`).not.toBeNull();
      return getComputedStyle(el);
    }

    it('the :root --hug-* contract is actually loaded (guard premise)', () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--hug-accent').trim();
      expect(accent).withContext('src/styles.scss must define the --hug-* contract').toBe('#7c4dff');
    });

    it('primary buttons carry the --hug-accent background with --hug-text labels', () => {
      const s = styleOf('mfa-security-add'); // .mfa-btn.primary
      expect(s.backgroundColor).toBe('rgb(124, 77, 255)'); // --hug-accent
      expect(s.color).toBe('rgb(232, 232, 240)'); // --hug-text
    });

    it('plain buttons sit on the --hug-bg-1 panel tone — never a light fallback', () => {
      const s = styleOf('mfa-security-regenerate'); // .mfa-btn
      expect(s.backgroundColor).toBe('rgb(18, 18, 30)'); // --hug-bg-1
      expect(s.color).toBe('rgb(232, 232, 240)'); // --hug-text (was: unset over #fff)
    });

    it('the setup key / recovery codes render in the real brand mono stack', async () => {
      // Enroll to the totp-show step so the mfa-secret <code> exists.
      mfa.enrollTotp.and.resolveTo(ok({ factorId: 'f-mono', secret: 'S3CRET', otpauthUri: 'otpauth://totp/x?secret=S3CRET' }));
      component.startEnroll();
      await component.startTotp();
      fixture.detectChanges();
      const s = styleOf('mfa-secret');
      // $font-mono must be a REAL monospace stack (branding baseline), not the
      // old Arial alias.
      expect(s.fontFamily).toContain('monospace');
      expect(s.fontFamily.toLowerCase()).not.toContain('arial');
    });
  });
});
