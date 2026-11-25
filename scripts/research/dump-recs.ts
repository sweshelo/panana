// Dump records of RPG FREE! maps and their EventObject rows' actions: bun scripts/research/dump-recs.ts 22.D01001B01@3.0 ...
import { lanaiContents } from '../../src/lanai/contents';
import { LanaiMaps, LANAI_EVENT_ACTIONS } from '../../src/lanai/maps';
import { lanaiActionName } from '../../src/lanai/actions';
import { lanaiRecEventRow } from '../../src/lanai/mapedit';
import { LanaiSession } from '../../src/lanai/session';
import { openImages } from '../../src/rom/dump';
import { hex8 } from '../../src/util/bytes';
import { LANAI_BASE, LANAI_UPDATE } from '../../test/env';

const dump = await openImages(
  [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
  (f) => (f as unknown as { name: string }).name,
);
const s = await LanaiSession.open(dump);
const cs = lanaiContents(s);
for (const arg of process.argv.slice(2)) {
  const m = /^(\d+)\.(\w+)(?:@(\d+)\.(\d+))?$/.exec(arg)!;
  const c = cs.find((c) => c.index === Number(m[1]))!;
  const maps = await LanaiMaps.load(s, c);
  const info = maps.mapByName(m[2]!)!;
  const doc = maps.doc(info);
  const t = maps.eventTable(info.dungeon);
  console.log(`== ${arg} archive ${c.archive} hash ${hex8(info.hash)} group ${info.dungeon} floor ${info.floor}`);
  const secs = m[3] ? [Number(m[3])] : [3, 4, 5, 8];
  for (const sec of secs)
    (doc.recs[sec] ?? []).forEach((r, i) => {
      if (m[4] && i !== Number(m[4])) return;
      const ev = lanaiRecEventRow(sec, r.raw);
      console.log(`  ${sec}.${i} raw ${Buffer.from(r.raw).toString('hex')} ev ${ev}`);
      if (!t || !ev || ev >= t.rows) return;
      const row = t.row(ev);
      console.log(`    EO ${Buffer.from(row).toString('hex')}`);
      for (const o of LANAI_EVENT_ACTIONS) {
        const ty = t.u32(ev, o);
        const args = Array.from({ length: 5 }, (_, k) => hex8(t.u32(ev, o + 4 + k * 4)));
        console.log(`    @${o.toString(16)} ${lanaiActionName(ty)} [${args.join(' ')}]`);
      }
    });
}
