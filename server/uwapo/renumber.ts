// Ported from lanai-custom-stages web/renumber.ts (99304a5); the uwapo there is kept in parallel.
// Renumbering the stages of several Panana ZIPs so they can be delivered (or written out) together. Each Panana session
// numbers a new stage the same way (content = Contents rows, archive F0000000, slot = max + 1, IDs and rows appended
// to the master), so two ZIPs made apart collide on all of them (docs/stage-distribution.md §1.2, §3).
//
// The packages are numbered in the order given: every value of a stage is kept while no earlier stage uses it, so one
// ZIP alone (and the first of several) keeps its numbers and its stage ID. What is renumbered:
//   - content number: the row of its Contents row; ContentsDef rows 0 / 1, MapStage +0x38, MapStageIntegration +0x34 /
//     +0x44, the CRR path, and the self references of the EventObject tables (Panana's cloneLanaiContent rule)
//   - archive name: the file name, the archive header +0x04, Contents +0x00, MapStageIntegration +0x38
//   - stage slot: MapStage +0x34, MapStageIntegration +0x40
//   - the IDs of the stage's own MapStageIntegration / MessageMapStage rows (MapStage +0x0C, MapStageIntegration +0x0C)
//   - the row numbers of every added master row (the 3DS appends the rows of all stages in manifest order), and
//     ItemData +0x0C where it names an added ItemDataCore row
// What is not, and refuses the merge: a ROM row changed by two packages, an ID of another added row (an item, a map
// name …) used by two packages (contents, messages or a CRO may hold it as a constant), an existing content replaced by
// two packages. Script state needs no numbers: it is private per stageKey (3ds/runtime/stage-state.inc); the stageKeys
// themselves are checked when the stages are extracted (merge.ts).
import {
  BASE_CONTENT_COUNT,
  hex8,
  parseArchive,
  parseTable,
  unpackEntry,
  type Archive,
  type PackageSummary,
} from './panana-zip';
import { rebuildArchive } from './table-write';

/** Old value → new value for the stages of one package. */
export interface Renumber {
  content: Map<number, number>;
  /** Archive names (8 hex digits, upper case). */
  archive: Map<string, string>;
  slot: Map<number, number>;
  /** Added master rows: "<table> <old row>" → new row. */
  rows: Map<string, number>;
  /** Row IDs of the stages' own MapStageIntegration / MessageMapStage rows: "<table> <old ID hex8>" → new ID. */
  ids: Map<string, number>;
}

export interface MergeProblem {
  kind: 'content' | 'archive' | 'masterRow' | 'rowId' | 'stageKey' | 'limit';
  value: string;
  /** Indexes of the packages (in the given order). */
  packages: number[];
  message: string;
}

/** The tables whose added rows of a stage get new IDs (the stage's own list row and its name). */
export const OWN_ID_TABLES = ['MapStageIntegration', 'MessageMapStage'] as const;
/** Added contents use 0xF0000000 + k * 0x10000 with k < 0x80 (3ds/runtime/stage-files.inc stage_custom_archive). */
export const CUSTOM_ARCHIVE_COUNT = 0x80;
const customArchive = (k: number) => hex8((0xf0000000 + k * 0x10000) >>> 0);
const isCustomArchive = (name: string) => (parseInt(name, 16) & 0xff80ffff) >>> 0 === 0xf0000000;

export const emptyRenumber = (): Renumber => ({
  content: new Map(),
  archive: new Map(),
  slot: new Map(),
  rows: new Map(),
  ids: new Map(),
});

/** Whether the plan changes nothing. */
export function isIdentity(r: Renumber): boolean {
  const same = <K, V>(m: Map<K, V>, key: (k: K) => V = (k) => k as unknown as V) =>
    [...m].every(([k, v]) => key(k) === v);
  return (
    same(r.content) &&
    same(r.archive) &&
    same(r.slot) &&
    [...r.rows].every(([k, v]) => Number(k.split(' ')[1]) === v) &&
    [...r.ids].every(([k, v]) => parseInt(k.split(' ')[1]!, 16) === v)
  );
}

/**
 * Plans the numbers of the stages of the packages, in that order. Needs summaries made with the master baseline (the
 * added rows and their owners). Problems are the collisions that renumbering cannot resolve; with any, the plans must
 * not be used.
 */
export function planMerge(summaries: PackageSummary[]): { plans: Renumber[]; problems: MergeProblem[] } {
  const problems: MergeProblem[] = [];
  const problem = (kind: MergeProblem['kind'], value: string, packages: number[], message: string) => {
    const known = problems.find((p) => p.kind === kind && p.value === value);
    if (known) known.packages = [...new Set([...known.packages, ...packages])].sort((a, b) => a - b);
    else problems.push({ kind, value, packages, message });
  };
  const plans = summaries.map(emptyRenumber);

  // values every package asked for: a value is kept only while no earlier stage holds it, and new ones avoid them all
  const allSlots = summaries.flatMap((s) => s.stages.flatMap((x) => x.stages.map((r) => r.slot)));
  const allArchives = new Set(summaries.flatMap((s) => s.stages.map((x) => x.archive)));
  const allIds = new Map<string, number[]>();
  for (const s of summaries)
    for (const d of s.masterDiff ?? [])
      for (const r of d.added)
        if (r.id !== null) allIds.set(d.name, [...(allIds.get(d.name) ?? []), parseInt(r.id, 16)]);
  let nextSlot = Math.max(0, ...allSlots) + 1;
  const nextId = new Map([...allIds].map(([t, ids]) => [t, Math.max(...ids) + 1]));

  const usedSlots = new Set<number>();
  const usedArchives = new Set<string>();
  const usedIds = new Map<string, Map<number, number>>(); // table → ID → package
  const changed = new Map<string, number>(); // "<table> <row>" → package
  const modified = new Map<number, number>(); // replaced content → package
  const nextRow = new Map<string, number>();

  summaries.forEach((summary, i) => {
    // (condition scripts are refused by extractStages for every ZIP, colliding or not)
    const plan = plans[i]!;
    const diff = summary.masterDiff ?? [];
    for (const d of diff) {
      if (!nextRow.has(d.name)) nextRow.set(d.name, d.baseRows);
      for (const r of d.changed) {
        if (!r.owner) continue; // not delivered
        const key = `${d.name} ${r.row}`;
        const other = changed.get(key);
        if (other !== undefined)
          problem('masterRow', key, [other, i], `ROM の同じ行 (${key}) を複数の ZIP が変更しています`);
        else changed.set(key, i);
      }
    }
    for (const stage of summary.stages) {
      if (stage.kind === 'modified') {
        const other = modified.get(stage.content);
        if (other !== undefined)
          problem(
            'content',
            String(stage.content),
            [other, i],
            `既存のコンテンツ ${stage.content} を複数の ZIP が置き換えています`,
          );
        else modified.set(stage.content, i);
      }
      // archive
      let archive = stage.archive;
      if (usedArchives.has(archive)) {
        if (stage.kind === 'modified')
          problem('archive', archive, [i], `既存のアーカイブ ${archive} を複数の ZIP が置き換えています`);
        else {
          let k = 0;
          while (k < CUSTOM_ARCHIVE_COUNT && (allArchives.has(customArchive(k)) || usedArchives.has(customArchive(k))))
            k++;
          if (k >= CUSTOM_ARCHIVE_COUNT)
            problem('limit', 'archive', [i], '追加コンテンツのアーカイブ名が足りません (0x80 個まで)');
          archive = customArchive(Math.min(k, CUSTOM_ARCHIVE_COUNT - 1));
        }
      }
      if (stage.kind === 'added' && !isCustomArchive(archive))
        problem(
          'archive',
          archive,
          [i],
          `追加コンテンツのアーカイブ名 ${archive} は 3DS が受け付けません (F0000000 + k×0x10000)`,
        );
      usedArchives.add(archive);
      plan.archive.set(stage.archive, archive);
      // slots
      for (const r of stage.stages) {
        if (plan.slot.has(r.slot)) continue;
        let slot = r.slot;
        if (usedSlots.has(slot)) slot = nextSlot++;
        if (slot > 0xffff) problem('limit', 'slot', [i], 'ステージ枠が u16 を超えます');
        usedSlots.add(slot);
        plan.slot.set(r.slot, slot);
      }
      // added master rows of the stage, in master order: new row numbers, and new IDs for its own list rows
      for (const d of diff)
        for (const r of d.added) {
          if (r.owner?.content !== stage.content) continue;
          const row = nextRow.get(d.name)!;
          nextRow.set(d.name, row + 1);
          plan.rows.set(`${d.name} ${r.row}`, row);
          if (d.name === 'Contents') plan.content.set(stage.content, row);
          if (r.id === null) continue;
          const id = parseInt(r.id, 16);
          const used = usedIds.get(d.name) ?? new Map<number, number>();
          usedIds.set(d.name, used);
          const own = (OWN_ID_TABLES as readonly string[]).includes(d.name) && r.owner.by === 'own';
          let to = id;
          if (used.has(id)) {
            if (own) {
              to = nextId.get(d.name)!;
              nextId.set(d.name, to + 1);
            } else
              problem(
                'rowId',
                `${d.name} ${r.id}`,
                [used.get(id)!, i],
                `追加された ${d.name} の行 ID ${r.id} を複数の ZIP が使っています (コンテンツの表や CRO が値として持つので振り直せません。Panana で片方の行を作り直してください)`,
              );
          }
          used.set(to, i);
          if (own) plan.ids.set(`${d.name} ${r.id}`, to);
        }
      if (stage.kind === 'added' && !plan.content.has(stage.content))
        problem(
          'content',
          String(stage.content),
          [i],
          `コンテンツ ${stage.content} の Contents の行が master にありません`,
        );
      if (stage.kind === 'modified') plan.content.set(stage.content, stage.content);
      const content = plan.content.get(stage.content);
      if (content !== undefined && content > 9999)
        problem('limit', 'content', [i], 'コンテンツ番号が 9999 を超えます (CRR のパスが 4 桁)');
    }
  });
  if (nextRow.get('Contents') !== undefined && nextRow.get('Contents')! < BASE_CONTENT_COUNT)
    problem('content', 'Contents', [], 'master の Contents の行数が ROM より少なくなっています');
  return { plans, problems };
}

// ---- applying a plan

const r32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const r16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const w32 = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint32(o, v >>> 0, true);
const w16 = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint16(o, v, true);

const mapped = (m: Map<number, number>, v: number) => m.get(v) ?? v;
const idOf = (plan: Renumber, table: string, id: number) => plan.ids.get(`${table} ${hex8(id)}`) ?? id;

/**
 * Edits one master row of a stage of the planned package in place (the bytes of its LCSR record, before its string
 * offsets matter: only number fields are written). `content` is the stage's old content number.
 */
export function renumberRow(plan: Renumber, table: string, row: Uint8Array, content: number): void {
  const archive = (o: number) => {
    const to = plan.archive.get(hex8(r32(row, o)));
    if (to) w32(row, o, parseInt(to, 16));
  };
  if (table === 'Contents' && row.length >= 4) archive(0);
  else if (table === 'MapStageIntegration' && row.length >= 0x46) {
    w32(row, 0x0c, idOf(plan, 'MessageMapStage', r32(row, 0x0c)));
    if (r32(row, 0x34) === content) w32(row, 0x34, mapped(plan.content, content));
    archive(0x38);
    w16(row, 0x40, mapped(plan.slot, r16(row, 0x40)));
    if (r16(row, 0x44) === content) w16(row, 0x44, mapped(plan.content, content));
  } else if (table === 'ItemData' && row.length >= 0x0e) {
    const core = plan.rows.get(`ItemDataCore ${r16(row, 0x0c)}`);
    if (core !== undefined) w16(row, 0x0c, core);
  }
}

/** The new row and ID of an added or changed master row (unchanged when not planned). */
export function renumberedRow(
  plan: Renumber,
  table: string,
  row: number,
  id: number | null,
): { row: number; id: number | null } {
  return {
    row: plan.rows.get(`${table} ${row}`) ?? row,
    id: id === null ? null : idOf(plan, table, id),
  };
}

/**
 * The content archive of a stage with the plan applied: its name in the header, ContentsDef rows 0 / 1, MapStage
 * (+0x0C message, +0x34 slot, +0x38 content) and the EventObject self references. Returns the input when nothing
 * changes.
 */
export function renumberArchive(plan: Renumber, bytes: Uint8Array, content: number): Uint8Array {
  const to = mapped(plan.content, content);
  const copy = bytes.slice();
  const arc: Archive = parseArchive(copy);
  const replaced = new Map<number, Uint8Array>();
  let edited = false;
  arc.entries.forEach((e, index) => {
    if (![1, 3, 11, 12].includes(e.type)) return;
    let body: Uint8Array;
    try {
      body = unpackEntry(arc, e).body;
    } catch {
      return;
    }
    const t = parseTable(body);
    if (!t) return;
    const at = (r: number, o: number) => t.dataOffset + r * t.rowSize + o;
    let changed = false;
    const set32 = (o: number, v: number) => {
      if (r32(body, o) === v >>> 0) return;
      w32(body, o, v);
      changed = true;
    };
    const set16 = (o: number, v: number) => {
      if (r16(body, o) === v) return;
      w16(body, o, v);
      changed = true;
    };
    if (t.name === 'ContentsDef' && t.rowSize >= 4)
      for (const r of [0, 1]) if (r < t.rows && r32(body, at(r, 0)) === content) set32(at(r, 0), to);
    if (t.name === 'MapStage' && t.rowSize >= 0x3a)
      for (let r = 0; r < t.rows; r++) {
        set32(at(r, 0x0c), idOf(plan, 'MessageMapStage', r32(body, at(r, 0x0c))));
        set16(at(r, 0x34), mapped(plan.slot, r16(body, at(r, 0x34))));
        if (r16(body, at(r, 0x38)) === content) set16(at(r, 0x38), to);
      }
    // Panana cloneLanaiContent: clear actions 0x8000002E (+8) / 0x80000031 (+4) at +0x10/+0x28/+0x40, and the
    // conditions with kind (u8 +0x5F / +0x60) 1 or 2 whose argument (+0x00 / +0x08) is a content. Any content of the
    // same package follows its new number (a stage may clear or test another stage of its ZIP), not only its own.
    const follow = (o: number) => {
      const v = r32(body, o);
      if (plan.content.has(v)) set32(o, plan.content.get(v)!);
    };
    if (t.name.endsWith('_EventObject') && t.rowSize >= 0x61)
      for (let r = 0; r < t.rows; r++) {
        for (const o of [0x10, 0x28, 0x40]) {
          const type = r32(body, at(r, o));
          const arg = type === 0x8000002e ? o + 8 : type === 0x80000031 ? o + 4 : -1;
          if (arg >= 0) follow(at(r, arg));
        }
        for (const [kind, arg] of [
          [0x5f, 0],
          [0x60, 8],
        ] as const)
          if ([1, 2].includes(body[at(r, kind)]!)) follow(at(r, arg));
      }
    if (!changed) return;
    edited = true;
    // a stored entry was edited in the copy itself; a packed one is packed again
    if (e.comp === 1 || e.comp === 6) replaced.set(index, body);
  });
  const name = plan.archive.get(hex8(arc.hash)) ?? hex8(arc.hash);
  if (!edited && name === hex8(arc.hash)) return bytes;
  const out = replaced.size ? rebuildArchive(arc, replaced) : copy;
  w32(out, 4, parseInt(name, 16));
  return out;
}
