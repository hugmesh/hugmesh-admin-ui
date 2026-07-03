/**
 * WebAuthn browser-API plumbing for the MFA surface. The admin-bff runs its OWN
 * WebAuthn ceremony (it cannot drive Casdoor's session-bound one on behalf of a
 * web user), so the UI only has to: (1) turn the BFF's base64url challenge into
 * the `PublicKeyCredential*Options` the browser wants, (2) call
 * navigator.credentials.create()/get(), and (3) serialize the result back to a
 * JSON string the BFF verifies. Kept as pure functions + thin wrappers so the
 * encode/decode logic is unit-testable without a real authenticator.
 */

import { WebAuthnOptions } from './mfa.types';

/** Decode a base64url (no padding) string to bytes. Backed by a fresh
 *  ArrayBuffer (not SharedArrayBuffer) so the result satisfies BufferSource. */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64url (no padding) — the form the BFF expects back. */
export function bytesToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether this browser exposes the WebAuthn API at all (so the UI can hide /
 *  disable passkey actions and explain why on an unsupported browser). */
export function webauthnSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).credentials?.create;
}

/**
 * Serialize a PublicKeyCredential (from create() or get()) into the JSON string
 * the BFF verifies — every ArrayBuffer becomes base64url. Handles BOTH the
 * registration (attestationObject) and assertion (authenticatorData/signature)
 * response shapes.
 */
export function credentialToJson(credential: PublicKeyCredential): string {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
    },
  };
  const resp = out['response'] as Record<string, unknown>;
  if (response.attestationObject) {
    resp['attestationObject'] = bytesToBase64url(response.attestationObject);
  }
  if (response.authenticatorData) {
    resp['authenticatorData'] = bytesToBase64url(response.authenticatorData);
    resp['signature'] = bytesToBase64url(response.signature);
    if (response.userHandle) resp['userHandle'] = bytesToBase64url(response.userHandle);
  }
  return JSON.stringify(out);
}

/**
 * Run a WebAuthn REGISTRATION ceremony from the BFF's options and return the
 * attestation JSON string for `enroll/webauthn/verify`. The user handle is
 * stable but opaque (the subject is the BFF's concern); a minimal cred-params
 * set (ES256 + RS256) covers virtually every authenticator.
 */
export async function createPasskey(opts: WebAuthnOptions, account: string): Promise<string> {
  const accountName = account || 'snapdragon-user';
  const encoded = new TextEncoder().encode(accountName);
  const userId = new Uint8Array(new ArrayBuffer(encoded.length));
  userId.set(encoded);
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBytes(opts.challenge),
    rp: { id: opts.rpId, name: opts.rpName },
    user: { id: userId, name: accountName, displayName: accountName },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
    timeout: 60_000,
  };
  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey registration was cancelled.');
  return credentialToJson(credential);
}

/**
 * Run a WebAuthn ASSERTION ceremony from the BFF's options and return the
 * get() response JSON string for the step-up `POST /bff/mfa/challenge`.
 */
export async function getAssertion(opts: WebAuthnOptions): Promise<string> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBytes(opts.challenge),
    rpId: opts.rpId,
    userVerification: 'preferred',
    timeout: 60_000,
  };
  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey verification was cancelled.');
  return credentialToJson(credential);
}
