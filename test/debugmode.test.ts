// Panana's debug mode (game/debugmode.ts): the patch assembles into the @emu area, its text and tables,
// and on the dump: the places it rewrites, the hook and the shop of every item.
import { beforeAll, describe, expect, test } from 'bun:test';
import { DEBUG_SHOP, debugModePatch, debugModeProblem, debugModeSource, debugShopItems, milestoneLabel, milestoneWrite } from '../src/game/debugmode';
import { KAHARA_EMU_AREA, buildPatches, patchRecords, applyRecords } from '../src/game/patch';
import { EXT_END, EXT_HEADER, SPILL } from '../src/game/mappatch';
import { MAP_DATA_KEYS } from '../src/game/codeconst';
import { STORY_CONDITIONS } from '../src/game/storyconditions';
import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { u16, u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

describe('debug mode patch', () => {
  test('the story milestones write 0x91[n] = 2 for a boss and 0x8D[type - 0x18] for an ending', () => {
    expect(milestoneWrite({ label: '', type: 0xb0, value: 6, sure: true })).toEqual({ key: 0x91, index: 6, value: 2 });
    expect(milestoneWrite({ label: '', type: 0x20, value: 3, sure: true })).toEqual({ key: 0x8d, index: 8, value: 3 });
    expect(milestoneLabel(STORY_CONDITIONS[2]!)).toBe('海底トンネルのバブルフロッグ');
    expect(STORY_CONDITIONS.every((c) => milestoneWrite(c))).toBe(true);
  });

  test('assembles without errors into the @emu area only (plus the three in-place words)', () => {
    const code = new Uint8Array(0x511000 - 0x100000);
    const built = buildPatches(code, [debugModePatch()]).get('panana:debug-mode')!;
    expect(built.errors).toEqual([]);
    const caves = built.blocks.filter((b) => b.kind === 'cave');
    expect(caves.every((b) => b.emu && b.addr >= KAHARA_EMU_AREA.start && b.addr + b.lines.length * 4 <= KAHARA_EMU_AREA.end)).toBe(true);
    expect(built.blocks.filter((b) => b.kind === 'at').map((b) => [b.addr, b.lines.length])).toEqual([[0x3ff000, 1], [0x1d4c44, 1], [0x2ea5b0, 1]]);
    // the hook is a bl to dbg_key
    const patched = applyRecords(code, patchRecords([built]));
    const bl = u32(patched, 0x3ff000 - 0x100000);
    expect(bl >>> 24).toBe(0xeb);
    expect(0x3ff000 + 8 + ((bl << 8) >> 6)).toBe(built.labels.get('dbg_key')!);
    // a string is UTF-16 ended by 0
    const s = built.labels.get('s_q_until')! - 0x100000;
    expect([u16(patched, s), u16(patched, s + 2)]).toEqual([0x307e, 0x3067]);
    // a word whose upper unit is 0x8000 or more (？ U+FF1F) is written whole
    const q = built.labels.get('s_q_story')!;
    expect(Array.from({ length: 30 }, (_, i) => u16(patched, q - 0x100000 + i * 2))).toContain(0xff1f);
    // the story table: key | index << 8 | value << 16; the labels follow one another from s_story0, 4-aligned
    const t = built.labels.get('story_table')! - 0x100000;
    expect(u32(patched, t)).toBe(0x91 | (3 << 8) | (2 << 16));
    expect(u32(patched, t + 4)).toBe(0x91 | (4 << 8) | (2 << 16));
    const s0 = built.labels.get('s_story0')!;
    expect(built.labels.get('s_story1')!).toBe((s0 + (milestoneLabel(STORY_CONDITIONS[0]!).length + 1) * 2 + 3) & ~3);
    // the questions call the game's yes / no window and the jump screen
    expect(debugModeSource()).toContain('bl FUN_0030873c');
    expect(debugModeSource()).toContain('mov r1, #0x23');
  });

  test('a @emu block is an error where the game has no such area', () => {
    const code = new Uint8Array(0x511000 - 0x100000);
    const layout = { caveStart: 0x4bf020, caveEnd: 0x4bff80, reservedEnd: 0x4c0000, writableEnd: 0x511000 };
    const built = buildPatches(code, [{ id: 'x', title: 'x', enabled: true, source: debugModeSource() }], layout).get('x')!;
    expect(built.errors[0]?.message).toContain('@emu');
  });
});

describe.skipIf(!hasCia)('debug mode on the dump', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('the rewritten words are the game\'s, and the area is copies of the mapData key array new maps do not use', () => {
    expect(debugModeProblem(game.dump.code)).toBeNull();
    const keys = game.dump.code.slice(MAP_DATA_KEYS - 0x100000, MAP_DATA_KEYS - 0x100000 + 0x334);
    expect((KAHARA_EMU_AREA.end - KAHARA_EMU_AREA.start) % 0x334).toBe(0);
    for (let a = KAHARA_EMU_AREA.start; a < KAHARA_EMU_AREA.end; a += 0x334) {
      expect(game.dump.code.slice(a - 0x100000, a - 0x100000 + 0x334)).toEqual(keys);
      expect(SPILL.some((s) => s < a + 0x334 && a < s + 0x334)).toBe(false);
    }
    expect(KAHARA_EMU_AREA.start >= EXT_END || KAHARA_EMU_AREA.end <= EXT_HEADER).toBe(true);
    const built = buildPatches(game.dump.code, [debugModePatch()]).get('panana:debug-mode')!;
    expect(built.errors).toEqual([]);
  });

  test('the shop sells every named item that is not gold', () => {
    const items = debugShopItems(game.master.itemData, (id) => game.master.itemName(id));
    expect(items.length).toBeGreaterThan(500);
    expect(items).toContain(1);
    expect(items.every((id) => game.master.itemName(id) && (game.master.itemData.row(id)[0x2c]! & 0xf) !== 2)).toBe(true);
    expect(DEBUG_SHOP).toBe(18);
  });
});
