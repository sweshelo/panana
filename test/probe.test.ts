// Temporary probe (removed before review): message file ranges.
import { expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { CIA, hasCia } from './env';
import { u32 } from '../src/util/bytes';

test.skipIf(!hasCia)('probe', async () => {
  const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  const t = game.master.texts;
  for (const f of [...t.files, ...t.readings]) console.log(`file ${f.entryIndex} ${f.name} ${f.gmsg.first}-${f.gmsg.last} reading=${f.gmsg.reading} editable=${f.editable}`);
  const at = game.master.table('actionData.bin');
  const ids = Array.from({ length: at.rows }, (_, i) => u32(at.row(i), 4)).filter(Boolean);
  console.log('action name ids', Math.min(...ids), Math.max(...ids));
  expect(t.files.length).toBeGreaterThan(0);
});
