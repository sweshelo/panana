// Importing a custom-stage distribution zip (LanaiSession.distributionZip) into the session being edited: the stages it
// adds come in as new contents of this session, numbered after the ones it has (the zip was made by another session,
// which numbered its stages the same way: content = Contents rows, archive F0000000, slot = max + 1, IDs appended).
//
// What is renumbered (cloneLanaiContent's rules, lanai-custom-stages web/renumber.ts):
//   - content number: Contents row, ContentsDef rows 0 / 1, MapStage +0x38, MapStageIntegration +0x34 / +0x44, the CRR
//     path, the EventObject tables' content references
//   - archive name: the file, the archive header +0x04, Contents +0x00, MapStageIntegration +0x38
//   - stage slot: MapStage +0x34, MapStageIntegration +0x40
//   - the stage's MessageMapStage row: its ID in MapStageIntegration +0x0C and MapStage +0x0C
//   - the other added master rows (MessageMapName, ItemData, ItemDataCore): their IDs / rows, and where they are named:
//     MapGroup +0x00 (a dungeon's name), the item of a chest (TreasureGroup) or a shop (ShopItem +0x00), ItemData +0x0C
//     (its ItemDataCore row), the insert tags of the strings, and the hexadecimal numbers of the event scripts
// A compiled CRO (a release zip carries no script) cannot be renumbered: an item ID in it is told as a warning.
// The changes to the ROM's rows are written as they are; a row this session changed too is skipped unless asked.
import { unzipSync } from 'fflate';
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { LANAI } from '../rom/titles';
import { equalBytes, hex8, u16, u32, w32 } from '../util/bytes';
import { scriptDocIsEmpty, type ScriptDoc } from './eventScript';
import { encodeLanaiMessage, lanaiMessageBytes, lanaiText, parseLanaiMessage } from './message';
import { LANAI_TREASURE_TABLE } from './maps';
import { archiveTables, LANAI_DELIVERABLE_TABLES, type LanaiSession } from './session';
import { LANAI_SHOP_ITEM_TABLE } from './shops';
import { lanaiCrrName, retargetContentTables } from './stageEdit';
import { LANAI_STAGE_MANIFEST, LANAI_STAGE_SOURCE, type LanaiStageSource, type OwnedRange } from './stageScript';
import type { LanaiTable } from './table';
import { LANAI_TREASURE_SLOTS } from './treasure';

/** A stage the zip adds (a content not in the ROM). */
export interface LanaiImportStage {
  /** Its number in the zip. */
  content: number;
  archive: string;
  names: string[];
  /** 'source': the script as edited comes in; 'compiled': only the built CRO (a release zip); 'none': no script. */
  script: 'source' | 'compiled' | 'none';
}

/** A row of the ROM the zip changed. */
export interface LanaiImportEdit {
  /** `table/row`: names it in LanaiImportOptions.overwrite. */
  key: string;
  table: string;
  row: number;
  /** This session changed the row too (to something else): skipped unless overwritten. */
  conflict: boolean;
}

export interface LanaiImport {
  stages: LanaiImportStage[];
  edits: LanaiImportEdit[];
  /** The other rows the zip adds to the master (a dungeon's name, items …): table and how many. */
  extras: { table: string; rows: number }[];
  /** What is not taken in. */
  notes: string[];
  /** @internal what apply reads */
  data: ImportData;
}

interface ImportData {
  romfs: Map<string, Uint8Array>;
  zip: Map<string, LanaiTable>;
  rom: Map<string, LanaiTable>;
  /** Added rows of the master that come in, by table: the rows (in the zip) of the stages and the extras. */
  own: { msi: number[]; messages: number[] };
  extraRows: Map<string, number[]>;
  manifest: Record<string, { stageKey?: string; owned?: OwnedRange[] }>;
  sources: Record<string, LanaiStageSource>;
}

export interface LanaiImportOptions {
  /** Keys (LanaiImportEdit.key) of the conflicting rows to overwrite; the others are skipped. */
  overwrite?: ReadonlySet<string>;
}

export interface LanaiImportResult {
  /** The new content numbers, in the order of LanaiImport.stages. */
  contents: number[];
  warnings: string[];
}

/** The tables the stages' own rows are in: their added rows that are not a stage's are not taken in. */
const OWN_TABLES = ['Contents', 'MapStageIntegration', 'MessageMapStage'];

const firstByName = (tables: { table: LanaiTable }[]): Map<string, LanaiTable> => {
  const out = new Map<string, LanaiTable>();
  for (const { table } of tables) if (!out.has(table.name)) out.set(table.name, table);
  return out;
};

const stringOffsetsOf = (t: LanaiTable, r: number): number[] =>
  Array.from({ length: t.rowSize >> 2 }, (_, k) => k * 4).filter((o) => t.isString(r, o));

/** Whether row `ar` of `a` and row `br` of `b` hold the same: the bytes apart from the strings, and the strings. */
function sameRow(a: LanaiTable, ar: number, b: LanaiTable, br: number): boolean {
  const x = a.row(ar),
    y = b.row(br);
  const sa = stringOffsetsOf(a, ar),
    sb = stringOffsetsOf(b, br);
  if (sa.join() !== sb.join()) return false;
  for (let o = 0; o < a.rowSize; o += 4) {
    if (sa.includes(o)) {
      if (!equalBytes(lanaiMessageBytes(a.data, u32(x, o)), lanaiMessageBytes(b.data, u32(y, o)))) return false;
    } else if (!equalBytes(x.subarray(o, Math.min(o + 4, x.length)), y.subarray(o, Math.min(o + 4, y.length))))
      return false;
  }
  return true;
}

const text = (t: LanaiTable, r: number, name: string): string => {
  const o = t.named(r, name);
  return o < 0 ? '' : lanaiText(parseLanaiMessage(t.data, o).tokens).trim();
};

const json = (b: Uint8Array, name: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(b));
  } catch {
    throw new Error(`${name} が JSON として読めません`);
  }
};

/** Reads a distribution zip: what it would bring into the session. Throws when it is not one. */
export async function readLanaiImport(s: LanaiSession, bytes: Uint8Array): Promise<LanaiImport> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('zip として読めません');
  }
  const prefix = `${LANAI.titleId}/`.toUpperCase();
  const romfs = new Map<string, Uint8Array>();
  const notes: string[] = [];
  let manifest: ImportData['manifest'] = {};
  let sources: ImportData['sources'] = {};
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith('/')) continue;
    if (!path.toUpperCase().startsWith(prefix)) {
      notes.push(`${LANAI.titleId} の外のファイル ${path} は取り込みません`);
      continue;
    }
    const rel = path.slice(prefix.length);
    if (rel.startsWith('romfs/')) romfs.set(rel.slice(6).toUpperCase(), data);
    else if (rel === LANAI_STAGE_MANIFEST)
      manifest = ((json(data, rel) as { stages?: ImportData['manifest'] }).stages ?? {}) as ImportData['manifest'];
    else if (rel === LANAI_STAGE_SOURCE)
      sources = ((json(data, rel) as { stages?: ImportData['sources'] }).stages ?? {}) as ImportData['sources'];
    else if (rel === 'exefs/code.ips') notes.push('exefs/code.ips (コードの MOD・条件スクリプト) は取り込みません');
    else notes.push(`${rel} は取り込みません`);
  }
  const master = romfs.get(LANAI.master);
  if (!master)
    throw new Error(
      `zip に master (romfs/${LANAI.master}) がありません。カスタムステージ配信用の zip を選んでください`,
    );
  const zip = firstByName(archiveTables(LANAI.master, parseArchive(master)));
  const rom = firstByName(archiveTables(LANAI.master, parseArchive(await s.raw.readRomfs(LANAI.master))));
  for (const [name, z] of zip) {
    if (LANAI_DELIVERABLE_TABLES.includes(name)) continue;
    const r = rom.get(name);
    if (!r || !equalBytes(z.data, r.data)) notes.push(`master の ${name} の変更は取り込みません (配信の対象外の表)`);
  }
  const need = (m: Map<string, LanaiTable>, name: string): LanaiTable => {
    const t = m.get(name);
    if (!t) throw new Error(`master に ${name} がありません`);
    return t;
  };
  const [zc, rc] = [need(zip, 'Contents'), need(rom, 'Contents')];
  const [zi, ri] = [need(zip, 'MapStageIntegration'), need(rom, 'MapStageIntegration')];
  const [zm, rm] = [need(zip, 'MessageMapStage'), need(rom, 'MessageMapStage')];

  const stages: LanaiImportStage[] = [];
  const msi: number[] = [];
  const messages: number[] = [];
  const archives = new Set<string>();
  for (let c = rc.rows; c < zc.rows; c++) {
    const archive = hex8(zc.u32(c, 0));
    if (!romfs.has(archive)) throw new Error(`コンテンツ ${c} のアーカイブ ${archive} が zip にありません`);
    if (!romfs.has(lanaiCrrName(c).toUpperCase()))
      throw new Error(`コンテンツ ${c} の CRR (${lanaiCrrName(c)}) が zip にありません`);
    archives.add(archive);
    const names: string[] = [];
    for (let r = ri.rows; r < zi.rows; r++) {
      if (zi.u32(r, 0x34) !== c) continue;
      msi.push(r);
      const m = zm.find(zi.u32(r, 0x0c));
      if (m >= rm.rows && !messages.includes(m)) messages.push(m);
      if (m >= 0) names.push(text(zm, m, 'stage_name'));
    }
    const source = sources[String(c)];
    stages.push({
      content: c,
      archive,
      names,
      script: source?.doc && !scriptDocIsEmpty(source.doc) ? 'source' : manifest[String(c)] ? 'compiled' : 'none',
    });
  }
  if (!stages.length) throw new Error('zip に追加したステージがありません');
  for (let r = ri.rows; r < zi.rows; r++)
    if (!msi.includes(r))
      notes.push(
        `既存のコンテンツ ${zi.u32(r, 0x34)} に足したステージの行 (MapStageIntegration ${r}) は取り込みません`,
      );
  for (let r = rm.rows; r < zm.rows; r++)
    if (!messages.includes(r)) notes.push(`どのステージのものでもない MessageMapStage の行 ${r} は取り込みません`);
  for (const name of romfs.keys()) {
    if (name === LANAI.master || archives.has(name) || name === 'PATCHLIST.BIN') continue;
    if (stages.some((x) => lanaiCrrName(x.content).toUpperCase() === name)) continue;
    notes.push(`romfs/${name} (既存のファイルの変更) は取り込みません`);
  }

  const extraRows = new Map<string, number[]>();
  const edits: LanaiImportEdit[] = [];
  for (const name of LANAI_DELIVERABLE_TABLES) {
    const z = zip.get(name),
      r = rom.get(name),
      cur = s.table(name);
    if (!z || !r || !cur) continue;
    if (!OWN_TABLES.includes(name) && z.rows > r.rows)
      extraRows.set(
        name,
        Array.from({ length: z.rows - r.rows }, (_, k) => r.rows + k),
      );
    for (let i = 0; i < Math.min(r.rows, z.rows); i++) {
      if (sameRow(z, i, r, i) || sameRow(z, i, cur, i)) continue;
      edits.push({ key: `${name}/${i}`, table: name, row: i, conflict: !sameRow(cur, i, r, i) });
    }
  }
  return {
    stages,
    edits,
    extras: [...extraRows].map(([table, rows]) => ({ table, rows: rows.length })),
    notes,
    data: { romfs, zip, rom, own: { msi, messages }, extraRows, manifest, sources },
  };
}

/** Renumbering of one import: old → new, by table. */
interface Renumber {
  /** Row IDs of the added rows. */
  ids: Map<string, Map<number, number>>;
  /** Row numbers of the added rows. */
  rows: Map<string, Map<number, number>>;
}

const mapped = (m: Map<number, number> | undefined, v: number): number => m?.get(v) ?? v;

/** A string of the zip with its insert tags pointed at the renumbered rows. */
function stringOf(z: LanaiTable, offset: number, ren: Renumber): Uint8Array {
  const bytes = lanaiMessageBytes(z.data, offset);
  const { tokens } = parseLanaiMessage(z.data, offset);
  let changed = false;
  for (const t of tokens)
    if (t.t === 'ins') {
      const id = ren.ids.get(t.table)?.get(t.id);
      if (id !== undefined && id !== t.id) {
        t.id = id;
        changed = true;
      }
    }
  return changed ? encodeLanaiMessage(tokens) : bytes.slice();
}

/** The row of `t` the new row is a copy of: one whose string fields are where the zip's row has them. */
function likeRow(t: LanaiTable, z: LanaiTable, zr: number): number {
  const want = stringOffsetsOf(z, zr).join();
  for (let r = 0; r < Math.min(t.rows, t.originalRows); r++) if (stringOffsetsOf(t, r).join() === want) return r;
  return 0;
}

/** Writes row `zr` of the zip's table into row `r` of the session's (the strings through setString). */
function writeRow(t: LanaiTable, r: number, z: LanaiTable, zr: number, ren: Renumber): void {
  const bytes = z.row(zr).slice();
  const strings = stringOffsetsOf(z, zr);
  const cur = t.row(r);
  for (const o of stringOffsetsOf(t, r)) bytes.set(cur.subarray(o, o + 4), o);
  if (t.name === 'ItemData') {
    // +0x0C: the ItemDataCore row (u16)
    const core = u16(bytes, 0x0c);
    const now = mapped(ren.rows.get('ItemDataCore'), core);
    bytes[0x0c] = now & 0xff;
    bytes[0x0d] = now >> 8;
  }
  t.setRow(r, bytes);
  for (const o of strings) if (t.isString(r, o)) t.setString(r, o, stringOf(z, z.u32(zr, o), ren));
}

/** Hexadecimal numbers of a script's text pointed at the renumbered IDs (the comments are left as they are). */
function renumberText(src: string, ids: Map<number, number>): { text: string; count: number } {
  let count = 0;
  const text = src.replace(
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b0[xX][0-9a-fA-F]+\b/gu,
    (m, comment: string | undefined) => {
      if (comment) return m;
      const now = ids.get(Number(m));
      if (now === undefined || now === Number(m)) return m;
      count++;
      return `0x${hex8(now)}`;
    },
  );
  return { text, count };
}

/**
 * Brings the zip's stages into the session (readLanaiImport told what they are): new contents numbered after the
 * session's, the other added rows after the session's, the changes to the ROM's rows (those the session changed too
 * only when `overwrite` names them).
 */
export async function applyLanaiImport(
  s: LanaiSession,
  imp: LanaiImport,
  options: LanaiImportOptions = {},
): Promise<LanaiImportResult> {
  if (!s.canExport) throw new Error('ステージのインポートには Update が必要です');
  const { romfs, zip, own, extraRows, manifest, sources } = imp.data;
  const warnings: string[] = [];
  const ren: Renumber = { ids: new Map(), rows: new Map() };
  const note = (table: string, oldRow: number, newRow: number): void => {
    const t = s.need(table),
      z = zip.get(table)!;
    if (!ren.rows.has(table)) ren.rows.set(table, new Map());
    if (!ren.ids.has(table)) ren.ids.set(table, new Map());
    ren.rows.get(table)!.set(oldRow, newRow);
    ren.ids.get(table)!.set(z.rowId(oldRow), t.rowId(newRow));
  };
  // the rows first (their numbers and IDs are what the others are pointed at), then what they hold
  const added: [table: string, oldRow: number, newRow: number][] = [];
  const add = (table: string, oldRow: number): number => {
    const t = s.need(table);
    const r = t.addRow(likeRow(t, zip.get(table)!, oldRow));
    note(table, oldRow, r);
    added.push([table, oldRow, r]);
    return r;
  };
  // ItemDataCore before ItemData (ItemData +0x0C names its row)
  const order = [...extraRows.keys()].sort((a, b) => Number(b === 'ItemDataCore') - Number(a === 'ItemDataCore'));
  for (const table of order) for (const r of extraRows.get(table)!) add(table, r);
  for (const r of own.messages) add('MessageMapStage', r);

  const contents = s.need('Contents'),
    integration = s.need('MapStageIntegration');
  const used = new Set([...s.dump.names(), ...s.createdFiles.keys()].map((n) => n.toUpperCase()));
  let hash = 0xf0000000;
  const plan = imp.stages.map((st, k) => {
    while (used.has(hex8(hash))) hash += 0x10000;
    const archive = hex8(hash);
    used.add(archive);
    return { st, index: contents.rows + k, hash, archive };
  });
  const contentMap = new Map(plan.map((p) => [p.st.content, p.index]));
  let slot = Math.max(...Array.from({ length: integration.rows }, (_, r) => integration.u16(r, 0x40)));
  for (const p of plan) {
    if (p.index > 0xffff) throw new Error('コンテンツ番号が u16 を超えます');
    const bytes = romfs.get(p.st.archive)!.slice();
    w32(bytes, 4, p.hash);
    s.addFile(p.archive, bytes);
    s.addFile(lanaiCrrName(p.index), romfs.get(lanaiCrrName(p.st.content).toUpperCase())!);
    const cr = add('Contents', p.st.content);
    if (cr !== p.index) throw new Error(`Contents の行 ${cr} がコンテンツ ${p.index} になりません`);
  }
  for (const r of own.msi) add('MapStageIntegration', r);
  for (const [table, oldRow, newRow] of added) writeRow(s.need(table), newRow, zip.get(table)!, oldRow, ren);

  const msgIds = ren.ids.get('MessageMapStage') ?? new Map<number, number>();
  const slots = new Map<string, number>();
  for (const p of plan) {
    contents.setU32(p.index, 0, p.hash);
    for (const old of own.msi) {
      const r = ren.rows.get('MapStageIntegration')!.get(old)!;
      if (integration.u32(r, 0x34) !== p.st.content) continue;
      if (++slot > 0xffff) throw new Error('ステージ番号が u16 を超えます');
      slots.set(`${p.archive}/${hex8(integration.u32(r, 0x0c))}`, slot);
      integration.setU32(r, 0x0c, mapped(msgIds, integration.u32(r, 0x0c)));
      integration.setU32(r, 0x34, p.index);
      integration.setU32(r, 0x38, p.hash);
      integration.setBits(r, 0x44, 0, 16, p.index);
      integration.setBits(r, 0x40, 0, 16, slot);
    }
  }

  // the edits of the ROM's rows: those the session changed too only when asked
  for (const e of imp.edits) {
    if (e.conflict && !options.overwrite?.has(e.key)) continue;
    writeRow(s.need(e.table), e.row, zip.get(e.table)!, e.row, ren);
  }

  const itemIds = ren.ids.get('ItemData') ?? new Map<number, number>();
  const nameIds = ren.ids.get('MessageMapName') ?? new Map<number, number>();
  const itemMoved = [...itemIds].filter(([a, b]) => a !== b);
  for (const p of plan) {
    const tables = await s.tablesIn(p.archive);
    const named = (n: string): LanaiTable | undefined => tables.find((t) => t.table.name === n)?.table;
    const def = named('ContentsDef');
    // the stage slots by the MapStage rows (their MessageMapStage IDs as in the zip), then the numbers
    const stage = named('MapStage');
    const at = new Map<number, number>();
    if (stage)
      for (let r = 0; r < stage.rows; r++) {
        const slot = slots.get(`${p.archive}/${hex8(stage.u32(r, 0x0c))}`);
        if (slot !== undefined) at.set(r, slot);
      }
    retargetContentTables(tables, contentMap, msgIds);
    for (const [r, slot] of at) stage!.setBits(r, 0x34, 0, 16, slot);
    const groups = named('MapGroup');
    if (groups && nameIds.size)
      for (let r = 0; r < groups.rows; r++)
        if (nameIds.has(groups.u32(r, 0))) groups.setU32(r, 0, nameIds.get(groups.u32(r, 0))!);
    if (itemMoved.length) {
      const chests = named(LANAI_TREASURE_TABLE);
      if (chests)
        for (let r = 0; r < chests.rows; r++)
          for (let k = 0; k < LANAI_TREASURE_SLOTS && k * 8 + 8 <= chests.rowSize; k++)
            if (chests.u8(r, k * 8 + 6) === 1 && itemIds.has(chests.u32(r, k * 8)))
              chests.setU32(r, k * 8, itemIds.get(chests.u32(r, k * 8))!);
      const shop = named(LANAI_SHOP_ITEM_TABLE);
      if (shop)
        for (let r = 0; r < shop.rows; r++)
          if (itemIds.has(shop.u32(r, 0))) shop.setU32(r, 0, itemIds.get(shop.u32(r, 0))!);
    }

    // the script: as edited (its item numbers renumbered), or the built CRO with what the distribution needs of it
    const name = p.st.names[0] || `コンテンツ ${p.index}`;
    const src = sources[String(p.st.content)];
    const spec = manifest[String(p.st.content)];
    const keys = new Set([...s.stageScripts.values()].map((x) => x.key.toLowerCase()));
    for (const x of s.importedStages.values()) keys.add(x.key.toLowerCase());
    let key = src?.stageKey ?? spec?.stageKey;
    if (key && keys.has(key.toLowerCase())) {
      warnings.push(
        `「${name}」: 同じステージの鍵がこのセッションにあるので、新しい鍵にしました (3DS の中断データは引き継がれません)`,
      );
      key = crypto.randomUUID();
    }
    if (p.st.script === 'source') {
      const ids = new Map(itemMoved);
      let count = 0;
      const doc: ScriptDoc = structuredClone(src!.doc);
      for (const f of doc.functions) {
        const r = renumberText(f.body, ids);
        f.body = r.text;
        count += r.count;
      }
      if (count) warnings.push(`「${name}」: スクリプトのアイテムの番号 ${count} か所を新しい番号にしました`);
      s.setStageScriptDoc(p.archive, doc, key, false);
    } else if (p.st.script === 'compiled' && spec) {
      s.importedStages.set(p.archive, { key: key ?? crypto.randomUUID(), owned: spec.owned ?? [] });
      warnings.push(`「${name}」: スクリプトのソースが無い zip (リリース用) なので、イベントは編集できません`);
      if (itemMoved.length && def && def.rows >= 3) {
        const arc = parseArchive(romfs.get(p.st.archive)!);
        const entry = findEntry(arc, def.u32(2, 0));
        const cro = entry ? unpackEntry(arc, entry).body : new Uint8Array(0);
        const hit = itemMoved.filter(([old]) => {
          for (let o = 0; o + 4 <= cro.length; o += 4) if (u32(cro, o) === old) return true;
          return false;
        });
        if (hit.length)
          warnings.push(
            `「${name}」: CRO にアイテムの番号 ${hit.map(([a, b]) => `${hex8(a)} (新しい番号 ${hex8(b)})`).join('、')} があります。スクリプトのソースが無いので書き換えられません`,
          );
      }
    }
  }
  const moved = [...ren.ids].flatMap(([table, m]) =>
    table === 'MessageMapStage' ? [] : [...m].filter(([a, b]) => a !== b).map(() => table),
  );
  if (moved.length) warnings.push(`追加された行の番号を振り直しました: ${[...new Set(moved)].join('、')}`);
  const skipped = imp.edits.filter((e) => e.conflict && !options.overwrite?.has(e.key));
  if (skipped.length)
    warnings.push(
      `このセッションでも変えた ROM の行 ${skipped.length} 行は取り込みませんでした: ${skipped.map((e) => e.key).join('、')}`,
    );
  s.edited();
  return { contents: plan.map((p) => p.index), warnings };
}
