// How a monster's symbol moves on the map in RPG2 (naauao kahara/symbol.md): what it does when it sees the player
// (chase, charge, run away…), how it waits and walks before that, and how far it sees. These are bit fields of its
// MonsterDesign row (+0x08 / +0x0C), read when the symbol is made (FUN_001ee5e0); the symbol's state machine is
// FUN_001eee7c and the check that it sees the player FUN_001eeaf0.
// The speeds are not in the row: each kind of movement takes its speed (and the charge and the run its time) from the
// literal pool of FUN_001ed820, the wandering walk from FUN_001ee088's. Each literal is loaded by one instruction only,
// so the speeds are edited for every monster at once by a code patch that rewrites those words.
import { BASE } from './codeconst';
import type { ParamField } from './monsters';
import type { CodePatch } from './patch';
import { u32 } from '../util/bytes';

/** Bit fields of a MonsterDesign row that steer its symbol (words 2 and 3 = +0x08 / +0x0C). */
export const CHASE = {
  /** +0x08 bit0-2: what it does when it sees the player (CHASE_KIND). */
  kind: { w: 2, lo: 0, n: 3 },
  /** +0x08 bit3-4: how it appears and moves while it has not seen the player (CHASE_STYLE). */
  style: { w: 2, lo: 3, n: 2 },
  /** +0x08 bit5-11 / bit12-18: the wait between walks, a random time in [min, max] (× 0.1 s). */
  waitMin: { w: 2, lo: 5, n: 7 },
  waitMax: { w: 2, lo: 12, n: 7 },
  /** +0x08 bit19-25: how long a walk lasts (× 0.1 s). */
  walk: { w: 2, lo: 19, n: 7 },
  /** +0x0C bit0-6: how long it follows the player (× 0.1 s). */
  chase: { w: 3, lo: 0, n: 7 },
  /** +0x0C bit7-16: how far it sees (world units; twice on the world map). */
  sight: { w: 3, lo: 7, n: 10 },
  /** +0x0C bit17: flies over holes (only where the map's mapData [1] is 5). */
  fly: { w: 3, lo: 17, n: 1 },
} satisfies Record<string, ParamField>;
export type ChaseKey = keyof typeof CHASE;

/** What a symbol does when it sees the player (+0x08 bit0-2). */
export const CHASE_KIND = [
  '追いかける (速い)',
  '追いかける (ふつう)',
  '追いかける (遅い)',
  '突進する',
  '逃げる',
  '気づかない',
  '壁ごしに気づいて追いかける',
  '(7: 未使用)',
];

export const CHASE_KIND_NOTE = [
  '見つけたら、プレイヤーの方へ向きを直しながら追いかけます。速さは「速い」の値です。',
  '見つけたら追いかけます。速さは「ふつう」の値です。',
  '見つけたら追いかけます。速さは「遅い」の値です。',
  '見つけたときのプレイヤーの方向へ、向きを変えずにまっすぐ走ります (突進の時間と速さ)。',
  '前 600・後ろ 400 の距離 (見える距離の欄は使わない) で気づき、プレイヤーと反対へ走ってから消えます (逃げる時間と速さ)。',
  'プレイヤーに気づかず、歩き回るだけです。元のゲームでは使われていません。',
  '見える距離と向きで気づきますが、間の壁を確かめません。速さは「ふつう」のダンジョンの値です。',
  'ゲームは何もしません (気づきません)。',
];

/** How a symbol appears and moves before it sees the player (+0x08 bit3-4). */
export const CHASE_STYLE = ['ふつう', '上から降りてくる', '跳ねて動く', '(3: ふつうと同じ)'];

export const CHASE_STYLE_NOTE = [
  'その場に現れ、待っては歩きます。',
  '出るときに上 (ダンジョンでは 300、ワールドマップでは 200) から落ちてきて、着地で弾みます。ほかはふつうと同じです。',
  '待ったあと、半分の確率で歩く代わりに跳ねて (50〜200) 移動します。',
  'ゲームはふつうと同じに扱います。',
];

/** One speed (or time) the symbols share: a float in code.bin. */
export interface ChaseSpeed {
  key: string;
  addr: number;
  label: string;
  /** The value in the game. */
  vanilla: number;
  /** 'speed' = world units per second; 'time' = seconds (edited in tenths). */
  unit: 'speed' | 'time';
  /** CHASE_KIND values it is used for. */
  kinds: number[];
}

/**
 * The shared speeds and times, by literal (FUN_001ed820 sets the movement when the symbol starts to move after
 * seeing the player: the time in +0x20, the speed in +0x2C; on the world map the symbol's +0x50 bit2 is set).
 */
export const CHASE_SPEEDS: ChaseSpeed[] = [
  { key: 'fastWorld', addr: 0x1eda10, label: '速い (ワールドマップ)', vanilla: 680, unit: 'speed', kinds: [0] },
  { key: 'fastDungeon', addr: 0x1eda14, label: '速い (ダンジョン)', vanilla: 620, unit: 'speed', kinds: [0] },
  { key: 'normalWorld', addr: 0x1eda18, label: 'ふつう (ワールドマップ)', vanilla: 600, unit: 'speed', kinds: [1] },
  { key: 'normalDungeon', addr: 0x1eda0c, label: 'ふつう (ダンジョン)・壁ごし', vanilla: 520, unit: 'speed', kinds: [1, 6] },
  { key: 'slowWorld', addr: 0x1eda1c, label: '遅い (ワールドマップ)', vanilla: 420, unit: 'speed', kinds: [2] },
  { key: 'slowDungeon', addr: 0x1eda20, label: '遅い (ダンジョン)', vanilla: 400, unit: 'speed', kinds: [2] },
  { key: 'chargeSpeed', addr: 0x1eda28, label: '突進の速さ', vanilla: 750, unit: 'speed', kinds: [3] },
  { key: 'chargeTime', addr: 0x1eda24, label: '突進の時間', vanilla: 4, unit: 'time', kinds: [3] },
  { key: 'fleeSpeed', addr: 0x1eda30, label: '逃げる速さ', vanilla: 250, unit: 'speed', kinds: [4] },
  { key: 'fleeTime', addr: 0x1eda2c, label: '逃げる時間', vanilla: 1.7, unit: 'time', kinds: [4] },
  { key: 'walk', addr: 0x1ee238, label: '歩き回る速さ (気づく前)', vanilla: 150, unit: 'speed', kinds: [0, 1, 2, 3, 4, 5, 6] },
];

/** Changed speeds by key (the export writes them; the others stay as in the game). */
export type ChaseSpeeds = Record<string, number>;

/** Largest value of a speed (units / s) or a time (s) the editor takes. */
export const CHASE_SPEED_MAX = { speed: 5000, time: 60 };

export const CHASE_PATCH_ID = 'panana:chase-speed';
export const CHASE_PATCH_TITLE = 'シンボルの速さ';

/** The bits of a float as a .word. */
function floatWord(v: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v, true);
  return b.getUint32(0, true);
}

/** Speeds that differ from the game's (the others are left out). */
export function changedSpeeds(speeds: ChaseSpeeds): ChaseSpeed[] {
  return CHASE_SPEEDS.filter((s) => s.key in speeds && Math.fround(speeds[s.key]!) !== Math.fround(s.vanilla));
}

/** Why the speeds cannot be patched in this code.bin (another version, or a base MOD rewrote the words), or null. */
export function chaseSpeedProblem(code: Uint8Array): string | null {
  const bad = CHASE_SPEEDS.filter((s) => s.addr - BASE + 4 > code.length || u32(code, s.addr - BASE) !== floatWord(s.vanilla));
  return bad.length ? `code.bin の 0x${bad.map((s) => s.addr.toString(16).toUpperCase()).join('・0x')} が元のゲームと違うので、「${CHASE_PATCH_TITLE}」を入れられません (別の版か、土台の MOD が同じ場所を書き換えています)` : null;
}

/** The patch writing the changed speeds, or null when none changed. */
export function chaseSpeedPatch(speeds: ChaseSpeeds): CodePatch | null {
  const changed = changedSpeeds(speeds);
  if (!changed.length) return null;
  const lines = [`; ${CHASE_PATCH_TITLE}: マップのシンボルの敵の速さ・時間 (FUN_001ed820 / FUN_001ee088 のリテラル。どれも 1 命令だけが読む)`];
  for (const s of changed) {
    const v = speeds[s.key]!;
    lines.push(`@0x${s.addr.toString(16).toUpperCase()}`, `  .word 0x${floatWord(v).toString(16).padStart(8, '0')} ; ${s.label} ${s.vanilla} -> ${v}`);
  }
  return { id: CHASE_PATCH_ID, title: CHASE_PATCH_TITLE, source: lines.join('\n'), enabled: true };
}
