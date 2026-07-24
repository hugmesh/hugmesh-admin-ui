import { createHmac } from 'node:crypto';

/**
 * RFC 6238 TOTP generator — the ONE honest way to satisfy a real MFA enroll/verify
 * and a real step-up challenge against a live admin-bff (`app.casdoor.mfa.enabled=true`).
 *
 * The admin-bff hands the console a base32 `secret` from `POST /bff/mfa/enroll/totp`
 * whose `otpauthUri` fixes the parameters we honour here: `algorithm=SHA1`, `digits=6`,
 * `period=30` (see mfa.types.ts TotpEnrollStart). So `verify` (enrollment) and `challenge`
 * (step-up) both accept the 6-digit code this computes from that secret — no authenticator
 * app, no interactive prompt, and NEVER a hard-coded passcode (which would be a vacuous
 * "any code passes" oracle). Runs in the Playwright worker (Node), not the browser, so the
 * code is computed here and only the finished 6 digits cross into `page.evaluate`.
 *
 * @cluster-only — the MFA/step-up scenarios that use this ship dark (they need a live
 * Casdoor + `mfa.enabled`); bddgen still compiles them so `--list` proves they parse.
 */

/** Decode an RFC 4648 base32 secret (the admin-bff `TotpEnrollStart.secret` form) to bytes. */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Casdoor may present the secret unpadded and/or spaced/lower-cased — normalise first.
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`Non-base32 character in TOTP secret: "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Compute the current 6-digit TOTP code for a base32 secret (SHA1, 30s period).
 *
 * @param secret - The base32 secret from `POST /bff/mfa/enroll/totp`.
 * @param atMs   - Wall-clock ms to compute for (defaults to now); overridable for a
 *                 deterministic unit check of this helper.
 */
export function totp(secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(secret);
  let counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}
