// Ported from lanai-custom-stages web/stage-files.ts (99304a5); the uwapo there is kept in parallel.
// The files of one published stage, cut out of a Panana MOD ZIP: the content archive, its CRR and the master rows it
// needs ("rows", LCSR v1). Formats: ../docs/stage-distribution.md §4.
import { unzipSync } from 'fflate';
import { emptyRenumber, renumberArchive, renumberedRow, renumberRow, type Renumber } from './renumber';
import { appendLcse, lcseBinary, stageEventsFor, type StageEventSpec } from './stage-events';
import {
  allTables,
  hex8,
  MASTER_ARCHIVE,
  MAX_EXPANDED_BYTES,
  parseArchive,
  parsePananaZip,
  TITLE_ID,
  type MasterBaseline,
  type MasterRowDiff,
  type PackageSummary,
  type StageSummary,
  type Table,
} from './panana-zip';

export const ROWS_MAGIC = 'LCSR';
export const ROWS_VERSION = 1;
/** LCSR row: attribution codes (byte +0x2D). */
export const ROW_OWNER_CODES = { own: 0, insert: 1, value: 2, link: 3 } as const;
/** No row ID (Contents, ItemDataCore …). */
export const NO_ROW_ID = 0xffffffff;
/**
 * MapStageIntegration: the enable condition (+0x1C v1, +0x20 v2, +0x24 u8 kind; default "shown") and the disable
 * condition (+0x28, +0x2C, +0x30 kind; default "not disabled"). The stage select (0x263B18) and its count (0x2A9024)
 * evaluate them on the list record (3ds/research/stage-list.md, event-conditions.md). Kind 0 returns the default.
 */
export const CONDITION_FIELDS = {
  enable: { v1: 0x1c, v2: 0x20, kind: 0x24 },
  disable: { v1: 0x28, v2: 0x2c, kind: 0x30 },
} as const;
export interface StageConditions {
  enable: { kind: number; v1: number; v2: number };
  disable: { kind: number; v1: number; v2: number };
}

export function stageConditions(row: Uint8Array): StageConditions {
  const read = (f: { v1: number; v2: number; kind: number }) => ({
    kind: row[f.kind]!,
    v1: le32(row, f.v1),
    v2: le32(row, f.v2),
  });
  return { enable: read(CONDITION_FIELDS.enable), disable: read(CONDITION_FIELDS.disable) };
}

/** Clears both conditions of a MapStageIntegration row (kind 0 = the default: always shown, never disabled). */
export function clearStageConditions(row: Uint8Array): void {
  for (const f of Object.values(CONDITION_FIELDS)) {
    row.fill(0, f.v1, f.v1 + 4);
    row.fill(0, f.v2, f.v2 + 4);
    row[f.kind] = 0;
  }
}

export interface RowRecord {
  entry: string;
  table: string;
  row: number;
  id: string | null;
  op: 'add' | 'replace';
  by: NonNullable<MasterRowDiff['owner']>['by'];
  /** In-row offsets of the string fields (relocated u32s of the data region). */
  stringFields: number[];
  rowSize: number;
  stringBytes: number;
}

export interface ExtractedStage {
  /** The stage with its new numbers (content, archive, crr, slots, IDs) when a renumbering plan was given. */
  stage: StageSummary;
  /** The content number and archive the ZIP gave the stage. */
  original: { content: number; archive: string };
  archive: Uint8Array;
  crr: Uint8Array;
  rows: Uint8Array;
  rowRecords: RowRecord[];
  /** LCSE source (lanai-stage.json), already appended to rows; null when the ZIP has none for this stage. */
  events: StageEventSpec | null;
  /** The conditions of the stage's own MapStageIntegration row as Panana wrote them (null: the stage has none). */
  conditions: StageConditions | null;
  /** The conditions were cleared in the delivered rows. */
  conditionsCleared: boolean;
}

export interface ExtractOptions {
  /** Deliver the stage's MapStageIntegration row with both conditions cleared (always shown in the custom tab). */
  clearConditions?: boolean;
  /** New numbers for the stages (renumber.ts planMerge); none keeps the ZIP's. */
  renumber?: Renumber;
}

/** In-row offsets of a table's string fields: the relocations that fall in the rows. */
export function stringFieldOffsets(t: Table): number[] {
  const end = t.dataOffset + t.rows * t.rowSize;
  const out = new Set<number>();
  for (const r of t.relocs) if (r >= t.dataOffset && r < end) out.add((r - t.dataOffset) % t.rowSize);
  return [...out].sort((a, b) => a - b);
}

const le32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const align4 = (n: number) => (n + 3) & ~3;

/**
 * Where each string of a table's pool ends: the next string any relocated u32 (string fields, field names) or the
 * table's name points at, or the end of the pool. A string is copied with the bytes up to the next one (a message's
 * tags contain zeros, and the `voice` strings are a binary form whose length is not known).
 */
function stringEnds(t: Table): (start: number) => number {
  const starts = new Set<number>([0x40 + le32(t.data, 0x34), t.poolEnd]);
  for (const r of t.relocs) {
    const v = le32(t.data, r);
    if (v >= 0x40 && v <= t.poolEnd) starts.add(v);
  }
  const sorted = [...starts].sort((a, b) => a - b);
  return (start) => sorted.find((s) => s > start) ?? t.poolEnd;
}

/** One LCSR record (see the format in docs/stage-distribution.md §4.3), written as row `to.row` with ID `to.id`. */
function rowRecord(
  entry: number,
  t: Table,
  row: number,
  op: 0 | 1,
  by: number,
  edit?: (row: Uint8Array) => void,
  to: { row: number; id: number | null } = { row, id: t.rowIds[row] ?? null },
): { bytes: Uint8Array; fields: number[]; stringBytes: number } {
  const fields = stringFieldOffsets(t);
  const rowStart = t.dataOffset + row * t.rowSize;
  const rowBytes = t.data.slice(rowStart, rowStart + t.rowSize);
  edit?.(rowBytes);
  const end = stringEnds(t);
  const blocks: Uint8Array[] = [];
  const placed = new Map<number, number>();
  let size = 0;
  for (const f of fields) {
    const at = le32(rowBytes, f);
    if (at < 0x40 || at >= t.poolEnd)
      throw new Error(`${t.name} 行 ${row} +0x${f.toString(16)} が文字列領域を指していません`);
    let rel = placed.get(at);
    if (rel === undefined) {
      rel = size;
      const bytes = t.data.subarray(at, end(at));
      blocks.push(bytes);
      size += bytes.length;
      const pad = align4(size) - size;
      if (pad) blocks.push(new Uint8Array(pad));
      size += pad;
      placed.set(at, rel);
    }
    new DataView(rowBytes.buffer, rowBytes.byteOffset).setUint32(f, rel, true);
  }
  const rowPadded = align4(t.rowSize);
  const out = new Uint8Array(0x34 + rowPadded + 4 + fields.length * 4 + 4 + size);
  const v = new DataView(out.buffer);
  v.setUint32(0, entry, true);
  const name = new TextEncoder().encode(t.name);
  if (name.length > 31) throw new Error(`表の名前が長すぎます: ${t.name}`);
  out.set(name, 4);
  v.setUint32(0x24, to.id ?? NO_ROW_ID, true);
  v.setUint32(0x28, to.row, true);
  out[0x2c] = op;
  out[0x2d] = by;
  out[0x2e] = by >= ROW_OWNER_CODES.value ? 1 : 0; // bit 0: the row is attributed to the stage by a guess
  v.setUint32(0x30, t.rowSize, true);
  out.set(rowBytes, 0x34);
  let o = 0x34 + rowPadded;
  v.setUint32(o, fields.length, true);
  o += 4;
  for (const f of fields) {
    v.setUint32(o, f, true);
    o += 4;
  }
  v.setUint32(o, size, true);
  o += 4;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return { bytes: out, fields, stringBytes: size };
}

/**
 * Cuts the stages out of a Panana ZIP. Needs the master baseline (the master rows of a stage are found by the diff) and
 * refuses what v1 cannot deliver: no master or baseline, a stage without its CRR, condition scripts (code.ips).
 */
export async function extractStages(
  zip: Uint8Array,
  baseline: MasterBaseline | null,
  options: ExtractOptions = {},
): Promise<{ summary: PackageSummary; stages: ExtractedStage[]; warnings: string[] }> {
  if (!baseline)
    throw new Error('master の基準 (data/master-baseline.json) がないので、ステージの master 行を決められません');
  const summary = await parsePananaZip(zip, baseline);
  if (!summary.stages.length) throw new Error('ZIP にステージがありません');
  if (summary.conditionScripts.length)
    throw new Error('条件スクリプト (code.ips) を使うステージは v1 では配信できません');
  if (!summary.masterDiff) throw new Error('ZIP に master (2135000A) がありません');
  let expanded = 0;
  const files = unzipSync(zip, {
    filter: (f) => {
      expanded += f.originalSize;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error('ZIP の展開後のサイズが大きすぎます');
      return true;
    },
  });
  const file = (path: string) =>
    Object.entries(files).find(([p]) => p.toUpperCase() === `${TITLE_ID}/${path}`.toUpperCase())?.[1];
  const master = file(`romfs/${MASTER_ARCHIVE}`)!;
  const eventsFile = Object.entries(files).find(
    ([p]) => p.split('/').at(-1)!.toLowerCase() === 'lanai-stage.json',
  )?.[1];
  let eventsJson: unknown = null;
  if (eventsFile) {
    try {
      eventsJson = JSON.parse(new TextDecoder().decode(eventsFile));
    } catch {
      throw new Error('lanai-stage.json が JSON として読めません');
    }
  }
  const tables = allTables(parseArchive(master));
  const warnings: string[] = [];
  const stages: ExtractedStage[] = [];
  for (const stage of summary.stages) {
    if (stage.warnings.length) warnings.push(...stage.warnings.map((w) => `コンテンツ ${stage.content}: ${w}`));
    const archive = file(`romfs/${stage.archive}`);
    if (!archive) throw new Error(`romfs/${stage.archive} がありません`);
    if (!stage.crr) throw new Error(`コンテンツ ${stage.content} の CRR がありません`);
    const crr = file(stage.crr)!;
    const plan = options.renumber ?? emptyRenumber();
    const records: { bytes: Uint8Array; record: RowRecord }[] = [];
    let conditions: StageConditions | null = null;
    // the stage's own list row (content and archive as in the stage): its conditions decide the custom tab
    const own = (d: { name: string }, t: Table, r: { owner?: { by: string } }) =>
      d.name === 'MapStageIntegration' && r.owner?.by === 'own' && t.rowSize >= 0x3c;
    for (const d of summary.masterDiff) {
      const t = tables.find((x) => hex8(x.entry) === d.entry)!.table;
      for (const [op, rows] of [
        [0, d.added],
        [1, d.changed],
      ] as const)
        for (const r of rows) {
          if (r.owner?.content !== stage.content) continue;
          const isOwn = own(d, t, r);
          const edit = (row: Uint8Array) => {
            if (isOwn) {
              conditions = stageConditions(row);
              if (options.clearConditions) clearStageConditions(row);
            }
            renumberRow(plan, d.name, row, stage.content);
          };
          // a changed ROM row keeps its row and ID; an added one takes the planned ones
          const to = op
            ? { row: r.row, id: r.id === null ? null : parseInt(r.id, 16) }
            : renumberedRow(plan, d.name, r.row, r.id === null ? null : parseInt(r.id, 16));
          const built = rowRecord(parseInt(d.entry, 16), t, r.row, op, ROW_OWNER_CODES[r.owner.by], edit, to);
          records.push({
            bytes: built.bytes,
            record: {
              entry: d.entry,
              table: d.name,
              row: to.row,
              id: to.id === null ? null : hex8(to.id),
              op: op ? 'replace' : 'add',
              by: r.owner.by,
              stringFields: built.fields,
              rowSize: t.rowSize,
              stringBytes: built.stringBytes,
            },
          });
        }
    }
    // deterministic order: master entry order (the diff's), then op, then row
    const head = new Uint8Array(8);
    head.set(new TextEncoder().encode(ROWS_MAGIC));
    new DataView(head.buffer).setUint16(4, ROWS_VERSION, true);
    new DataView(head.buffer).setUint16(6, records.length, true);
    const lcsr = new Uint8Array(8 + records.reduce((n, r) => n + r.bytes.length, 0));
    lcsr.set(head);
    let o = 8;
    for (const r of records) {
      lcsr.set(r.bytes, o);
      o += r.bytes.length;
    }
    let events: StageEventSpec | null;
    let rows: Uint8Array = lcsr;
    try {
      events = stageEventsFor(eventsJson, stage.content);
      if (events) rows = appendLcse(lcsr, lcseBinary(events));
    } catch (error) {
      throw new Error(`コンテンツ ${stage.content}: ${(error as Error).message}`);
    }
    if (!events)
      warnings.push(
        `コンテンツ ${stage.content}: stageKey がないため、スクリプト状態は訪問中だけ保持され保存されません`,
      );
    const found = conditions as StageConditions | null;
    const set = found ? [found.enable.kind && '出現', found.disable.kind && '無効化'].filter(Boolean) : [];
    if (set.length && !options.clearConditions)
      warnings.push(
        `コンテンツ ${stage.content}: ${set.join('・')}の条件があります (種類 0x${found!.enable.kind.toString(16)} / 0x${found!.disable.kind.toString(16)})。満たさないとカスタムタブに出ないか選べません`,
      );
    const content = plan.content.get(stage.content) ?? stage.content;
    const archiveName = plan.archive.get(stage.archive) ?? stage.archive;
    const idOf = (table: string, id: string | null) => {
      const to = id === null ? undefined : plan.ids.get(`${table} ${id}`);
      return to === undefined ? id : hex8(to);
    };
    const crrPath = `romfs/.crr/contents${String(content).padStart(4, '0')}.crr`;
    const renumbered: StageSummary = {
      ...stage,
      content,
      archive: archiveName,
      crr: crrPath,
      stages: stage.stages.map((r) => ({
        ...r,
        content: r.content === stage.content ? content : r.content,
        slot: plan.slot.get(r.slot) ?? r.slot,
        messageId: idOf('MessageMapStage', r.messageId)!,
        integrationId: idOf('MapStageIntegration', r.integrationId),
        integrationRow:
          r.integrationRow === null
            ? null
            : (plan.rows.get(`MapStageIntegration ${r.integrationRow}`) ?? r.integrationRow),
      })),
      files: [`romfs/${archiveName}`, crrPath],
    };
    stages.push({
      stage: renumbered,
      original: { content: stage.content, archive: stage.archive },
      archive: renumberArchive(plan, archive, stage.content),
      crr,
      rows,
      rowRecords: records.map((r) => r.record),
      events,
      conditions: found,
      conditionsCleared: !!options.clearConditions && !!found,
    });
  }
  const loose = summary.masterDiff.flatMap((d) =>
    [...d.added, ...d.changed].filter((r) => !r.owner).map((r) => `${d.name} 行 ${r.row}`),
  );
  if (loose.length) warnings.push(`どのステージのものか判定できない master の行は配信しません: ${loose.join('、')}`);
  return { summary, stages, warnings };
}
