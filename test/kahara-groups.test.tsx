import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArmMachine } from '../src/game/arm';
import { decodeFix, FIX_TABLE } from '../src/game/boss';
import { Game } from '../src/game/game';
import { Master } from '../src/game/master';
import { MonsterBook, MONSTER_DESIGN_ARCHIVE } from '../src/game/monsters';
import { buildModFiles } from '../src/export/pack';
import { GroupPage } from '../src/pages/groups';
import { openImage, type Dump } from '../src/rom/dump';
import type { Session } from '../src/session';
import { GroupDetail, GroupIcons } from '../src/ui/GroupDetail';
import { CIA, hasCia } from './env';

describe.skipIf(!hasCia)('Kahara fixed encounter editor', () => {
  let dump: Dump;
  beforeAll(async () => { dump = await openImage(Bun.file(CIA), 'cia'); });
  async function fixture() {
    const game = await Game.load(dump);
    return { game, book: await game.monsters() };
  }

  test('#142 displays King in the list, detail and editor', async () => {
    const { game, book } = await fixture();
    const g = book.groups[142]!;
    expect(book.groupMonsters(g)).toEqual([176]);
    const icons = renderToString(<GroupIcons game={game} book={book} g={g} />);
    expect(icons).toContain('キング');
    expect(icons).not.toContain('(敵なし)');
    const detail = renderToString(<GroupDetail game={game} book={book} group={g} />);
    expect(detail).toContain('固定編成 #34');
    expect(detail).toContain('href="#/monsters/176"');
    const session = { game, docOf: () => ({ sec6Header: new Uint8Array(), cells6: [] }) } as unknown as Session;
    const html = renderToString(<GroupPage session={session} book={book} arg="142" visit={0} />);
    expect(html).toContain('固定編成のみ');
    expect(html).toContain('通常候補のみ');
    expect(html).toContain('固定編成のモンスター');
    expect(html).toContain('固定編成だけを使います');
    expect(html).toContain('固定編成の重み');
    expect(html).not.toContain('未解析');
  });

  test('fixed edits are isolated, reuse a private row, and survive export/reopen', async () => {
    const { game, book } = await fixture();
    const original = game.master.table(FIX_TABLE).row(34).slice();
    book.setGroupFixSlots(142, [{ monster: 1, count: 2 }]);
    const id = book.groups[142]!.extra[5]!;
    expect(id).toBe(65);
    expect(book.groupChanged(142)).toBe(true);
    expect(game.master.table(FIX_TABLE).row(34)).toEqual(original);
    book.setGroupFixSlots(142, [{ monster: 2, count: 0 }]);
    expect(book.groups[142]!.extra[5]).toBe(id);
    expect(game.master.table(FIX_TABLE).rows).toBe(66);
    expect(book.groupMonsters(book.groups[142]!)).toEqual([2]);
    const files = buildModFiles(game, [], [], game.master.changed());
    const master = new Master(files.get('56562135')!);
    expect(decodeFix(master.table(FIX_TABLE).row(id))).toEqual({ flags: 0x341, slots: [{ monster: 2, count: 0 }] });
    const reopened = new MonsterBook(master, await dump.readRomfs(MONSTER_DESIGN_ARCHIVE));
    expect(reopened.groupMonsters(reopened.groups[142]!)).toEqual([2]);
    book.revertGroup(142);
    expect(book.groupChanged(142)).toBe(false);
    expect(book.groupMonsters(book.groups[142]!)).toEqual([176]);
  });

  test('editing a copied group does not mutate the source fixed formation', async () => {
    const { book } = await fixture();
    book.setGroupFixSlots(142, [{ monster: 1, count: 0 }]);
    const copy = book.copyGroup(142);
    book.setGroupFixSlots(142, [{ monster: 2, count: 0 }]);
    expect(book.groupMonsters(book.groups[copy]!)).toEqual([1]);
    expect(book.groupMonsters(book.groups[142]!)).toEqual([2]);
  });

  test('normal mode survives export and the ROM allocator selects candidates', async () => {
    const { game, book } = await fixture();
    book.setGroupSlots(142, [{ monster: 1, weight: 1, count: 0 }], []);
    book.setGroupFormation(142, [0, 1, 0, 0, 0], 34);
    const files = buildModFiles(game, [], [], game.master.changed());
    const master = new Master(files.get('56562135')!);
    const row = master.table('monsterGroup.bin').row(142);
    const stubs = new Map<number, (m: ArmMachine) => number>();
    const m = new ArmMachine(dump.code, { stubs });
    const group = m.alloc(0x30), rng = m.alloc(8), slot = m.alloc(0x1c);
    row.forEach((b, i) => m.wb(group + i, b));
    // ArmMachine copies the options' Map by reference.
    stubs.set(0x30f984, () => group);
    stubs.set(0x31d738, () => rng);
    m.run(0x3523b0, [slot, 0]);
    expect([m.rb(slot), m.rb(slot + 1), m.rb(slot + 2)]).toEqual([0, 1, 0]);
    expect(row[0]).toBe(1);
    expect([...row.subarray(0x28)]).toEqual([0, 1, 0, 0, 0, 34]);
  });

  test('invalid weights fail atomically; exhausted fixed-table capacity keeps the group unchanged', async () => {
    const { game, book } = await fixture();
    const group = game.master.table('monsterGroup.bin').row(142).slice();
    expect(() => book.setGroupFormation(142, [1, -1, 0, 0, 0], 34)).toThrow();
    expect(() => book.setGroupFormation(142, [1, 0, 0, 0, 0], 256)).toThrow();
    const table = game.master.table(FIX_TABLE);
    table.data = table.withRows(Array.from({ length: 256 }, (_, i) => table.row(Math.min(i, 64)).slice()));
    expect(book.groupFixRoom(book.groups[142]!)).toBe(false);
    expect(() => book.setGroupFixSlots(142, [{ monster: 1, count: 0 }])).toThrow();
    expect(game.master.table('monsterGroup.bin').row(142)).toEqual(group);
  });
});
