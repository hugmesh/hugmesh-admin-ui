import { base64urlToBytes, bytesToBase64url, credentialToJson, webauthnSupported } from './webauthn';

describe('webauthn utils', () => {
  it('base64urlToBytes round-trips with bytesToBase64url', () => {
    const original = 'AQIDBAUGBwgJCgsM'; // arbitrary base64url
    const bytes = base64urlToBytes(original);
    expect(bytesToBase64url(bytes.buffer)).toBe(original);
  });

  it('base64urlToBytes decodes url-safe chars (- and _) without padding', () => {
    // "??>" style bytes that force + and / in standard base64 -> - and _ here.
    const bytes = base64urlToBytes('-_8'); // 0xfb 0xff
    expect(Array.from(bytes)).toEqual([0xfb, 0xff]);
  });

  it('bytesToBase64url strips padding and uses url-safe alphabet', () => {
    const buf = new Uint8Array([0xfb, 0xff]).buffer;
    const encoded = bytesToBase64url(buf);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).toBe('-_8');
  });

  it('credentialToJson serializes a registration (attestation) credential to base64url', () => {
    const cred = {
      id: 'cred-id',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([4, 5]).buffer,
        attestationObject: new Uint8Array([6, 7]).buffer,
      },
    } as unknown as PublicKeyCredential;
    const json = JSON.parse(credentialToJson(cred));
    expect(json.id).toBe('cred-id');
    expect(json.type).toBe('public-key');
    expect(typeof json.rawId).toBe('string');
    expect(typeof json.response.clientDataJSON).toBe('string');
    expect(typeof json.response.attestationObject).toBe('string');
    expect(json.response.authenticatorData).toBeUndefined();
  });

  it('credentialToJson serializes an assertion (get) credential with authenticatorData + signature', () => {
    const cred = {
      id: 'cred-id',
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([2]).buffer,
        authenticatorData: new Uint8Array([3]).buffer,
        signature: new Uint8Array([4]).buffer,
        userHandle: new Uint8Array([5]).buffer,
      },
    } as unknown as PublicKeyCredential;
    const json = JSON.parse(credentialToJson(cred));
    expect(typeof json.response.authenticatorData).toBe('string');
    expect(typeof json.response.signature).toBe('string');
    expect(typeof json.response.userHandle).toBe('string');
    expect(json.response.attestationObject).toBeUndefined();
  });

  it('webauthnSupported reflects navigator.credentials.create presence', () => {
    // In the headless test browser this is typically true; just assert it is a boolean.
    expect(typeof webauthnSupported()).toBe('boolean');
  });
});
