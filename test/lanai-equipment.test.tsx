// RPG FREE!'s equipment effects (src/lanai/equipment.ts, EquipEffects.tsx; naauao lanai/equipment.md): FUN_00165F60's
// table (no ROM), and the ROM's EquipInfo rows, their effects as the equipment screen names them, and an edit.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LanaiEquipEffects } from '../src/lanai/EquipEffects';
import { isLanaiEquipment, lanaiEffectCondition, lanaiEffects, lanaiEquipRow, lanaiItemEffects, lanaiSetEffect, LANAI_EQUIP_SLOTS } from '../src/lanai/equipment';
import { lanaiItems } from '../src/lanai/items';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('RPG FREE! effect kinds → ConditionData rows (FUN_00165F60)', () => {
  test('kinds with one row, and the fallbacks of the kinds picked by number or value', () => {
    expect(lanaiEffectCondition(0x01, 0, 1)).toBe(38);
    expect(lanaiEffectCondition(0x05, 0, 140)).toBe(81);
    expect(lanaiEffectCondition(0x28, 0, 0)).toBe(42);
    expect(lanaiEffectCondition(0x32, 0, 0)).toBe(52);
    expect(lanaiEffectCondition(0x42, 0, 658)).toBe(153);
    expect(lanaiEffectCondition(0x6f, 0, 0)).toBe(167);
    expect(lanaiEffectCondition(0x77, 0, 0)).toBe(0);
    // 9 by the value (7 光 / 8 闇 are swapped in the rows), 10 by the value, the others by the number
    expect([7, 8, 0].map((v) => lanaiEffectCondition(0x09, 0, v))).toEqual([93, 92, 85]);
    expect([3, 4, 2].map((v) => lanaiEffectCondition(0x0a, 0, v))).toEqual([95, 96, 94]);
    expect([1, 3, 12, 100, 13].map((n) => lanaiEffectCondition(0x22, n, 0))).toEqual([112, 119, 127, 125, 111]);
    expect([1, 9, 10].map((n) => lanaiEffectCondition(0x23, n, 0))).toEqual([129, 137, 128]);
    expect([0, 5, 6].map((n) => lanaiEffectCondition(0x34, n, 0))).toEqual([145, 150, 144]);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! equipment effects (ROM)', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    session = await LanaiSession.open(dump, { fresh: true });
  });
  const named = (name: string) => {
    const it = lanaiItems(session).find((x) => x.name === name);
    if (!it) throw new Error(`no item ${name}`);
    return it;
  };

  test('every equipment has its EquipInfo row, one row per item', () => {
    const seen = new Map<string, Set<number>>();
    for (const it of lanaiItems(session)) {
      if (!isLanaiEquipment(it.kind)) continue;
      const e = lanaiEquipRow(session, it);
      expect(e).not.toBeNull();
      const rows = seen.get(e!.table.name + LANAI_EQUIP_SLOTS[it.kind & 0xf0]!.file) ?? new Set();
      rows.add(e!.row);
      seen.set(e!.table.name + LANAI_EQUIP_SLOTS[it.kind & 0xf0]!.file, rows);
    }
    expect([...seen.values()].map((s) => s.size).sort((a, b) => a - b)).toEqual([206, 256, 265, 294, 347, 365]);
  });

  test('effects as the equipment screen names them', () => {
    expect(lanaiItemEffects(session, named('ちからのうでわ'))).toContain('こうげきりょく +4');
    expect(lanaiItemEffects(session, named('ハートのブローチ')).join()).toContain('ターン終了時: HP自動回復 +4%');
    expect(lanaiItemEffects(session, named('しんぴのスカーフ'))).toContain('全状態異常たいせい +1');
    expect(lanaiItemEffects(session, named('プレミアムワンド'))).toEqual(expect.arrayContaining(['とくぎ数 +1', 'ほかく +4倍']));
    expect(lanaiItemEffects(session, named('ゴーレムのくびわ'))).toContain('こうげき +0.4倍');
    expect(lanaiItemEffects(session, named('アンテナダウンバッジ'))).toContain('アンテナダウン (-1)');
    // every effect of the game has a name
    for (const it of lanaiItems(session)) for (const t of lanaiItemEffects(session, it)) expect(t).not.toContain('名前なし');
  });

  test('an edited effect is saved in the row and can be put back', () => {
    const it = named('ちからのうでわ');
    const ref = lanaiEquipRow(session, it)!;
    const before = lanaiEffects(ref)[0]!;
    lanaiSetEffect(ref, { slot: 0, kind: 0x34, number: 4, value: -12 });
    session.edited();
    expect(lanaiEffects(ref)[0]).toEqual({ slot: 0, kind: 0x34, number: 4, value: -12 });
    expect(lanaiItemEffects(session, it)).toContain('すばやさ -12');
    expect(ref.table.rowChanged(ref.row)).toBe(true);
    expect(session.changedTables().some((t) => t.table === ref.table)).toBe(true);
    const html = renderToString(<LanaiEquipEffects session={session} equip={ref} kind={it.kind} onEdit={() => {}} />);
    expect(html).toContain('すばやさ -12');
    expect(html).toContain('能力値');
    ref.table.setRow(ref.row, ref.table.originalRow(ref.row)!);
    session.edited();
    expect(lanaiEffects(ref)[0]).toEqual(before);
    expect(ref.table.rowChanged(ref.row)).toBe(false);
  });
});
