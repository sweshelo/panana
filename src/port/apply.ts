// Giving a monster of the shown game the look of another game's monster (#100): the converted files go into the
// shown game's model archive (store.ts) and a new design row (a copy of the monster's own, with the ported files and
// the look's sizes) becomes the monster's.
import { forgetArchives } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE } from '../game/monsters';
import { forgetLanaiMonsters, forgetLanaiModelIndex } from '../lanai/monsters';
import type { TitleKey } from '../rom/titles';
import type { Opened } from '../ui/workspace';
import { lanaiTemplate, portedDesign, portedEntries, takenIn, type MonsterLook } from './looks';
import { PortStore } from './store';

/** Gives monster `row` of `target` the look; returns the new design row. */
export async function giveMonsterLook(o: Opened, target: TitleKey, row: number, look: MonsterLook): Promise<number> {
  if (look.title === target) throw new Error('同じ作品の見た目は、デザインの行を選び直してください');
  const store = await PortStore.of(target);
  if (target === 'kahara') {
    const s = o.kahara?.session;
    const book = s?.book;
    if (!s || !book) throw new Error('電波人間のRPG2 のモンスターを読めていません');
    if (!book.canNewLook()) throw new Error('モンスターのデザインはこれ以上増やせません (256 行まで)');
    const template = book.designBytes(book.monster(row)!.design);
    const { entries, hashes, altIdle } = await portedEntries(look, target, template, await takenIn(target, (n) => s.game.dump.readRomfs(n)));
    store.add(entries);
    forgetArchives(MONSTER_MODEL_ARCHIVE);
    const d = book.newLook(row, (r) => r.set(portedDesign(look, target, r, hashes)));
    // the other idle (MonsterParameter +0x4A bit3) needs a 002_ animation the new look may not have
    const p = book.paramRow(row);
    if (!altIdle && p[0x4a]! & 8) {
      p[0x4a] = p[0x4a]! & ~8;
      book.reload();
    }
    s.saveNow();
    return d;
  }
  if (target === 'oahu') {
    const s = o.oahu;
    if (!s) throw new Error('電波人間のRPG3 を開いていません');
    if ((await s.monsterModels.rows()) >= 0x100) throw new Error('モンスターのデザインはこれ以上増やせません (256 行まで)');
    const mons = s.battle.monsters;
    const template = await s.monsterModels.rowBytes(mons.get(row, 'design'));
    if (!template) throw new Error('このモンスターのデザインの行がありません');
    const { entries, hashes, altIdle } = await portedEntries(look, target, template, await takenIn(target, (n) => s.dump.readRomfs(n)));
    store.add(entries);
    const d = await s.monsterModels.addRow(portedDesign(look, target, template, hashes));
    mons.set(row, 'design', d);
    // the other idle (+0x48 bit9) needs a 002_ animation the new look may not have
    const r = mons.row(row);
    if (!altIdle && r[0x49]! & 2) r[0x49] = r[0x49]! & ~2;
    s.saveNow();
    return d;
  }
  const s = o.lanai;
  if (!s) throw new Error('電波人間のRPG FREE! を開いていません');
  const designs = s.need('MonsterDesign');
  const params = s.need('MonsterParameter');
  if (designs.rows >= 0x400) throw new Error('モンスターのデザインはこれ以上増やせません (1024 行まで)');
  const current = params.bits(row, 0x00, 20, 10);
  const from = lanaiTemplate((i) => designs.row(i), designs.rows, current);
  const { entries, hashes, altIdle } = await portedEntries(look, target, designs.row(from).slice(), await takenIn(target, (n) => s.dump.readRomfs(n)));
  store.add(entries);
  const d = designs.addRow(from);
  designs.setRow(d, portedDesign(look, target, designs.row(d).slice(), hashes));
  params.setBits(row, 0x00, 20, 10, d);
  // the other idle (+0x18 bit0) needs a 002_ animation the new look may not have
  if (!altIdle && params.u32(row, 0x18) & 1) params.setU32(row, 0x18, (params.u32(row, 0x18) & ~1) >>> 0);
  s.forgetArchive('719F0000');
  forgetLanaiModelIndex(s);
  forgetLanaiMonsters(s);
  s.edited();
  return d;
}

/**
 * The battle's other idle of a monster: it plays `002_` instead of `001_` (RPG2 MonsterParameter +0x4A bit3, RPG3
 * monsterParameter +0x48 bit9, FREE! MonsterParameter +0x18 bit0).
 */
export function altIdle(o: Opened, target: TitleKey, row: number): boolean {
  if (target === 'kahara') return !!(o.kahara!.session.book!.paramRow(row)[0x4a]! & 8);
  if (target === 'oahu') return !!(o.oahu!.battle.monsters.row(row)[0x49]! & 2);
  return !!(o.lanai!.need('MonsterParameter').u32(row, 0x18) & 1);
}

export function setAltIdle(o: Opened, target: TitleKey, row: number, on: boolean): void {
  if (target === 'kahara') {
    const s = o.kahara!.session;
    const p = s.book!.paramRow(row);
    p[0x4a] = on ? p[0x4a]! | 8 : p[0x4a]! & ~8;
    s.book!.reload();
    s.saveNow();
  } else if (target === 'oahu') {
    const r = o.oahu!.battle.monsters.row(row);
    r[0x49] = on ? r[0x49]! | 2 : r[0x49]! & ~2;
    o.oahu!.saveNow();
  } else {
    const t = o.lanai!.need('MonsterParameter');
    t.setU32(row, 0x18, (on ? t.u32(row, 0x18) | 1 : t.u32(row, 0x18) & ~1) >>> 0);
    o.lanai!.edited();
  }
}
