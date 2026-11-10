// Replacing a monster's texture with an image: the PICA texture encoder (no ROM), and an RPG2 monster whose texture
// is replaced (the file written again in the model archive, the design row pointing at it). The ROM part needs RPG2's
// dump (roms/, test/env.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { parseCgfx } from '../src/cgfx/cgfx';
import { encodeTexture, encodeTextureLevels } from '../src/cgfx/encode';
import { decodeTexture, textureDataSize } from '../src/cgfx/texture';
import { Game } from '../src/game/game';
import { MONSTER_MODEL_ARCHIVE } from '../src/game/monsters';
import { PortStore } from '../src/port/store';
import { replaceMonsterTexture } from '../src/port/textures';
import { openImage } from '../src/rom/dump';
import type { Session } from '../src/session';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

/** A smooth test image with an alpha ramp. */
function image(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = (x * 255) / (w - 1);
      out[o + 1] = (y * 255) / (h - 1);
      out[o + 2] = 128 + 100 * Math.sin(x / 9) * Math.cos(y / 7);
      out[o + 3] = ((x + y) * 255) / (w + h - 2);
    }
  }
  return out;
}

/** Mean absolute difference of the channels `ch` (0..3). */
function diff(a: Uint8Array, b: Uint8Array, ch: number[]): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (const c of ch) { s += Math.abs(a[i + c]! - b[i + c]!); n++; }
  return s / n;
}

describe('PICA texture encoding', () => {
  const w = 64, h = 32;
  const img = image(w, h);
  // [format, channels compared, largest mean error]
  const cases: [number, number[], number][] = [
    [0, [0, 1, 2, 3], 0], [1, [0, 1, 2], 0], [2, [0, 1, 2], 3], [3, [0, 1, 2], 3], [4, [0, 1, 2, 3], 5],
    [8, [3], 0], [11, [3], 9], [12, [0, 1, 2], 6], [13, [0, 1, 2], 6], [13, [3], 9],
  ];
  for (const [f, ch, max] of cases) {
    test(`format ${f} decodes back to the image`, () => {
      const data = encodeTexture(img, w, h, f);
      expect(data.length).toBe(textureDataSize(f, w, h));
      expect(diff(decodeTexture(data, w, h, f), img, ch)).toBeLessThanOrEqual(max);
    });
  }

  test('the formats without loss of a decoded image encode it to the same bytes', () => {
    for (const f of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const data = encodeTexture(img, w, h, f);
      expect(encodeTexture(decodeTexture(data, w, h, f), w, h, f)).toEqual(data);
    }
  });

  test('mipmap levels follow level 0 at half the size', () => {
    const n = textureDataSize(12, w, h) + textureDataSize(12, w / 2, h / 2);
    const data = encodeTextureLevels(img, w, h, 12, 2, n);
    expect(data.length).toBe(n);
    expect(data.subarray(0, textureDataSize(12, w, h))).toEqual(encodeTexture(img, w, h, 12));
    expect(data.subarray(textureDataSize(12, w, h)).some((v) => v)).toBe(true);
  });
});

describe.skipIf(!hasCia)('replacing an RPG2 monster texture', () => {
  let game: Game;
  let session: Session;

  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'kahara'));
    await PortStore.install(game.dump);
    session = { game, book: await game.monsters(), saveNow: () => {} } as unknown as Session;
  }, 120_000);

  afterAll(async () => (await PortStore.of('kahara')).clear());

  const files = async (design: Uint8Array): Promise<{ model: Uint8Array; colour: Uint8Array | null }> => {
    const arc = parseArchive(await game.dump.readRomfs(MONSTER_MODEL_ARCHIVE));
    const body = (h: number): Uint8Array | null => (h && findEntry(arc, h) ? unpackEntry(arc, findEntry(arc, h)!).body : null);
    return { model: body(u32(design, 0x10))!, colour: u32(design, 0x14) === u32(design, 0x10) ? null : body(u32(design, 0x14)) };
  };

  test('the texture is written again and only this monster shows it', async () => {
    const book = session.book!;
    const m = book.monsters.find((x) => book.designUsers(x.design).length > 1)!;
    const before = book.designBytes(m.design);
    const other = book.designUsers(m.design).find((r) => r !== m.row)!;
    const { model, colour } = await files(before);
    const textures = [...parseCgfx(model).textures, ...(colour ? parseCgfx(colour).textures : [])].filter((t) => t.name !== 'dummy');
    const t = textures.at(-1)!;
    const img = image(t.width, t.height);

    const d = await replaceMonsterTexture(session, m.row, t.name, { width: t.width, height: t.height, rgba: img });
    expect(d).not.toBe(before);
    expect(book.monster(m.row)!.design).toBe(d);
    expect(book.designBytes(book.monster(other)!.design)).toEqual(before);
    const after = book.designBytes(d);
    const now = await files(after);
    const all = [...parseCgfx(now.model).textures, ...(now.colour ? parseCgfx(now.colour).textures : [])];
    const got = all.filter((x) => x.name === t.name).at(-1)!;
    expect(got.format).toBe(t.format);
    expect(diff(got.rgba, img, [0, 1, 2])).toBeLessThan(12);
    // the model keeps its meshes and animations
    expect(parseCgfx(now.model).models[0]!.meshes.length).toBe(parseCgfx(model).models[0]!.meshes.length);

    // a second replacement changes the row the first one added, and drops the file nothing names any more
    const store = await PortStore.of('kahara');
    const first = store.list().length;
    const d2 = await replaceMonsterTexture(session, m.row, t.name, { width: t.width, height: t.height, rgba: image(t.width, t.height).reverse() });
    expect(d2).toBe(d);
    expect(store.list().length).toBe(first);
  }, 120_000);
});
