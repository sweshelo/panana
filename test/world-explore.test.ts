// TEMPORARY: prints code.bin / data facts about how W01 entrances appear (world map appearance conditions). Removed before the PR.
import { beforeAll, describe, test } from 'bun:test';
import { disassemble, type Insn } from '../src/game/disasm';
import { Game } from '../src/game/game';
import { ENT, parseEntrances } from '../src/game/worldmap';
import { openImage } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

const BASE = 0x100000;
const log = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => v.toString(16);

describe.skipIf(!hasCia)('explore', () => {
  let game: Game;
  let code: Uint8Array;
  let insns: Insn[];
  const at = (a: number): Insn => insns[(a - BASE) >> 2]!;
  const word = (a: number): number => u32(code, a - BASE);
  const dis = (tag: string, a: number, n: number): void => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = at(a + i * 4);
      if (!x) break;
      out.push(`${h(x.addr)} ${x.text}${x.literal !== undefined ? ` ; =${h(word(x.literal))}` : ''}`);
    }
    log(`DIS ${tag} @${h(a)}\n` + out.join('\n'));
  };
  const callers = (t: number): number[] => insns.filter((x) => x.call && x.target === t).map((x) => x.addr);
  const funcStart = (a: number): number => {
    for (let p = a; p > a - 0x4000; p -= 4) if (/^push \{.*lr\}/.test(at(p).text)) return p;
    return a;
  };

  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    code = game.dump.code;
    insns = [];
    for (let o = 0; o + 4 <= code.length; o += 4) insns.push(disassemble(u32(code, o), BASE + o));
  }, 300000);

  test('round 1', async () => {
    for (const w of game.worldMaps()) {
      const ents = parseEntrances(game.db.get(w.sections[2]!));
      const ev = await game.eventTable(w.dungeon);
      log(`WORLD ${w.code} entrances ${ents.length} events ${ev?.rows ?? '-'} mapGroup ${Array.from(game.master.mapGroup.row(w.dungeon).slice(0, 0x28), (b) => b.toString(16).padStart(2, '0')).join('')}`);
      for (const [i, r] of ents.entries()) {
        const e = ENT.event(r);
        const row = ev && e ? ev.table.row(e) : null;
        log(`ENT ${w.code} ${i} id=${h(ENT.id(r))} dest=${h(ENT.destMap(r))} ev=${e} pt=${h(ENT.point(r))} part=${ENT.part(r)} xy=${ENT.x(r)},${ENT.y(r)}` +
          (row ? ` row: +00=${u32(row, 0)} +04=${u32(row, 4)} +4B=${h(row[0x4b]!)} +4C=${h(row[0x4c]!)} +4D=${h(row[0x4d]!)} +44=${h(row[0x44]! | (row[0x45]! << 8))}` : ''));
      }
      if (ev) for (let i = 0; i < ev.rows; i++) log(`EVROW ${w.code} ${i} ${Array.from(ev.table.row(i), (b) => b.toString(16).padStart(2, '0')).join('')}`);
      const s6 = game.db.get(w.sections[6]!);
      for (let o = 0; o + 16 <= s6.length; o += 16) log(`S6 ${w.code} ${Array.from(s6.slice(o, o + 16), (b) => b.toString(16).padStart(2, '0')).join('')}`);
    }
    // messages that say something appeared
    for (let id = 0; id < 0x6000; id++) {
      const t = game.master.message(id);
      if (t && /出現|現れ|あらわれ|姿を/.test(t)) log(`MSG ${h(id)} ${t.slice(0, 60).replace(/\n/g, ' ')}`);
    }
    // the entrance loader and the W01 script classes
    dis('FUN_001E2AC4 entrances', 0x1e2ac4, 200);
    for (const [tag, a, n] of [['262270', 0x262270, 30], ['2622C8', 0x2622c8, 140], ['262490', 0x262490, 4], ['262494', 0x262494, 30], ['2624B4', 0x2624b4, 30], ['26251C', 0x26251c, 140], ['262CCC', 0x262ccc, 20], ['262D14', 0x262d14, 120]] as const) dis(tag, a, n);
    dis('vtable 4FF664', 0x4ff664, 8);
    for (const c of callers(0x1e2ac4)) log('caller 1e2ac4', h(c), 'fn', h(funcStart(c)));
  });
});
