import { Component, EventEmitter, Output, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MfaService } from './mfa.service';
import { getAssertion, webauthnSupported } from './webauthn';
import { ChallengeFactor } from './mfa.types';

type Method = 'totp' | 'recovery' | 'webauthn';

/**
 * The reusable, INLINE MFA step-up challenge dialog. A privileged admin action
 * (image-gen trigger/keys-download today; cloud-backup restore, the desktop
 * terminal, and ssh-key issuance are gated the same way and can adopt this
 * identically once they grow real consumer UI) can 403 with the platform's
 * "requires step-up" contract (see {@link isStepUpRequiredError}). Rather than
 * navigate away, the calling component shows THIS dialog inline: it collects a
 * TOTP code, a recovery code, or a WebAuthn passkey assertion, submits it to the
 * EXISTING `POST /bff/mfa/challenge`, and on success emits {@link satisfied} —
 * the caller is expected to blindly retry the SAME privileged action, which now
 * succeeds because the BFF's step-up gates read a FRESH stamp off the caller's
 * own session (the "A5 UNIFIED step-up": `mfaFresh || <token leg>`), not a value
 * this dialog hands back. No stepUpToken plumbing is needed on the retry.
 *
 * SHIPS DARK: the BFF 503s every `/bff/mfa/*` call while `app.casdoor.mfa.enabled
 * =false`; this dialog maps that to a terminal "not enabled yet" state (never an
 * error) with only a Close affordance — the caller should fall back to whatever
 * non-MFA step-up path it already has (e.g. image-gen's manual token field).
 *
 * a11y: a fieldset/legend chooses the method, each input has a visible label +
 * aria-describedby helptext, and the verdict is announced via role="alert"/
 * aria-live. This is a plain in-flow `<section>` (not a native `<dialog>`/modal
 * overlay) so it composes with each console's existing layout/testing
 * conventions — the caller decides where to render it (typically right above
 * the form it gates).
 */
@Component({
  selector: 'snap-mfa-step-up-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mfa-step-up-dialog.component.html',
  styleUrl: './mfa.component.scss',
})
export class MfaStepUpDialogComponent {
  private readonly mfa = inject(MfaService);

  /** Optional short description of the action being gated (e.g. "trigger this
   *  image build"), spliced into the intro sentence. */
  readonly action = input<string>('this action');

  /** Emitted once the challenge succeeds — the caller should retry its
   *  privileged action and dismiss this dialog. */
  @Output() readonly satisfied = new EventEmitter<void>();
  /** Emitted when the user cancels — the caller should dismiss this dialog
   *  without retrying. */
  @Output() readonly dismissed = new EventEmitter<void>();

  readonly method = signal<Method>('totp');
  readonly error = signal('');
  readonly busy = signal(false);
  /** Set true when the BFF answered 503 — the surface is not yet launched. */
  readonly dark = signal(false);

  /** The TOTP or recovery code typed by the user. */
  code = '';

  readonly webauthnAvailable = webauthnSupported();

  /** A TOTP code must be 6 digits; a recovery code must be non-blank. A method
   *  (not a computed): `code` is a plain ngModel field, so this is re-evaluated
   *  on each template tick rather than depending on a non-reactive read. */
  codeValid(): boolean {
    const v = this.code.trim();
    if (this.method() === 'totp') return /^\d{6}$/.test(v);
    return v.length > 0;
  }

  setMethod(m: Method): void {
    this.method.set(m);
    this.code = '';
    this.error.set('');
  }

  /** Submit a TOTP or recovery-code challenge. */
  async submitCode(): Promise<void> {
    if (!this.codeValid()) {
      this.error.set(
        this.method() === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of your recovery codes.',
      );
      return;
    }
    await this.send(this.method() as ChallengeFactor, this.code.trim());
  }

  /** Run a passkey assertion and submit it as a webauthn challenge. */
  async useWebauthn(): Promise<void> {
    if (!this.webauthnAvailable) {
      this.error.set('This browser does not support passkeys. Use a code instead.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    const opts = await this.mfa.assertWebauthnOptions();
    if (opts.dark) {
      this.busy.set(false);
      this.dark.set(true);
      return;
    }
    if (!opts.ok || !opts.data) {
      this.busy.set(false);
      this.error.set(opts.error || 'Could not start passkey verification.');
      return;
    }
    let assertion: string;
    try {
      assertion = await getAssertion(opts.data);
    } catch (e) {
      this.busy.set(false);
      this.error.set(this.passkeyError(e));
      return;
    }
    await this.send('webauthn', assertion, true);
  }

  cancel(): void {
    this.error.set('');
    this.code = '';
    this.dismissed.emit();
  }

  private async send(factor: ChallengeFactor, credential: string, alreadyBusy = false): Promise<void> {
    this.error.set('');
    if (!alreadyBusy) this.busy.set(true);
    const r = await this.mfa.challenge(factor, credential);
    this.busy.set(false);
    if (r.dark) {
      this.dark.set(true);
      return;
    }
    if (r.status === 401 || !r.ok || !r.data?.mfaSatisfied) {
      this.error.set('That did not verify. Try again with a current code or your passkey.');
      return;
    }
    this.code = '';
    this.satisfied.emit();
  }

  private passkeyError(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'Passkey verification was cancelled or timed out.';
    return (e as { message?: string })?.message || 'Could not verify with a passkey.';
  }
}
