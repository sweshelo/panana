def rep(s,a,b,cnt=1):
    assert s.count(a)>=1, a[:70]
    return s.replace(a,b)
p='src/game/boss.ts'
s=open(p,encoding='utf-8').read()
i=s.index("/** Saved patches with the boss patch's source")
s=s[:i]+"""/** The boss patch: exported in code.ips whenever an event table has a boss row (it is Panana's, not in the patch list). */
export const BOSS_PATCH: CodePatch = { id: BOSS_PATCH_ID, title: BOSS_PATCH_TITLE, source: BOSS_PATCH_SOURCE, enabled: true };

/** A boss row in any of the tables (kind 0x31 in +0x4D / +0x4E / +0x4F). */
export function usesBoss(tables: Iterable<EventTable>): boolean {
  for (const t of tables)
    for (let row = 0; row < t.rows; row++) if (STAGE_KIND.some((o) => t.table.row(row)[o] === KIND_BOSS)) return true;
  return false;
}
"""
s=rep(s,"""import type { CodePatch } from './patch';
""","""import type { CodePatch } from './patch';
import type { EventTable } from './events';
""")
s=rep(s,"""// The kind needs a code patch, which Panana writes into code.ips itself (the "ボス戦" patch below).""","""// The kind needs a code patch, which Panana adds to code.ips itself when a boss row exists (BOSS_PATCH below).""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/controller.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""        if (stamp.type === 'boss') st.game.codePatches = ensureBossPatch(st.game.codePatches);
""","")
s=rep(s,"""
import { ensureBossPatch } from '../game/boss';""","")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/events.tsx'
s=open(p,encoding='utf-8').read()
s=rep(s,"""        <select value={kind} onChange={(e) => apply(() => {
          const k = Number(e.target.value);
          ev.table.row(row)[0x4d] = k;
          if (k === KIND_BOSS) game.codePatches = ensureBossPatch(game.codePatches);
        })}>""","""        <select value={kind} onChange={(e) => apply(() => (ev.table.row(row)[0x4d] = Number(e.target.value)))}>""")
s=rep(s,"""import { ensureBossPatch, KIND_BOSS } from '../game/boss';
""","")
open(p,'w',encoding='utf-8').write(s)

p='src/session.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""    if (edits.patches) game.codePatches = refreshBossPatch(edits.patches);""","""    if (edits.patches) game.codePatches = edits.patches;""")
s=rep(s,"""
import { refreshBossPatch } from './game/boss';""","")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/validate.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""        if (!game.codePatches.some((p) => p.id === BOSS_PATCH_ID && p.enabled))
          out.push({ level: 'error', msg: `${name} がありますが、コードのパッチ「ボス戦」が入っていません`, target, key: `bosspatch/${row}` });
""","")
s=rep(s,"""import { BOSS_PATCH_ID, fixGroup,""","""import { fixGroup,""")
open(p,'w',encoding='utf-8').write(s)

p='src/export/pack.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""export function modPackage(game: Game, files: Map<string, Uint8Array>): Map<string, Uint8Array> {""","""export function modPackage(game: Game, files: Map<string, Uint8Array>, extra: CodePatch[] = []): Map<string, Uint8Array> {""")
s=rep(s,"""  const ips = codeIps(game);""","""  const ips = codeIps(game, extra);""")
s=rep(s,""" * code.ips of the MOD: the base MOD's, plus the tables of the new maps when there are any (or when the base has
 * an older extension, which is rebuilt). docs/new-map.md §2.
 */
export function codeIps(game: Game): Uint8Array | null {""",""" * code.ips of the MOD: the base MOD's, plus the tables of the new maps when there are any (or when the base has
 * an older extension, which is rebuilt; docs/new-map.md §2), the enabled code patches and `extra` (Panana's own
 * patches, e.g. game/boss.ts BOSS_PATCH).
 */
export function codeIps(game: Game, extra: CodePatch[] = []): Uint8Array | null {""")
s=rep(s,"""  const records = patchRecords(buildPatches(game.dump.code, game.codePatches.filter((p) => p.enabled)).values());""","""  const records = patchRecords(buildPatches(game.dump.code, exportedPatches(game, extra)).values());""")
s=rep(s,"""const addedMap = (m: MapInfo): AddedMap => ({""","""/** The code patches written to code.ips: the enabled ones of the patch list, then `extra`. */
export const exportedPatches = (game: Game, extra: CodePatch[] = []): CodePatch[] => [...game.codePatches.filter((p) => p.enabled), ...extra];

const addedMap = (m: MapInfo): AddedMap => ({""")
s=rep(s,"""import { buildPatches, patchRecords } from '../game/patch';""","""import { buildPatches, patchRecords, type CodePatch } from '../game/patch';""")
open(p,'w',encoding='utf-8').write(s)

p='src/ui/ExportDialog.tsx'
s=open(p,encoding='utf-8').read()
s=rep(s,"""    const patches = game.codePatches.filter((p) => p.enabled);""","""    // Panana's own patches, when their data is used (boss battles: game/boss.ts)
    const extra = usesBoss(st.events.values()) ? [BOSS_PATCH] : [];
    const patches = exportedPatches(game, extra);""")
s=rep(s,"""    return { docs, events, issues, changes, shops, worlds: session.worldSections() };""","""    return { docs, events, issues, changes, shops, worlds: session.worldSections(), extra };""")
s=rep(s,"""      const pkg = modPackage(game, files);""","""      const pkg = modPackage(game, files, what.extra);""")
s=rep(s,"""import { buildModFiles, buildModZip, modPackage } from '../export/pack';""","""import { buildModFiles, buildModZip, exportedPatches, modPackage } from '../export/pack';
import { BOSS_PATCH, usesBoss } from '../game/boss';""")
open(p,'w',encoding='utf-8').write(s)
