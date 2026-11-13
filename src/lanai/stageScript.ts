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
  parseStageScript,
  STAGE_BIT_FLAGS,
  STAGE_BYTE_FLAGS,
  stageScriptCrr,
  type LeaveReset,
  type StageScript,
} from './eventScript';
import { LANAI_EVENT_ACTIONS, lanaiMaps } from './maps';
import type { LanaiSession } from './session';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT, lanaiCrrName } from './stageEdit';

/** The file of the MOD zip (beside romfs/) that carries the keys and the owned flags of the scripted stages. */
export const LANAI_STAGE_MANIFEST = 'lanai-stage.json';
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
}

const inRange = (v: number, r: { first: number; count: number }): boolean => v >= r.first && v < r.first + r.count;

/** The script read and held against the content's maps. Throws a ScriptError when the script does not read. */
export async function checkStageScript(s: LanaiSession, c: LanaiContent, source: string): Promise<StageScriptCheck> {
  const script = parseStageScript(source);
  const maps = await lanaiMaps(s, c);
  const problems: string[] = [],
    notes: string[] = [];
  for (const e of script.events) {
    const what = `${e.line} 行目 on ${e.trigger}(${e.group}, ${e.row})`;
    const t = maps.eventTable(e.group);
    if (!maps.groups[e.group] || !t) problems.push(`${what}: MapGroup ${e.group} がこのステージにありません`);
    else if (e.row >= t.rows) problems.push(`${what}: イベント ${e.row} がありません (${t.name} は ${t.rows} 行)`);
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
  if (count('bit')) owned.push({ field: 'bit', first: STAGE_BIT_FLAGS.first, count: count('bit') });
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
  return { script, problems, notes, resets, owned };
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
    const cro = buildCro(compileStageScript(base, check.script, check.resets).cro);
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

/** lanai-stage.json for the scripted stages, or null when there is none. */
export async function stageScriptManifest(s: LanaiSession): Promise<Uint8Array | null> {
  const list = scripted(s);
  if (!list.length) return null;
  const stages: Record<string, { stageKey: string; owned: OwnedRange[] }> = {};
  for (const { c, key, source } of list)
    stages[String(c.index)] = { stageKey: key, owned: (await checkStageScript(s, c, source)).owned };
  return new TextEncoder().encode(`${JSON.stringify({ format: 1, stages }, null, 2)}\n`);
}
