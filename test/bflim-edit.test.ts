import { expect, test } from 'bun:test';
import { readBflim, replaceBflimImage } from '../src/layout/bflim';
import { w16, w32 } from '../src/util/bytes';

test('BFLIM replacement preserves dimensions, orientation and footer for each swizzle', () => {
  for (const swizzle of [0, 4, 8]) {
    const template = new Uint8Array(16 * 8 * 4 + 0x28);
    const foot = template.length - 0x28,
      imag = foot + 0x14;
    template.set(new TextEncoder().encode('FLIM'), foot);
    w16(template, foot + 4, 0xfeff);
    template.set(new TextEncoder().encode('imag'), imag);
    w16(template, imag + 8, 8);
    w16(template, imag + 10, 16);
    template[imag + 14] = 9; // RGBA8
    template[imag + 15] = swizzle;
    w32(template, imag + 16, foot);
    const before = readBflim(template);
    const pixels = Uint8Array.from({ length: 16 * 8 * 4 }, (_, i) => (i * 13) % 256);
    const result = replaceBflimImage(template, pixels);
    expect(readBflim(result)).toEqual({ ...before, rgba: pixels });
    expect(result.subarray(foot)).toEqual(template.subarray(foot));
    expect(template.subarray(0, foot).some((v) => v !== 0)).toBe(false);
    expect(() => replaceBflimImage(template, pixels.subarray(4))).toThrow();
  }
});
