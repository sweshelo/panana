// IPS patches (code.ips): "PATCH", records {u24 offset, u16 size, data} or RLE {offset, 0, u16 count, u8 value},
// "EOF". Offsets are file offsets of the decompressed code.bin (address - 0x100000).

export function applyIps(base: Uint8Array, ips: Uint8Array): Uint8Array {
  const tag = (o: number, s: string): boolean => [...s].every((c, i) => ips[o + i] === c.charCodeAt(0));
  if (!tag(0, 'PATCH')) throw new Error('IPS ではありません');
  let out = base.slice();
  let p = 5;
  while (p + 3 <= ips.length && !tag(p, 'EOF')) {
    const off = (ips[p]! << 16) | (ips[p + 1]! << 8) | ips[p + 2]!;
    let size = (ips[p + 3]! << 8) | ips[p + 4]!;
    p += 5;
    let data: Uint8Array;
    if (size === 0) {
      size = (ips[p]! << 8) | ips[p + 1]!;
      data = new Uint8Array(size).fill(ips[p + 2]!);
      p += 3;
    } else {
      data = ips.subarray(p, p + size);
      p += size;
    }
    if (off + size > out.length) {
      const grown = new Uint8Array(off + size);
      grown.set(out);
      out = grown;
    }
    out.set(data, off);
  }
  return out;
}

/** Version of the generic switch patch (elpulse mod/build_code.py: "PNSW" + u32 in the code cave), or 0. */
export function switchPatchVersion(code: Uint8Array): number {
  const from = 0x4bf020 - 0x100000, to = Math.min(code.length, 0x4c0000 - 0x100000);
  for (let o = from; o + 8 <= to; o += 4)
    if (code[o] === 0x50 && code[o + 1] === 0x4e && code[o + 2] === 0x53 && code[o + 3] === 0x57)
      return (code[o + 4]! | (code[o + 5]! << 8) | (code[o + 6]! << 16) | (code[o + 7]! << 24)) >>> 0;
  return 0;
}

/** Records {file offset, bytes} as an IPS patch. Records at the offset "EOF" (0x454F46) start one byte earlier. */
export function buildIps(records: [number, Uint8Array][], code?: Uint8Array): Uint8Array {
  const parts: number[] = [...'PATCH'].map((c) => c.charCodeAt(0));
  for (let [off, data] of records) {
    if (off === 0x454f46) {
      if (!code) throw new Error('IPS: 0x454F46 には前の 1 バイトが要ります');
      const b = new Uint8Array(data.length + 1);
      b[0] = code[off - 1]!;
      b.set(data, 1);
      off -= 1;
      data = b;
    }
    for (let p = 0; p < data.length; p += 0xffff) {
      const chunk = data.subarray(p, p + 0xffff);
      const o = off + p;
      if (o > 0xffffff) throw new Error('IPS: オフセットが 24 ビットを超えます');
      parts.push((o >> 16) & 0xff, (o >> 8) & 0xff, o & 0xff, chunk.length >> 8, chunk.length & 0xff, ...chunk);
    }
  }
  parts.push(...[...'EOF'].map((c) => c.charCodeAt(0)));
  return Uint8Array.from(parts);
}

/** `base` (an IPS patch, or null) followed by the given records (later records win). */
export function appendIps(base: Uint8Array | null, records: [number, Uint8Array][], code?: Uint8Array): Uint8Array {
  const extra = buildIps(records, code);
  if (!base) return extra;
  const tag = (o: number, s: string): boolean => [...s].every((c, i) => base[o + i] === c.charCodeAt(0));
  if (!tag(0, 'PATCH')) throw new Error('土台の code.ips が IPS ではありません');
  // Walk the records to find the base's "EOF" (the offset 0x454F46 spells it too, so the tail is not enough).
  let p = 5;
  while (p + 3 <= base.length && !tag(p, 'EOF')) {
    const size = (base[p + 3]! << 8) | base[p + 4]!;
    p += 5 + (size === 0 ? 3 : size);
  }
  const out = new Uint8Array(p + extra.length - 5);
  out.set(base.subarray(0, p));
  out.set(extra.subarray(5), p);
  return out;
}
