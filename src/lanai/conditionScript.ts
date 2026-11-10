// A deliberately small, parsed language; no eval. Compiles boolean predicates to A32, calling the game's
// confirmed condition evaluator for leaves. 0x72 is outside vanilla's [0,0x71] jump table.
import type { CodePatch } from '../game/patch';
import { u32 } from '../util/bytes';
import { lanaiCode } from './code';
import type { LanaiSession } from './session';
export type ConditionExpr = { op: 'test'; kind: number; v1: number; v2: number } | { op: 'true' | 'false' } | { op: 'not'; value: ConditionExpr } | { op: 'and' | 'or'; left: ConditionExpr; right: ConditionExpr };
const predicates: Record<string, [number, number]> = { cleared: [1, 1], flag: [3, 1], valueEq: [5, 2], valueGe: [6, 2], valueLe: [7, 2], eventGe: [12, 2], eventLe: [13, 2], timer: [22, 1] };
export const CONDITION_SCRIPT_HELP = 'cleared(コンテンツ番号), flag(番号), valueEq/Ge/Le(番号, 値), eventGe/Le(イベント番号, 状態), timer(番号), true, false。! / && / || / ( ) で組み合わせます。';
export function parseConditionScript(source: string): ConditionExpr {
  const tokens = source.match(/\s+|&&|\|\||[!(),]|0x[\da-f]+|\d+|[A-Za-z_]\w*|./gi)?.filter(t => !/^\s+$/.test(t)) ?? [];
  if (tokens.length > 256) throw new Error('条件が長すぎます (256 トークンまで)');
  let i = 0;
  const take = (t: string): boolean => tokens[i] === t && (++i > 0);
  const need = (t: string): void => { if (!take(t)) throw new Error(`「${t}」が必要です (${i + 1} 番目)`); };
  const num = (): number => { const t = tokens[i++]; if (!t || !/^(0x[\da-f]+|\d+)$/i.test(t) || Number(t) > 0xffffffff) throw new Error('0〜4294967295 の整数を指定してください'); return Number(t); };
  const atom = (): ConditionExpr => {
    if (take('!')) return { op: 'not', value: atom() };
    if (take('(')) { const e = or(); need(')'); return e; }
    const name = tokens[i++];
    if (name === 'true' || name === 'false') return { op: name };
    const p = name && Object.hasOwn(predicates, name) && predicates[name]; if (!p) throw new Error(`未知の条件: ${name ?? '(空)'}`);
    need('('); const v1 = num(); if (v1 > 0xffff) throw new Error('番号は 0〜65535 で指定してください');
    let v2 = 0; if (p[1] === 2) { need(','); v2 = num(); } need(')');
    return { op: 'test', kind: p[0], v1, v2 };
  };
  const and = (): ConditionExpr => { let e = atom(); while (take('&&')) e = { op: 'and', left: e, right: atom() }; return e; };
  const or = (): ConditionExpr => { let e = and(); while (take('||')) e = { op: 'or', left: e, right: and() }; return e; };
  const e = or(); if (i !== tokens.length) throw new Error(`解釈できません: ${tokens[i]}`); return e;
}
export function conditionScriptPatch(s: LanaiSession): CodePatch | null {
  if (!s.conditionScripts.size) return null;
  const code = lanaiCode(s.dump);
  if (u32(code, 0x2fcd38 - 0x100000) !== 0xe92d40f0) throw new Error('条件判定関数が既に変更されています');
  const lines = ['@0x2FCD38', 'b condition_dispatch', '@cave condition_dispatch', 'cmp r0, #0x72', 'beq condition_custom', 'push {r4, r5, r6, r7, lr}', 'b FUN_002fcd3c', 'condition_custom:'];
  for (const [id] of s.conditionScripts) lines.push(`ldr ip, =${id}`, 'cmp r1, ip', `beq condition_${id}`);
  lines.push('mov r0, #0', 'bx lr');
  let serial = 0;
  function emit(e: ConditionExpr): void {
    switch (e.op) {
      case 'true': case 'false': lines.push(`mov r0, #${e.op === 'true' ? 1 : 0}`); break;
      case 'test':
        // Eight-byte aligned stack, including the two unused output-pointer parameters of FUN_002FCD38.
        lines.push(`mov r0, #${e.kind}`, `ldr r1, =${e.v1}`, `ldr r2, =${e.v2}`, 'mov r3, #0', 'str r3, [sp]', 'str r3, [sp, #4]', 'bl FUN_002fcd38'); break;
      case 'not': emit(e.value); lines.push('cmp r0, #0', 'moveq r0, #1', 'movne r0, #0'); break;
      case 'and': case 'or': { const label = `condition_short_${serial++}`; emit(e.left); lines.push('cmp r0, #0', `${e.op === 'and' ? 'beq' : 'bne'} ${label}`); emit(e.right); lines.push(`${label}:`); break; }
    }
  }
  for (const [id, source] of s.conditionScripts) { lines.push(`condition_${id}:`, 'push {r4, lr}', 'sub sp, sp, #8'); emit(parseConditionScript(source)); lines.push('add sp, sp, #8', 'pop {r4, pc}'); }
  return { id: 'lanai:conditions', title: '条件スクリプト', enabled: true, source: lines.join('\n') };
}
