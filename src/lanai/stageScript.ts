// The event script of an added stage (eventScript.ts) against the stage's data, and into its files: the script's rows
// must be rows of the content's EventObject tables whose first action is "a script" (0x8000002D), the CRO of the
// content's archive becomes content 99's (no events) with the script's events, its CRR registers the new CRO, and
// lanai-stage.json tells the distribution server (lanai-custom-stages web/stage-events.ts) the stage's key and the
// flags it owns: the 3DS patch keeps those in a file of the stage instead of the save.
import { findEntry, parseArchive, rebuildArchive } from '../archive/gsarc';
import { LANAI_ACTION_SCRIPT } from './actions';
import { lanaiContents, type LanaiContent } from './contents';
import { buildCro, parseCro } from './cro';
import {
  compileStageScript,
  hexId,
  INTRO_DIR,
  nodeCharaRows,
  scriptBodies,
  parseStageScript,
  STAGE_BIT_FLAGS,
  STAGE_BYTE_FLAGS,
  SCRIPT_TRIGGER_LABEL,
  stageScriptCrr,
  triggerHasRow,
  usesOwnState,
  type IntroSpec,
  type LeaveReset,
  type ScriptNode,
  type ScriptTrigger,
  type ScriptDoc,
  type StageScript,
} from './eventScript';
import { lanaiRecEventRow } from './mapedit';
import {
  LANAI_EVENT_ACTIONS,
  LANAI_EVENT_SECTIONS,
  lanaiEventSlot,
  lanaiMaps,
  type LanaiMapInfo,
  type LanaiMaps,
} from './maps';
import type { LanaiTable } from './table';
import type { LanaiSession } from './session';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT, lanaiCrrName } from './stageEdit';

/** The file of the MOD zip (beside romfs/) that carries the keys and the owned flags of the scripted stages. */
export const LANAI_STAGE_MANIFEST = 'lanai-stage.json';
/**
 * The file of the distribution zip (beside romfs/) that carries the scripts as they are edited (the editor's documents,
 * comments and all), so that the stages can be imported and edited again (stageImport.ts). The release zip leaves it
 * out.
 */
export const LANAI_STAGE_SOURCE = 'panana-stage-source.json';

/** What LANAI_STAGE_SOURCE holds for a stage, by its content number. */
export interface LanaiStageSource {
  /** The content's root archive. */
  archive: string;
  stageKey: string;
  doc: ScriptDoc;
}
/** The boss battle of a range: its second argument is the byte flag that becomes 2 (actions.ts). */
const ACTION_BOSS = 0x8000000c;
/** How many ranges a stage can own (lanai-custom-stages web/stage-events.ts MAX_OWNED). */
const MAX_OWNED = 4;

export interface OwnedRange {
  field: 'bit' | 'byte' | 'state';
  first: number;
  count: number;
}

export interface StageScriptCheck {
  script: StageScript;
  /** What keeps the script from working in the game; the MOD is not written while there is one. */
  problems: string[];
  notes: string[];
  /** The flags set back to 0 when the stage is left besides the script's `reset` variables: the bosses of the data. */
  resets: LeaveReset[];
  owned: OwnedRange[];
  /** The opening of each group with an intro event (read off the maps). */
  intros: Record<number, IntroSpec>;
}

const inRange = (v: number, r: { first: number; count: number }): boolean => v >= r.first && v < r.first + r.count;

/** The kind of a section 3 record (+0x15) that is a gate: its door opens and closes in the shipped openings. */
const GATE_KIND = 12;

/** Where a group's opening happens (stage-intro.md): its first map, and the gate of its start point if any. */
export interface GroupOpening {
  map: number;
  mapName: string;
  /** The start point's record of section 3 (null: the point is not one; the opening is the fade and the name). */
  gate: IntroSpec['gate'];
  /** What a person should know (the point has no record, the gate has no door …). */
  note: string | null;
}

/**
 * A group's opening as the shipped stages have it: IntroCommon is made with the group's first map, and its walk-in
 * uses the tile and facing of the start point, a record of section 3 in that map (91 of 91 shipped intros); the door
 * that closes is the record's EventObject row when the record is a gate (kind 12). null when the group has no first map.
 */
export function groupOpening(maps: LanaiMaps, group: number): GroupOpening | null {
  const g = maps.groups[group];
  const info = g && maps.map(g.firstMap);
  if (!g || !info) return null;
  const rec = (maps.doc(info).recs[3] ?? []).find((r) => u32at(r.raw, 0) === g.firstPoint);
  if (!rec)
    return {
      map: info.hash,
      mapName: info.name,
      gate: null,
      note: `開始地点が ${info.name} の出入口 (区画 3) ではないので、門から歩いて入る演出はなく、ステージ名だけ出します`,
    };
  const dir = INTRO_DIR[rec.raw[0x14] ?? 0];
  if (!dir)
    return {
      map: info.hash,
      mapName: info.name,
      gate: null,
      note: `開始地点の出入口の向き (${rec.raw[0x14]}) が分からないので、ステージ名だけ出します`,
    };
  const door = rec.raw[0x15] === GATE_KIND ? lanaiRecEventRow(3, rec.raw) : 0;
  return {
    map: info.hash,
    mapName: info.name,
    gate: { x: rec.x, z: rec.y, dir, door },
    note: door ? null : '開始地点の出入口が門 (種類 12) ではないので、歩いて入りますが扉は閉まりません',
  };
}

/** What a map's record is to the game's events: its section and its kind (section 5 +0x00, section 3 +0x15). */
export interface EventRecord {
  section: number;
  kind: number;
}
/** The kind of a record as EventRecord takes it: section 5's +0x00, section 3's exit kind (+0x15), else 0. */
export const eventRecordKind = (section: number, raw: Uint8Array): number =>
  section === 5 ? u32at(raw, 0) : section === 3 ? (raw[0x15] ?? 0) : 0;
/** Exit kinds (section 3) with no event: the arrival points (lanai/maps.ts LANAI_EXIT_KIND 8 / 11). */
const NO_EVENT_EXITS = [8, 11];
/** The gimmick kinds of section 5 whose event is a GimmickEvent (event-actions.md §3); 4〜6 are the buttons. */
const GIMMICK_KINDS = [4, 5, 6, 11, 14, 15];
const BUTTON_KINDS = [4, 5, 6];
/** Section 5 kinds that have no event (the character alone). */
const NO_EVENT_KINDS = [7, 10];
const u32at = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The records of a group's maps by the EventObject row they name. */
export function eventRecords(maps: LanaiMaps, group: number): Map<number, EventRecord[]> {
  const out = new Map<number, EventRecord[]>();
  for (const m of maps.maps) {
    if (m.dungeon !== group || m.world) continue;
    for (const section of LANAI_EVENT_SECTIONS)
      for (const r of maps.doc(m).recs[section] ?? []) {
        const kind = u32at(r.raw, 0);
        if (section === 8 && kind >= 100) continue;
        const row = lanaiRecEventRow(section, r.raw);
        out.set(row, [...(out.get(row) ?? []), { section, kind: eventRecordKind(section, r.raw) }]);
      }
  }
  return out;
}

/** What starts the event of a record (the game makes the event's object by section and kind), or null: none here. */
export function recordTrigger(rec: EventRecord): ScriptTrigger | null {
  if (rec.section === 8) return 'area';
  // an exit, a door, a hole …: MoveEvent makes the event of its row (the CRO's export 6; CRO 22's random holes)
  if (rec.section === 3) return NO_EVENT_EXITS.includes(rec.kind) ? null : 'exit';
  if (rec.section !== 5 || NO_EVENT_KINDS.includes(rec.kind)) return null;
  if (BUTTON_KINDS.includes(rec.kind)) return 'button';
  return GIMMICK_KINDS.includes(rec.kind) ? null : 'talk';
}
/** Whether a function can be given to a record under a trigger: "all monsters beaten" is kept by a range too. */
export const triggerFitsRecord = (t: ScriptTrigger, rec: EventRecord): boolean =>
  recordTrigger(rec) === (t === 'defeat' ? 'area' : t === 'switch' ? 'button' : t);

/** The rows of the objects a body names with obj(row). */
export function charaRows(body: ScriptNode[]): number[] {
  const out: number[] = [];
  for (const n of body) {
    out.push(...nodeCharaRows(n));
    for (const b of scriptBodies(n)) out.push(...charaRows(b));
  }
  return out;
}

/** The EventObject rows the records of one map name (GetMapChara(row) finds a character only there). */
export function mapEventRows(maps: LanaiMaps, info: LanaiMapInfo): Set<number> {
  const out = new Set<number>();
  for (const section of LANAI_EVENT_SECTIONS)
    for (const r of maps.doc(info).recs[section] ?? []) {
      if (section === 8 && u32at(r.raw, 0) >= 100) continue;
      out.add(lanaiRecEventRow(section, r.raw));
    }
  return out;
}
/** The maps (floors) of a map group. */
export const groupFloors = (maps: LanaiMaps, group: number): LanaiMapInfo[] =>
  maps.maps.filter((m) => m.dungeon === group && !m.world);

/**
 * The objects a start's body names that are not on a floor it runs on: (row, the floors without it). On those
 * floors the statements that act on the object are skipped (nodeCharaRows).
 */
export function startMissingRows(
  maps: LanaiMaps,
  group: number,
  body: ScriptNode[],
  map?: number,
): { row: number; floors: string[] }[] {
  const floors = groupFloors(maps, group).filter((m) => map === undefined || m.hash === map);
  const rows = floors.map((m) => ({ m, rows: mapEventRows(maps, m) }));
  return [...new Set(charaRows(body))].flatMap((row) => {
    const without = rows.filter((x) => !x.rows.has(row)).map((x) => x.m.name);
    return without.length ? [{ row, floors: without }] : [];
  });
}

/** The MonsterGroup values ScriptMap.EncountBoss names in a body (its first argument), each once. */
export function battleGroups(body: ScriptNode[]): number[] {
  const out: number[] = [];
  const walk = (list: ScriptNode[]): void => {
    for (const n of list) {
      const group = n.op === 'call' && n.call.name === 'ScriptMap::EncountBoss' ? n.call.args[0] : undefined;
      if (group?.k === 'i') {
        if (!out.includes(group.v)) out.push(group.v);
      } else for (const b of scriptBodies(n)) walk(b);
    }
  };
  walk(body);
  return out;
}

/**
 * The row of the content's MonsterGroup an EncountBoss value names as the game looks it up (FUN_0031C038): a value below
 * 0x80000000 is a row number, else a row ID. -1 when there is no such row (the game would fight row 0, the empty one).
 */
export function battleRow(t: LanaiTable | undefined, value: number): number {
  if (!t) return -1;
  if (value < 0x80000000) return value < t.rows ? value : -1;
  return t.find(value >>> 0);
}

/** The script read and held against the content's maps. Throws a ScriptError when the script does not read. */
export async function checkStageScript(s: LanaiSession, c: LanaiContent, source: string): Promise<StageScriptCheck> {
  const script = parseStageScript(source);
  const maps = await lanaiMaps(s, c);
  const problems: string[] = [],
    notes: string[] = [];
  const intros: Record<number, IntroSpec> = {};
  let introCount = 0;
  for (const e of script.events) {
    const floor = e.map === undefined ? undefined : maps.maps.find((m) => m.hash === e.map);
    const where = triggerHasRow(e.trigger)
      ? ` のイベント ${e.row}`
      : e.map !== undefined
        ? ` の ${floor?.name ?? hexId(e.map)}`
        : '';
    const what = e.fn
      ? `関数「${e.fn}」(MapGroup ${e.group}${where}、${SCRIPT_TRIGGER_LABEL[e.trigger]})`
      : `${e.line} 行目 on ${e.trigger}(${e.group}, ${e.map !== undefined ? hexId(e.map) : e.row})`;
    const t = maps.eventTable(e.group);
    if (!maps.groups[e.group] || !t) {
      problems.push(`${what}: MapGroup ${e.group} がこのステージにありません`);
      continue;
    }
    if (e.map !== undefined && (!floor || floor.dungeon !== e.group || floor.world)) {
      problems.push(`${what}: マップ ${hexId(e.map)} は MapGroup ${e.group} の階層ではありません`);
      continue;
    }
    if (e.trigger === 'start') {
      // a start runs on every floor it is of: an object not on one of them is skipped there
      for (const x of startMissingRows(maps, e.group, e.body, e.map))
        if (x.floors.length < groupFloors(maps, e.group).length || e.map !== undefined)
          notes.push(
            `${what}: obj(${x.row}) は ${x.floors.join('・')} にないので、そこではこのオブジェクトを使う文を飛ばします${e.map === undefined ? ' (その階層だけの処理は「この階層が始まるとき」に割り当てられます)' : ''}`,
          );
    }
    const records = eventRecords(maps, e.group);
    // the states the body reads or writes are kept in the rows' slots: a slot beyond the group's count is not kept
    const stateRows = new Set(
      [...JSON.stringify(e.body).matchAll(/"name":"state\((\d+)\)"/gu)].map((m) => Number(m[1])),
    );
    if (triggerHasRow(e.trigger) && usesOwnState(e.body)) stateRows.add(e.row);
    for (const r of stateRows) {
      const slot = r < t.rows ? lanaiEventSlot(t, r) : -1;
      if (slot < 0) problems.push(`${what}: state のイベント ${r} がありません (${t.name} は ${t.rows} 行)`);
      else if (slot >= maps.groups[e.group]!.stateCount)
        problems.push(
          `${what}: イベント ${r} の状態の枠 ${slot} が MapGroup ${e.group} の枠の数 ${maps.groups[e.group]!.stateCount} 以上なので、state を読み書きできません (いつも 0)`,
        );
    }
    // the characters the body names: a row no character's record has gives the game nothing to act on
    for (const r of new Set(charaRows(e.body)))
      if (!records.get(r)?.length)
        notes.push(
          `${what}: obj(${r}) のイベント ${r} を使うレコード (キャラ・物・扉) が MapGroup ${e.group} のマップにありません`,
        );
    for (const g of battleGroups(e.body)) {
      const mg = maps.monsterGroup;
      if (battleRow(mg, g) < 0)
        problems.push(
          `${what}: ScriptMap.EncountBoss(${g}, …) の群れがありません。引数は MonsterGroup の行番号 (0〜${(mg?.rows ?? 1) - 1}) です (行 ID ではありません。ないと空の群れ (行 0) と戦います)`,
        );
      else if (g === 0 || battleRow(mg, g) === 0)
        notes.push(`${what}: ScriptMap.EncountBoss(${g}, …) は MonsterGroup の行 0 (空の群れのことが多い) と戦います`);
    }
    if (e.trigger === 'intro') {
      // one bit flag per intro after the script's bit variables: "played in this visit"
      const opening = groupOpening(maps, e.group);
      const flag = STAGE_BIT_FLAGS.first + script.vars.filter((v) => v.kind === 'bit').length + introCount++;
      if (!opening) problems.push(`${what}: MapGroup ${e.group} の最初のマップがありません`);
      else if (!inRange(flag, STAGE_BIT_FLAGS))
        problems.push(`${what}: bit の変数が多すぎて入場の演出のフラグがとれません`);
      else {
        intros[e.group] = { map: opening.map, flag, gate: opening.gate };
        if (opening.note) notes.push(`${what}: ${opening.note}`);
      }
    }
    if (!triggerHasRow(e.trigger)) continue;
    const recs = records.get(e.row) ?? [];
    if (e.row < t.rows && !recs.length)
      notes.push(`${what}: イベント ${e.row} を使うレコードがマップにありません (置かれていないイベントは起きません)`);
    else if (e.row < t.rows && !recs.some((x) => triggerFitsRecord(e.trigger, x)))
      notes.push(
        `${what}: イベント ${e.row} のレコードは「${SCRIPT_TRIGGER_LABEL[e.trigger]}」の種類ではありません (ゲームはレコードの区画と種類でイベントの種類を決めるので、このままでは呼ばれません)`,
      );
    if (e.row >= t.rows) problems.push(`${what}: イベント ${e.row} がありません (${t.name} は ${t.rows} 行)`);
    else if (t.u32(e.row, LANAI_EVENT_ACTIONS[0]) !== LANAI_ACTION_SCRIPT)
      problems.push(
        `${what}: イベント ${e.row} の動作 1 が「スクリプト (CRO)」ではありません。マップのページでそのレコードの動作 1 の型を 2D にしてください`,
      );
    else if (LANAI_EVENT_ACTIONS.slice(1).some((o) => ![0, 0x80000000, LANAI_ACTION_SCRIPT].includes(t.u32(e.row, o))))
      notes.push(`${what}: 動作 2・3 に別の型があるので、2 回目からはスクリプトではなくその型が動きます`);
  }
  // the bosses of the data: the game writes 2 before the battle, so a lost battle leaves "beaten" unless it is reset
  const resets: LeaveReset[] = [];
  for (let g = 0; g < maps.groups.length; g++) {
    const t = maps.groups[g] ? maps.eventTable(g) : undefined;
    if (!t) continue;
    for (let r = 0; r < t.rows; r++)
      for (const o of LANAI_EVENT_ACTIONS) {
        if (t.u32(r, o) !== ACTION_BOSS) continue;
        const flag = t.u32(r, o + 8) & 0xffff;
        if (!inRange(flag, STAGE_BYTE_FLAGS))
          notes.push(
            `MapGroup ${g} のイベント ${r} のボス戦が書く数値フラグ ${flag} はこのステージのものではありません (${STAGE_BYTE_FLAGS.first}〜 の変数の番号にすると、ステージを離れるときに戻ります)`,
          );
        else if (!resets.some((x) => x.flag === flag)) resets.push({ kind: 'byte', flag });
      }
  }
  // what the stage owns: its variables and the event states of its map groups
  const owned: OwnedRange[] = [];
  const count = (kind: 'byte' | 'bit'): number => script.vars.filter((v) => v.kind === kind).length;
  const bytes = Math.max(count('byte'), ...resets.map((r) => r.flag - STAGE_BYTE_FLAGS.first + 1));
  if (bytes > 0) owned.push({ field: 'byte', first: STAGE_BYTE_FLAGS.first, count: bytes });
  // the intros' bits follow the bit variables
  const bits = count('bit') + introCount;
  if (bits) owned.push({ field: 'bit', first: STAGE_BIT_FLAGS.first, count: bits });
  const states = maps.groups
    .filter((g) => g && g.stateCount > 0)
    .map((g) => ({ first: g.stateFirst, count: g.stateCount }))
    .sort((a, b) => a.first - b.first);
  let merged: { first: number; count: number }[] = [];
  for (const r of states) {
    const last = merged[merged.length - 1];
    if (last && r.first <= last.first + last.count) last.count = Math.max(last.count, r.first + r.count - last.first);
    else merged.push({ ...r });
  }
  if (merged.length > MAX_OWNED - owned.length) {
    const first = merged[0]!.first,
      end = Math.max(...merged.map((r) => r.first + r.count));
    notes.push(
      `MapGroup の状態の枠が ${merged.length} か所に分かれているので、${first}〜${end - 1} をまとめてこのステージのものにします`,
    );
    merged = [{ first, count: end - first }];
  }
  for (const r of merged) owned.push({ field: 'state', ...r });
  return { script, problems, notes, resets, owned, intros };
}

/** The contents that have a script, with it. */
function scripted(s: LanaiSession): { c: LanaiContent; key: string; source: string }[] {
  const out: { c: LanaiContent; key: string; source: string }[] = [];
  for (const c of lanaiContents(s)) {
    const x = c && s.stageScripts.get(c.archive.toUpperCase());
    if (c && x) out.push({ c, ...x });
  }
  return out;
}

/**
 * Builds the scripts into the MOD's files: each scripted stage's archive gets the built CRO in place of its own, and
 * its CRR registers it. Throws when a script has a problem (the stage would not work).
 */
export async function buildStageScripts(s: LanaiSession, files: Map<string, Uint8Array>): Promise<void> {
  const list = scripted(s);
  if (!list.length) return;
  const template = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT];
  if (!template) throw new Error(`空のスクリプトのひな形 (コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT}) がありません`);
  const empty = await contentScript(s, template, await s.archive(template.archive));
  const base = parseCro(empty.body);
  for (const { c, source } of list) {
    const name = c.stages[0]?.name || `コンテンツ ${c.index}`;
    const check = await checkStageScript(s, c, source);
    if (check.problems.length) throw new Error(`「${name}」のイベントのスクリプト: ${check.problems[0]}`);
    const cro = buildCro(compileStageScript(base, check.script, check.resets, check.intros, c.index).cro);
    const bytes = files.get(c.archive) ?? s.createdFiles.get(c.archive);
    if (!bytes) throw new Error(`「${name}」のアーカイブ ${c.archive} が MOD にありません`);
    const arc = parseArchive(bytes);
    const def = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')?.table;
    const entry = def && def.rows >= 3 ? findEntry(arc, def.u32(2, 0)) : undefined;
    if (!entry) throw new Error(`「${name}」の ContentsDef の CRO がありません`);
    const rebuilt = rebuildArchive(arc, new Map([[entry.index, cro]]));
    files.set(c.archive, rebuilt);
    files.set(lanaiCrrName(c.index), stageScriptCrr(empty.crr, cro));
  }
}

/** LANAI_STAGE_SOURCE for the scripted stages, or null when there is none. */
export function stageScriptSources(s: LanaiSession): Uint8Array | null {
  const list = scripted(s);
  if (!list.length) return null;
  const stages: Record<string, LanaiStageSource> = {};
  for (const { c, key } of list)
    stages[String(c.index)] = {
      archive: c.archive,
      stageKey: key,
      doc: s.stageScripts.get(c.archive.toUpperCase())!.doc,
    };
  return new TextEncoder().encode(`${JSON.stringify({ format: 1, stages }, null, 2)}
`);
}

/** lanai-stage.json for the scripted stages, or null when there is none. */
export async function stageScriptManifest(s: LanaiSession): Promise<Uint8Array | null> {
  const list = scripted(s);
  const stages: Record<string, { stageKey: string; owned: OwnedRange[] }> = {};
  // the stages imported with their built CRO alone (a release zip): what came with them
  for (const c of lanaiContents(s)) {
    const x = c && s.importedStages.get(c.archive.toUpperCase());
    if (c && x) stages[String(c.index)] = { stageKey: x.key, owned: x.owned };
  }
  for (const { c, key, source } of list)
    stages[String(c.index)] = { stageKey: key, owned: (await checkStageScript(s, c, source)).owned };
  if (!Object.keys(stages).length) return null;
  return new TextEncoder().encode(`${JSON.stringify({ format: 1, stages }, null, 2)}\n`);
}
