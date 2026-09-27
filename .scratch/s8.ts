import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { CIA } from '../test/env';
const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const counts = new Map<string, number>();
for (const info of game.editableMaps()) {
  const doc = game.doc(info);
  const ev = await game.eventTable(info.dungeon);
  for (const rec of doc.recs[8] ?? []) {
    const r = rec.raw; const row = r[0]! | (r[1]! << 8);
    const k = ev?.has(row) ? ev.kind(row) : -1;
    const key = hex(r.subarray(8));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (['D05F01003','F07OUT000','D01B02001','E01OUT000'].includes(info.name)) console.log(info.name, row, 'kind', k?.toString(16), hex(r), ev?.has(row) ? hex(ev.table.row(row).subarray(0x44)) : '');
  }
}
console.log(counts);
