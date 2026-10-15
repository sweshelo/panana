// CGFX port (src/port/gfx): every monster model / texture bcres (470D2848, MonsterDesign +0x10 / +0x14) and every item
// model read and written again must be byte-identical; edited files must still be readable by our renderer's reader.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, unpackEntry } from '../src/archive/gsarc';
import { readAnimations } from '../src/cgfx/anim';
import { parseCgfx, type CgfxFile } from '../src/cgfx/cgfx';
import { Game } from '../src/game/game';
import { ITEM_MODEL_ARCHIVES } from '../src/game/items';
import { MONSTER_MODEL_ARCHIVE } from '../src/game/monsters';
import { readGfx, writeGfx, decodeKeys, linkBones, buildDictTree, dictFind, GfxPrimitiveType, type Gfx } from '../src/port/gfx';
import { openImage } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

/** Offset of the first differing byte, or -1. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Meshes / bones of our renderer's reader, as plain numbers (for comparing two files). */
function summary(f: CgfxFile): unknown {
  return {
    models: f.models.map((m) => ({
      name: m.name,
      bones: m.bones.map((b) => [b.name, b.parent, ...b.scale, ...b.rotation, ...b.translation]),
      meshes: m.meshes.map((x) => ({
        name: x.name,
        material: x.material,
        positions: Array.from(x.positions),
        indices: Array.from(x.indices),
        skin: x.skinIndices ? Array.from(x.skinIndices) : null,
      })),
      materials: m.materials.map((x) => [x.name, ...x.textures]),
    })),
    textures: f.textures.map((t) => [t.name, t.width, t.height, t.format]),
  };
}

describe.skipIf(!hasCia)('CGFX port (kahara)', () => {
  /** label -> file */
  const monsters = new Map<string, Uint8Array>();
  const items = new Map<string, Uint8Array>();

  beforeAll(async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await game.monsters();
    const arc = await game.archive(MONSTER_MODEL_ARCHIVE);
    for (const m of book.monsters) {
      const ref = book.modelOf(m);
      if (!ref) continue;
      for (const [kind, h] of [['model', ref.model], ['texture', ref.texture]] as const) {
        if (!h) continue;
        const e = findEntry(arc, h);
        if (e) monsters.set(`${kind} ${h.toString(16)}`, unpackEntry(arc, e).body);
      }
    }
    const t = game.master.itemData;
    for (const name of ITEM_MODEL_ARCHIVES) {
      const a = await game.archive(name);
      for (let id = 1; id < t.rows; id++) {
        const h = u32(t.row(id), 0x20);
        const e = h ? findEntry(a, h) : undefined;
        if (e && !items.has(h.toString(16))) items.set(h.toString(16), unpackEntry(a, e).body);
      }
    }
  });

  const roundTrip = (files: Map<string, Uint8Array>): string[] => {
    const bad: string[] = [];
    for (const [k, b] of files) {
      try {
        const out = writeGfx(readGfx(b));
        const d = firstDiff(b, out);
        if (d >= 0) bad.push(`${k}: differs at 0x${d.toString(16)}`);
      } catch (err) {
        bad.push(`${k}: ${(err as Error).message}`);
      }
    }
    return bad;
  };

  test('monster models and textures are byte-identical', () => {
    expect(monsters.size).toBeGreaterThan(150);
    expect(roundTrip(monsters)).toEqual([]);
  });

  test('item models are byte-identical', () => {
    expect(items.size).toBeGreaterThan(300);
    expect(roundTrip(items)).toEqual([]);
  });

  test('parseCgfx reads the written files to the same meshes, bones and positions', () => {
    for (const files of [monsters, items])
      for (const [k, b] of files) {
        const out = writeGfx(readGfx(b));
        expect([k, summary(parseCgfx(out))]).toEqual([k, summary(parseCgfx(b))]);
      }
  });

  test('edited files: written, read again and seen by parseCgfx', () => {
    let n = 0;
    for (const [k, b] of monsters) {
      if (!k.startsWith('model')) continue;
      const g = readGfx(b);
      if (!g.models.length || g.skeletalAnimations.length < 2) continue;
      // Layout that differs from the native one: renamed model, fewer animations, no material animations.
      const edited: Gfx = { ...g, models: g.models.map((m) => ({ ...m, name: `${m.name}_port` })), skeletalAnimations: g.skeletalAnimations.slice(1), materialAnimations: [] };
      const out = writeGfx(edited);
      const again = readGfx(out);
      expect(again).toEqual(edited);
      expect(firstDiff(writeGfx(again), out)).toBe(-1);
      const before = summary(parseCgfx(b)) as { models: { name: string }[] };
      for (const m of before.models) m.name += '_port';
      expect(summary(parseCgfx(out))).toEqual(before);
      expect(readAnimations(out, 0x14).filter((a) => a.kind === 'skeletal').length).toBe(g.skeletalAnimations.length - 1);
      if (++n >= 8) break;
    }
    expect(n).toBe(8);
  });

  test('bone links follow parentIndex and keys decode like the renderer (anim.ts)', () => {
    for (const [k, b] of monsters) {
      if (!k.startsWith('model')) continue;
      const g = readGfx(b);
      for (const m of g.models) {
        if (!m.skeleton) continue;
        const copy = structuredClone(m.skeleton);
        linkBones(copy);
        expect(copy).toEqual(m.skeleton);
      }
      // Decoded curves vs src/cgfx/anim.ts (skeletal curves of the first animation).
      const theirs = readAnimations(b, 0x14).filter((a) => a.kind === 'skeletal')[0];
      const mine = g.skeletalAnimations[0];
      if (!theirs || !mine) continue;
      for (const e of mine.elements) {
        if (e.content.type !== GfxPrimitiveType.Transform) continue;
        const track = theirs.skeletal.find((t) => t.bone === e.name);
        e.content.channels.forEach((ch, i) => {
          const other = track?.channels?.[i];
          if (ch === null || typeof ch === 'number' || !other || typeof other !== 'object') return;
          const keys = decodeKeys(ch.segments[0]!);
          expect(keys.length * 4).toBe(other.keys.length);
          keys.forEach((kf, j) => {
            expect(kf.frame).toBeCloseTo(other.keys[j * 4]!, 3);
            expect(kf.value).toBeCloseTo(other.keys[j * 4 + 1]!, 3);
            expect(kf.inSlope).toBeCloseTo(other.keys[j * 4 + 2]!, 3);
          });
        });
      }
    }
  });
});

test('dictionary tree finds every name', () => {
  const names = ['enemy_38_01', 'waist', 'hip_1', 'tail', 'tail_1', 'tail_2', 'Meshes[0].IsVisible', 'M_enemy_38_01_body'];
  const tree = buildDictTree(names);
  names.forEach((n, i) => expect(dictFind(tree, n)).toBe(i));
  expect(dictFind(tree, 'missing')).toBe(-1);
});
