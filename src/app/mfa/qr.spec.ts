import { encodeQr } from './qr';

describe('encodeQr', () => {
  it('produces a square boolean matrix for a short otpauth URI', () => {
    const m = encodeQr('otpauth://totp/snapdragon:alice?secret=ABC&issuer=snapdragon');
    expect(m.length).toBeGreaterThan(0);
    // Square.
    for (const row of m) expect(row.length).toBe(m.length);
    // Standard QR sizes are 17 + 4*version.
    expect((m.length - 17) % 4).toBe(0);
  });

  it('renders the three finder patterns (dark 7x7 ring corners)', () => {
    const m = encodeQr('otpauth://totp/x?secret=ABCDEFGH');
    const n = m.length;
    // Top-left finder centre (3,3) is dark; the gap at (5,5)/(1,1) inner ring is light.
    expect(m[0][0]).toBeTrue();
    expect(m[3][3]).toBeTrue();
    // Top-right + bottom-left finder corners exist.
    expect(m[0][n - 1]).toBeTrue();
    expect(m[n - 1][0]).toBeTrue();
  });

  it('includes the mandatory dark module', () => {
    const m = encodeQr('otpauth://totp/x?secret=ABCDEFGH');
    const n = m.length;
    expect(m[n - 8][8]).toBeTrue();
  });

  it('throws rather than emit an unscannable code when the payload is too large', () => {
    const huge = 'otpauth://totp/x?secret=' + 'A'.repeat(400);
    expect(() => encodeQr(huge)).toThrow();
  });

  it('produces different matrices for different content', () => {
    const a = encodeQr('otpauth://totp/a?secret=AAAA');
    const b = encodeQr('otpauth://totp/b?secret=BBBB');
    const flat = (m: boolean[][]) => m.flat().join('');
    expect(flat(a)).not.toBe(flat(b));
  });
});
