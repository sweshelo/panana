// The contents (stages) of 電波人間のRPG FREE! (naauao lanai/contents.md): the master's Contents table (row = content
// number -> root archive), the stages of MapStageIntegration (+0x34 content number, +0x0C MessageMapStage row ID,
// +0x49 stamina) and what a content's archive holds (its tables, its MapStage, its CRO of event scripts).
import { entryBlob, unpackEntry, type Archive } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { ascii, hex8, u32 } from '../util/bytes';
import type { LanaiSession, LanaiTableRef } from './session';
import { archiveTables } from './session';

/** A stage: a row of MapStageIntegration (MapStage +0x00..+0x33, then the content, its archive, its TableResource). */
export interface LanaiStage {
  row: number;
  content: number;
  /** +0x00: steps of 0x64 (the order, 推定). */
  order: number;
  /** +0x0C: row ID of MessageMapStage. */
  messageId: number;
  name: string;
  mission: string;
  note: string;
  /** +0x24 (3 = story, 0x16 = events …, 推定). */
  category: number;
  /** +0x49 (MapStage +0x3D): stamina to enter the stage. */
  stamina: number;
}

export interface LanaiContent {
  index: number;
  /** Root archive of the content. */
  archive: string;
  /** Entry of its TableResource. */
  tableResource: number;
  stages: LanaiStage[];
}

export const CATEGORY_NOTE: Record<number, string> = { 3: '本編 (推定)', 0x16: 'イベント系 (推定)' };

export function lanaiContents(s: LanaiSession): LanaiContent[] {
  const contents = s.need('Contents');
  const msi = s.need('MapStageIntegration');
  const msg = s.need('MessageMapStage');
  const out: LanaiContent[] = Array.from({ length: contents.rows }, (_, i) => ({
    index: i,
    archive: hex8(contents.u32(i, 0)),
    tableResource: contents.u32(i, 4),
    stages: [],
  }));
  for (let r = 0; r < msi.rows; r++) {
    const row = msi.row(r);
    const messageId = u32(row, 0x0c);
    const m = msg.find(messageId);
    const stage: LanaiStage = {
      row: r,
      content: u32(row, 0x34),
      order: u32(row, 0),
      messageId,
      name: m < 0 ? '' : s.plain(msg, m, 'stage_name').trim(),
      mission: m < 0 ? '' : s.plain(msg, m, 'stage_mission').trim(),
      note: m < 0 ? '' : s.plain(msg, m, 'stage_exp'),
      category: row[0x24]!,
      stamina: row[0x49]!,
    };
    out[stage.content]?.stages.push(stage);
  }
  return out;
}

/** The name of a content for lists: its first stage, or "コンテンツ N". */
export const contentTitle = (c: LanaiContent): string => c.stages.find((x) => x.name)?.name ?? (c.index === 0 ? '島・町' : `コンテンツ ${c.index}`);

/** What a CRO module holds: its classes, and the functions of the main program it calls. */
export interface CroInfo {
  module: string;
  /** Classes named in its RTTI ("D01001B01Npc0201", "D01Intro" …). */
  classes: string[];
  /** Imported functions, as "ScriptChara::MoveTo". */
  imports: string[];
}

/** "_ZN11ScriptChara6MoveToE…" -> "ScriptChara::MoveTo" (the nested name only; other names are kept as they are). */
export function demangleName(sym: string): string {
  let i = sym.startsWith('_ZNK') ? 4 : sym.startsWith('_ZN') ? 3 : -1;
  if (i < 0) return sym;
  const parts: string[] = [];
  for (let m = /^\d+/.exec(sym.slice(i)); m; m = /^\d+/.exec(sym.slice(i))) {
    i += m[0].length;
    parts.push(sym.slice(i, i + Number(m[0])));
    i += Number(m[0]);
  }
  return parts.length ? parts.join('::') : sym;
}

/** What a CRO tells by its strings: the module name (+0x84 points at it in the header), RTTI class names, imports. */
export function croInfo(b: Uint8Array): CroInfo {
  const strings: string[] = [];
  let cur = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!;
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= 4 && c === 0) strings.push(cur);
      cur = '';
    }
  }
  const nameOff = u32(b, 0x84);
  const module = nameOff && nameOff < b.length ? ascii(b, nameOff, Math.max(0, b.indexOf(0, nameOff) - nameOff)) : '';
  const classes: string[] = [];
  for (const s of strings) {
    const m = /^(\d+)([A-Z]\w+)$/.exec(s);
    if (m && Number(m[1]) === m[2]!.length) classes.push(m[2]!);
  }
  const imports = [...new Set(strings.filter((s) => s.startsWith('_ZN')).map(demangleName))].sort();
  return { module, classes: [...new Set(classes)].sort(), imports };
}

/** A content's archive read: its tables, its CRO, the other entries. */
export interface ContentArchive {
  archive: Archive;
  tables: LanaiTableRef[];
  cro: { name: string; info: CroInfo } | null;
  /** ContentsDef's values (u32 each). */
  def: number[];
}

export async function readContent(s: LanaiSession, c: LanaiContent): Promise<ContentArchive> {
  const archive = await s.archive(c.archive);
  const tables = archiveTables(c.archive, archive);
  let cro: ContentArchive['cro'] = null;
  for (const e of archive.entries) {
    if (e.comp !== 1) continue;
    const name = zipEntryName(entryBlob(archive, e));
    if (!name?.endsWith('.cro')) continue;
    cro = { name, info: croInfo(unpackEntry(archive, e).body) };
    break;
  }
  const def = tables.find((t) => t.table.name === 'ContentsDef')?.table;
  return { archive, tables, cro, def: def ? Array.from({ length: def.rows }, (_, i) => def.u32(i, 0)) : [] };
}
