import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MfaService } from './mfa.service';
import { MfaFactor } from './mfa.types';
import { encodeQr } from './qr';
import { createPasskey, webauthnSupported } from './webauthn';
import { SessionService } from '../session.service';
import { MfaStepUpDialogComponent } from './mfa-step-up-dialog.component';

/** The enrollment-wizard steps, shown inline when `view() === 'enroll'`. `dark`
 *  is terminal: the feature is not yet launched. The TOTP QR and its 6-digit
 *  verify input live on the SAME `totp-show` step (mirrors login-ui's wizard). */
type EnrollStep = 'choose' | 'totp-show' | 'recovery' | 'done' | 'dark';

/**
 * Admin "Security" console (`/admin/security`, any authenticated admin/superadmin
 * — this is SELF-service over the caller's OWN factors, not an admin-on-behalf-
 * of-another-user surface). Lists the caller's MFA factors, lets them enroll a
 * TOTP authenticator or a WebAuthn passkey, remove a factor, and regenerate
 * recovery codes — reusing login-ui's proven MFA UX (same `/bff/mfa/*` contract,
 * same shared hugmesh-auth-core backend) rendered in admin-ui's own
 * store-less single-component convention (a signal-only component, no separate
 * store service, matching the `desktop-governance`/`superadmin-domains` family
 * of lighter admin.routes.ts pages rather than the image-gen console's
 * heavier store-service split).
 *
 * <p>STEP-UP GATED MUTATIONS: removing a factor and regenerating recovery codes
 * both require a FRESH MFA stamp (`MfaEnrollmentController#requireStepUp`) — a
 * 403 here is answered with the SAME inline {@link MfaStepUpDialogComponent}
 * every other privileged admin-bff action uses (image-gen trigger/keys, cloud-
 * backup restore, …), rather than login-ui's separate `/login/mfa/challenge`
 * ROUTE — this console never navigates away mid-action.
 *
 * <p><b>WHY THIS COMPONENT DOES NOT USE THE SHARED {@code isStepUpRequiredError}
 * HELPER.</b> It looks like an inconsistency (two step-up detection strategies in
 * one repo) and it was reviewed as a candidate for collapsing. It must NOT be
 * collapsed, for two independent reasons:
 * <ol>
 *   <li>The shared helper's legacy fallback is {@code /requires step-up/i}. This
 *       plane's 403 message is {@code "requires a fresh MFA step-up to mutate
 *       factors"} — which that pattern does NOT match. Routing these branches
 *       through the helper would therefore SILENTLY STOP offering step-up on
 *       "remove factor" and "regenerate recovery codes": a strictly worse bug
 *       than the free-text coupling being fixed elsewhere.</li>
 *   <li>The structured {@code X-Step-Up-Required} signal cannot be added to this
 *       plane from this repo pair: {@code MfaEnrollmentController} ships inside
 *       the hugmesh-auth-core JAR, a DIFFERENT repository, so its 403 carries no
 *       signal header for the helper to prefer.</li>
 * </ol>
 * The bare {@code r.status === 403} branch is also SOUND here, not merely
 * tolerated: on {@code DELETE /bff/mfa/factors/{id}} and {@code POST
 * /bff/mfa/recovery/regenerate} the caller is ALWAYS the owner (the subject comes
 * from the session, never the body), so there is no other authorization dimension
 * that could produce a 403 — a 403 on these two endpoints IS the step-up gate.
 * Unifying this belongs in hugmesh-auth-core: adopt the same signal there, then
 * this component can switch over and pick up the flavour for free.
 *
 * <p>SHIPS DARK: a 503 from `factors()` flips this to a terminal "MFA not
 * enabled" state so the whole surface is hidden/disabled until launch — never an
 * error.
 *
 * <p>NO SECRETS: the TOTP secret and recovery codes are DISPLAY-ONCE — shown for
 * the single render right after they are minted and never re-fetched, logged, or
 * persisted by this component.
 */
@Component({
  selector: 'hug-mfa-security',
  standalone: true,
  imports: [CommonModule, FormsModule, MfaStepUpDialogComponent],
  templateUrl: './mfa-security.component.html',
  styleUrl: './mfa.component.scss',
})
export class MfaSecurityComponent implements OnInit {
  private readonly mfa = inject(MfaService);
  private readonly session = inject(SessionService);

  // ── list view ──────────────────────────────────────────────────────────
  readonly view = signal<'list' | 'enroll'>('list');
  readonly factors = signal<MfaFactor[]>([]);
  readonly loaded = signal(false);
  readonly dark = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  /** Display-once codes from a regenerate (cleared on the next mutation). */
  readonly newRecoveryCodes = signal<string[]>([]);

  /** A pending step-up challenge for a remove/regenerate mutation, or null when
   *  none is in flight. `retry` re-attempts the SAME mutation once the inline
   *  {@link MfaStepUpDialogComponent} reports the challenge satisfied. */
  readonly stepUpChallenge = signal<null | { description: string; retry: () => Promise<void> }>(null);

  // ── enroll wizard ──────────────────────────────────────────────────────
  readonly enrollStep = signal<EnrollStep>('choose');
  readonly enrollError = signal('');
  readonly enrollBusy = signal(false);
  readonly secret = signal('');
  readonly otpauthUri = signal('');
  readonly recoveryCodes = signal<string[]>([]);
  passcode = '';
  readonly webauthnAvailable = webauthnSupported();

  readonly qrMatrix = computed<boolean[][] | null>(() => {
    const uri = this.otpauthUri();
    if (!uri) return null;
    try {
      return encodeQr(uri);
    } catch {
      return null;
    }
  });

  /** A method (not a computed): `passcode` is a plain ngModel field. */
  passcodeValid(): boolean {
    return /^\d{6}$/.test(this.passcode.trim());
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    const r = await this.mfa.factors();
    if (r.dark) {
      this.dark.set(true);
      this.loaded.set(true);
      return;
    }
    if (!r.ok || !r.data) {
      this.error.set(r.error || 'Could not load your security settings.');
      this.loaded.set(true);
      return;
    }
    this.factors.set(r.data.factors ?? []);
    this.loaded.set(true);
  }

  /** Human label for a factor type (also its accessible name fragment). */
  typeLabel(type: MfaFactor['type']): string {
    return type === 'TOTP' ? 'Authenticator app' : 'Passkey';
  }

  /** The accessible name for a factor's remove button. */
  removeLabel(f: MfaFactor): string {
    return `Remove ${this.typeLabel(f.type)} added ${f.createdAt}`;
  }

  async remove(f: MfaFactor): Promise<void> {
    this.error.set('');
    this.newRecoveryCodes.set([]);
    this.busy.set(true);
    const r = await this.mfa.removeFactor(f.id);
    this.busy.set(false);
    if (r.dark) {
      this.dark.set(true);
      return;
    }
    // Bare 403, NOT the shared isStepUpRequiredError helper — see the class doc. On this
    // endpoint 403 <=> step-up (owner is always the session subject), and the helper's phrase
    // does not match auth-core's "requires a fresh MFA step-up to mutate factors".
    if (r.status === 403) {
      this.stepUpChallenge.set({
        description: `removing your ${this.typeLabel(f.type)}`,
        retry: () => this.remove(f),
      });
      return;
    }
    if (!r.ok || !r.data?.removed) {
      this.error.set(r.error || 'Could not remove that factor.');
      return;
    }
    this.factors.update((list) => list.filter((x) => x.id !== f.id));
  }

  async regenerate(): Promise<void> {
    this.error.set('');
    this.newRecoveryCodes.set([]);
    this.busy.set(true);
    const r = await this.mfa.regenerateRecovery();
    this.busy.set(false);
    if (r.dark) {
      this.dark.set(true);
      return;
    }
    // Bare 403 by design — same reasoning as remove(); see the class doc.
    if (r.status === 403) {
      this.stepUpChallenge.set({
        description: 'regenerating your recovery codes',
        retry: () => this.regenerate(),
      });
      return;
    }
    if (!r.ok || !r.data) {
      this.error.set(r.error || 'Could not regenerate recovery codes.');
      return;
    }
    this.newRecoveryCodes.set(r.data.recoveryCodes ?? []);
  }

  /** The inline step-up dialog reported success — retry the gated mutation it
   *  was blocking (the BFF now reads a fresh MFA stamp off this session). */
  async onStepUpSatisfied(): Promise<void> {
    const challenge = this.stepUpChallenge();
    this.stepUpChallenge.set(null);
    if (challenge) await challenge.retry();
  }

  /** The user cancelled the step-up dialog — drop the pending mutation. */
  onStepUpDismissed(): void {
    this.stepUpChallenge.set(null);
  }

  // ── enroll wizard ──────────────────────────────────────────────────────

  startEnroll(): void {
    this.resetEnroll();
    this.view.set('enroll');
  }

  cancelEnroll(): void {
    this.resetEnroll();
    this.view.set('list');
  }

  private resetEnroll(): void {
    this.enrollError.set('');
    this.secret.set('');
    this.otpauthUri.set('');
    this.recoveryCodes.set([]);
    this.passcode = '';
    this.enrollStep.set('choose');
  }

  async startTotp(): Promise<void> {
    this.enrollError.set('');
    this.enrollBusy.set(true);
    const r = await this.mfa.enrollTotp();
    this.enrollBusy.set(false);
    if (r.dark) return this.goEnrollDark();
    if (!r.ok || !r.data) return this.enrollFail(r.error || 'Could not start authenticator setup.');
    this.secret.set(r.data.secret);
    this.otpauthUri.set(r.data.otpauthUri);
    this.enrollStep.set('totp-show');
  }

  async verifyTotp(): Promise<void> {
    if (!this.passcodeValid()) {
      this.enrollError.set('Enter the 6-digit code from your authenticator app.');
      return;
    }
    this.enrollError.set('');
    this.enrollBusy.set(true);
    const r = await this.mfa.verifyTotp(this.passcode.trim());
    this.enrollBusy.set(false);
    if (r.dark) return this.goEnrollDark();
    if (r.status === 401) return this.enrollFail('That code did not match — try the current code.');
    if (!r.ok || !r.data) return this.enrollFail(r.error || 'Could not verify the code.');
    this.secret.set('');
    this.otpauthUri.set('');
    this.passcode = '';
    this.recoveryCodes.set(r.data.recoveryCodes ?? []);
    this.enrollStep.set('recovery');
  }

  async startWebauthn(): Promise<void> {
    if (!this.webauthnAvailable) {
      this.enrollError.set('This browser does not support passkeys. Use an authenticator app instead.');
      return;
    }
    this.enrollError.set('');
    this.enrollBusy.set(true);
    const opts = await this.mfa.enrollWebauthnOptions();
    if (opts.dark) {
      this.enrollBusy.set(false);
      return this.goEnrollDark();
    }
    if (!opts.ok || !opts.data) {
      this.enrollBusy.set(false);
      return this.enrollFail(opts.error || 'Could not start passkey registration.');
    }
    let attestation: string;
    try {
      attestation = await createPasskey(opts.data, this.session.session()?.label ?? '');
    } catch (e) {
      this.enrollBusy.set(false);
      return this.enrollFail(this.passkeyError(e));
    }
    const verify = await this.mfa.verifyWebauthn(attestation);
    this.enrollBusy.set(false);
    if (verify.dark) return this.goEnrollDark();
    if (verify.status === 409) return this.enrollFail('That passkey is already registered.');
    if (!verify.ok) return this.enrollFail(verify.error || 'Passkey registration could not be verified.');
    this.enrollStep.set('done');
  }

  /** Finish the wizard — return to the factor list and refresh it. */
  async finishEnroll(): Promise<void> {
    this.view.set('list');
    this.resetEnroll();
    await this.load();
  }

  private goEnrollDark(): void {
    this.enrollError.set('');
    this.enrollStep.set('dark');
  }

  private enrollFail(message: string): void {
    this.enrollError.set(message);
  }

  private passkeyError(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'Passkey registration was cancelled or timed out.';
    return (e as { message?: string })?.message || 'Could not create a passkey.';
  }
}
