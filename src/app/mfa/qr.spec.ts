import { encodeQr } from './qr';
import jsQR from 'jsqr';

describe('encodeQr', () => {
  it('produces a square boolean matrix for a short otpauth URI', () => {
    const m = encodeQr('otpauth://totp/hugmesh:alice?secret=ABC&issuer=hugmesh');
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
  // The test that was missing (2026-11-26): every earlier spec checked the SHAPE of the
  // matrix, so a hand-written encoder whose codes no scanner could read passed them all
  // and TOTP enrolment by QR never worked. This decodes what the page actually paints —
  // with the same quiet zone — through an independent decoder (jsQR).
  it('draws codes a scanner reads back to the exact otpauth URI', () => {
    const accounts = ['lavender', 'lavender@example.org', 'a.very.long.username.for.testing'];
    const secrets = ['JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
                     'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'];
    for (const account of accounts) {
      for (const secret of secrets) {
        const uri = `otpauth://totp/HugMesh:${encodeURIComponent(account)}?secret=${secret}`
          + '&issuer=HugMesh&algorithm=SHA1&digits=6&period=30';
        const m = encodeQr(uri);
        const quiet = 4, scale = 4, size = (m.length + 2 * quiet) * scale;
        const px = new Uint8ClampedArray(size * size * 4).fill(255);
        for (let y = 0; y < m.length; y++) {
          for (let x = 0; x < m.length; x++) {
            if (!m[y][x]) continue;
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const p = (((y + quiet) * scale + dy) * size + ((x + quiet) * scale + dx)) * 4;
                px[p] = px[p + 1] = px[p + 2] = 0;
              }
            }
          }
        }
        const read = jsQR(px, size, size);
        expect(read?.data).withContext(uri).toBe(uri);
      }
    }
  });
});
