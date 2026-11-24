import { findEntry, parseArchive, rebuildArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { sha256 } from './codes';
import { encodeLanaiMessage, parseLanaiText } from './message';
import { hex8, u32, w32, equalBytes } from '../util/bytes';
import { readSarc } from '../layout/sarc';
import { readBflim, replaceBflimImage } from '../layout/bflim';
import { CRO_COMMON_HOOKS, croHooks, lanaiContents, type LanaiContent, type LanaiStage } from './contents';
import { lanaiMaps } from './maps';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';
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
  values: {
    order: number;
    stamina: number;
    recommendedLevel?: number;
    thumbnail?: { archive: string; hash: number } | Uint8Array;
    visible: LanaiCondition;
    hidden: LanaiCondition;
  },
): Promise<void> {
  const { order, stamina, visible, hidden } = values;
  const recommendedLevel = values.recommendedLevel ?? stage.recommendedLevel;
  if (!Number.isInteger(recommendedLevel) || recommendedLevel < 0 || recommendedLevel > 0xffff)
    throw new Error('推奨レベルは 0〜65535 で指定してください');
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
  if (values.thumbnail) {
    const body =
      values.thumbnail instanceof Uint8Array
        ? values.thumbnail
        : await s.readLayout(values.thumbnail.archive, values.thumbnail.hash);
    // Keep the destination's entry hash and layout name; its tables/maps remain independent of the source.
    await s.setLayout(c.archive, stage.thumbnail, body);
  }
  for (const [table, row, staminaOffset] of [
    [m, stage.row, 0x49],
    [t, r, 0x3d],
  ] as const) {
    table.setU32(row, 0, order);
    table.setBits(row, staminaOffset === 0x49 ? 0x40 : 0x34, 16, 16, recommendedLevel);
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

export const lanaiCrrName = (n: number): string => `.crr/contents${String(n).padStart(4, '0')}.crr`;

/** The CRO of a content's archive (ContentsDef row 2) and the Update CRR registering it. */
export async function contentScript(
  s: LanaiSession,
  c: LanaiContent,
  arc: Archive,
): Promise<{ entry: number; body: Uint8Array; crr: Uint8Array }> {
  const def = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')?.table;
  if (!def || def.rows < 3) throw new Error(`コンテンツ ${c.index} に ContentsDef がありません`);
  const e = findEntry(arc, def.u32(2, 0));
  if (!e) throw new Error(`コンテンツ ${c.index} の ContentsDef の CRO がありません`);
  const crr =
    s.createdFiles.get(lanaiCrrName(c.index)) ??
    (await (s.dump.readUpdateRomfs?.(lanaiCrrName(c.index)) ?? s.dump.readRomfs(lanaiCrrName(c.index))));
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
  /**
   * With 'empty': give the start group the game's opening (an `intro` event: the party walks in through the start's
   * gate, the stage's name, the gate closes; stage-intro.md). On unless false.
   */
  intro?: boolean;
  /** Clear the source stage's presentation and entrance requirements for a stage made from the empty template. */
  resetStage?: boolean;
}

async function resetNewStage(
  s: LanaiSession,
  archive: string,
  stageRow: number,
  localRow: number,
  thumbnail: number,
  messageRow: number,
): Promise<void> {
  const messages = s.need('MessageMapStage');
  const blank = encodeLanaiMessage(parseLanaiText(''));
  for (const name of ['stage_mission', 'stage_exp']) {
    const offset = messages.fields.find((f) => f.name === name)?.offset;
    if (offset === undefined) throw new Error(`${name} の欄がありません`);
    messages.setString(messageRow, offset, blank);
  }
  const integration = s.need('MapStageIntegration');
  const local = (await s.tablesIn(archive)).find((t) => t.table.name === 'MapStage')?.table;
  if (!local) throw new Error('MapStage がありません');
  for (const [table, row, levelOffset, staminaOffset] of [
    [integration, stageRow, 0x40, 0x49],
    [local, localRow, 0x34, 0x3d],
  ] as const) {
    table.setBits(row, levelOffset, 16, 16, 0);
    table.setBits(row, staminaOffset & ~3, (staminaOffset & 3) * 8, 8, 0);
    for (const offset of [0x1c, 0x28]) {
      table.setU32(row, offset, 0);
      table.setU32(row, offset + 4, 0);
      table.setBits(row, offset + 8, 0, 8, 0);
    }
  }
  const body = (await s.readLayout(archive, thumbnail)).slice();
  const texture = [...readSarc(body)].find(([name]) => /^timg\/.*\.bflim$/i.test(name))?.[1];
  if (!texture) throw new Error('サムネイル画像がありません');
  const image = readBflim(texture);
  const pixels = new Uint8Array(image.width * image.height * 4);
  body.set(replaceBflimImage(texture, pixels), texture.byteOffset - body.byteOffset);
  await s.setLayout(archive, thumbnail, body);
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
    s.createdFiles.has(lanaiCrrName(index)) ||
    s.dump.files?.().some((f) => f.path.toUpperCase() === lanaiCrrName(index).toUpperCase())
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
  s.addFile(lanaiCrrName(index), crr);
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
  if (options.resetStage) await resetNewStage(s, archive, row, local.r, srcStage.thumbnail, messageRow);
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
  // the game's opening on the start group (an event script with `on intro(group) {}`), as the shipped stages have
  const group = integration.u16(row, 0x46);
  if (options.script === 'empty' && options.intro !== false && group > 0)
    s.setStageScriptDoc(archive, { vars: [], functions: [], bindings: [{ trigger: 'intro', group, row: 0, fn: '' }] });
  s.edited();
  return index;
}

/**
 * Why an added content cannot be removed, or null when it can. Rows can only be taken off the end of a table, so the
 * content must be the last of Contents and its stage rows the last of MapStageIntegration (the last added stage: the
 * stages are removed newest first).
 */
export function lanaiContentRemoveBlock(s: LanaiSession, c: LanaiContent): string | null {
  const contents = s.need('Contents'),
    integration = s.need('MapStageIntegration');
  if (c.index < contents.originalRows || !s.createdFiles.has(c.archive)) return '元からあるステージは削除できません';
  if (c.index !== contents.rows - 1) return '最後に追加したステージから順に削除できます';
  const rows = c.stages.map((st) => st.row).sort((a, b) => a - b);
  if (rows.some((r, i) => r !== integration.rows - rows.length + i || r < integration.originalRows))
    return 'ステージの行が MapStageIntegration の最後にないので削除できません';
  return null;
}

/**
 * Remove an added content (the undo of cloneLanaiContent): its stage rows (and their name rows of MessageMapStage when
 * they are the last and no other stage uses them), its Contents row, its archive and CRR, and its event script.
 */
/** Whether row `r` of a table differs from what was read (its bytes or a string written into it). */
const rowEdited = (t: LanaiTable, r: number): boolean =>
  t.rowChanged(r) || t.changedStrings().some(([row]) => row === r);

/**
 * The contents with edits: their archive (tables, maps, stage images: LanaiSession.changedArchives), their stages'
 * MapStageIntegration rows (by the content they were read with and the one they name now) and those rows' names
 * (MessageMapStage).
 */
export function lanaiChangedContents(s: LanaiSession, contents: LanaiContent[]): Set<number> {
  const out = new Set<number>();
  const archives = s.changedArchives();
  for (const c of contents) if (archives.has(c.archive.toUpperCase())) out.add(c.index);
  const msi = s.need('MapStageIntegration');
  for (const r of msi.changedRows()) {
    out.add(msi.u32(r, 0x34));
    const was = msi.originalRow(r);
    if (was) out.add(u32(was, 0x34));
  }
  const msg = s.need('MessageMapStage');
  const names = new Set([...msg.changedRows(), ...msg.changedStrings().map(([r]) => r)].map((r) => msg.rowId(r)));
  if (names.size) for (let r = 0; r < msi.rows; r++) if (names.has(msi.u32(r, 0x0c))) out.add(msi.u32(r, 0x34));
  return out;
}

/**
 * Puts a content of the ROM back as it was read: its archive (LanaiSession.revertArchive), its stages' rows of
 * MapStageIntegration (those read with this content) and their MessageMapStage rows. Rows other edits added (a stage
 * of an added content) stay. Not for an added content: removeLanaiContent takes it out.
 */
export function revertLanaiContent(s: LanaiSession, c: LanaiContent): void {
  const archive = c.archive.toUpperCase();
  if (s.createdFiles.has(archive)) throw new Error('追加したステージは元に戻せません (削除してください)');
  s.revertArchive(archive);
  const msi = s.need('MapStageIntegration');
  const msg = s.need('MessageMapStage');
  for (let r = 0; r < msi.rows; r++) {
    const was = msi.originalRow(r);
    if (!was || u32(was, 0x34) !== c.index) continue;
    if (rowEdited(msi, r)) msi.revertRow(r);
    const m = msg.find(u32(was, 0x0c));
    if (m >= 0 && msg.originalRow(m) && rowEdited(msg, m)) msg.revertRow(m);
  }
  s.edited();
}

export function removeLanaiContent(s: LanaiSession, c: LanaiContent): void {
  const block = lanaiContentRemoveBlock(s, c);
  if (block) throw new Error(block);
  const contents = s.need('Contents'),
    integration = s.need('MapStageIntegration'),
    messages = s.need('MessageMapStage');
  const names = c.stages.map((st) => st.messageId);
  for (let k = 0; k < c.stages.length; k++) integration.removeLastRow();
  const used = new Set(Array.from({ length: integration.rows }, (_, r) => integration.u32(r, 0xc)));
  for (const id of [...names].reverse()) {
    const m = messages.find(id);
    if (m === messages.rows - 1 && m >= messages.originalRows && !used.has(id)) messages.removeLastRow();
  }
  contents.removeLastRow();
  s.removeFile(c.archive);
  if (s.createdFiles.has(lanaiCrrName(c.index))) s.removeFile(lanaiCrrName(c.index));
  s.edited();
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
