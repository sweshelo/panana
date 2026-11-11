import { findEntry, parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { sha256 } from './codes';
import { encodeLanaiMessage, parseLanaiText } from './message';
import { hex8, w32, equalBytes } from '../util/bytes';
import { CRO_COMMON_HOOKS, croHooks, lanaiContents, type LanaiContent, type LanaiStage } from './contents';
import { lanaiMaps } from './maps';
import type { LanaiSession } from './session';
import type { LanaiCondition } from './conditions';

/** Corresponding local MapStage row, matched by message ID; integration has 12 inserted bytes at +0x34. */
async function localStage(s: LanaiSession, c: LanaiContent, stage: LanaiStage) {
  const t = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')?.table;
  if (!t) throw new Error('MapStage がありません');
  const rows = Array.from({ length: t.rows }, (_, r) => r).filter((r) => t.u32(r, 0xc) === stage.messageId);
  if (rows.length !== 1) throw new Error('対応する MapStage を一意に特定できません');
  return { t, r: rows[0]! };
}
export async function editLanaiStage(
  s: LanaiSession,
  c: LanaiContent,
  stage: LanaiStage,
  values: { order: number; stamina: number; visible: LanaiCondition; hidden: LanaiCondition },
): Promise<void> {
  const { order, stamina, visible, hidden } = values;
  if (
    !Number.isInteger(order) ||
    order < 0 ||
    order > 0xffffffff ||
    !Number.isInteger(stamina) ||
    stamina < 0 ||
    stamina > 255
  )
    throw new Error('順序は u32、スタミナは 0〜255 で指定してください');
  if (
    [visible, hidden].some(
      (c) =>
        ![c.kind, c.v1, c.v2].every(Number.isInteger) ||
        c.kind < 0 ||
        c.kind > 255 ||
        c.v1 < 0 ||
        c.v1 > 0xffffffff ||
        c.v2 < 0 ||
        c.v2 > 0xffffffff,
    )
  )
    throw new Error('条件の値が範囲外です');
  const { t, r } = await localStage(s, c, stage);
  const m = s.need('MapStageIntegration');
  for (const [table, row, staminaOffset] of [
    [m, stage.row, 0x49],
    [t, r, 0x3d],
  ] as const) {
    table.setU32(row, 0, order);
    table.setBits(row, staminaOffset & ~3, (staminaOffset & 3) * 8, 8, stamina);
    for (const [c, offset] of [
      [visible, 0x1c],
      [hidden, 0x28],
    ] as const) {
      table.setU32(row, offset, c.v1);
      table.setU32(row, offset + 4, c.v2);
      table.setBits(row, offset + 8, 0, 8, c.kind);
    }
  }
  s.edited();
}
/**
 * The content whose CRO has no event of its own (only the hooks every CRO has, contents.md §4.3): 「あみだクジ（仮）」, an
 * unused stage. Its CRO and Update CRR are used as they are for a content made without the source's events.
 */
export const LANAI_EMPTY_SCRIPT_CONTENT = 99;

const crrName = (n: number): string => `.crr/contents${String(n).padStart(4, '0')}.crr`;

/** The CRO of a content's archive (ContentsDef row 2) and the Update CRR registering it. */
async function contentScript(
  s: LanaiSession,
  c: LanaiContent,
  arc: Archive,
): Promise<{ entry: number; body: Uint8Array; crr: Uint8Array }> {
  const def = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')?.table;
  if (!def || def.rows < 3) throw new Error(`コンテンツ ${c.index} に ContentsDef がありません`);
  const e = findEntry(arc, def.u32(2, 0));
  if (!e) throw new Error(`コンテンツ ${c.index} の ContentsDef の CRO がありません`);
  const crr =
    s.createdFiles.get(crrName(c.index)) ??
    (await (s.dump.readUpdateRomfs?.(crrName(c.index)) ?? s.dump.readRomfs(crrName(c.index))));
  return { entry: e.index, body: unpackEntry(arc, e).body, crr };
}

/** Whether the CRR holds the SHA-256 of the CRO's first 0x80 bytes (what nn::ro checks before the signature). */
function crrRegisters(crr: Uint8Array, cro: Uint8Array): boolean {
  const digest = sha256(cro.subarray(0, 0x80));
  for (let offset = 0; offset + digest.length <= crr.length; offset++)
    if (equalBytes(crr.subarray(offset, offset + digest.length), digest)) return true;
  return false;
}

export interface LanaiCloneOptions {
  /**
   * 'copy' keeps the source's CRO (its opening event, NPCs, doors … and the flags they read and set, shared with the
   * source). 'empty' puts content 99's CRO, which has no events: maps, treasure, exits and the clear actions of the
   * tables still work, the events written in the CRO do not.
   */
  script?: 'copy' | 'empty';
}

/** A content starts as an editable copy of the source, including its original native CRO. No script decompilation. */
export async function cloneLanaiContent(
  s: LanaiSession,
  source: LanaiContent,
  title: string,
  options: LanaiCloneOptions = {},
): Promise<number> {
  if (!s.canExport) throw new Error('新しいコンテンツの追加には Update が必要です');
  if (!title.trim()) throw new Error('ステージ名を入力してください');
  const encodedTitle = encodeLanaiMessage(parseLanaiText(title.trim()));
  if (source.index === 0 || source.stages.length !== 1)
    throw new Error('ステージの行が 1 つあるコンテンツを選んでください');
  await s.tablesIn(source.archive);
  const local = await localStage(s, source, source.stages[0]!);
  const contents = s.need('Contents'),
    integration = s.need('MapStageIntegration'),
    messages = s.need('MessageMapStage');
  const srcStage = source.stages[0]!;
  const msg = messages.find(srcStage.messageId);
  if (msg < 0) throw new Error('ステージのメッセージがありません');
  const nameOffset = messages.fields.find((f) => f.name === 'stage_name')?.offset;
  if (nameOffset === undefined) throw new Error('ステージ名の欄がありません');
  const index = contents.rows;
  const stageSlot = Math.max(...Array.from({ length: integration.rows }, (_, r) => integration.u16(r, 0x40))) + 1;
  if (stageSlot > 0xffff) throw new Error('ステージ番号が u16 を超えます');
  if (index > 0xffff) throw new Error('コンテンツ番号が u16 を超えます');
  // Capture all edits to the source before copying; subsequent edits belong to the copy.
  const bytes = s.modFiles().get(source.archive) ?? (await s.archive(source.archive)).data;
  const used = new Set([...s.dump.names(), ...s.createdFiles.keys()].map((n) => n.toUpperCase()));
  let hash = 0xf0000000;
  while (used.has(hex8(hash))) hash += 0x10000;
  const archive = hex8(hash);
  if (
    s.createdFiles.has(crrName(index)) ||
    s.dump.files?.().some((f) => f.path.toUpperCase() === crrName(index).toUpperCase())
  )
    throw new Error('追加先の CRR が既にあります');
  const arc = parseArchive(bytes);
  const own = await contentScript(s, source, arc);
  let cro = own.body,
    crr = own.crr,
    newArchive: Uint8Array = bytes.slice();
  if (options.script === 'empty') {
    const template = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT];
    if (!template) throw new Error(`空のスクリプトのひな形 (コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT}) がありません`);
    const empty = await contentScript(s, template, await s.archive(template.archive));
    const extra = croHooks(empty.body).filter((h) => !(CRO_COMMON_HOOKS as readonly number[]).includes(h));
    if (extra.length)
      throw new Error(`コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT} の CRO にイベントがあります (${extra.join(', ')})`);
    ({ body: cro, crr } = empty);
    newArchive = rebuildArchive(arc, new Map([[own.entry, cro]]));
  }
  // The CRO stays byte-for-byte identical to a ROM one, so its registration hash is reused under the new CRR path.
  if (!crrRegisters(crr, cro)) throw new Error('CRO と CRR の登録ハッシュが一致しません');
  w32(newArchive, 4, hash);
  s.addFile(archive, newArchive);
  s.addFile(crrName(index), crr);
  const copied = await s.tablesIn(archive);
  const copiedDef = copied.find((t) => t.table.name === 'ContentsDef')!.table;
  copiedDef.setU32(0, 0, index);
  copiedDef.setU32(1, 0, index);
  const messageRow = messages.addRow(msg),
    messageId = messages.rowId(messageRow);
  messages.setString(messageRow, nameOffset, encodedTitle);
  const row = integration.addRow(srcStage.row);
  integration.setU32(row, 0xc, messageId);
  integration.setU32(row, 0x34, index);
  integration.setU32(row, 0x38, hash);
  integration.setBits(row, 0x44, 0, 16, index);
  integration.setBits(row, 0x40, 0, 16, stageSlot);
  const copyStage = copied.find((t) => t.table.name === 'MapStage')!.table;
  copyStage.setU32(local.r, 0xc, messageId);
  copyStage.setBits(local.r, 0x38, 0, 16, index);
  copyStage.setBits(local.r, 0x34, 0, 16, stageSlot);
  // Known data-driven clear actions and self-clear predicates follow the new content. Native code is preserved.
  for (const { table: t } of copied.filter((t) => t.table.name.endsWith('_EventObject')))
    for (let r = 0; r < t.rows; r++) {
      for (const offset of [0x10, 0x28, 0x40]) {
        const type = t.u32(r, offset);
        const argOffset = type === 0x8000002e ? offset + 8 : type === 0x80000031 ? offset + 4 : -1;
        if (argOffset >= 0 && t.u32(r, argOffset) === source.index) t.setU32(r, argOffset, index);
      }
      for (const [kind, arg] of [
        [0x5f, 0],
        [0x60, 8],
      ])
        if ([1, 2].includes(t.u8(r, kind!)) && t.u32(r, arg!) === source.index) t.setU32(r, arg!, index);
    }
  const cr = contents.addRow(source.index);
  contents.setU32(cr, 0, hash);
  s.edited();
  return index;
}

/**
 * Where a stage starts (contents.md §3.3): the MapGroup MapStage +0x3A names (MapStageIntegration +0x46; the stage
 * select puts it in the save's current group 0x29, FUN_002E7814) and that group's first map and arrival point (MapGroup
 * +0x14 / +0x18, a section 3 record's point ID). All 126 stages of the ROM start at a map of their own map table.
 */
export interface LanaiStageStart {
  group: number;
  map: number;
  point: number;
}

export async function lanaiStageStart(s: LanaiSession, c: LanaiContent, stage: LanaiStage): Promise<LanaiStageStart> {
  const maps = await lanaiMaps(s, c);
  const group = s.need('MapStageIntegration').u16(stage.row, 0x46);
  const g = maps.mapGroup;
  if (!g || group < 1 || group >= g.rows) return { group, map: 0, point: 0 };
  return { group, map: g.u32(group, 0x14), point: g.u32(group, 0x18) };
}

/** Starts the stage at a map of its content and an arrival point of that map (the map's MapGroup becomes the start). */
export async function setLanaiStageStart(
  s: LanaiSession,
  c: LanaiContent,
  stage: LanaiStage,
  map: number,
  point: number,
): Promise<void> {
  const maps = await lanaiMaps(s, c);
  const info = maps.map(map);
  if (!info) throw new Error(`マップ ${hex8(map)} はこのステージのマップ表にありません`);
  const g = maps.mapGroup;
  const group = info.dungeon;
  if (!g || group < 1 || group >= g.rows) throw new Error(`マップ ${info.name} の MapGroup ${group} がありません`);
  if (group > 0xffff) throw new Error('MapGroup の番号が u16 を超えます');
  const { t, r } = await localStage(s, c, stage);
  s.need('MapStageIntegration').setBits(stage.row, 0x44, 16, 16, group);
  t.setBits(r, 0x38, 16, 16, group);
  g.setU32(group, 0x14, map);
  g.setU32(group, 0x18, point);
  maps.readGroups();
  maps.changed();
  s.edited();
}
