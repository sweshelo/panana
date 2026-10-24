// Monster looks across the games (#100): every game's design rows (the model, its colour's textures and motions, the
// scales and attach points), listed from the opened dumps, and giving a monster of one game the look of another's:
// the files are converted (convert/), added to the target's model archive (store.ts) and a new design row of the
// target points at them.
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { MONSTER_MODEL_ARCHIVE } from '../game/monsters';
import { lanaiModelIndex, lanaiMonsterDesign, lanaiMonsters, LANAI_MONSTER_MODEL_ARCHIVES } from '../lanai/monsters';
import { lanaiMonsterModel } from '../lanai/monsterModels';
import { OAHU_MONSTER_MODEL_ARCHIVE } from '../oahu/monsterModels';
import { monsterRef } from '../pages/monsters';
import type { ModelRef } from '../pages/modelview';
import type { PortTitle } from './convert';
import type { Opened } from '../ui/workspace';
import { f32, hex8, s16, u16, u32, w32 } from '../util/bytes';
import { convertMonster, type MonsterFiles } from './convert';
import { readGfx } from './gfx';
import { readH3D } from './h3d';
import { entryHash, PortStore, type PortedEntry } from './store';

/** Where a game's design row keeps what a port changes (naauao research; each game's model builder). */
interface DesignLayout {
  model: number;
  texture: number;
  /** The battle motions' file (RPG2 keeps them in the model). */
  motion: number | null;
  /** f32 distances of the performances 0x45〜 and how many there are. */
  distances: number;
  distanceCount: number;
  /** f32 scales: field, field (special maps), battle, book. */
  scales: [number, number, number, number];
  /** u16 heights (2). */
  heights: number;
  /** 4 attach points × 4 s16. */
  attach: number;
  /** u16 radius (used when > 200). */
  radius: number;
  /** Fields of the source species to clear (colour animation row, attached effects, …): [offset, bytes]. */
  clear: [number, number][];
}

export const DESIGN_LAYOUT: Record<PortTitle, DesignLayout> = {
  kahara: { model: 0x10, texture: 0x14, motion: null, distances: 0x18, distanceCount: 4, scales: [0x28, 0x2c, 0x30, 0x34], heights: 0x3c, attach: 0x40, radius: 0x66, clear: [[0x68, 1], [0x69, 1]] },
  oahu: { model: 0x0c, texture: 0x10, motion: 0x14, distances: 0x18, distanceCount: 5, scales: [0x2c, 0x30, 0x34, 0x38], heights: 0x40, attach: 0x48, radius: 0x6e, clear: [[0x70, 1], [0x71, 1]] },
  // +0x4C〜 effects. The string fields (+0x18 a procedural texture, +0x34 the waist bone's name) are not cleared but
  // avoided: the template is a row without them (lanaiTemplate)
  lanai: { model: 0x08, texture: 0x0c, motion: 0x10, distances: 0x20, distanceCount: 5, scales: [0x38, 0x3c, 0x40, 0x44], heights: 0x58, attach: 0x60, radius: 0x94, clear: [[0x4c, 6], [0x96, 1]] },
};

/** RPG FREE!: MonsterDesign +0x04 bits 20 / 21 / 22 = the model / texture / motion is in 719F0000 (else 28480000). */
const LANAI_UPDATE_BITS = 0x700000;
const LANAI_PORT_ARCHIVE = '719F0000';
/** dummy_tex.bch: the colour file of RPG3's and FREE!'s looks without textures of their own (28480000). */
const DUMMY_TEXTURE = 0x8232fc00;

/** What a look carries over to the target's design row (the units are the same in the three games). */
export interface LookParams {
  distances: number[];
  scales: number[];
  heights: [number, number];
  attach: number[];
  radius: number;
}

export function readLookParams(title: PortTitle, r: Uint8Array): LookParams {
  const l = DESIGN_LAYOUT[title];
  return {
    distances: Array.from({ length: l.distanceCount }, (_, i) => f32(r, l.distances + i * 4)),
    scales: l.scales.map((o) => f32(r, o)),
    heights: [u16(r, l.heights), u16(r, l.heights + 2)],
    attach: Array.from({ length: 16 }, (_, i) => s16(r, l.attach + i * 2)),
    radius: u16(r, l.radius),
  };
}

function writeLookParams(title: PortTitle, r: Uint8Array, p: LookParams): void {
  const l = DESIGN_LAYOUT[title];
  const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
  // a distance the source has no value for keeps the template's
  for (let i = 0; i < Math.min(l.distanceCount, p.distances.length); i++) dv.setFloat32(l.distances + i * 4, p.distances[i]!, true);
  l.scales.forEach((o, i) => dv.setFloat32(o, p.scales[i]!, true));
  dv.setUint16(l.heights, p.heights[0], true);
  dv.setUint16(l.heights + 2, p.heights[1], true);
  p.attach.forEach((v, i) => dv.setInt16(l.attach + i * 2, v, true));
  dv.setUint16(l.radius, p.radius, true);
  for (const [o, n] of l.clear) r.fill(0, o, o + n);
}

/** A design row of an opened game, as a look to port. */
export interface MonsterLook {
  title: PortTitle;
  /** The design row. */
  design: number;
  /** Names of the monsters with this look. */
  names: string[];
  model: ModelRef | null;
  files(): Promise<MonsterFiles>;
  /** The design row's bytes. */
  row: Uint8Array;
}

const body = async (read: (name: string) => Promise<Uint8Array>, archive: string, hash: number): Promise<Uint8Array | null> => {
  if (!hash) return null;
  const arc = parseArchive(await read(archive));
  const e = findEntry(arc, hash);
  return e ? unpackEntry(arc, e).body : null;
};

/** The looks of an opened game that monsters use (one per design row with a model). */
export async function monsterLooks(o: Opened, title: PortTitle): Promise<MonsterLook[]> {
  const out: MonsterLook[] = [];
  if (title === 'kahara') {
    const s = o.kahara?.session;
    const book = s?.book;
    if (!s || !book) return [];
    const read = (n: string): Promise<Uint8Array> => s.game.dump.readRomfs(n);
    for (let d = 0; d < book.designRows; d++) {
      const row = book.designBytes(d);
      const model = u32(row, 0x10), texture = u32(row, 0x14);
      const users = book.monsters.filter((m) => m.design === d);
      if (!model || !users.length) continue;
      out.push({
        title, design: d, row, names: [...new Set(users.map((m) => m.name))], model: monsterRef(s.game, book, users[0]!),
        files: async () => ({ model: (await body(read, MONSTER_MODEL_ARCHIVE, model))!, texture: await body(read, MONSTER_MODEL_ARCHIVE, texture), motion: null }),
      });
    }
  } else if (title === 'oahu') {
    const s = o.oahu;
    if (!s) return [];
    const models = s.monsterModels;
    const mons = s.battle.monsters;
    const names = new Map<number, string[]>();
    for (let r = 1; r < mons.rows; r++) {
      if (!mons.get(r, 'name')) continue;
      const d = mons.get(r, 'design');
      names.set(d, [...(names.get(d) ?? []), s.battle.monsterName(r)]);
    }
    const read = (n: string): Promise<Uint8Array> => s.dump.readRomfs(n);
    const n = await models.rows();
    for (let d = 0; d < n; d++) {
      const row = (await models.rowBytes(d))!;
      const [model, texture, motion] = [0x0c, 0x10, 0x14].map((x) => u32(row, x)) as [number, number, number];
      if (!model || !names.has(d)) continue;
      out.push({
        title, design: d, row, names: [...new Set(names.get(d))], model: models.ref(d),
        files: async () => ({ model: (await body(read, OAHU_MONSTER_MODEL_ARCHIVE, model))!, texture: await body(read, OAHU_MONSTER_MODEL_ARCHIVE, texture), motion: await body(read, OAHU_MONSTER_MODEL_ARCHIVE, motion) }),
      });
    }
  } else {
    const s = o.lanai;
    if (!s) return [];
    const designs = s.need('MonsterDesign');
    const names = new Map<number, string[]>();
    for (const m of lanaiMonsters(s)) if (m.designRow >= 0 && m.name) names.set(m.designRow, [...(names.get(m.designRow) ?? []), m.name]);
    const index = await lanaiModelIndex(s);
    for (let d = 0; d < designs.rows; d++) {
      const x = lanaiMonsterDesign(s, d);
      if (!x?.model || !names.has(d) || !index.get(x.model) || index.name(x.model)?.startsWith('dummy')) continue;
      out.push({
        title, design: d, row: designs.row(d).slice(), names: [...new Set(names.get(d))], model: lanaiMonsterModel(s, x, false),
        files: async () => {
          const i = await lanaiModelIndex(s);
          return { model: i.body(x.model)!, texture: i.body(x.texture), motion: i.body(x.motion) };
        },
      });
    }
  }
  return out;
}

/** The species tag of ported files (`enemy_k38` for RPG2's design 38): names the model, its LUTs and animations. */
export const portName = (look: Pick<MonsterLook, 'title' | 'design'>): string => `enemy_${look.title[0]}${look.design}`;

/** The converted files of a look for another game, and the entries they become in that game's model archive. */
export async function portedEntries(look: MonsterLook, target: PortTitle, template: Uint8Array, taken: (archive: string, hash: number) => boolean): Promise<{ entries: PortedEntry[]; hashes: { model: number; texture: number; motion: number }; altIdle: boolean }> {
  const files = convertMonster(await look.files(), look.title, target, { name: portName(look) });
  const l = DESIGN_LAYOUT[target];
  const archive = target === 'kahara' ? MONSTER_MODEL_ARCHIVE : target === 'oahu' ? OAHU_MONSTER_MODEL_ARCHIVE : LANAI_PORT_ARCHIVE;
  const name = portName(look);
  const ext = target === 'kahara' ? 'bcres' : 'bch';
  const entries: PortedEntry[] = [];
  const add = (b: Uint8Array | null, file: string, likeAt: number | null): number => {
    if (!b) return 0;
    const hash = entryHash(b, (h) => taken(archive, h) || entries.some((e) => e.hash === h));
    entries.push({ archive, hash, name: file, body: b, like: likeAt === null ? 0 : u32(template, likeAt) });
    return hash;
  };
  const model = add(files.model, `${name}.${ext}`, l.model);
  const texture = add(files.texture, `${name}_tex.${ext}`, l.texture);
  const motion = add(files.motion, `${name}_battle.${ext}`, l.motion);
  return { entries, hashes: { model, texture, motion }, altIdle: hasAltIdle(files, target) };
}

/** A new design row for `target`: the template row (the monster's current look) with the ported files and the look's sizes. */
export function portedDesign(look: MonsterLook, target: PortTitle, template: Uint8Array, hashes: { model: number; texture: number; motion: number }): Uint8Array {
  const r = template.slice();
  const l = DESIGN_LAYOUT[target];
  // A look whose colour has no textures of its own: RPG3 / FREE! name their empty texture file (dummy_tex.bch, in
  // 28480000), RPG2 reads the textures the model holds
  const texture = hashes.texture || (target === 'kahara' ? hashes.model : DUMMY_TEXTURE);
  w32(r, l.model, hashes.model);
  w32(r, l.texture, texture);
  if (l.motion !== null) w32(r, l.motion, hashes.motion);
  if (target === 'lanai') {
    // the bits name the archive of each file: the ported ones are in 719F0000, the dummy and "none" in 28480000
    const bits = 0x100000 | (hashes.texture ? 0x200000 : 0) | (hashes.motion ? 0x400000 : 0);
    w32(r, 0x04, ((u32(r, 0x04) & ~LANAI_UPDATE_BITS) | bits) >>> 0);
  }
  writeLookParams(target, r, readLookParams(look.title, look.row));
  return r;
}

/** Whether an archive of the target already has an entry (the game's own, or one a port added). */
export async function takenIn(target: PortTitle, read: (name: string) => Promise<Uint8Array>): Promise<(archive: string, hash: number) => boolean> {
  const store = await PortStore.of(target);
  const archives = target === 'kahara' ? [MONSTER_MODEL_ARCHIVE] : target === 'oahu' ? [OAHU_MONSTER_MODEL_ARCHIVE] : [...LANAI_MONSTER_MODEL_ARCHIVES];
  const have = new Set<string>();
  for (const a of archives) for (const e of parseArchive(await read(a)).entries) have.add(`${a}/${hex8(e.hash)}`);
  // RPG FREE! names an entry by hash in either archive (the row's bits say which): keep the hashes apart from both
  return (archive, hash) => store.has(archive, hash) || have.has(`${archive}/${hex8(hash)}`) || (target === 'lanai' && archives.some((a) => have.has(`${a}/${hex8(hash)}`)));
}

/**
 * The RPG FREE! design row a ported look starts from: the monster's own when it has no procedural texture and no
 * bone name of its own (string fields, which an added row would carry over), else the first row like that.
 */
export function lanaiTemplate(row: (i: number) => Uint8Array, rows: number, current: number): number {
  const clean = (i: number): boolean => {
    const r = row(i);
    return !u32(r, 0x14) && !u32(r, 0x18) && !u32(r, 0x34) && !!u32(r, 0x08);
  };
  if (current >= 0 && current < rows && clean(current)) return current;
  for (let i = 0; i < rows; i++) if (clean(i)) return i;
  return current;
}

/**
 * Whether the files have a looping `002_` skeletal animation: the battle's other idle, which a monster plays instead
 * of `001_` when its switch is on (RPG2 MonsterParameter +0x4A bit3, RPG3 +0x48 bit9, FREE! +0x18 bit0).
 */
export function hasAltIdle(files: MonsterFiles, title: PortTitle): boolean {
  const names: string[] = [];
  if (title === 'kahara') names.push(...readGfx(files.model).skeletalAnimations.map((a) => a.name));
  else for (const b of [files.model, files.motion]) if (b) names.push(...readH3D(b).skeletalAnimations.map((a) => a.name));
  return names.some((n) => n.startsWith('002_'));
}
