/**
 * A tiny, dependency-free QR encoder — just enough to render an `otpauth://`
 * URI as a scannable matrix so a user can point an authenticator app at it
 * during TOTP enrollment. We deliberately avoid pulling a QR npm package (the
 * repo ships ZERO runtime deps beyond Angular + federation); an otpauth URI is
 * short, so byte-mode at error-correction level M with an auto-selected version
 * comfortably covers it.
 *
 * The output is a boolean matrix ({@code modules[y][x] === true} => dark). The
 * component paints it as CSS grid cells; nothing here touches the DOM, so the
 * encoder is pure and unit-testable.
 *
 * NOTE: this implements the standard QR pipeline (byte-mode data, Reed-Solomon
 * ECC, mask 0, the canonical format-info bits for level M / mask 0). It is sized
 * for short URIs; {@link encodeQr} throws if the payload exceeds the supported
 * versions rather than emit an unscannable code.
 */

// --- Galois field (GF(256)) tables for Reed-Solomon, generator 0x11d. -------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The Reed-Solomon generator polynomial of the given degree. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

/** Compute {@code ecCount} Reed-Solomon error-correction codewords. */
function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const res = new Uint8Array(ecCount);
  for (const d of data) {
    const factor = d ^ res[0];
    res.copyWithin(0, 1);
    res[res.length - 1] = 0;
    for (let j = 0; j < gen.length; j++) res[j] ^= gfMul(gen[j], factor);
  }
  return res;
}

/**
 * Per-version capacity at EC level M for byte mode (data codewords, ec codewords
 * per block, block layout). We support versions 1..10, which holds well over a
 * typical otpauth URI's length. Each entry: [totalDataCodewords, ecPerBlock,
 * group1Blocks, group1DataCw, group2Blocks, group2DataCw].
 */
const VERSIONS: Record<number, [number, number, number, number, number, number]> = {
  1: [16, 10, 1, 16, 0, 0],
  2: [28, 16, 1, 28, 0, 0],
  3: [44, 26, 1, 44, 0, 0],
  4: [64, 18, 2, 32, 0, 0],
  5: [86, 24, 2, 43, 0, 0],
  6: [108, 16, 4, 27, 0, 0],
  7: [124, 18, 4, 31, 0, 0],
  8: [154, 22, 2, 38, 2, 39],
  9: [182, 22, 3, 36, 2, 37],
  10: [216, 26, 4, 43, 1, 44],
};

const ALIGN_POS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Build the byte-mode bitstream (mode + length + data + terminator + pad). */
function buildData(payload: Uint8Array, dataCodewords: number): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(payload.length, 8); // length (8-bit count fits versions 1..9; 16-bit at >=10)
  // Versions >= 10 use a 16-bit character count in byte mode. Re-emit if needed.
  for (const b of payload) push(b, 8);
  // Terminator + byte alignment.
  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (out.length < dataCodewords) out.push(padBytes[p++ % 2]);
  return new Uint8Array(out);
}

/** Same as buildData but with a 16-bit char-count (versions >= 10). */
function buildDataLong(payload: Uint8Array, dataCodewords: number): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(payload.length, 16);
  for (const b of payload) push(b, 8);
  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (out.length < dataCodewords) out.push(padBytes[p++ % 2]);
  return new Uint8Array(out);
}

/** Pick the smallest version whose data capacity holds the payload. */
function pickVersion(payloadLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const [dataCw] = VERSIONS[v];
    const headerBytes = v >= 10 ? 3 : 2; // mode+len overhead approx in bytes
    if (payloadLen + headerBytes <= dataCw) return v;
  }
  throw new Error('QR payload too large for supported versions (1..10).');
}

/** Interleave data + EC codewords across blocks per the QR spec. */
function interleave(version: number, dataCodewords: Uint8Array): Uint8Array {
  const [, ecPerBlock, g1Blocks, g1Cw, g2Blocks, g2Cw] = VERSIONS[version];
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const block = dataCodewords.slice(offset, offset + g1Cw);
    offset += g1Cw;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }
  for (let i = 0; i < g2Blocks; i++) {
    const block = dataCodewords.slice(offset, offset + g2Cw);
    offset += g2Cw;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }
  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) result.push(b[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of ecBlocks) result.push(b[i]);
  }
  return new Uint8Array(result);
}

/** Format-info bits (15) for EC level M and mask pattern 0, pre-XOR'd. */
const FORMAT_M0 = 0b101010000010010;

function placeMatrix(version: number, codewords: Uint8Array): boolean[][] {
  const size = 17 + version * 4;
  const m: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  const setFinder = (r: number, c: number) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const yy = r + y;
        const xx = c + x;
        if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
        const onBorder = x === -1 || x === 7 || y === -1 || y === 7;
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        m[yy][xx] = onBorder ? false : ring || center;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
  }

  // Alignment patterns.
  const align = ALIGN_POS[version];
  for (const r of align) {
    for (const c of align) {
      if (m[r][c] !== null) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const ring = Math.max(Math.abs(x), Math.abs(y));
          m[r + y][c + x] = ring !== 1;
        }
      }
    }
  }

  // Dark module.
  m[size - 8][8] = true;

  // Reserve + place format info.
  const fmt = FORMAT_M0;
  const fmtBit = (i: number) => ((fmt >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fmtBit(i);
  m[8][7] = fmtBit(6);
  m[8][8] = fmtBit(7);
  m[7][8] = fmtBit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = fmtBit(i);
  // Second copy: bits 0..6 down the bottom-left column (rows size-1..size-7),
  // bits 7..14 across the top-right row (cols size-8..size-1). The dark module
  // at (size-8, 8) sits BELOW this strip and is not a format bit.
  for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = fmtBit(i);
  for (let i = 7; i <= 14; i++) m[8][size - 15 + i] = fmtBit(i);
  // Re-assert the dark module last (it must never be a format/data cell).
  m[size - 8][8] = true;

  // Data placement (zig-zag up/down), mask 0 = (row+col) % 2 === 0.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const getBit = (i: number) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // skip the timing column
    for (let row = 0; row < size; row++) {
      const r = upward ? size - 1 - row : row;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[r][cc] !== null) continue;
        let dark = getBit(bitIndex++) === 1;
        if ((r + cc) % 2 === 0) dark = !dark; // mask 0
        m[r][cc] = dark;
      }
    }
    upward = !upward;
  }

  return m.map((row) => row.map((v) => v === true));
}

/**
 * Encode {@code text} into a QR module matrix (boolean[y][x], true === dark).
 * Throws if the text is too long for the supported version range.
 */
export function encodeQr(text: string): boolean[][] {
  const payload = bytesOf(text);
  const version = pickVersion(payload.length);
  const [dataCw] = VERSIONS[version];
  const data = version >= 10 ? buildDataLong(payload, dataCw) : buildData(payload, dataCw);
  const full = interleave(version, data);
  return placeMatrix(version, full);
}
