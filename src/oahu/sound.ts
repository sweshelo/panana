// BGM and sound effects of 電波人間のRPG3 (#80): the soundData rows with their names (sound/sound.bcsar, as RPG2) and where
// the game uses them: mapData (field BGM, battle BGM, footsteps), the default BGM of fixed battles (monsterGroup +0x32
// bit2), and the BGM rows written in the Update's code.bin (calls of the BGM player and of the fixed battles).
// naauao oahu/sound.md.
import { BASE } from '../game/codeconst';
import { SOUND_SLOTS, type SoundSlot } from '../game/sound';
import type { OahuBattle } from './battle';
import type { OahuCode } from './code';
import type { OahuMaster } from './master';

/** soundData rows the code names: the battle BGMs of fixed battles (FUN_0021112C / FUN_00211228 with BGM 0). */
export const OAHU_BATTLE_BGM = { normal: 7, boss: 8 } as const;
/** monsterGroup +0x32 bit2: a fixed battle started without a BGM plays BGM_BATTLE_2 (else BGM_BATTLE_1). */
export const OAHU_BOSS_BGM_BIT = 0x04;

/** mapGroup (dungeons, 89 × 0x34): +0x1C name, +0x2E its mapData row (battles), +0x2F a second row (towns: indoors). */
const MAP_GROUP = { name: 0x1c, mapData: 0x2e, mapData2: 0x2f } as const;

/** Functions of the Update's code.bin that take a soundData row (naauao oahu/sound.md §3). */
export const OAHU_SOUND_CODE = {
  /** FUN_00213970(row, …): plays a BGM (stops the one playing). */
  playBgm: 0x213970,
  /** FUN_0021112C(&group hash, BGM): a fixed battle by the hash of its monsterGroup row; BGM 0 = by +0x32 bit2. */
  fixedBattle: 0x21112c,
  /** FUN_00211228(group row, BGM): the same by row (event objects). */
  fixedBattleRow: 0x211228,
} as const;

/**
 * BGMs FUN_0024CB8C(field BGM, map key, …) returns instead of the map's mapData [4] (Update @0x24CB8C). On the world map
 * (key 0xA8654391, mapGroup +0x04 of every dungeon) the BGM changes with the state (FUN_0023BC6C, FUN_0021395C(3〜6); by the names, the ship / cruiser); the others need a flag.
 */
export const OAHU_FIELD_BGM_OVERRIDES: { row: number; what: string }[] = [
  { row: 3, what: 'ワールドマップ' },
  { row: 4, what: 'ワールドマップ (乗り物などの状態で切り替え)' },
  { row: 5, what: 'ワールドマップ (乗り物などの状態で切り替え)' },
  { row: 6, what: 'ワールドマップ (乗り物などの状態で切り替え)' },
  { row: 0x23, what: 'マップのキー 0x7D6021D8 で、FUN_001EDCF0(0x1E, 2) が真のとき' },
  { row: 0x11, what: 'FUN_002AB0BC(マップ) = 0x16 で、FUN_001ED9B8(3) が真のとき' },
];

export type OahuSoundUseKind = 'map' | 'battle' | 'code';

/** One place that uses a soundData row. */
export interface OahuSoundUse {
  kind: OahuSoundUseKind;
  /** What uses it ("フィールドの BGM"). */
  what: string;
  /** Where ("mapData 行 1"), with the dungeons, groups or address. */
  where: string;
  /** Names of the dungeons / the group, with a link. */
  links?: { label: string; href: string }[];
  /** From reading the code and not checked in the game. */
  unsure?: boolean;
}

export const OAHU_SOUND_USE_KIND: Record<OahuSoundUseKind, string> = { map: 'マップ', battle: '決まった戦闘', code: 'コード' };

const SLOT_LABEL: Record<SoundSlot, string> = Object.fromEntries(SOUND_SLOTS.map(([slot, label]) => [slot, label])) as Record<SoundSlot, string>;

export interface OahuDungeon {
  row: number;
  name: string;
}

/** The dungeons (mapGroup rows) whose +0x2E / +0x2F is each mapData row. */
export function oahuMapDataDungeons(master: OahuMaster, name: (id: number) => string): Map<number, { main: OahuDungeon[]; second: OahuDungeon[] }> {
  const t = master.table('mapGroup.bin');
  const out = new Map<number, { main: OahuDungeon[]; second: OahuDungeon[] }>();
  const at = (r: number) => out.get(r) ?? (out.set(r, { main: [], second: [] }), out.get(r)!);
  for (let r = 1; r < t.rows; r++) {
    const row = t.row(r);
    const id = new DataView(row.buffer, row.byteOffset).getUint32(MAP_GROUP.name, true);
    const d = { row: r, name: name(id) || `mapGroup ${r}` };
    if (row[MAP_GROUP.mapData]) at(row[MAP_GROUP.mapData]!).main.push(d);
    // 0 = none; a town's second row is often the next one
    if (row[MAP_GROUP.mapData2]) at(row[MAP_GROUP.mapData2]!).second.push(d);
  }
  return out;
}

/** A call of `target` (BL or B) in .text, with the constant the code puts in r0 / r1 just before it (when it does). */
export interface CodeCall {
  at: number;
  r0: number | null;
  r1: number | null;
  /** A hash loaded through a literal before the call (`ldr rX, =ptr; ldr rX, [rX, #k]`), for the group of a fixed battle. */
  hash: number | null;
}

const ror = (v: number, r: number): number => (r ? ((v >>> r) | (v << (32 - r))) >>> 0 : v);
const isBranch = (w: number): boolean => ((w >>> 25) & 7) === 5 && w >>> 28 === 0xe;
const branchTarget = (w: number, at: number): number => at + 8 + ((w << 8) >> 6);

/** Every BL / B to `target` in .text, with the constants that reach r0 and r1. */
export function codeCalls(code: OahuCode, target: number, textEnd: number): CodeCall[] {
  const out: CodeCall[] = [];
  for (let at = BASE; at < textEnd; at += 4) {
    const w = code.word(at);
    if (!isBranch(w) || branchTarget(w, at) !== target) continue;
    const reg: [number | null, number | null] = [null, null];
    const seen = [false, false];
    let hash: number | null = null;
    const loaded = new Map<number, number>();
    // Back over at most 10 instructions, not past another call or a return.
    const back: number[] = [];
    for (let b = at - 4, n = 0; n < 10 && b >= BASE; b -= 4, n++) {
      const x = code.word(b);
      if (isBranch(x) || (x & 0x0fff0000) === 0x08bd0000) break;
      back.push(b);
    }
    for (const b of back) {
      const x = code.word(b);
      for (const r of [0, 1]) {
        if (seen[r]) continue;
        // mov rN, #imm
        if ((x & 0xfffff000) >>> 0 === (0xe3a00000 | (r << 12)) >>> 0) {
          reg[r] = ror(x & 0xff, ((x >> 8) & 0xf) * 2);
          seen[r] = true;
        } else if (((x >>> 12) & 0xf) === r && writesRd(x)) seen[r] = true;
      }
    }
    // ldr rX, [pc, #imm] (a pointer) then ldr rX, [rX, #k]: the hash at pointer + k
    for (const b of [...back].reverse()) {
      const x = code.word(b);
      if ((x & 0xffff0000) >>> 0 === 0xe59f0000) loaded.set((x >>> 12) & 0xf, code.word(b + 8 + (x & 0xfff)));
      else if ((x & 0xfff00000) >>> 0 === 0xe5900000) {
        const rn = (x >>> 16) & 0xf;
        const p = loaded.get(rn);
        if (p !== undefined && p >= BASE && p < BASE + code.code.length - 4 && ((x >>> 12) & 0xf) === rn) hash = code.word(p + (x & 0xfff));
      }
    }
    out.push({ at, r0: reg[0], r1: reg[1], hash });
  }
  return out;
}

/** Data processing or load with this Rd (approximately: not a compare, store or VFP op). */
function writesRd(x: number): boolean {
  const op = (x >>> 26) & 3;
  if (op === 0) {
    const opcode = (x >>> 21) & 0xf;
    return !(opcode >= 8 && opcode <= 11 && (x & (1 << 20))); // tst / teq / cmp / cmn
  }
  if (op === 1) return !!(x & (1 << 20)); // ldr
  return false;
}

const hexAt = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(6, '0')}`;

/** soundData row -> the places that use it. `code` is the Update's (null: the code uses are not listed). */
export function oahuSoundUses(master: OahuMaster, battle: OahuBattle, code: OahuCode | null, textEnd: number): Map<number, OahuSoundUse[]> {
  const out = new Map<number, OahuSoundUse[]>();
  const add = (row: number, u: OahuSoundUse): void => {
    if (row) out.set(row, [...(out.get(row) ?? []), u]);
  };
  const dungeons = oahuMapDataDungeons(master, (id) => battle.message(id));
  const dungeonLinks = (r: number): { label: string; href: string }[] => {
    const d = dungeons.get(r);
    return d ? [...d.main, ...d.second].map((x) => ({ label: x.name, href: '' })) : [];
  };
  // mapData [4] / [5] / [6]
  const md = master.table('mapData.bin');
  for (let r = 0; r < md.rows; r++) {
    const row = md.row(r);
    for (const [slot, , o] of SOUND_SLOTS) {
      const links = dungeonLinks(r);
      const battleRow = !!dungeons.get(r)?.main.length;
      add(row[o]!, {
        kind: 'map',
        what: SLOT_LABEL[slot],
        where: `mapData 行 ${r}`,
        links: links.length ? links : undefined,
        // the battle BGM is read from the dungeon's row (mapGroup +0x2E), so [5] of the other rows may never play
        unsure: slot === 'battle' && !battleRow ? true : undefined,
      });
    }
  }
  // the default BGM of the groups (fixed battles started with BGM 0)
  const groups = master.table('monsterGroup.bin');
  for (let r = 1; r < groups.rows; r++) {
    if (!(groups.row(r)[0x32]! & OAHU_BOSS_BGM_BIT)) continue;
    const g = battle.group(r);
    const lead = g.fixed[0] ?? g.leads[0]?.monster;
    add(OAHU_BATTLE_BGM.boss, {
      kind: 'battle',
      what: '決まった戦闘 (BGM 指定なし)',
      where: `群れ #${r} (+0x32 bit2)`,
      links: [{ label: lead ? battle.monsterName(lead) : `群れ #${r}`, href: `#/groups/${r}` }],
    });
  }
  for (const o of OAHU_FIELD_BGM_OVERRIDES) add(o.row, { kind: 'code', what: 'フィールドの BGM の差し替え', where: `${o.what} (FUN_0024CB8C)`, unsure: true });
  if (!code) return out;
  const groupIndex = groups.hashIndex();
  for (const c of codeCalls(code, OAHU_SOUND_CODE.playBgm, textEnd)) {
    if (c.r0 !== null) add(c.r0, { kind: 'code', what: 'BGM を鳴らす', where: `@${hexAt(c.at)} (FUN_00213970)`, unsure: true });
  }
  for (const target of [OAHU_SOUND_CODE.fixedBattle, OAHU_SOUND_CODE.fixedBattleRow]) {
    for (const c of codeCalls(code, target, textEnd)) {
      const group = c.hash !== null && target === OAHU_SOUND_CODE.fixedBattle ? groupIndex.get(c.hash) : undefined;
      const bgm = c.r1 || (group !== undefined ? (groups.row(group)[0x32]! & OAHU_BOSS_BGM_BIT ? OAHU_BATTLE_BGM.boss : OAHU_BATTLE_BGM.normal) : 0);
      if (!bgm) continue;
      const g = group !== undefined ? battle.group(group) : null;
      const lead = g ? (g.fixed[0] ?? g.leads[0]?.monster) : undefined;
      add(bgm, {
        kind: 'battle',
        what: c.r1 ? '決まった戦闘 (BGM 指定)' : '決まった戦闘 (BGM 指定なし)',
        where: `@${hexAt(c.at)} (${target === OAHU_SOUND_CODE.fixedBattle ? 'FUN_0021112C' : 'FUN_00211228'})`,
        links: group !== undefined ? [{ label: lead ? battle.monsterName(lead) : `群れ #${group}`, href: `#/groups/${group}` }] : undefined,
        unsure: true,
      });
    }
  }
  return out;
}
