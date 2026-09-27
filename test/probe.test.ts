// Temporary probe (removed before review): directData rows used by skills, and the action name files.
import { expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { ActionBook } from '../src/game/actions';
import { openImage } from '../src/rom/dump';
import { CIA, hasCia } from './env';
import { u16, u32 } from '../src/util/bytes';

test.skipIf(!hasCia)('probe', async () => {
  const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  const book = await game.monsters();
  const dd = book.directData!;
  const at = game.master.table('actionData.bin');
  console.log('directData rows', dd.rows, 'size', dd.rowSize, 'index', dd.indexOffset, 'actionData rows', at.rows, 'size', at.rowSize, 'index', at.indexOffset);
  const actions = new ActionBook(game.master, (r) => book.monster(r)?.name ?? '', dd);
  const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const perfUsers = new Map<number, number[]>();
  for (const a of actions.actions) if (a.performance) perfUsers.set(a.performance, [...(perfUsers.get(a.performance) ?? []), a.row]);
  console.log('perf rows used', perfUsers.size, 'shared', [...perfUsers].filter(([, v]) => v.length > 1).length, 'max perf', Math.max(...perfUsers.keys()));
  for (const m of book.monsters.filter((m) => /まおう|魔王/.test(m.name) || m.boss || m.nextForm)) {
    console.log(`#${m.row} ${m.name} design ${m.design} boss ${m.boss} next ${m.nextForm}`);
    for (const s of m.skills) {
      const a = actions.action(s.action)!;
      console.log(`   act ${s.action} ${a.name} kind ${a.kind} type ${a.type} perf ${a.performance} [${hex(a.raw)}] dd [${a.performance < dd.rows ? hex(dd.row(a.performance)) : '-'}] users ${perfUsers.get(a.performance)?.join(',')}`);
    }
  }
  for (let i = 0; i < 12; i++) console.log('dd', i, hex(dd.row(i)));
  const anims = new Map<number, number>();
  for (let i = 0; i < dd.rows; i++) anims.set(dd.row(i)[0x0a]!, (anims.get(dd.row(i)[0x0a]!) ?? 0) + 1);
  console.log('dd anims', [...anims].map(([k, v]) => `${k.toString(16)}×${v}`).join(' '));
  const names = new Map<string, number>();
  for (const a of actions.actions) if (a.nameId) { const f = game.master.texts.file(a.nameId); names.set(f ? `${f.name} ${f.gmsg.first}-${f.gmsg.last} ed=${f.editable}` : 'none', (names.get(f ? `${f.name} ${f.gmsg.first}-${f.gmsg.last} ed=${f.editable}` : 'none') ?? 0) + 1); }
  console.log('action name files', [...names]);
  const used = new Set(actions.actions.map((a) => a.nameId));
  const f = game.master.texts.file(actions.action(1)?.nameId || actions.actions.find((a) => a.nameId)!.nameId)!;
  const free: string[] = [];
  for (let id = f.gmsg.first; id <= f.gmsg.last; id++) if (!used.has(id)) free.push(`${id}:${game.master.texts.plain(id)}`);
  console.log('free in name file', free.length, free.slice(0, 60).join(' | '));
  console.log('design +0x18..+0x28 of まおう', book.monsters.filter((m) => /まおう/.test(m.name)).map((m) => m.design));
  expect(dd.rows).toBeGreaterThan(0);
  void u16; void u32;
});
