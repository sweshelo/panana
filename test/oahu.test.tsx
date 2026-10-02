// 電波人間のRPG3 (oahu) dump: opening the Base and what the RomFS viewer shows (naauao oahu/analysis.md).
// Needs the decrypted Base CIA (test/env.ts OAHU_BASE); skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { unzipSync } from 'fflate';
import { findByName, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { equalUnits, Gmsg, toUnits } from '../src/game/gmsg';
import { OAHU_SYNTAX, textToUnits, unitsToText } from '../src/game/msgtext';
import { OAHU_MESSAGE_ARCHIVES, OahuMessages } from '../src/oahu/messages';
import { OahuActionPage } from '../src/oahu/ActionPage';
import { OAHU_CODE, OAHU_LAYOUT, OahuCode } from '../src/oahu/code';
import { OahuCodePage } from '../src/oahu/CodePage';
import { OAHU_EQUIP_EFFECTS } from '../src/oahu/tables';
import { applyIps } from '../src/rom/ips';
import { u32 } from '../src/util/bytes';
import { OahuGroupPage } from '../src/oahu/GroupPage';
import { OahuMonsterPage } from '../src/oahu/MonsterPage';
import { OahuMonsterModels } from '../src/oahu/monsterModels';
import { OahuSession } from '../src/oahu/session';
import { OAHU_ELEMENT_NAMES, OAHU_MONSTER_BRAIN, OAHU_SKILL_CONDITION } from '../src/oahu/tables';
import { readField } from '../src/game/tabledef';
import { openImage, openImages, openUpdate, type Dump } from '../src/rom/dump';
import { equalBytes } from '../src/util/bytes';
import { GmsgView, GsTableView, viewsFor } from '../src/romfs/formats';
import { oahuRomfsProfile } from '../src/romfs/oahu';
import { asArchive } from '../src/romfs/sniff';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase)('RPG3 Base', () => {
  let dump: Dump;
  beforeAll(async () => {
    dump = await openImage(Bun.file(OAHU_BASE), 'base');
  });

  test('is told apart as oahu, v0, with 269 RomFS files (176 at the root)', () => {
    expect(dump.title.key).toBe('oahu');
    expect(dump.titleVersion).toBe(0);
    expect(dump.code.length).toBe(5021696);
    expect(dump.files!().length).toBe(269);
    expect(dump.names().length).toBe(176);
    expect(dump.files!().some((f) => f.path === 'sound/sound.bcsar')).toBe(true);
  });

  test('every root archive is version 7', async () => {
    let archives = 0;
    for (const n of dump.names()) {
      const a = asArchive(await dump.readRomfs(n), n);
      if (!a) continue;
      archives++;
      expect(a.version).toBe(oahuRomfsProfile.archiveVersion);
    }
    expect(archives).toBe(176);
  });

  test('master 21350000: itemData and the system messages show in their views', async () => {
    const m = parseArchive(await dump.readRomfs('21350000'));
    expect(m.entries.length).toBe(288);
    const item = findByName(m, 'itemData.bin')!;
    const t = new GsTable(item.body);
    expect([t.rows, t.rowSize]).toEqual([1191, 0x40]);
    expect(viewsFor(item.body, 'itemData.bin')[0]!.id).toBe('gstable');
    expect(renderToString(<GsTableView body={item.body} name="itemData.bin" profile={oahuRomfsProfile} />)).toContain('1191 行 × 0x40 バイト');

    const msg = findByName(m, 'MessageSystemCommon_JP.gsmb')!;
    const g = new Gmsg(msg.body);
    expect(g.first).toBe(0);
    // itemData +0x14 of row 1 is the name of the item
    const name = new DataView(t.row(1).buffer, t.row(1).byteOffset).getUint32(0x14, true);
    expect(g.has(name)).toBe(true);
    const text = String.fromCharCode(...toUnits(g.raw[name]!).subarray(1)).replace(/\0.*$/s, '');
    expect(renderToString(<GmsgView body={msg.body} name={null} profile={oahuRomfsProfile} />)).toContain(`ID 0〜${g.last}`);
    expect(text.length).toBeGreaterThan(0);
  });

  test('itemData is shown by its fields, with the names of the messages', async () => {
    const m = parseArchive(await dump.readRomfs('21350000'));
    const item = findByName(m, 'itemData.bin')!;
    const s = await OahuSession.open(dump);
    const html = renderToString(<GsTableView body={item.body} name="itemData.bin" profile={oahuRomfsProfile} context={{ message: (id) => s.messages.texts.preview(id, true) }} />);
    for (const label of ['買値', '売値', '名前', 'アクション', '分類', '上限']) expect(html).toContain(`>${label}</th>`);
    expect(html).toContain('キズぐすり');
    expect(html).toContain('道具 (回復など)');
  });
});

describe.skipIf(!hasOahuBase)('RPG3 items (Base)', () => {
  let s: OahuSession;
  beforeAll(async () => {
    s = await OahuSession.open(await openImage(Bun.file(OAHU_BASE), 'base'));
  });

  test('the fields of the known items', () => {
    const { items } = s;
    expect(items.table.rows).toBe(1191);
    expect(items.items.length).toBe(981);
    const kizu = items.item(1)!;
    expect([kizu.name, kizu.price, kizu.sell, kizu.rarity, kizu.limit, kizu.action, kizu.categoryByte, kizu.kind]).toEqual(['キズぐすり', 20, 2, 1, 99, 267, 0x11, 1]);
    expect(items.actionName(267)).toContain('キズぐすり');
    expect(items.itemActions().some((a) => a.row === 267)).toBe(true);
    const choker = items.items.find((it) => it.name === 'ハートのチョーカー')!;
    expect(choker.kind).toBe(3);
    expect(choker.effects.map((e) => items.effectText(e))).toEqual(['能力アップ: さいだいＨＰ +15']);
    const mantle = items.items.find((it) => it.name === 'ひのマント')!;
    expect(mantle.effects.map((e) => items.effectText(e))).toEqual(['たいせい (属性): 火 +2', '浮遊']);
    const claw = items.items.find((it) => it.name === 'するどいつめ')!;
    expect(items.effectText(claw.effects[0]!)).toBe('アクション (打撃): #233 どくこうげき');
    expect(items.items.find((it) => it.name === 'ふつうのさお')!.limit).toBe(1);
  });

  test('a copied item gets messages past MessageSystemCommon; it is kept with the Update and exported in the master', async () => {
    const { items } = s;
    const texts = s.messages.texts;
    items.set(1, 'price', 30);
    items.setText(1, 'name', 'キズぐすりＭ');
    expect(items.canCopy(3)).toBe(true);
    const n = items.copyItem(3);
    expect(items.added(n)).toBe(true);
    const copy = items.item(n)!;
    const nameId = items.messageId(n, 'name');
    expect(nameId).toBe(8658);
    expect(copy.name).toBe('キズぐすり+');
    expect(items.get(n, 'order')).toBe(Math.max(...items.items.filter((x) => x.id !== n).map((x) => items.get(x.id, 'order'))) + 1);
    items.setText(n, 'name', 'キズぐすりＺ');
    items.set(n, 'price', 12345);
    expect(items.item(3)!.name).toBe('キズぐすり+');
    expect(texts.addedIds().length).toBe(new Set(['name', 'menu', 'shop0', 'shop1', 'shop2'].map((k) => items.messageId(3, k))).size);

    const u = await s.withUpdate(await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    expect(u.items.item(1)!.price).toBe(30);
    expect(u.items.item(1)!.name).toBe('キズぐすりＭ');
    expect(u.items.item(n)!.name).toBe('キズぐすりＺ');
    expect(u.items.item(n)!.price).toBe(12345);
    const files = u.modFiles();
    expect(files.has('21350000')).toBe(true);
    const out = parseArchive(files.get('21350000')!);
    const before = parseArchive(await u.dump.readRomfs('21350000'));
    for (const e of out.entries) {
      const name = unpackEntry(out, e).name;
      const same = equalBytes(unpackEntry(before, before.entries[e.index]!).body, unpackEntry(out, e).body);
      expect(same).toBe(!['itemData.bin', 'MessageSystemCommon_JP.gsmb', 'MessageSystemCommon_IN.gsmb'].includes(name ?? ''));
    }
    const t = new GsTable(findByName(out, 'itemData.bin')!.body);
    const g = new Gmsg(findByName(out, 'MessageSystemCommon_JP.gsmb')!.body);
    expect(g.last).toBe(8657 + texts.addedIds().length);
    expect(unitsToText(g.units(new DataView(t.row(n).buffer, t.row(n).byteOffset).getUint32(0x14, true))!, OAHU_SYNTAX).text).toBe('キズぐすりＺ');
    expect(new DataView(t.row(1).buffer, t.row(1).byteOffset).getUint32(0, true)).toBe(30);

    u.items.removeItem(n);
    expect(u.items.item(n)).toBeUndefined();
    expect(u.messages.texts.addedIds()).toEqual([]);
  });
});

describe.skipIf(!hasOahuUpdate)('RPG3 Update', () => {
  test('is refused with the Base to choose', async () => {
    await expect(openImage(Bun.file(OAHU_UPDATE), 'update')).rejects.toThrow('Base (00040000000EF000) の CIA を選んでください');
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 messages and the MOD (Base + Update)', () => {
  let base: Dump;
  let merged: Dump;
  beforeAll(async () => {
    base = await openImage(Bun.file(OAHU_BASE), 'base');
    merged = await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia');
  });

  test('the Update: v4096, its code.bin, 11 archives from patch:', async () => {
    expect(merged.update?.titleVersion).toBe(4096);
    expect(merged.code.length).toBe(5029888);
    expect(merged.update!.patched).toEqual(['21350000', '3B630000', 'A9DF0000', '296B0000', '97CF0000', '7BF70000', '619D0000', '838B0000', '58190000', '00910000', '6E380000']);
    const b = await base.readRomfs('21350000'), m = await merged.readRomfs('21350000');
    expect(equalBytes(b, m)).toBe(false);
    expect(equalBytes(await base.readRomfs('A4070000'), await merged.readRomfs('A4070000'))).toBe(true);
    await expect(openUpdate(Bun.file(OAHU_BASE), 'x')).rejects.toThrow('Base です');
  });

  test('every GMSG of the RomFS is in OAHU_MESSAGE_ARCHIVES; every message reads back the same as text', async () => {
    const holders: string[] = [];
    for (const n of base.names()) {
      const a = asArchive(await base.readRomfs(n), n);
      if (a?.entries.some((e) => e.type === 6)) holders.push(n);
    }
    expect(holders.sort()).toEqual([...OAHU_MESSAGE_ARCHIVES].sort());
    const m = await OahuMessages.load(base);
    let n = 0;
    for (const f of m.texts.files) {
      expect(f.editable).toBe(true);
      for (let id = f.gmsg.first; id <= f.gmsg.last; id++, n++) {
        const u = f.gmsg.units(id)!;
        expect(equalUnits(textToUnits(unitsToText(u, OAHU_SYNTAX), OAHU_SYNTAX), u)).toBe(true);
      }
    }
    expect(n).toBe(16889);
    expect(m.texts.text(40000)?.text).toBeDefined();
  });

  test('an edit made on the Base is exported on the Update\'s archives; the zip is in 00040000000EF000/romfs', async () => {
    const s = await OahuSession.open(base);
    expect(s.canExport).toBe(false);
    expect(() => s.modFiles()).toThrow('Update');
    s.messages.texts.setText(80000, 'ＭＯＤ');
    const u = await s.withUpdate(await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    expect(u.canExport).toBe(true);
    expect(u.messages.texts.isEdited(80000)).toBe(true);
    const files = u.modFiles();
    // MessageCommand_JP: 4 copies
    expect([...files.keys()].sort()).toEqual(['3B630000', '58190000', '619D0000', '838B0000']);
    const upd = parseArchive(await merged.readRomfs('838B0000'));
    const out = parseArchive(files.get('838B0000')!);
    expect(out.entries.length).toBe(upd.entries.length);
    for (const e of out.entries) {
      const before = unpackEntry(upd, upd.entries[e.index]!).body;
      const after = unpackEntry(out, e).body;
      if (e.type !== 6) expect(equalBytes(before, after)).toBe(true);
    }
    const cmd = out.entries.find((e) => unpackEntry(out, e).name === 'MessageCommand_JP.gsmb')!;
    expect(unitsToText(new Gmsg(unpackEntry(out, cmd).body).units(80000)!, OAHU_SYNTAX).text).toBe('ＭＯＤ');
    const zip = unzipSync(u.modZip());
    expect(Object.keys(zip).sort()).toEqual(['00040000000EF000/romfs/3B630000', '00040000000EF000/romfs/58190000', '00040000000EF000/romfs/619D0000', '00040000000EF000/romfs/838B0000']);
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 monsters, groups and actions (Base + Update)', () => {
  let s: OahuSession;
  beforeAll(async () => {
    s = await OahuSession.open(await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia'));
  });

  test('the fields of a monster: stats, drops, skills, resistances', () => {
    const { battle } = s;
    const m = battle.monsters;
    expect([m.rows, battle.groups.rows, battle.actions.rows, battle.conditions.rows]).toEqual([201, 190, 1126, 125]);
    expect(battle.monsterName(1)).toBe('はなもぐら');
    const g = (k: string): number => m.get(1, k);
    expect([g('level'), g('hpMin'), g('hpMax'), g('attackMax'), g('defenseMax'), g('speedMax'), g('exp'), g('gold')]).toEqual([1, 10, 12, 16, 4, 5, 2, 5]);
    expect(battle.drops(1).map((d) => [battle.itemName(d.item), d.rate])).toEqual([['タンポポのたね(色1)', 4], ['キズぐすり', 7], ['ちていじんプリント', 10]]);
    // battleParameter +0xE6, rolled in float (FUN_001C3994): 1/3 and 1/6 come out as 1/2 and 1/5
    expect(battle.dropBase).toEqual([1, 3, 4, 6, 8, 12, 16, 32, 64, 128, 256, 512, 1024, 4096, 8192, 16384]);
    expect(Array.from({ length: 16 }, (_, r) => battle.dropOdds(r))).toEqual([1, 2, 4, 5, 8, 12, 16, 32, 64, 128, 256, 512, 1024, 4096, 8192, 16384]);
    expect([0, 1, 9, 10, 12, 13, 15].map((r) => battle.dropClass(r).label)).toEqual(['必ず', 'おたから', 'おたから', 'レア', 'レア', '激レア', '激レア']);
    expect([battle.dropOdds(4, 200), battle.dropOdds(4, 0), battle.dropOdds(15, -1)]).toEqual([4, Infinity, 1]);
    expect(battle.skills(1)[0]).toEqual({ slot: 1, action: 995, condition: 1 });
    expect(battle.actionName(995)).toBe('たいあたり');
    expect(m.get(150, 'exp')).toBe(65000);
    expect(m.get(180, 'exp')).toBe(100000);
    expect(battle.monsterList().length).toBeGreaterThan(150);
    expect(battle.groupsOf(1)).toContain(5);
  });

  test('actions, states and groups', () => {
    const { battle } = s;
    expect(battle.actions.get(233, 'state')).toBe(1);
    expect(battle.conditionName(1)).toBe('どく');
    expect(battle.conditionName(42)).toBe('状態 42');
    expect(battle.conditionName(64)).toBe('毒たいせい');
    expect(battle.actions.get(969, 'element')).toBe(2);
    expect(battle.actions.get(984, 'range')).toBe(3);
    // Two elements: 10〜25 need the 5th bit (アイスメテオ 16 = 氷・土, ダークシャイニング 25 = 光・闇).
    expect([190, 202, 220].map((r) => OAHU_ELEMENT_NAMES[battle.actions.get(r, 'element')])).toEqual(['火・氷', '氷・土', '光・闇']);
    // A monster's row (kind 2) names the monster, points back at it, and its skills follow it.
    expect(battle.actions.get(566, 'kind')).toBe(2);
    expect(battle.actions.get(566, 'subject')).toBe(79);
    expect(battle.monsters.get(79, 'own')).toBe(566);
    expect(battle.actionUsers(566).monsters).toEqual([79]);
    expect(battle.usedSkills(79).map((x) => x.action)).toEqual([567, 568]);
    expect(battle.actions.get(267, 'kind')).toBe(4);
    expect(battle.items.itemActions().every((a) => battle.actions.get(a.row, 'kind') === 4)).toBe(true);
    expect(battle.conditions.get(36, 'combine')).toBe(4);
    expect(battle.actionUsers(995).monsters).toContain(1);
    expect(battle.group(1).fixed.map((r) => battle.monsterName(r))).toEqual(['たからばこぞう']);
    expect(battle.group(5).leads.map((x) => battle.monsterName(x.monster))).toEqual(['はなもぐら', 'てっぽうオトシゴ']);
  });

  test('the books render; an edit goes into the master', () => {
    const html = renderToString(<OahuMonsterPage session={s} arg="1" />);
    for (const t of ['はなもぐら', 'ドロップ', 'たいあたり', 'ちていじんプリント', 'たいせい']) expect(html).toContain(t);
    for (const t of ['おたから・12.5%', 'レア・0.39%', '4: 1/8']) expect(html).toContain(t);
    expect(renderToString(<OahuGroupPage session={s} arg="5" />)).toContain('てっぽうオトシゴ');
    expect(renderToString(<OahuActionPage session={s} arg="233" />)).toContain('どくこうげき');
    s.battle.monsters.set(1, 'gold', 777);
    s.battle.groups.set(5, 'lead1Weight', 9);
    const out = parseArchive(s.modFiles().get('21350000')!);
    const t = new GsTable(findByName(out, 'monsterParameter.bin')!.body);
    expect(new DataView(t.row(1).buffer, t.row(1).byteOffset).getUint32(0x14, true) & 0xfffff).toBe(777);
    expect(new GsTable(findByName(out, 'monsterGroup.bin')!.body).row(5)[2]).toBe(9);
  });

  test('a monster model: its design row in monsterDesign.bin names the model and colour entries of 28480000', async () => {
    const { battle } = s;
    expect([1, 43, 55].map((r) => battle.monsters.get(r, 'design'))).toEqual([136, 138, 137]);
    const models = new OahuMonsterModels(s.dump);
    const d = await models.design(136);
    expect(d?.model).toBe(0xd6f7bc00);
    const loaded = await battle.monsterModel(1)!.load();
    expect(loaded?.set.models.get(0)?.name).toBe('enemy_66_01');
    expect(loaded?.set.textures.has('enemy_66_01_body')).toBe(true);
  });

  test('skill conditions: monsterBrain.bin (402F0000) has a row per condition, named after the test monsters 「知能：…」', async () => {
    const t = new GsTable(findByName(parseArchive(await s.dump.readRomfs('402F0000')), 'monsterBrain.bin')!.body);
    expect([t.rows, t.rowSize]).toEqual([16, OAHU_MONSTER_BRAIN.rowSize]);
    const get = (row: number, k: string): number => readField(t.row(row), OAHU_MONSTER_BRAIN.fields.find((x) => x.key === k)!);
    expect([0, 1, 2, 3].map((r) => [get(r, 'ap'), get(r, 'apOwn'), get(r, 'once')])).toEqual([[0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 1, 1]]);
    expect([get(6, 'effective'), get(6, 'targetHp25'), get(6, 'lowestHp'), get(6, 'weakElement')]).toEqual([1, 1, 1, 1]);
    expect([get(5, 'targetHp65'), get(7, 'strongHalf'), get(8, 'healer'), get(9, 'canAct'), get(9, 'canUse')]).toEqual([2, 1, 2, 2, 2]);
    expect([12, 14].map((r) => [get(r, 'hp50'), get(r, 'hp25')])).toEqual([[1, 0], [0, 1]]);
    const { battle } = s;
    const tests = battle.monsterList().filter((m) => m.name.startsWith('知能：'));
    const named = new Map(tests.flatMap((m) => battle.usedSkills(m.id).filter((k) => k.condition > 1).map((k): [number, string] => [k.condition, m.name.slice(3)])));
    for (const [c, n] of named) if (c !== 3) expect(OAHU_SKILL_CONDITION[c]).toBe(n);
    expect(named.get(3)).toBe('標準抑');
    expect(battle.actions.get(1089, 'ap')).toBe(1);
  });

  test('skills and group slots are written packed; the fallback slot follows its skill', () => {
    const { battle } = s;
    const row = battle.monsterList().find((m) => battle.usedSkills(m.id).length >= 3 && battle.monsters.get(m.id, 'fallback') === 1)!.id;
    const before = battle.usedSkills(row);
    const now = before.map((x) => ({ action: x.action, condition: x.condition, from: x.slot }));
    // remove the first skill: the fallback (slot 2) is now slot 1
    battle.setSkills(row, now.slice(1));
    expect(battle.usedSkills(row).map((x) => x.action)).toEqual(before.slice(1).map((x) => x.action));
    expect(battle.monsters.get(row, `skill${before.length}`)).toBe(0);
    expect(battle.monsters.get(row, `cond${before.length}`)).toBe(1);
    expect(battle.monsters.get(row, 'fallback')).toBe(0);
    battle.monsters.revert(row);
    battle.setGroupSlots(5, [{ monster: 1, weight: 3, count: 5 }], []);
    expect(battle.group(5).leads).toEqual([{ monster: 1, weight: 3, count: 5 }]);
    expect(battle.group(5).mates).toEqual([]);
    battle.setFixed(5, [2, 1]);
    expect(battle.group(5).fixed).toEqual([2, 1]);
    battle.groups.revert(5);
    expect(battle.groups.changed(5)).toBe(false);
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 code.bin (#65)', () => {
  let base: OahuSession;
  let s: OahuSession;
  beforeAll(async () => {
    base = await OahuSession.open(await openImage(Bun.file(OAHU_BASE), 'base'));
    s = await OahuSession.open(await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia'));
  });

  test('without the Update there is no code.bin; the code page asks for the Update', () => {
    expect(base.code).toBeNull();
    expect(base.codeError).toBe('');
    expect(() => base.buildPatches()).toThrow('Update');
    const html = renderToString(<OahuCodePage session={base} onAddUpdate={() => {}} />);
    expect(html).toContain('Update の CIA も選んでください');
    expect(html).not.toContain('逆アセンブル');
    // the Base's code.bin has other addresses
    expect(() => OahuCode.check(base.dump.code)).toThrow('v4096');
  });

  test('the Update\'s code.bin: the probes, the cave is zero, the effect table matches the item effects', () => {
    const code = s.code!;
    expect(code).not.toBeNull();
    expect(code.caveSize).toBe(0x740);
    for (let a = OAHU_LAYOUT.caveStart; a < OAHU_LAYOUT.caveEnd; a += 4) expect(code.word(a)).toBe(0);
    const rows = code.effectConditions();
    expect(rows.length).toBe(OAHU_CODE.effectKinds);
    expect(rows[0]).toBe(0);
    for (let k = 1; k < rows.length; k++) expect(rows[k]).toBe(OAHU_EQUIP_EFFECTS[k]!.condition);
    expect(renderToString(<OahuCodePage session={s} onAddUpdate={() => {}} />)).toContain('mov r1, r0');
  });

  test('a patch is assembled on the Update\'s addresses and exported as exefs/code.ips', () => {
    s.codePatches = [{
      id: 'p',
      title: 'kind 0x30 -> row 0x4C',
      source: '@0x1A658C\n  b to_cave\n@cave to_cave\n  ldr r0, =0x4C\n  bx lr\n',
      enabled: true,
    }];
    const built = s.buildPatches().get('p')!;
    expect(built.errors).toEqual([]);
    expect(built.cave![1]).toBe(OAHU_LAYOUT.caveEnd);
    const zip = unzipSync(s.modZip());
    const ips = zip['00040000000EF000/exefs/code.ips']!;
    expect(ips).toBeDefined();
    const patched = OahuCode.check(applyIps(s.code!.code, ips));
    expect(() => patched.effectConditions()).toThrow("0x30");
    const cave = built.cave![0];
    expect(u32(patched.code, cave - 0x100000)).toBe(0xe59f0000); // ldr r0, [pc, #0]
    expect(u32(patched.code, cave + 8 - 0x100000)).toBe(0x4c);
    // a broken patch is left out of code.ips
    s.codePatches = [{ id: 'q', title: 'bad', source: '@0x1A658C\n  foo r0\n', enabled: true }];
    expect(s.codeIps()).toBeNull();
    s.codePatches = [];
  });
});
