// Nintendo LZ10. The compressor reproduces tools/gsarc.py lz10_compress byte for byte (greedy, nearest
// match first, longer matches only), using hash chains instead of rfind.

export function lz10Decompress(src: Uint8Array): Uint8Array {
  if (src[0] !== 0x10) throw new Error('LZ10: 先頭が 0x10 ではありません');
  let size = src[1]! | (src[2]! << 8) | (src[3]! << 16);
  let pos = 4;
  if (size === 0) {
    size = (src[4]! | (src[5]! << 8) | (src[6]! << 16) | (src[7]! << 24)) >>> 0;
    pos = 8;
  }
  const out = new Uint8Array(size);
  let o = 0;
  while (o < size) {
    const flags = src[pos++]!;
    for (let bit = 0; bit < 8 && o < size; bit++) {
      if (flags & (0x80 >> bit)) {
        const b1 = src[pos]!;
        const b2 = src[pos + 1]!;
        pos += 2;
        const n = (b1 >> 4) + 3;
        const disp = (((b1 & 0xf) << 8) | b2) + 1;
        if (disp > o) throw new Error('LZ10: 参照が先頭より前を指しています');
        for (let i = 0; i < n && o < size; i++, o++) out[o] = out[o - disp]!;
      } else {
        out[o++] = src[pos++]!;
      }
    }
  }
  return out;
}

export function lz10Compress(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n >= 1 << 24) throw new Error('LZ10: 16 MB 以上は圧縮できません');
  const out = new Uint8Array(4 + n + Math.ceil(n / 8) + 8);
  out[0] = 0x10;
  out[1] = n & 0xff;
  out[2] = (n >> 8) & 0xff;
  out[3] = (n >> 16) & 0xff;
  let op = 4;

  const HBITS = 15;
  const head = new Int32Array(1 << HBITS).fill(-1);
  const prev = new Int32Array(n);
  const hash = (p: number): number =>
    (((data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!) * 2654435761) >>> (32 - HBITS);
  let inserted = 0; // positions < inserted are in the chains
  const insertUpTo = (limit: number): void => {
    for (; inserted < limit && inserted + 2 < n; inserted++) {
      const h = hash(inserted);
      prev[inserted] = head[h]!;
      head[h] = inserted;
    }
  };

  let pos = 0;
  while (pos < n) {
    const flagPos = op++;
    let flags = 0;
    for (let bit = 0; bit < 8 && pos < n; bit++) {
      let bestLen = 0;
      let bestDisp = 0;
      const start = Math.max(0, pos - 0x1000);
      const maxlen = Math.min(18, n - pos);
      if (maxlen >= 3) {
        insertUpTo(pos); // candidates p <= pos - 1
        const a = data[pos]!, b = data[pos + 1]!, c = data[pos + 2]!;
        for (let p = head[hash(pos)]!; p >= start; p = prev[p]!) {
          if (data[p] !== a || data[p + 1] !== b || data[p + 2] !== c) continue;
          let l = 3;
          while (l < maxlen && data[p + l] === data[pos + l]) l++;
          if (l > bestLen) {
            bestLen = l;
            bestDisp = pos - p;
          }
          if (l === maxlen) break;
        }
      }
      if (bestLen >= 3) {
        flags |= 0x80 >> bit;
        const d = bestDisp - 1;
        out[op++] = ((bestLen - 3) << 4) | (d >> 8);
        out[op++] = d & 0xff;
        pos += bestLen;
      } else {
        out[op++] = data[pos++]!;
      }
    }
    out[flagPos] = flags;
  }
  while (op % 4) out[op++] = 0;
  return out.slice(0, op);
}
