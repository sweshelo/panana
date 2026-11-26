// Ported from lanai-custom-stages web/stage-events.ts (99304a5); the uwapo there is kept in parallel.
// LCSE v1: the custom-stage state section appended to a stage's rows file (3ds/runtime/stage-state.inc).
//   rows = LCSR || LCSE || { u32 "LCSE", u32 LCSE bytes }
//   LCSE +0 "LCSE", +4 u16 version 1, +6 u16 event count, +8 stageKey (16 bytes),
//        +0x18 owned[4] { u16 field, u16 count, u16 first, u16 0 }. v1 carries no events (count 0): stage events are
//        the game's own (native conditions / actions / CRO).
// Source: an optional `lanai-stage.json` in the Panana ZIP: { "format": 1, "stages": { "<content>": StageEventSpec } }.
// Without it a stage has no stageKey: the 3DS keeps its script state private but only for one visit.

export const LCSE_MAGIC = 0x4553434c;
export const LCSE_HEADER = 0x38;
export const LCSE_EVENT = 0x18;
export const MAX_OWNED = 4;

/** Script-state spaces: game bit / byte / clear flags (main +0x54) and per-MapGroup event state (main +0x58 field 3). */
export const STATE_FIELDS = { bit: 0x51, byte: 0x52, clear: 0x53, state: 0x103 } as const;
export type StateField = keyof typeof STATE_FIELDS;
/** Element counts of the game's FlagData definitions (research/script-state-verify.ts); state is bounded by u16. */
export const FIELD_LIMITS: Record<StateField, number> = { bit: 25000, byte: 12500, clear: 700, state: 0x10000 };

export interface OwnedRange {
  field: StateField;
  first: number;
  count: number;
}

export interface StageEventSpec {
  /** Created once per stage by the editor and kept across updates; never derived from content numbers or hashes. */
  stageKey: string;
  /** Indexes that belong to this stage: they read 0 until written instead of reading through to the main save. */
  owned?: OwnedRange[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a spec; throws a Japanese message naming the problem. */
export function checkStageEvents(spec: StageEventSpec): void {
  if (!UUID.test(spec.stageKey ?? '')) throw new Error('stageKey は UUID 形式で指定してください');
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(spec.stageKey)) throw new Error('stageKey にすべて 0 は使えません');
  const owned = spec.owned ?? [];
  if (owned.length > MAX_OWNED) throw new Error(`所有範囲は ${MAX_OWNED} 個までです`);
  for (const r of owned) {
    if (!(r.field in STATE_FIELDS)) throw new Error(`不明な状態の種類: ${r.field}`);
    if (!Number.isInteger(r.first) || !Number.isInteger(r.count) || r.first < 0 || r.count < 1 || r.count > 0xffff)
      throw new Error(`所有範囲 ${r.field} ${r.first}+${r.count} が不正です`);
    if (r.first + r.count > FIELD_LIMITS[r.field])
      throw new Error(`所有範囲 ${r.field} ${r.first}+${r.count} がゲームの上限 ${FIELD_LIMITS[r.field]} を超えます`);
  }
}

function keyBytes(stageKey: string): Uint8Array {
  return Uint8Array.from(stageKey.replaceAll('-', '').match(/../g)!, (h) => parseInt(h, 16));
}

export function lcseBinary(spec: StageEventSpec): Uint8Array {
  checkStageEvents(spec);
  const out = new Uint8Array(LCSE_HEADER);
  const v = new DataView(out.buffer);
  v.setUint32(0, LCSE_MAGIC, true);
  v.setUint16(4, 1, true);
  v.setUint16(6, 0, true);
  out.set(keyBytes(spec.stageKey), 8);
  (spec.owned ?? []).forEach((r, k) => {
    v.setUint16(0x18 + k * 8, STATE_FIELDS[r.field], true);
    v.setUint16(0x1a + k * 8, r.count, true);
    v.setUint16(0x1c + k * 8, r.first, true);
  });
  return out;
}

/** rows || lcse || footer. The LCSR length is always a multiple of 4, so the section stays aligned. */
export function appendLcse(rows: Uint8Array, lcse: Uint8Array): Uint8Array {
  if (rows.length % 4 || lcse.length % 4) throw new Error('rows / LCSE の長さが 4 の倍数ではありません');
  const out = new Uint8Array(rows.length + lcse.length + 8);
  out.set(rows);
  out.set(lcse, rows.length);
  const v = new DataView(out.buffer);
  v.setUint32(out.length - 8, LCSE_MAGIC, true);
  v.setUint32(out.length - 4, lcse.length, true);
  return out;
}

/** The spec of one content number from a parsed lanai-stage.json, or null. */
export function stageEventsFor(json: unknown, content: number): StageEventSpec | null {
  if (json === undefined || json === null) return null;
  const doc = json as { format?: number; stages?: Record<string, StageEventSpec> };
  if (doc.format !== 1 || typeof doc.stages !== 'object' || !doc.stages)
    throw new Error('lanai-stage.json の形式が不正です (format 1)');
  return doc.stages[String(content)] ?? null;
}
