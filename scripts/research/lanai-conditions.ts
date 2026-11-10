// bun scripts/research/lanai-conditions.ts [first kind] [last kind]
// Local ROM only. Lists the actual branch targets and disassembly, including literal addresses.
import { disassemble } from '../../src/game/disasm';
import { openImages, openUpdate } from '../../src/rom/dump';
import { u32 } from '../../src/util/bytes';
import { LANAI_BASE, LANAI_UPDATE } from '../../test/env';

if (process.argv.includes('--usage')) {
  const { LanaiSession } = await import('../../src/lanai/session');
  const { lanaiContents } = await import('../../src/lanai/contents');
  const { lanaiMaps } = await import('../../src/lanai/maps');
  const images = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as File).name);
  const session = await LanaiSession.open(images, { fresh: true });
  const counts = new Map<number, number>();
  const examples = new Map<number, Set<string>>();
  for (const content of lanaiContents(session)) {
    const maps = await lanaiMaps(session, content);
    for (const group of maps.groups) {
      const table = maps.eventTable(group.row);
      if (!table) continue;
      for (let row = 1; row < table.rows; row++)
        for (const [field, offset] of [
          [0x5f, 0],
          [0x60, 8],
        ] as const) {
          const kind = table.u8(row, field);
          if (!kind) continue;
          counts.set(kind, (counts.get(kind) ?? 0) + 1);
          const values = examples.get(kind) ?? new Set<string>();
          if (values.size < 8) values.add(`${table.u32(row, offset)},${table.u32(row, offset + 4)}`);
          examples.set(kind, values);
        }
    }
  }
  console.log(
    [...counts]
      .sort(([a], [b]) => a - b)
      .map(([kind, count]) => ({ kind: `0x${kind.toString(16)}`, count, examples: [...examples.get(kind)!] })),
  );
  process.exit(0);
}

const dump = await openUpdate(Bun.file(LANAI_UPDATE), 'FREE! Update');
const code = dump.code;
const first = Number(process.argv[2] ?? 0);
const last = Number(process.argv[3] ?? 0x17);
const targets = Array.from({ length: 0x72 }, (_, k) => u32(code, 0x2fcd60 - 0x100000 + k * 4));
const sorted = [...new Set(targets)].sort((a, b) => a - b);
for (let kind = first; kind <= Math.min(last, 0x71); kind++) {
  const start = targets[kind]!;
  const end = Math.min(sorted.find((a) => a > start) ?? start + 16, start + 0x200);
  console.log(`\n条件 0x${kind.toString(16).toUpperCase()}: @${start.toString(16).toUpperCase()}`);
  for (let a = start; a < end; a += 4) {
    const ins = disassemble(u32(code, a - 0x100000), a);
    console.log(
      `${a.toString(16)}: ${ins.text}${ins.literal ? ` ; =0x${u32(code, ins.literal - 0x100000).toString(16)}` : ''}`,
    );
  }
}
