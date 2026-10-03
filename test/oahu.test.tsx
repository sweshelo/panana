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
import { OAHU_ELEMENT_NAMES, OAHU_EQUIP_EFFECTS, OAHU_FORM_CATEGORIES, OAHU_MONSTER_BRAIN, oahuCategoryValues, OAHU_SKILL_CONDITION, oahuTriggerLabel } from '../src/oahu/tables';
import { applyIps } from '../src/rom/ips';
import { u32 } from '../src/util/bytes';
import { OahuGroupPage } from '../src/oahu/GroupPage';
import { OahuMonsterPage } from '../src/oahu/MonsterPage';
import { OahuMonsterModels } from '../src/oahu/monsterModels';
import { OahuMaster } from '../src/oahu/master';
import { oahuPreviewPhases } from '../src/oahu/ActionPreview';
import { OahuPerformances } from '../src/oahu/performance';
import { animKeys, effectLabel } from '../src/game/performance';
import { OahuSession } from '../src/oahu/session';
import { OahuShopPage } from '../src/oahu/ShopPage';
import { parseOahuShopItems } from '../src/oahu/shops';
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

  test('form changes: category 21 / 22 actions point at the new form (+0x1A), the ボディ ones fire by +0x2A', () => {
    const { battle } = s;
    // ポーン 148 → 149 → 150: ボディ (効果 0x2F) actions with trigger 101 (a blow that would defeat it).
    expect(battle.formChanges(148)).toEqual([{ action: 530, via: 'body', to: 149, trigger: 101 }]);
    expect(battle.formChanges(149)).toEqual([{ action: 531, via: 'body', to: 150, trigger: 101 }]);
    expect(battle.formChanges(150)).toEqual([]);
    // ドローンＺ 160 → じしょう・まおう 161 (category 22, the whitened screen) → 162.
    expect(battle.actions.get(966, 'category')).toBe(22);
    expect(battle.formChanges(160).map((c) => c.to)).toEqual([161]);
    expect(battle.formChanges(161)).toEqual([{ action: 562, via: 'body', to: 162, trigger: 101 }]);
    // たからばこぞう 18 hides by a skill (picked by the AI), 19 jumps out when hit by breath or spells (107).
    expect(battle.formChanges(18)).toEqual([{ action: 644, via: 'skill3', to: 19, trigger: null }]);
    expect(battle.formChanges(19)).toEqual([{ action: 645, via: 'skill2', to: 18, trigger: null }, { action: 645, via: 'body', to: 18, trigger: 107 }]);
    // テンペスター's barrier: broken by a wind attack (110 = element 3).
    expect(battle.formChanges(112).find((c) => c.via === 'body')).toEqual({ action: 1026, via: 'body', to: 111, trigger: 110 });
    expect(oahuTriggerLabel(110)).toBe('風の攻撃を受けたとき');
    expect(oahuTriggerLabel(30)).toBe('30% の確率');
    expect(battle.formSources(149)).toEqual([{ monster: 148, change: { action: 530, via: 'body', to: 149, trigger: 101 } }]);
    // Every category 21 / 22 action points at a monster row.
    for (let a = 1; a < battle.actions.rows; a++) if (OAHU_FORM_CATEGORIES.includes(battle.actions.get(a, 'category'))) expect(battle.formTarget(a)).toBeGreaterThan(0);
    const html = renderToString(<OahuMonsterPage session={s} arg="148" />);
    for (const t of ['変身', '倒される一撃を受けたとき', '#149']) expect(html).toContain(t);
    expect(renderToString(<OahuActionPage session={s} arg="530" />)).toContain('形態を変える');
  });

  test('action categories: +0x18 / +0x1A by category, the fields of states and hits (docs/oahu/actions.md)', () => {
    const { battle } = s;
    const a = battle.actions;
    // ジャシン's #870: category 21, +0x1A = the new form (row 147), fired from ボディ by a fatal blow.
    expect([870, 966].map((r) => [a.get(r, 'category'), a.get(r, 'min'), a.get(r, 'max'), a.get(r, 'trigger')])).toEqual([[21, 1, 147, 101], [22, 1, 161, 101]]);
    expect(oahuCategoryValues(21).kind).toBe('monster');
    const jashin = renderToString(<OahuActionPage session={s} arg="870" />);
    for (const t of ['新しい形態', 'ジャシン', '倒される一撃を受けたとき']) expect(jashin).toContain(t);
    // なかまをよんだ: a monster row in +0x1A, or (#579) a group row in +0x18.
    expect(battle.summonTarget(485)).toEqual({ monster: 40 });
    expect(battle.summonTarget(579)).toEqual({ group: 152 });
    expect(renderToString(<OahuActionPage session={s} arg="579" />)).toContain('群れ #152');
    // Category 35 picks one of the action rows +0x18〜+0x1A when an item is used.
    expect([a.get(326, 'min'), a.get(326, 'max')]).toEqual([327, 329]);
    // States: どく 1 / もうどく 2 (+0x1C), the rate and turns of w1; hits: +0x2D in tenths.
    expect([79, 81].map((r) => a.get(r, 'strength'))).toEqual([1, 2]);
    expect([a.get(91, 'strength'), a.get(4, 'strength')]).toEqual([-1, 500]);
    expect([a.get(79, 'rate'), a.get(79, 'turnsMin'), a.get(79, 'turnsMax')]).toEqual([1, 2, 4]);
    expect([a.get(335, 'multiplier'), a.get(609, 'multiplier'), a.get(243, 'multiplier')]).toEqual([10, 30, 2]);
    expect(a.get(142, 'noFloat')).toBe(1);
    // A category that does not read +0x18 / +0x1A says so; changing the category changes the fields shown.
    a.set(335, 'max', 5);
    expect(renderToString(<OahuActionPage session={s} arg="335" />)).toContain('では使われません');
    a.set(335, 'category', 19);
    expect(battle.summonTarget(335)).toEqual({ monster: 5 });
    expect(renderToString(<OahuActionPage session={s} arg="335" />)).toContain('呼ぶモンスター');
    battle.revertAction(335);
    expect(battle.actionChanged(335)).toBe(false);
  });

  test('a copied action is a new row at the end of actionData with messages of its own; it is saved, exported and removed', async () => {
    const { battle } = s;
    const a = battle.actions;
    const rows = a.rows;
    const added = battle.texts.addedIds().length;
    expect(battle.canCopyAction(966)).toBe(true);
    const n = battle.copyAction(966);
    expect([n, a.rows, a.added(n), battle.actionChanged(n)]).toEqual([rows, rows + 1, true, true]);
    expect(battle.actionName(n)).toBe(battle.actionName(966));
    expect(a.get(n, 'name')).not.toBe(a.get(966, 'name'));
    expect([a.get(n, 'category'), battle.formTarget(n)]).toEqual([22, 161]);
    expect(battle.texts.addedIds().length).toBeGreaterThan(added);
    a.set(n, 'max', 150);
    const html = renderToString(<OahuActionPage session={s} arg={String(n)} />);
    for (const t of ['写して新しいアクションを作る', 'このアクションを消す']) expect(html).toContain(t);
    expect(html).not.toContain('このアクションの変更を元に戻す');
    const out = parseArchive(s.modFiles().get('21350000')!);
    const t = new GsTable(findByName(out, 'actionData.bin')!.body);
    expect(t.rows).toBe(rows + 1);
    expect(t.row(n)[0x1a]).toBe(150);
    const m = await OahuMaster.load(s.dump);
    m.restore(s.master.saved());
    expect([m.table('actionData.bin').rows, m.table('actionData.bin').row(n)[0x1a]]).toEqual([rows + 1, 150]);
    battle.removeAction(n);
    expect([a.rows, battle.texts.addedIds().length]).toEqual([rows, added]);
  });

  test('a message shared by several actions can be made one action\'s own', () => {
    const { battle } = s;
    const a = battle.actions;
    const row = [...Array(a.rows).keys()].find((r) => r > 0 && battle.actionsWithText(r, 'name').length > 0)!;
    const before = a.get(row, 'name');
    const others = battle.actionsWithText(row, 'name');
    expect(renderToString(<OahuActionPage session={s} arg={String(row)} />)).toContain('このアクションだけの文にする');
    const n = battle.ownActionText(row, 'name');
    expect([a.get(row, 'name'), battle.actionsWithText(row, 'name'), a.get(others[0]!, 'name')]).toEqual([n, [], before]);
    expect(battle.message(n)).toBe(battle.message(before));
    battle.revertAction(row);
    battle.texts.removeAdded(n);
    expect(a.get(row, 'name')).toBe(before);
  });

  test('performances: directData of 402F0000, the counterpart row, the skill motions and the preview phases', async () => {
    const { battle } = s;
    const a = battle.actions;
    expect([995, 526].map((r) => ['perfUser', 'perfUser2', 'perfTarget', 'perfTarget2', 'perfField', 'perfSecond'].map((k) => a.get(r, k)))).toEqual([[872, 0, 873, 0, 0, 0], [458, 0, 115, 0, 459, 277]]);
    const t = (await s.performances.tables())!;
    expect([t.direct.rows, t.direct.rowSize]).toEqual([985, 0x16]);
    const keys = animKeys(s.master);
    const hit = OahuPerformances.forUnit(t.direct, 873, false)!;
    const monsterHit = OahuPerformances.forUnit(t.direct, 873, true)!;
    expect([keys[hit.anim], keys[monsterHit.anim], hit.counterpart]).toEqual(['012_', '008_', 131]);
    const beam = OahuPerformances.forUnit(t.direct, 458, true)!;
    expect(keys[beam.anim]).toBe('006_');
    const names = await s.performances.effectNames();
    expect(effectLabel(t.effects.effect(beam.effect), names)).toBe('fx_e28_firebeam_a @head');
    // The skill motions come from the BCH of monsterDesign +0x14.
    const loaded = (await battle.monsterModel(150, true)!.load())!;
    const motions = loaded.set.models.get(loaded.hash)!.animations.map((x) => x.name.slice(0, 4));
    for (const k of ['001_', '005_', '006_', '008_']) expect(motions).toContain(k);
    const phases = oahuPreviewPhases(s, { ...t, names, sounds: null }, 526, 150, 0);
    expect(phases.map((p) => [p.anim, p.effects.length > 0, !!p.model])).toEqual([['006_', true, true], ['012_', true, false], ['', true, false]]);
    expect(renderToString(<OahuActionPage session={s} arg="526" />)).toContain('プレビュー');
  });

  test('the look of a form change: category 22 swaps in the model of monsterParameter +0x62 (ドローンＺ 160 → 161)', () => {
    const { battle } = s;
    const m = battle.monsters;
    expect(m.get(160, 'formModel')).toBe(161);
    for (let r = 1; r < m.rows; r++) if (r !== 160) expect(m.get(r, 'formModel')).toBe(0);
    m.set(1, 'skill1', 966);
    expect(renderToString(<OahuActionPage session={s} arg="966" />)).toContain('見た目が新しい形態になりません');
    m.set(1, 'formModel', 161);
    expect(renderToString(<OahuActionPage session={s} arg="966" />)).not.toContain('見た目が新しい形態になりません');
    const html = renderToString(<OahuMonsterPage session={s} arg="1" />);
    for (const t of ['変身の見た目', 'じしょう・まおう']) expect(html).toContain(t);
    battle.revertMonster(1);
    expect(renderToString(<OahuActionPage session={s} arg="870" />)).toContain('系統 21 では見た目は変わりません');
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

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 shops (#79)', () => {
  let s: OahuSession;
  beforeAll(async () => {
    s = await OahuSession.open(await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia'));
  });

  test('ShopItem (782 × 0x10) and Shop (44 × 0x38) in 3B630000 and E3C10000', () => {
    const shops = s.shops!;
    expect(shops.archiveNames()).toEqual(['3B630000', 'E3C10000']);
    expect(shops.shops.map((x) => x.id)).toEqual([...Array(37).keys()].filter((i) => i !== 17 && i !== 19));
    expect(shops.shops.reduce((a, x) => a + shops.rows(x.id).length, 0) + shops.shops.length).toBe(782);
    expect(shops.originalMax).toBe(54);
    // ジュエルショップ: payment 1, prices in ShopItem +0x08, the モト only once
    for (const id of [27, 28, 29, 30, 31, 32]) expect(shops.shop(id)!.settings!.payment).toBe(1);
    expect(shops.shop(33)!.settings!.payment).toBe(2);
    expect(shops.shop(0)!.settings!.payment).toBe(0);
    expect(shops.rows(27)[0]).toEqual({ item: 102, price: 1, once: 2 });
    expect(shops.rows(26).map((r) => r.once)).toEqual([0, 12, 13]);
    expect(shops.onceNumbers).toEqual([...Array(17).keys()].map((i) => i + 1).filter((n) => n !== 9));
    expect(s.items.item(shops.rows(0)[0]!.item)!.name).toBe('キズぐすり');
    expect(shops.shop(0)!.settings!.room).toBe(0x0b589c00);
    expect(s.messages.texts.plain(shops.shop(2)!.settings!.messages[2]!)).toBe('欲しい数、入力しろ。');
  });

  test('the table is rebuilt byte for byte; a stock edit is written to both archives', async () => {
    const shops = s.shops!;
    const arc = parseArchive(await s.dump.readRomfs('3B630000'));
    const original = unpackEntry(arc, arc.entries.find((e) => e.hash === 0x67297400)!).body;
    expect(equalBytes(shops.build(), original)).toBe(true);
    shops.set(27, [...shops.rows(27), { item: 1, price: 3, once: 0 }]);
    shops.set(0, shops.rows(0).slice(1));
    expect(shops.changedShops()).toEqual([0, 27]);
    const files = s.modFiles();
    expect([...files.keys()].sort()).toEqual(['3B630000', 'E3C10000']);
    const out = [parseArchive(files.get('3B630000')!), parseArchive(files.get('E3C10000')!)];
    const tables = out.map((a) => unpackEntry(a, a.entries.find((e) => e.hash === 0x67297400)!).body);
    expect(equalBytes(tables[0]!, tables[1]!)).toBe(true);
    const t = new GsTable(tables[0]!);
    expect(t.rows).toBe(782);
    const back = parseOahuShopItems(t);
    expect(back.get(27)!.rows.at(-1)).toEqual({ item: 1, price: 3, once: 0 });
    expect(back.get(0)!.rows.length).toBe(8);
    // the rest of 3B630000 (models, Shop, MessageCommand) is as it was
    for (const e of out[0]!.entries) if (e.hash !== 0x67297400) expect(equalBytes(unpackEntry(out[0]!, e).body, unpackEntry(arc, arc.entries[e.index]!).body)).toBe(true);
    // saved and restored like the other edits
    const saved = shops.saved();
    shops.set(27, shops.originalRows(27));
    shops.set(0, shops.originalRows(0));
    expect(shops.changed()).toBe(false);
    shops.restore(saved);
    expect(shops.changedShops()).toEqual([0, 27]);
    const html = renderToString(<OahuShopPage session={s} arg="27" />);
    expect(html).toContain('値段 (ジュエル)');
    expect(html).toContain('じゅうたくちのモト');
    expect(html).not.toContain('同一アイテム');
    // 店 25 (幻影の店) sells キズぐすり eight times: only a note
    expect(shops.rows(25).map((r) => r.item)).toEqual(Array(8).fill(2));
    expect(renderToString(<OahuShopPage session={s} arg="25" />)).toContain('同一アイテムが既に陳列されています (キズぐすり)');
    shops.set(27, shops.originalRows(27));
    shops.set(0, shops.originalRows(0));
  });
});
