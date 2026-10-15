// Porting looks and item models between the opened games (#100): a monster of each game gets another game's look (the
// converted files in the target's model archive, a new design row pointing at them), the target's own readers show the
// ported model, and the MOD export carries the archives. Needs the three games' dumps (roms/, test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { parseBch, unwrapBch } from '../src/bch/bch';
import { parseCgfx } from '../src/cgfx/cgfx';
import { Game } from '../src/game/game';
import { MONSTER_MODEL_ARCHIVE } from '../src/game/monsters';
import { lanaiMonsterSet } from '../src/lanai/monsterModels';
import { lanaiMonsterDesign, lanaiMonsters } from '../src/lanai/monsters';
import { LanaiSession } from '../src/lanai/session';
import { OahuSession } from '../src/oahu/session';
import { giveMonsterLook } from '../src/port/apply';
import { giveItemModel, itemLooks } from '../src/port/items';
import { monsterLooks, type MonsterLook } from '../src/port/looks';
import { PortStore } from '../src/port/store';
import { openDumps, openImage } from '../src/rom/dump';
import type { TitleKey } from '../src/rom/titles';
import { ItemBook } from '../src/game/items';
import type { Session } from '../src/session';
import type { Opened } from '../src/ui/workspace';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia, hasLanai, hasOahuBase, hasOahuUpdate, LANAI_BASE, LANAI_UPDATE, OAHU_BASE, OAHU_UPDATE } from './env';

const ready = hasCia && hasOahuBase && hasOahuUpdate && hasLanai;

describe.skipIf(!ready)('porting between the games', () => {
  const o: Opened = {};
  let game: Game;

  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'kahara'));
    await PortStore.install(game.dump);
    const book = await game.monsters();
    let items: ItemBook | null = null;
    // the parts of RPG2's session the ports use (Session.open needs IndexedDB)
    const session = {
      game, book, saveNow: () => {},
      items: async () => ({ items: (items ??= new ItemBook(game, new Map())), stock: null }),
    } as unknown as Session;
    o.kahara = { session, editor: null as never };
    const [oahu] = await openDumps([Bun.file(OAHU_BASE), Bun.file(OAHU_UPDATE)], () => 'oahu');
    o.oahu = await OahuSession.open(oahu!);
    const [lanai] = await openDumps([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], () => 'lanai');
    o.lanai = await LanaiSession.open(lanai!, { fresh: true });
  }, 120_000);

  const looks = new Map<TitleKey, MonsterLook[]>();
  const look = async (t: TitleKey, name: string): Promise<MonsterLook> => {
    if (!looks.has(t)) looks.set(t, await monsterLooks(o, t));
    const l = looks.get(t)!.find((x) => x.names.some((n) => n.includes(name))) ?? looks.get(t)![0]!;
    return l;
  };

  test('every game lists the looks its monsters use', async () => {
    for (const t of ['kahara', 'oahu', 'lanai'] as const) {
      const l = await monsterLooks(o, t);
      expect(l.length).toBeGreaterThan(50);
      const f = await l[0]!.files();
      expect(f.model.length).toBeGreaterThan(0);
    }
  }, 120_000);

  test('an RPG2 monster gets RPG3 and RPG FREE! looks', async () => {
    const book = o.kahara!.session.book!;
    for (const from of ['oahu', 'lanai'] as const) {
      const row = 1;
      const d = await giveMonsterLook(o, 'kahara', row, await look(from, 'ドラゴン'));
      expect(book.monster(row)!.design).toBe(d);
      const r = book.designBytes(d);
      const arc = parseArchive(await game.dump.readRomfs(MONSTER_MODEL_ARCHIVE));
      const model = unpackEntry(arc, findEntry(arc, u32(r, 0x10))!).body;
      const f = parseCgfx(model);
      expect(f.models[0]!.meshes.length).toBeGreaterThan(0);
      expect(f.models[0]!.animations.some((a) => a.name.startsWith('001_'))).toBe(true);
      expect(parseCgfx(unpackEntry(arc, findEntry(arc, u32(r, 0x14))!).body).textures.length).toBeGreaterThan(0);
    }
    const archives = await (await PortStore.of('kahara')).archives();
    expect(archives.map(([n]) => n)).toEqual([MONSTER_MODEL_ARCHIVE]);
  }, 300_000);

  test('an RPG3 monster gets RPG2 and RPG FREE! looks, exported with its design rows', async () => {
    const s = o.oahu!;
    for (const from of ['kahara', 'lanai'] as const) {
      const row = 1;
      const d = await giveMonsterLook(o, 'oahu', row, await look(from, 'ドラゴン'));
      expect(s.battle.monsters.get(row, 'design')).toBe(d);
      const loaded = await s.monsterModels.ref(d, true).load();
      expect(loaded!.set.models.size).toBeGreaterThan(0);
      expect(loaded!.set.errors).toEqual([]);
      const m = loaded!.set.models.get(0)!;
      expect(m.animations.some((a) => a.name.startsWith('005_'))).toBe(true);
    }
    const files = await s.allModFiles();
    expect(files.has('28480000')).toBe(true);
    expect(files.has('402F0000')).toBe(true);
  }, 300_000);

  test('an RPG FREE! monster gets RPG2 and RPG3 looks, in the Update archive', async () => {
    const s = o.lanai!;
    const row = lanaiMonsters(s).find((m) => m.name && m.designRow >= 0)!.row;
    for (const from of ['kahara', 'oahu'] as const) {
      const d = await giveMonsterLook(o, 'lanai', row, await look(from, 'ドラゴン'));
      const m = lanaiMonsters(s).find((x) => x.row === row)!;
      expect(m.designRow).toBe(d);
      const design = lanaiMonsterDesign(s, d)!;
      expect((s.need("MonsterDesign").u32(d, 0x04) >>> 20) & 1).toBe(1);
      const set = await lanaiMonsterSet(s, design);
      expect(set.models.size).toBeGreaterThan(0);
      expect(set.errors).toEqual([]);
    }
    const files = await s.allModFiles();
    expect(files.has('719F0000')).toBe(true);
    expect(files.has('2135000A')).toBe(true);
    // the BCH in the archive is RPG FREE!'s version
    const arc = parseArchive(files.get('719F0000')!);
    const d = lanaiMonsterDesign(s, lanaiMonsters(s).find((x) => x.row === row)!.designRow)!;
    expect(unwrapBch(unpackEntry(arc, findEntry(arc, d.model)!).body)[4]).toBe(0x21);
  }, 300_000);

  test('items get the other game\'s models', async () => {
    const fromOahu = (await itemLooks(o, 'oahu')).slice(0, 3);
    const fromKahara = (await itemLooks(o, 'kahara')).slice(0, 3);
    expect(fromOahu.length).toBe(3);
    const { items } = await o.kahara!.session.items();
    const k = items.items.find((it) => it.model)!;
    const h = await giveItemModel(o, 'kahara', k.id, fromOahu[0]!);
    expect(items.item(k.id)!.model).toBe(h);
    const s = o.oahu!;
    const it = s.items.items.find((x) => x.model && x.name)!;
    const h2 = await giveItemModel(o, 'oahu', it.id, fromKahara[0]!);
    expect(s.items.item(it.id)!.model).toBe(h2);
    const m = await s.itemModels.model(h2);
    expect(m?.kind).toBe('model');
    const files = await s.allModFiles();
    expect([...files.keys()].length).toBeGreaterThan(2);
    // the converted BCH is RPG3's version
    const src = await s.itemModels.sourceFiles(h2);
    expect(parseBch(unwrapBch(src!.body)).models.length).toBeGreaterThan(0);
  }, 300_000);
});
