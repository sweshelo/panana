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
