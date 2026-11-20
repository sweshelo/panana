// The move() / walk() calls (library functions) of the stage's event script (eventScript.ts) as points on a map:
// where each sends whom, read from the functions' text and written back into it when a point is dragged on the map's
// page (mapview.ts). The game takes the position as a GSvec in world units: x and z are the ground (the map's columns and rows, a cell = 500, the
// middle of cell c = 250 + 500 × c), y is the height (0 = the floor). The ground is x / z as the game's own readers
// use it (IntroCommon::GetActionBeforePos takes x, z; RPG3 FUN_004C7048(x, z) looks up the cell under a position).
import { CELL } from '../game/sections';
import { triggerHasRow, type ScriptDoc } from './eventScript';

export type ScriptMoveWho = { kind: 'hero' } | { kind: 'self' } | { kind: 'chara'; row: number };

/** A move() or walk() in a function's text: whom it moves, where, and where its three numbers are written. */
export interface ScriptMove {
  who: ScriptMoveWho;
  x: number;
  y: number;
  z: number;
  /** The line of the statement (1-based) and the offsets of the x, y and z numbers in the text ([from, to)). */
  line: number;
  spans: [[number, number], [number, number], [number, number]];
}

const NUM = String.raw`-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)`;
const WHO = String.raw`hero|self|obj\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*\)`;
const XYZ = String.raw`(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*\)`;
/** move(who, x, y, z) and who.move(x, y, z), or walk: the object, then its row (obj), then x, y and z. */
const MOVE_RE = new RegExp(String.raw`\b(?:move|walk)\s*\(\s*(${WHO})\s*,\s*${XYZ}`, 'gu');
const METHOD_MOVE_RE = new RegExp(String.raw`(?<![\w.])(${WHO})\s*\.\s*(?:move|walk)\s*\(\s*${XYZ}`, 'gu');
const num = (s: string): number => (s.startsWith('-') ? -Number(s.slice(1)) : Number(s));

/** The moves (either form) of a function's text whose position is written as three numbers (not in comments). */
export function scriptMoves(body: string): ScriptMove[] {
  // comments become spaces, so the offsets stay those of the text
  const code = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  const found = [
    ...[...code.matchAll(MOVE_RE)].map((m) => ({ m, after: ',' })),
    ...[...code.matchAll(METHOD_MOVE_RE)].map((m) => ({ m, after: '(' })),
  ].sort((a, b) => a.m.index - b.m.index);
  return found.map(({ m, after }) => {
    const whoText = m[1]!;
    const who: ScriptMoveWho =
      whoText === 'hero'
        ? { kind: 'hero' }
        : whoText === 'self'
          ? { kind: 'self' }
          : { kind: 'chara', row: num(m[2]!) };
    // the numbers are the last three groups: find each after the one before it
    let at = m.index + m[0].indexOf(after, m[0].indexOf(whoText) + whoText.length);
    const spans = [m[3]!, m[4]!, m[5]!].map((s) => {
      const from = code.indexOf(s, at);
      at = from + s.length;
      return [from, at] as [number, number];
    }) as ScriptMove['spans'];
    return {
      who,
      x: num(m[3]!),
      y: num(m[4]!),
      z: num(m[5]!),
      line: code.slice(0, m.index).split('\n').length,
      spans,
    };
  });
}

/** A coordinate as the script writes it: whole numbers plainly, else with up to two decimals. */
export const coordText = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The text with the k-th move() sent to (x, y, z); the text unchanged when it has no such move(). */
export function withScriptMove(body: string, k: number, x: number, y: number, z: number): string {
  const m = scriptMoves(body)[k];
  if (!m) return body;
  const values = [x, y, z].map(coordText);
  let out = body;
  // from the last number, so the earlier offsets still hold
  for (let i = 2; i >= 0; i--) out = out.slice(0, m.spans[i]![0]) + values[i] + out.slice(m.spans[i]![1]);
  return out;
}

/** World units <-> the map's cells (x -> column, z -> row). */
export const worldToCell = (w: number): number => w / CELL;
export const cellToWorld = (c: number): number => c * CELL;

/** The move() statements of a function that runs on a map, in the order of its text. */
export interface MapScriptMoves {
  fn: string;
  /** The rows of the events the function is given to on this map (self is their character). */
  rows: number[];
  moves: ScriptMove[];
}

/**
 * The functions of a script that run on a map of a MapGroup, with their move() statements: those given to an event
 * of a record on the map (`rows`), and those the group's start or intro runs.
 */
export function mapScriptMoves(doc: ScriptDoc, group: number, rows: ReadonlySet<number>): MapScriptMoves[] {
  const out: MapScriptMoves[] = [];
  for (const f of doc.functions) {
    const bound = doc.bindings.filter(
      (b) => b.fn === f.name && b.group === group && (!triggerHasRow(b.trigger) || rows.has(b.row)),
    );
    if (!bound.length) continue;
    const moves = scriptMoves(f.body);
    if (!moves.length) continue;
    out.push({
      fn: f.name,
      rows: [...new Set(bound.filter((b) => triggerHasRow(b.trigger)).map((b) => b.row))],
      moves,
    });
  }
  return out;
}

/** The text of whom a move() moves. */
export const moveWhoText = (w: ScriptMoveWho): string =>
  w.kind === 'chara' ? `obj(${w.row})` : w.kind === 'hero' ? 'hero' : 'self';
