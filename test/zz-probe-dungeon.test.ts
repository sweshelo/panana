// TEMPORARY probe (new dungeon investigation): prints ROM facts to the CI log. Remove before merge.
import { describe, test } from 'bun:test';
import { Game } from '../src/game/game';
import { BASE, MAP_TABLE, MAP_TABLE_ROWS } from '../src/game/codeconst';
import { disassemble } from '../src/game/disasm';
import { findByName, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { openImage } from '../src/rom/dump';
import { cstr, hex8, u16, u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

const hx = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe.skipIf(!hasCia)('PROBE dungeon', () => {
  test('dump', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const code = game.dump.code;
    const at = (a: number): number => a - BASE;
    const L: string[] = [];
    const p = (s: string): void => {
      L.push(s);
    };
    p('== dungeon table');
    for (let i = 0; i < MAP_TABLE_ROWS; i++) {
      const o = at(MAP_TABLE) + i * 16;
      const np = u32(code, o + 4);
      p(`row ${i}: id ${u32(code, o)} name ${np ? cstr(code, at(np)) : '-'} (${hex8(np)}) count ${u32(code, o + 8)} arr ${hex8(u32(code, o + 12))}`);
    }
    p(`after table: ${hx(code.subarray(at(MAP_TABLE) + MAP_TABLE_ROWS * 16, at(MAP_TABLE) + MAP_TABLE_ROWS * 16 + 64))}`);
    const mg = game.master.mapGroup;
    p(`== mapGroup rows ${mg.rows} size ${mg.rowSize} offset ${mg.offset} index ${mg.indexOffset} total ${mg.data.length}`);
    p(`header ${hx(mg.data.subarray(0, mg.offset))}`);
    for (let r = 0; r < mg.rows; r++) p(`mg ${r} ${game.master.dungeonName(r)}: ${hx(mg.row(r))}`);
    if (mg.indexOffset) p(`mg index ${hx(mg.data.subarray(mg.indexOffset))}`);
    const ent = findByName(game.master.archive, 'mapGroup.bin')!.entry;
    p(`mapGroup entry hash ${hex8(ent.hash)} index ${ent.index}`);
    const fd = new GsTable(findByName(game.master.archive, 'flagData.bin')!.body);
    p(`== flagData rows ${fd.rows} size ${fd.rowSize}`);
    for (const k of [0x4f, 0x50, 0x51, 0x5f, 0x60, 0x61, 0x62, 0x63, 0x8d, 0x8e, 0x91, 0x92]) p(`flag ${hex8(k)}: ${hx(fd.row(k))}`);
    p('== master entries');
    for (const e of game.master.archive.entries) {
      const n = e.comp === 1 ? unpackEntry(game.master.archive, e).name : null;
      p(`m ${e.index} ${hex8(e.hash)} t${e.type} c${e.comp} ${n ?? ''}`);
    }
    p('== event archives');
    for (let d = 0; d < mg.rows; d++) {
      const a = game.master.eventArchive(d);
      if (!a) continue;
      let s = `ev d${d} ${hex8(a)}:`;
      try {
        const arc = parseArchive(await game.dump.readRomfs(hex8(a)));
        s += ` ver ${arc.version} hash ${hex8(arc.hash)}`;
        for (const e of arc.entries) s += ` [${hex8(e.hash)} t${e.type} c${e.comp} ${e.comp === 1 ? unpackEntry(arc, e).name : ''} ${e.raw}]`;
      } catch (err) {
        s += ' ' + (err as Error).message;
      }
      p(s);
    }
    // literal references
    const words = new Map<number, number[]>();
    for (let o = 0; o + 4 <= code.length; o += 4) {
      const w = u32(code, o);
      const l = words.get(w);
      if (l) l.push(o + BASE);
      else words.set(w, [o + BASE]);
    }
    const refsTo = (lit: number): number[] => {
      const out: number[] = [];
      for (let a = BASE; a < 0x4c0000; a += 4) {
        const w = u32(code, at(a));
        if ((w & 0x0f7f0000) === 0x051f0000) {
          const off = w & 0xfff;
          const t = a + 8 + (w & 0x800000 ? off : -off);
          if (t === lit) out.push(a);
        }
      }
      return out;
    };
    const dis = (start: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const a = start + i * 4;
        const ins = disassemble(u32(code, at(a)), a);
        p(`  ${a.toString(16)}: ${ins.text}${ins.literal ? ` ; =${hex8(u32(code, at(ins.literal)))}` : ''}`);
      }
    };
    const showRefs = (label: string, value: number): void => {
      const lits = words.get(value >>> 0) ?? [];
      p(`== refs ${label} ${hex8(value)}: words at ${lits.map((x) => x.toString(16)).join(' ')}`);
      for (const l of lits.slice(0, 12)) for (const r of refsTo(l).slice(0, 6)) {
        p(` ldr at ${r.toString(16)}`);
        dis(r - 16 * 4, 48);
      }
    };
    showRefs('mapGroup entry', ent.hash);
    showRefs('flagData entry', findByName(game.master.archive, 'flagData.bin')!.entry.hash);
    const d1 = parseArchive(await game.dump.readRomfs(hex8(game.master.eventArchive(1))));
    for (const e of d1.entries) showRefs(`d01 entry ${e.index}`, e.hash);
    p('== functions');
    for (const [a, n] of [[0x2f8e1c, 40], [0x2f8de0, 20], [0x2f1f48, 40], [0x20e384, 50], [0x31bac4, 30], [0x304adc, 80], [0x30b788, 20], [0x31c3d8, 40], [0x31bff4, 40], [0x2c65f8, 30], [0x003048f8, 60]] as const) {
      p(` FUN_${a.toString(16)}`);
      dis(a, n);
    }
    p('== cmp #0x3a / #0x39 / #0x38');
    for (let a = BASE; a < 0x4c0000; a += 4) {
      const w = u32(code, at(a));
      if ((w & 0x0ff0f000) === 0x03500000 && [0x38, 0x39, 0x3a].includes(w & 0xfff)) p(`  ${a.toString(16)}: ${disassemble(w, a).text}`);
    }
    // world map entrance destinations (section 2) of W01 dungeons? also dungeon names msg ids
    p(`== u16 0x16 of mapGroup: ${Array.from({ length: mg.rows }, (_, r) => u16(mg.row(r), 0x16)).join(',')}`);
    console.log(L.join('\n'));
  }, 600000);
});
