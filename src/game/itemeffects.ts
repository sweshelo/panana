// Item effects of the elpulse MOD (elpulse mod/build_code.py and mod/build_items.py), cut out so that any item made in
// Panana can take them: the effect is a new actionData row for the item, and the export adds the code.ips patches the
// effects in use need (and only those, so an unused effect costs no code cave).
//
//   ap-all          仲間全員の AP 回復 (vanilla type 1 for the whole party; the battle shows the action's own messages)
//   full-all        type 4 全回復: FUN_002d8404 (the recovery spring / bed): HP and AP to max, revive, cure the states
//   fixate          type 5 固定化: a QR unit (origin 3) becomes a regular one, so the shrine can call it back after farewell
//   teleporter-plus テレポーター+: leaves a warp hole at the player's position, then escapes like テレポーター
//   fixate-all      type 6 (debug): fixates every owned unit farewell would delete
//   unfix-all       type 7 (debug): every owned unit but the hero's family back to a QR unit
//
// The routines are those of elpulse (same instructions; the local labels are prefixed). Not cut out: the recovery
// spring that offers いずみのせいすい and the generic switch, which are not item actions.
import { u16, u32, w16, w32 } from '../util/bytes';
import { ActionEdits, decodeAction } from './actions';
import type { Master } from './master';
import type { CodePatch } from './patch';

/** Rows of actionData in the game; the battle used to drop rows past them (FUN_00288634, see ITEM_ACTION_PATCH). */
export const VANILLA_ACTION_ROWS = 0x2a0;
export const TELEPORTER_ITEM = 0x1c;
/** テレポーター's action (kind 3; FUN_002c65f8 handles the item by its ID, and reads only the "usable in the field" bit). */
export const TELEPORTER_ACTION = 207;
/** itemData +0x08 bit4: listed in the 電波人間ハウス's item menu (FUN_002ddf98), with action w0 bit30. */
export const HOUSE_ITEM_FLAG = 0x10;

export type ModEffectKey = 'ap-all' | 'full-all' | 'fixate' | 'teleporter-plus' | 'fixate-all' | 'unfix-all';

export interface ModEffect {
  key: ModEffectKey;
  label: string;
  /** What it does, for the info tip. */
  note: string;
  /** The row copied for the item (its animation and sound). */
  template: number;
  /** w0 (kind, type, range, scenes). Absent = the template's as it is. */
  w0?: number;
  /** w3 / w4: the result messages (one unit / the party). A string = a message of MOD_TEXTS, added when needed. */
  msgs?: [number | string, number | string];
  /** +0x18 / +0x1A: amount (min / max). */
  amount?: [number, number];
  /** Bits set in itemData +0x08. */
  itemFlags?: number;
  debug?: boolean;
}

export const MOD_EFFECTS: ModEffect[] = [
  {
    key: 'ap-all',
    label: '仲間全員の AP 回復',
    template: 182,
    w0: 0xa0324c8d,
    msgs: [0x1803, 0x1804],
    amount: [70, 100],
    note: '仲間全員の AP を回復します (量はアクションの最小〜最大。アンテナパワー+ と同じ 70〜100 で作ります)。戦闘の結果は「āのAPがN回復した」「APが平均N回復した」。',
  },
  {
    key: 'full-all',
    label: '仲間全員を全回復・復活',
    template: 191,
    w0: 0xa0324ca5,
    msgs: [0x17fe, 0x17ff],
    amount: [0, 0],
    note: '回復の泉やベッドと同じ全回復 (FUN_002d8404) を仲間全員に: HP と AP が最大になり、倒れた電波人間も生き返り、状態異常も治ります。',
  },
  {
    key: 'fixate',
    label: '固定化 (QR の電波人間)',
    template: 179,
    w0: 0xc03244ad,
    msgs: ['fixate', 'fixate'],
    amount: [0, 0],
    itemFlags: HOUSE_ITEM_FLAG,
    note: 'QR コードで入手した電波人間をふつうの電波人間にして、さよならしても精霊のほこらから呼び戻せるようにします。フィールドと電波人間ハウスで使えます (戦闘では使えません)。さよならの記録に見た目と名前を残すパッチも入ります。',
  },
  {
    key: 'teleporter-plus',
    label: 'テレポーター+ (ワープホールを残す)',
    template: TELEPORTER_ACTION,
    note: 'その場にワープホールを作ってから、テレポーターと同じようにダンジョンを脱出します。次にダンジョンに入ると、ワープホールから始めるか聞かれます。ワープホールを残せないダンジョンでは「しかし何も起きなかった」になり、減りません。',
  },
  {
    key: 'fixate-all',
    label: '全員を固定化 (デバッグ)',
    template: 182,
    w0: 0x80324cb5,
    msgs: ['fixate_all_1', 'fixate_all'],
    amount: [0, 0],
    debug: true,
    note: 'デバッグ用。さよならで消えてしまう電波人間 (QR など) を一度に全員固定化します。フィールドだけで使えます。',
  },
  {
    key: 'unfix-all',
    label: '全員を QR 由来に戻す (デバッグ)',
    template: 182,
    w0: 0x80324cbd,
    msgs: ['unfix_all_1', 'unfix_all'],
    amount: [0, 0],
    debug: true,
    note: 'デバッグ用。主人公と家族以外の電波人間を全員 QR 由来に戻します (固定化の確認用)。フィールドだけで使えます。',
  },
];

export const modEffect = (key: string): ModEffect | undefined => MOD_EFFECTS.find((e) => e.key === key);

const R = (base: string, yomi: string): string => `[0001]'${base}[0001](${yomi}[0001])`;
const DENPA = R('電波', 'でんぱ'),
  KOTEIKA = R('固定化', 'こていか'),
  DENPANINGEN = R('電波人間', 'でんぱにんげん');
const TAI = R('体', 'たい'),
  YURAI = R('由来', 'ゆらい'),
  MODO = R('戻', 'もど');
/** The result messages of the effects (elpulse mod/build_items.py EXTRA_TEXTS; ā = the unit, [000B] = the amount). */
export const MOD_TEXTS: Record<string, string> = {
  fixate: `[0011][0001]āの${DENPA}が${KOTEIKA}された`,
  fixate_all_1: `[0011][0001]āが[0001][000B][0001]${TAI}の${DENPANINGEN}を${KOTEIKA}した`,
  fixate_all: `[0011][0001][000B][0001]${TAI}の${DENPANINGEN}を${KOTEIKA}した`,
  unfix_all_1: `[0011][0001]āが[0001][000B][0001]${TAI}の${DENPANINGEN}をQR${YURAI}に${MODO}した`,
  unfix_all: `[0011][0001][000B][0001]${TAI}の${DENPANINGEN}をQR${YURAI}に${MODO}した`,
};

/** elpulse tools/gmsg.py encode: "[XXXX]" = a raw unit, "\n" = a new line; NUL-terminated. */
export function encodeModText(s: string): Uint16Array {
  const out: number[] = [];
  for (const tok of s.split(/(\[[0-9A-Fa-f]{4}\]|\n)/)) {
    if (!tok) continue;
    if (tok === '\n') out.push(0x0a);
    else if (/^\[[0-9A-Fa-f]{4}\]$/.test(tok)) out.push(parseInt(tok.slice(1, 5), 16));
    else for (const c of tok) out.push(c.charCodeAt(0));
  }
  out.push(0);
  return Uint16Array.from(out);
}

const sameUnits = (a: Uint16Array | undefined, b: Uint16Array): boolean =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether an action row is テレポーター+: a copy of テレポーター's action for another item (only +0x14 differs). */
function isTeleporterPlus(master: Master, row: number): boolean {
  const t = master.table('actionData.bin');
  if (row === TELEPORTER_ACTION || row <= 0 || row >= t.rows || TELEPORTER_ACTION >= t.rows) return false;
  const a = t.row(row),
    b = master.originalRow('actionData.bin', TELEPORTER_ACTION);
  if (a.length !== b.length || u16(a, 0x14) === TELEPORTER_ITEM || !u16(a, 0x14)) return false;
  for (let i = 0; i < a.length; i++) if ((i < 0x14 || i > 0x15) && a[i] !== b[i]) return false;
  return true;
}

/** The MOD effect of an action row, or null (a vanilla effect). */
export function modEffectOf(master: Master, row: number): ModEffect | null {
  const t = master.table('actionData.bin');
  if (row <= 0 || row >= t.rows) return null;
  const r = t.row(row);
  const f = decodeAction(r);
  if (f.kind === 2) {
    const byType: Record<number, ModEffectKey> = { 4: 'full-all', 5: 'fixate', 6: 'fixate-all', 7: 'unfix-all' };
    if (byType[f.type]) return modEffect(byType[f.type]!)!;
    if (f.type === 1 && f.range === 6) return modEffect('ap-all')!;
    return null;
  }
  return isTeleporterPlus(master, row) ? modEffect('teleporter-plus')! : null;
}

/** Items (tools, with a name) and the action of each. */
function tools(master: Master): { id: number; action: number }[] {
  const items = master.itemData,
    actions = master.table('actionData.bin');
  const out: { id: number; action: number }[] = [];
  for (let id = 1; id < items.rows; id++) {
    const r = items.row(id);
    const a = u32(r, 0x24);
    if (u32(r, 0x0c) && (r[0x2c]! & 0xf) === 1 && a > 0 && a < actions.rows) out.push({ id, action: a });
  }
  return out;
}

/** The MOD effects the items use: effect -> the items. */
export function usedModEffects(master: Master): Map<ModEffectKey, number[]> {
  const out = new Map<ModEffectKey, number[]>();
  for (const { id, action } of tools(master)) {
    const e = modEffectOf(master, action);
    if (e) out.set(e.key, [...(out.get(e.key) ?? []), id]);
  }
  return out;
}

/**
 * Give an item a MOD effect: a new action row (a copy of the effect's template naming the item at +0x14, with the
 * effect's w0, messages and amount), or the item's own added row rewritten when no other item uses it. Returns the row.
 */
export function assignModEffect(master: Master, item: number, key: ModEffectKey): number {
  const e = modEffect(key);
  if (!e) throw new Error(`効果 ${key} はありません`);
  const items = master.itemData,
    t = master.table('actionData.bin');
  const r = items.row(item);
  const cur = u32(r, 0x24);
  const own =
    cur >= master.originalRows('actionData.bin') &&
    cur < t.rows &&
    u16(t.row(cur), 0x14) === item &&
    tools(master).every((x) => x.action !== cur || x.id === item);
  const row = own ? cur : new ActionEdits(master, null, 0).copyForItem(e.template, item);
  const dst = t.row(row);
  dst.set(t.row(e.template).subarray(0, dst.length));
  w16(dst, 0x14, item);
  if (e.w0 !== undefined) w32(dst, 0, e.w0);
  if (e.msgs) e.msgs.forEach((m, i) => w32(dst, 0x0c + i * 4, typeof m === 'number' ? m : modText(master, m)));
  if (e.amount) {
    w16(dst, 0x18, e.amount[0]);
    w16(dst, 0x1a, e.amount[1]);
  }
  w32(r, 0x24, row);
  if (e.itemFlags) w32(r, 8, (u32(r, 8) | e.itemFlags) >>> 0);
  return row;
}

/** The message ID of a text of MOD_TEXTS: one added before with the same text, else a new one. */
function modText(master: Master, key: string): number {
  const texts = master.texts;
  const units = encodeModText(MOD_TEXTS[key]!);
  const have = texts.addedIds().find((id) => sameUnits(texts.units(id), units));
  if (have !== undefined) return have;
  if (!texts.canAdd()) throw new Error('メッセージを追加できません');
  return texts.add(units);
}

// ---- code.ips --------------------------------------------------------------------------------------------------

/** A hook of the game the patches overwrite: its address and the instruction there in the game (to see a base MOD's). */
const HOOKS = {
  effects: [
    [0x2f4248, 0x1a000004],
    [0x310028, 0x1a00000a],
    [0x318440, 0x1a000103],
    [0x2f63ac, 0x1a00004a],
  ],
  healmsg: [
    [0x24e3f0, 0xe3a03b06],
    [0x24e360, 0xe59f303c],
  ],
  farewell: [
    [0x220a58, 0xeb02d32f],
    [0x2d5300, 0xe92d4ff0],
    [0x290940, 0xe2841004],
  ],
  teleporter: [
    [0x2c6600, 0xe350001c],
    [0x25de4c, 0xe350001c],
    [0x266b14, 0xe350001c],
    [0x2c66fc, 0x13500000],
    [0x2c6764, 0xe3a01613],
    [0x353480, 0xe92d4070],
  ],
} as const;
type Group = keyof typeof HOOKS;

export const MOD_PATCH_TITLES: Record<Group, string> = {
  effects: 'アイテムの効果 (全回復・固定化)',
  healmsg: 'アイテムの効果: 戦闘の回復メッセージ',
  farewell: 'アイテムの効果: さよならの記録 (固定化)',
  teleporter: 'アイテムの効果: テレポーター+',
};

/** Whether the code already has a group's hooks (a base MOD built by elpulse mod/build_code.py). */
const hooked = (code: Uint8Array, g: Group): boolean =>
  HOOKS[g].some(([a, w]) => a - 0x100000 + 4 <= code.length && u32(code, a - 0x100000) !== w);

/** "cmp reg, #n" (or the conditional form) for any n: through ip when n is not an ARM immediate (flags only change). */
function cmpLines(reg: string, n: number, cond = ''): string[] {
  const imm = (v: number): boolean => {
    for (let rot = 0; rot < 32; rot += 2) if (((v << rot) | (v >>> (32 - rot))) >>> 0 <= 0xff) return true;
    return false;
  };
  return imm(n) ? [`cmp${cond} ${reg}, #${n}`] : [`push {ip}`, `ldr ip, =${n}`, `cmp${cond} ${reg}, ip`, `pop {ip}`];
}

/** Z = `reg` is one of `ids`. */
const isOneOf = (reg: string, ids: number[], first = ''): string[] =>
  ids.flatMap((id, i) => cmpLines(reg, id, i ? 'ne' : first));

const lines = (xs: (string | false | undefined)[]): string =>
  xs.filter((x): x is string => typeof x === 'string').join('\n') + '\n';

function effectsSource(types: Set<number>): string {
  const all = types.has(6) || types.has(7),
    fix = types.has(5),
    full = types.has(4);
  return lines([
    '; アイテムの効果 (elpulse mod/build_code.py): 効果の種別 4 全回復・5 固定化・6 / 7 デバッグ',
    '@0x2F4248                     ; FUN_002f41ac (効果の計算): cmp r2, #3 / bne ret',
    '  b elp_calc',
    '@0x310028                     ; FUN_0030ffb8 (効果を当てる): 種別 3 以外',
    '  bne elp_apply',
    '@0x318440                     ; FUN_00318380 (効果があるか): 種別 3 以外',
    '  bne elp_effective',
    '@0x2F63AC                     ; FUN_002f5324 (フィールドの結果のメッセージ): 種別 3 以上で出す',
    '  bcc 0x2F64DC',
    '@cave elp_apply               ; r0 = 種別、r4 = 結果、r5 = 電波人間',
    all && '  cmp r0, #6',
    all && '  moveq r0, #1',
    all && '  beq elp_apply_all',
    all && '  cmp r0, #7',
    all && '  bne elp_apply_one',
    all && '  mov r0, #3',
    all && 'elp_apply_all:',
    all && '  bl elp_fixall',
    all && '  b 0x310058',
    all && 'elp_apply_one:',
    fix && '  cmp r0, #5',
    fix && '  beq elp_fixate',
    full && '  cmp r0, #4',
    full && '  bne 0x310058',
    full && '  mov r0, r5',
    full && '  bl FUN_002d8404             ; 全回復 (回復の泉・ベッドと同じ)',
    '  b 0x310058',
    fix && 'elp_fixate:                   ; QR (由来 3) をふつうの電波人間 (由来 1 / 2) に',
    fix && '  ldrh r0, [r5, #2]',
    fix && '  add r0, r0, #1',
    fix && '  cmp r0, #0x10000',
    fix && '  bne 0x310058',
    fix && '  ldrh r0, [r5]',
    fix && '  bl FUN_00311748             ; セーブの記録',
    fix && '  cmp r0, #0',
    fix && '  beq 0x310058',
    fix && '  ldrb r1, [r0, #0x0a]',
    fix && '  cmp r1, #0',
    fix && '  moveq r1, #1',
    fix && '  movne r1, #2',
    fix && '  ldrb r2, [r0, #0x5a]',
    fix && '  bic r2, r2, #7',
    fix && '  orr r2, r2, r1',
    fix && '  strb r2, [r0, #0x5a]',
    fix && '  strb r1, [r5, #0x2c]',
    fix && '  b 0x310058',
    '@cave elp_calc                ; FUN_002f41ac の続き (cmp r2, #3 のフラグ)',
    '  blo 0x2F4260',
    all && '  cmp r2, #6',
    all && '  moveq r0, #0',
    all && '  beq elp_calc_all',
    all && '  cmp r2, #7',
    all && '  bne elp_calc_one',
    all && '  mov r0, #2',
    all && 'elp_calc_all:                 ; 量 = 変わる電波人間の数',
    all && '  bl elp_fixall',
    all && '  str r0, [r4]',
    all && '  b 0x2F4260',
    all && 'elp_calc_one:',
    fix && '  cmp r2, #5                   ; 固定化は生き返らせない',
    fix && '  beq 0x2F4260',
    '  b 0x2F424C                   ; 種別 3 / 4: HP が 0 以下なら生き返る',
    '@cave elp_effective           ; r0 = 種別、r4 = 電波人間。0x31884C = ある、0x318854 = ない',
    all && '  cmp r0, #6',
    all && '  moveq r0, #0',
    all && '  beq elp_eff_all',
    all && '  cmp r0, #7',
    all && '  bne elp_eff_one',
    all && '  mov r0, #2',
    all && 'elp_eff_all:',
    all && '  bl elp_fixall',
    all && '  cmp r0, #0',
    all && '  bne 0x31884C',
    all && '  b 0x318854',
    all && 'elp_eff_one:',
    fix && '  cmp r0, #5',
    fix && '  bne elp_eff_full',
    fix && '  ldrb r0, [r4, #0x2c]         ; 由来 3 (QR) ならある',
    fix && '  cmp r0, #3',
    fix && '  beq 0x31884C',
    fix && '  b 0x318854',
    fix && 'elp_eff_full:',
    full && '  cmp r0, #4',
    full && '  bne 0x318854',
    full && '  ldrsh r0, [r4, #0x5c]        ; 倒れている',
    full && '  cmp r0, #0',
    full && '  ble 0x31884C',
    full && '  ldrsh r1, [r4, #0x60]        ; HP が最大でない',
    full && '  cmp r1, r0',
    full && '  bgt 0x31884C',
    full && '  ldrsh r0, [r4, #0x6a]        ; AP が最大でない',
    full && '  ldrsh r1, [r4, #0x6e]',
    full && '  cmp r1, r0',
    full && '  bgt 0x31884C',
    '  b 0x318854',
    all && FIXALL_SOURCE,
  ]);
}

/** Debug types 6 / 7: r0 bit0 = write (else count), bit1 = back to QR. Returns the number of units. */
const FIXALL_SOURCE = `@cave elp_fixall              ; すべての電波人間 (パーティ 8 + ハウス 180) を調べる
  push {r4-r10, lr}
  mov r8, r0
  mov r9, #0
  ldr r7, =0x562F90            ; 記録の置き場の番号
  ldrb r6, [r7]
  mov r0, #0
  strb r0, [r7]
  mov r4, #0
elp_fa_loop:
  mov r0, r4
  bl FUN_00311748
  cmp r0, #0
  beq elp_fa_next
  ldrb r1, [r0, #0x34]         ; Lv 0 = 空き
  cmp r1, #0
  beq elp_fa_next
  ldrb r2, [r0, #0x5a]
  and r1, r2, #7
  ldrb r3, [r0, #0x3e]
  tst r8, #2
  bne elp_fa_rev
  cmp r1, #3
  beq elp_fa_fwd
  cmp r1, #1
  cmpne r1, #2
  beq elp_fa_next
  cmp r3, #0
  bne elp_fa_next
elp_fa_fwd:
  add r9, r9, #1
  tst r8, #1
  beq elp_fa_next
  ldrb r1, [r0, #0x0a]
  cmp r1, #0
  moveq r1, #1
  movne r1, #2
  b elp_fa_set
elp_fa_rev:
  cmp r3, #0
  bne elp_fa_next
  cmp r1, #3
  beq elp_fa_next
  add r9, r9, #1
  tst r8, #1
  beq elp_fa_next
  mov r1, #3
elp_fa_set:
  bic r2, r2, #7
  orr r2, r2, r1
  strb r2, [r0, #0x5a]
  cmp r4, #8                   ; パーティは読み込み済みの写し (+0x2C) も
  bhs elp_fa_next
  ldr r3, =0x564638
  ldr r3, [r3]
  add r3, r3, #0xb00
  add r3, r3, #0xa8
  add r3, r3, r4, lsl #2
  ldr r3, [r3, #4]
  cmp r3, #0
  strbne r1, [r3, #0x2c]
elp_fa_next:
  add r4, r4, #1
  cmp r4, #0xbc
  blo elp_fa_loop
  strb r6, [r7]
  mov r0, r9
  pop {r4-r10, pc}`;

/** Rows past the game's take the result messages of the battle's group heal from their own w3 / w4. */
const HEALMSG_SOURCE = `; 戦闘の回復の演出 (FUN_0024dff4) は 0x1800 / 0x1802 に決め打ち。追加したアクション (行 ${VANILLA_ACTION_ROWS} 以降) は w3 / w4 のメッセージにする
@0x24E3F0                     ; mov r3, #0x1800 (1 体)
  bl elp_healmsg1
@0x24E360                     ; ldr r3, =0x1802 (何体か、平均)
  bl elp_healmsg2
@cave elp_healmsg1            ; [sp, #0x4C] = アクション、r4 = actionData の表 (+0x10 = 今の行)
  ldr r3, [sp, #0x4c]
  cmp r3, #${VANILLA_ACTION_ROWS}
  ldrhs r3, [r4, #0x10]
  ldrhs r3, [r3, #0x0c]
  movlo r3, #0x1800
  bx lr
@cave elp_healmsg2
  ldr r3, [sp, #0x4c]
  cmp r3, #${VANILLA_ACTION_ROWS}
  ldrhs r3, [r4, #0x10]
  ldrhs r3, [r3, #0x10]
  movlo r3, #0x1800
  orrlo r3, r3, #2
  bx lr
`;

const PACK_MAGIC = 0xc5;
/** elpulse: farewell keeps unit[0..0x41] only and recall rebuilds the look from the seed, so a fixated QR unit came back as someone else. */
const FAREWELL_SOURCE = `; さよならの記録 (elpulse mod/build_code.py): 種から作り直すと違う電波人間になるなら、名前と見た目を記録のニックネームの欄に残す
@0x220A58                     ; FUN_00220868 (さよなら): bl FUN_002d571c
  bl elp_packstore
@0x2D5300                     ; FUN_002d5300 (記録 -> 電波人間) の入口
  b elp_recwrap
@0x290940                     ; FUN_002907c4 (同じ電波人間か): 種のない電波人間は見た目で比べる
  b elp_seedid
@cave elp_packstore           ; r0 = さよならの枠、r1 = 電波人間 (0x78)
  push {r4-r8, lr}
  sub sp, sp, #0x90
  mov r4, r0
  mov r5, r1
  bl FUN_002d571c
  mov r0, r4
  bl FUN_00311748
  movs r6, r0
  beq elp_ps_out
  ldrb r0, [r6, #0x3d]
  cmp r0, #${PACK_MAGIC}
  moveq r0, #0
  strbeq r0, [r6, #0x3d]
  ldrb r0, [r6, #0x3e]
  cmp r0, #0
  bne elp_ps_out
  add r0, sp, #0x10
  mov r1, #0x78
  bl FUN_0033bd94
  add r0, sp, #0x10
  mov r1, r6
  mov r2, #0x42
  bl FUN_0033e138
  ldrb r0, [sp, #0x13]
  cmp r0, #1
  beq elp_ps_alt
  ldrb r1, [sp, #0x45]
  cmp r1, #2
  cmpne r1, #4
  moveq r1, #1
  movne r1, #0
  add r0, sp, #0x10
  bl FUN_0023b810
  b elp_ps_cmp
elp_ps_alt:
  mov r0, #0
  str r0, [sp]
  mov r0, #1
  str r0, [sp, #4]
  add r0, sp, #0x14
  str r0, [sp, #8]
  add r0, sp, #0x10
  mov r1, #0
  ldrb r2, [sp, #0x1a]
  mov r3, #0
  bl FUN_002edcac
elp_ps_cmp:
  add r0, sp, #0x52
  add r1, r5, #0x42
  mov r2, #0
elp_ps_cloop:
  ldrb r3, [r0, r2]
  ldrb r12, [r1, r2]
  cmp r3, r12
  bne elp_ps_diff
  add r2, r2, #1
  cmp r2, #0x28
  blo elp_ps_cloop
  b elp_ps_out
elp_ps_diff:
  ldrh r0, [r6, #0x0c]
  cmp r0, #0
  addne r7, r6, #0x0c
  addeq r7, r5, #0x42
  mov r2, #0
elp_ps_nlen:
  lsl r3, r2, #1
  ldrh r3, [r7, r3]
  cmp r3, #0
  cmpne r3, #2
  beq elp_ps_ncopy
  add r2, r2, #1
  cmp r2, #8
  blo elp_ps_nlen
  b elp_ps_out
elp_ps_ncopy:
  add r8, r6, #0x0c
  mov r0, #0
elp_ps_nc1:
  cmp r0, r2
  bhs elp_ps_nc2
  lsl r1, r0, #1
  ldrh r3, [r7, r1]
  strh r3, [r8, r1]
  add r0, r0, #1
  b elp_ps_nc1
elp_ps_nc2:
  cmp r0, #8
  bhs elp_ps_look
  lsl r1, r0, #1
  mov r3, #0
  strh r3, [r8, r1]
  add r0, r0, #1
  b elp_ps_nc2
elp_ps_look:
  add r0, r6, #0x1c
  add r1, r5, #0x5a
  mov r2, #0x10
  bl FUN_0033e138
  mov r0, #${PACK_MAGIC}
  strb r0, [r6, #0x3d]
elp_ps_out:
  add sp, sp, #0x90
  pop {r4-r8, pc}
@cave elp_seedid              ; FUN_002907c4: r5 = a、r4 = b
  mov r2, #4
elp_si_a:
  ldrb r0, [r5, r2]
  cmp r0, #0xff
  bne elp_si_bchk
  add r2, r2, #1
  cmp r2, #10
  blo elp_si_a
  b 0x2907F8
elp_si_bchk:
  mov r2, #4
elp_si_b:
  ldrb r0, [r4, r2]
  cmp r0, #0xff
  bne elp_si_seed
  add r2, r2, #1
  cmp r2, #10
  blo elp_si_b
  b 0x2907F8
elp_si_seed:
  add r1, r4, #4
  b 0x290944
@cave elp_recwrap             ; FUN_002d5300(電波人間, &枠) のあと、さよならの記録 (置き場 4) なら残したものを戻す
  push {r4-r6, lr}
  mov r4, r0
  mov r5, r1
  bl elp_rec_tramp
  ldr r0, =0x562F90
  ldrb r0, [r0]
  cmp r0, #4
  bne elp_rec_done
  ldr r0, [r5]
  cmp r0, #0
  blt elp_rec_done
  bl FUN_00311748
  movs r6, r0
  beq elp_rec_done
  ldrb r0, [r6, #0x3d]
  cmp r0, #${PACK_MAGIC}
  bne elp_rec_done
  add r0, r4, #0x42
  add r1, r6, #0x0c
  mov r2, #0x10
  bl FUN_0033e138
  add r0, r4, #0x52
  mov r1, #8
  bl FUN_0033bd94
  add r0, r4, #0x5a
  add r1, r6, #0x1c
  mov r2, #0x10
  bl FUN_0033e138
  add r0, r4, #0x0c
  mov r1, #0x20
  bl FUN_0033bd94
  mov r0, #0
  strb r0, [r4, #0x3d]
elp_rec_done:
  pop {r4-r6, pc}
elp_rec_tramp:
  push {r4, r5, r6, r7, r8, sb, sl, fp, lr}
  b 0x2D5304
`;

function teleporterSource(ids: number[]): string {
  return lines([
    `; テレポーター+ (elpulse mod/build_code.py): アイテム ${ids.join('・')} をテレポーターとして使い、ワープホールの記録を書いてから脱出する`,
    '@0x2C6600                     ; FUN_002c65f8 (アイテムを使う): cmp r0, #0x1c',
    '  bl elp_tpcmp',
    '@0x25DE4C                     ; FUN_0025dc4c (フィールドのアイテムの画面): cmp r0, #0x1c',
    '  bl elp_tpcmp',
    '@0x266B14                     ; FUN_00266938 (アイテムの画面): cmp r0, #0x1c',
    '  bl elp_tpcmp',
    '@0x2C66FC                     ; ここで使えるか: cmpne r0, #0',
    '  blne elp_tpok',
    '@0x2C6764                     ; 脱出のイベントを積む直前: mov r1, #0x1300000',
    '  bl elp_tprec',
    '@0x353480                     ; FUN_00353480 (脱出のイベント) の入口: push {r4, r5, r6, lr}',
    '  b elp_tpesc',
    '@cave elp_tpcmp               ; Z = テレポーター (0x1C) か テレポーター+',
    '  cmp r0, #0x1c',
    ...isOneOf('r0', ids, 'ne'),
    '  bx lr',
    '@cave elp_tpok                ; r0 = ダンジョンの表の bit1、r5 = アイテム。Z = 使えない',
    '  cmp r0, #0',
    '  bxeq lr',
    ...isOneOf('r5', ids),
    '  bne elp_tpok_ok',
    '  push {r4, lr}',
    '  bl FUN_0030b788             ; 今のダンジョン',
    '  and r0, r0, #0xff',
    '  bl FUN_002f8de0             ; ワープホールの記録の枠 (0〜12) か -1',
    '  pop {r4, lr}',
    '  cmp r0, #13',
    '  movhs r0, #0',
    '  movlo r0, #1',
    'elp_tpok_ok:',
    '  cmp r0, #0',
    '  bx lr',
    '@cave elp_tprec               ; r5 = アイテム。位置は (0, 0, 0) で書き、elp_tpesc で埋める',
    ...isOneOf('r5', ids),
    '  movne r1, #0x1300000',
    '  bxne lr',
    '  push {r4-r7, lr}',
    '  sub sp, sp, #0xc',
    '  ldr r4, =0x564638',
    '  ldr r4, [r4]',
    '  add r4, r4, #0x400',
    '  add r4, r4, #4',
    '  mov r0, r4',
    '  bl FUN_0030b788',
    '  and r6, r0, #0xff',
    '  mov r0, r4',
    '  bl FUN_00319170             ; マップ',
    '  mov r7, r0',
    '  cmp r6, #2                   ; D02 と D03 は記録を 1 つ使う',
    '  moveq r5, #3',
    '  beq elp_tprec_other',
    '  cmp r6, #3',
    '  bne elp_tprec_rec',
    '  mov r5, #2',
    'elp_tprec_other:',
    '  mov r0, r4',
    '  mov r1, r5',
    '  bl FUN_002f2794',
    '  cmp r0, #0',
    '  movne r0, r4',
    '  movne r1, r5',
    '  blne FUN_00430f54',
    'elp_tprec_rec:',
    '  mov r0, r7',
    '  bl FUN_002f1f48',
    '  ldr r0, [r0, #4]             ; 階',
    '  str r0, [sp]',
    '  adr r3, elp_tprec_zero',
    '  mov r0, r4',
    '  mov r1, r6',
    '  mov r2, r7',
    '  bl FUN_00430ec4             ; ワープホールの記録を書く',
    '  add sp, sp, #0xc',
    '  pop {r4-r7, lr}',
    '  mov r1, #0x1300000',
    '  bx lr',
    'elp_tprec_zero:',
    '  .word 0',
    '  .word 0',
    '  .word 0',
    '@cave elp_tpesc               ; 記録が今のマップで (0, 0, 0) なら、先頭の電波人間の位置で書き直す',
    '  push {r0-r8, lr}',
    '  sub sp, sp, #0x10',
    '  ldr r4, =0x564638',
    '  ldr r0, [r4]',
    '  add r0, r0, #0x400',
    '  add r0, r0, #4',
    '  bl FUN_0030b788',
    '  and r6, r0, #0xff',
    '  mov r0, r6',
    '  bl FUN_002f8de0',
    '  cmp r0, #13',
    '  bhs elp_tpesc_done',
    '  mov r5, r0',
    '  ldr r0, [r4]',
    '  add r0, r0, #0x400',
    '  add r0, r0, #4',
    '  mov r1, r6',
    '  bl FUN_002f2794',
    '  cmp r0, #0',
    '  beq elp_tpesc_done',
    '  ldr r0, [r4]',
    '  add r0, r0, #0x400',
    '  add r0, r0, #4',
    '  bl FUN_00319170',
    '  mov r7, r0',
    '  ldr r0, [r4]',
    '  mov r1, #0x61',
    '  mov r2, r5',
    '  mov r3, sp',
    '  bl FUN_00304adc             ; 記録のマップ',
    '  ldr r0, [sp]',
    '  cmp r0, r7',
    '  bne elp_tpesc_done',
    '  ldr r0, [r4]',
    '  mov r1, #0x62',
    '  mov r2, r5',
    '  mov r3, sp',
    '  bl FUN_00304adc             ; 記録の位置',
    '  ldm sp, {r0-r2}',
    '  orr r0, r0, r1',
    '  orrs r0, r0, r2',
    '  bne elp_tpesc_done',
    '  ldr r0, [r4]',
    '  add r0, r0, #0x400',
    '  add r0, r0, #4',
    '  mov r1, r6',
    '  bl FUN_0044d584             ; 記録の階',
    '  str r0, [sp]',
    '  mov r0, #0',
    '  bl FUN_00303db0             ; 先頭',
    '  ldr r0, [r0, #0x10]',
    '  add r3, r0, #0x14',
    '  ldr r0, [r4]',
    '  add r0, r0, #0x400',
    '  add r0, r0, #4',
    '  mov r1, r6',
    '  mov r2, r7',
    '  bl FUN_00430ec4',
    'elp_tpesc_done:',
    '  add sp, sp, #0x10',
    '  pop {r0-r8, lr}',
    '  push {r4, r5, r6, lr}',
    '  b 0x353484',
  ]);
}

/** The patches for the given effects (ids: the items of テレポーター+). */
export function modEffectPatchesFor(used: Map<ModEffectKey, number[]>): Map<Group, CodePatch> {
  const out = new Map<Group, CodePatch>();
  const add = (g: Group, source: string): void =>
    void out.set(g, { id: `elp-${g}`, title: MOD_PATCH_TITLES[g], source, enabled: true });
  const types = new Set<number>(
    [...used.keys()]
      .map((k) => ({ 'full-all': 4, fixate: 5, 'fixate-all': 6, 'unfix-all': 7 } as Record<string, number>)[k])
      .filter((t): t is number => t !== undefined),
  );
  if (types.size) add('effects', effectsSource(types));
  if (used.has('ap-all') || used.has('full-all')) add('healmsg', HEALMSG_SOURCE);
  if (types.has(5) || types.has(6) || types.has(7)) add('farewell', FAREWELL_SOURCE);
  const tp = used.get('teleporter-plus');
  if (tp?.length) add('teleporter', teleporterSource([...new Set(tp)].sort((a, b) => a - b)));
  return out;
}

export interface ModEffectPatches {
  patches: CodePatch[];
  /** Patches left out because the base MOD's code.ips already has them (elpulse's mod/out). */
  inBase: string[];
  /** Effects the base MOD's patches may not cover. */
  warnings: string[];
}

/**
 * The patches the export needs for the MOD effects the items use. `code` = code.bin with the base MOD applied: a group
 * the base MOD already hooked (elpulse's code.ips) is left out.
 */
export function modEffectPatches(master: Master, code: Uint8Array): ModEffectPatches {
  const used = usedModEffects(master);
  const want = modEffectPatchesFor(used);
  const patches: CodePatch[] = [],
    inBase: string[] = [],
    warnings: string[] = [];
  for (const [g, p] of want) {
    if (!hooked(code, g)) {
      patches.push(p);
      continue;
    }
    inBase.push(p.title);
    // elpulse's code.ips knows テレポーター+ as item 178 only, and types 6 / 7 only when built with --debug
    const tp = (used.get('teleporter-plus') ?? []).filter((id) => id !== 178);
    if (g === 'teleporter' && tp.length)
      warnings.push(
        `土台の MOD の テレポーター+ はアイテム 178 だけです。アイテム ${tp.join('・')} はテレポーター+ として動きません`,
      );
    const dbg = MOD_EFFECTS.filter((e) => e.debug && used.has(e.key));
    if (g === 'effects' && dbg.length)
      warnings.push(`土台の MOD が --debug で作られていないと「${dbg.map((e) => e.label).join('」「')}」は動きません`);
  }
  return { patches, inBase, warnings };
}
