// Builds small test MODs for verifying the RPG FREE! (lanai) export in the game (docs/lanai-mod-verification.md, #109).
// Usage: bun scripts/lanai-test-mods.ts <base.cia> <update.cia> [outDir]   (decrypted CIAs, as test/env.ts)
// One zip per check, each with a single edit, so a failure points at one mechanism. Load a zip as a LayeredFS MOD.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller } from '../src/editor/controller';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiEditState } from '../src/lanai/mapedit';
import { lanaiMaps } from '../src/lanai/maps';
import { lanaiCopyActionInto, lanaiCopyStats, lanaiSetTransformTarget, lanaiStatsOf } from '../src/lanai/monsterStats';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';

const [base, update, out = 'lanai-test-mods'] = process.argv.slice(2);
if (!base || !update) throw new Error('usage: bun scripts/lanai-test-mods.ts <base.cia> <update.cia> [outDir]');
mkdirSync(out, { recursive: true });

const open = async (): Promise<LanaiSession> => {
  const dump = await openImages([Bun.file(base), Bun.file(update)], (f) => (f as unknown as { name: string }).name);
  return LanaiSession.open(dump, { fresh: true });
};
const emit = (name: string, s: LanaiSession, note: string): void => {
  const files = [...s.modFiles()].map(([n, b]) => `${n} (${b.length} bytes)`).join(', ');
  writeFileSync(join(out, `${name}.zip`), s.modZip());
  console.log(`${name}.zip: ${note}\n  files: ${files}`);
};

// M1 ability row appended: 強化 たからばこぞう (monster 41) with its own copied row, HP raised
{
  const s = await open();
  const row = lanaiCopyStats(s, 41);
  const ref = lanaiStatsOf(s, 41)!;
  s.rows(ref.table).set(row, 'hpHi', 9999);
  s.rows(ref.table).set(row, 'hpLo', 9999);
  emit('m1-ability-row', s, `monster 41 → new ${ref.table} row ${row} (HP 9999)`);
}

// M2 ActionData row appended: monster 41's skill2 (the hide-in-box transform) copied; target unchanged
{
  const s = await open();
  const ref = lanaiStatsOf(s, 41)!;
  const id = s.rows(ref.table).get(ref.row, 'skill2');
  const nid = lanaiCopyActionInto(s, id, ref, 0x58);
  emit('m2-action-row', s, `monster 41 skill slot +0x58: action ${id} → copy ${nid} (same behaviour expected)`);
}

// M3 transform target changed: the copied action now turns monster 41 into monster 45 instead of 42
{
  const s = await open();
  const ref = lanaiStatsOf(s, 41)!;
  const id = s.rows(ref.table).get(ref.row, 'skill2');
  const nid = lanaiCopyActionInto(s, id, ref, 0x58);
  lanaiSetTransformTarget(s, nid, 45, ref);
  emit('m3-transform-target', s, `monster 41 transform → monster 45 (action ${nid})`);
}

// Map edits on content 38, map D01001B01 (as test/lanai-mapedit.test.ts)
const mapStep = async (name: string, note: string, edit: (c: Controller, st: ReturnType<typeof lanaiEditState>) => void): Promise<void> => {
  const s = await open();
  const maps = await lanaiMaps(s, lanaiContents(s)[38]!);
  const info = maps.mapByName('D01001B01')!;
  const st = lanaiEditState(maps);
  st.open(info);
  const before = st.current!.tiles.length + '/' + Object.values(st.current!.recs).map((r) => r.length).join(',');
  edit(new Controller(st), st);
  const after = st.current!.tiles.length + '/' + Object.values(st.current!.recs).map((r) => r.length).join(',');
  if (before === after && name !== 'p1-tile-in-place') console.warn(`  WARNING ${name}: tile/record counts did not change (${before})`);
  emit(name, s, `${note}; tiles/records ${before} → ${after}`);
};

await mapStep('p1-tile-in-place', 'one tile repainted (same size; control)', (ctl, st) => {
  const t = st.current!.tiles.find((x) => x.kind === 5)!;
  st.brush = { kind: 14, letter: 0x7a, rot: 1 };
  st.setTool('paint');
  ctl.down(t.x + 0.5, t.y + 0.5, { shiftKey: false, button: 0 });
  ctl.up();
});
await mapStep('p2-record-added', 'exit 0 duplicated (record section grows)', (ctl, st) => {
  st.select({ type: 'rec', section: 3, index: 0 });
  ctl.duplicateRec();
});
await mapStep('p3-record-removed', 'exit 0 deleted (record section shrinks)', (ctl, st) => {
  st.select({ type: 'rec', section: 3, index: 0 });
  ctl.deleteSelection();
});
