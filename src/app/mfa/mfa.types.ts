/**
 * Shared MFA contract types for the admin-ui MFA surface (factor management +
 * the inline step-up challenge dialog). These MIRROR the admin-bff `/bff/mfa/*`
 * contract exactly (the SAME shared snapdragon-auth-core `MfaEnrollmentController`
 * / `MfaChallengeController` the login-ui remote already talks to) — the UI never
 * invents shapes the server does not return. NO SECRETS are ever persisted
 * client-side: the TOTP secret and the recovery codes are shown ONCE (display-once)
 * and then forgotten by the UI.
 */

/** A registered MFA factor as listed by `GET /bff/mfa/factors`. NO secrets. */
export interface MfaFactor {
  id: string;
  type: 'TOTP' | 'WEBAUTHN';
  enabled: boolean;
  /** ISO-8601 creation timestamp (server-rendered). */
  createdAt: string;
}

/** The display-once result of starting TOTP enrollment (`enroll/totp`). The
 *  {@link secret} (base32) and {@link otpauthUri} are shown ONCE for the QR /
 *  manual-entry step and never re-fetched (the server masks them forever after). */
export interface TotpEnrollStart {
  factorId: string;
  /** otpauth://totp/<issuer>:<account>?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30 */
  otpauthUri: string;
  /** base32 secret — shown ONCE so the user can hand-key it if the QR fails. */
  secret: string;
}

/** WebAuthn ceremony options returned by enroll/assert `webauthn/options`. The
 *  challenge is base64url and bound to the session (pending, 5-minute TTL). */
export interface WebAuthnOptions {
  challenge: string;
  rpId: string;
  rpName: string;
}

/** The challenge factor kinds accepted by the EXISTING `POST /bff/mfa/challenge`. */
export type ChallengeFactor = 'totp' | 'webauthn' | 'recovery';

/**
 * The DARK-aware outcome wrapper. Every `/bff/mfa/*` call can answer 503 while
 * `app.casdoor.mfa.enabled=false` ("ships dark"); the UI treats that as "MFA not
 * yet launched" and hides/disables the surface rather than erroring. {@code dark}
 * is set ONLY on a 503; {@code ok=false} with {@code dark=false} is a real error.
 */
export interface MfaResult<T> {
  ok: boolean;
  /** True when the server answered 503 (feature ships dark / not yet enabled). */
  dark: boolean;
  /** HTTP status (0 on a network failure). */
  status: number;
  /** The decoded JSON payload on success. */
  data?: T;
  /** A human error message on a non-OK, non-dark response. */
  error?: string;
}
