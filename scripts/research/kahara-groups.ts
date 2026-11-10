// Read-only investigation of RPG2 v1.1.0 encounter groups.
// Usage: bun scripts/research/kahara-groups.ts [roms/kahara-base.cia]
// Runs the ROM's integer ARM routines with table lookups and RNG stubbed.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { openImage } from '../../src/rom/dump';
import { GsTable } from '../../src/archive/gstable';
import { ArmMachine } from '../../src/game/arm';

const dump = await openImage(Bun.file(process.argv[2] ?? 'roms/kahara-base.cia'), 'research');
assert.equal(dump.titleVersion, 1040, 'Addresses below require Kahara v1.1.0');
const archive = Buffer.from(await dump.readRomfs('56562135'));
const tables = new Map<string, GsTable>();
for (let i = 0; i < archive.readUInt32LE(8); i++) {
  const entry = 12 + i * 28;
  if (archive.readUInt32LE(entry + 16) !== 1) continue;
  const off = archive.readUInt32LE(entry + 12);
  if (archive.readUInt32LE(off) !== 0x04034b50) continue;
  const nl = archive.readUInt16LE(off + 26), el = archive.readUInt16LE(off + 28);
  const name = archive.subarray(off + 30, off + 30 + nl).toString();
  if (!/^monster(Group|FixGroup)\.bin$/.test(name)) continue;
  const start = off + 30 + nl + el;
  const compressed = archive.subarray(start, start + archive.readUInt32LE(off + 18));
  const method = archive.readUInt16LE(off + 8);
  assert.ok(method === 0 || method === 8);
  tables.set(name, new GsTable(method === 8 ? inflateRawSync(compressed) : compressed));
}
const groups = tables.get('monsterGroup.bin')!, fixes = tables.get('monsterFixGroup.bin')!;
assert.equal(groups.rows, 144);
assert.equal(groups.rowSize, 0x2e);
assert.equal(fixes.rows, 65);
const reference = await Bun.file(new URL('../../docs/kahara/reference/monsters.md', import.meta.url)).text();
const names = new Map([...reference.matchAll(/^\| (\d+) \| \d+ \| ([^|]+) \|/gm)].map(m => [Number(m[1]), m[2]!.trim()]));
const u16 = (r: Uint8Array, off: number) => r[off]! | r[off + 1]! << 8;
function slots(row: Uint8Array, start: number, size: number) {
  return Array.from({ length: 5 }, (_, i) => ({ id: u16(row, start + i * 4), code: row[start + i * 4 + size]! }))
    .filter(s => s.id).map(s => ({ ...s, name: names.get(s.id) }));
}
console.log(JSON.stringify({ version: dump.titleVersion, codeSha256: createHash('sha256').update(dump.code).digest('hex') }));
let empty = 0, fixedOnly = 0, dormantFixReferences = 0;
for (let row = 0; row < groups.rows; row++) {
  const r = groups.row(row);
  const candidates = [...slots(r, 0, 3), ...slots(r, 0x14, 3)];
  if (!candidates.length) empty++;
  if (!r[0x2d]) continue;
  if (!candidates.length) fixedOnly++;
  else if (!r[0x28]) dormantFixReferences++;
  console.log(JSON.stringify({ row, weights: [...r.subarray(0x28, 0x2d)], fix: r[0x2d], fixedPatternEnabled: !!r[0x28],
    formation: slots(fixes.row(r[0x2d]!), 4, 2), candidates }));
}
console.log(JSON.stringify({ total: groups.rows, emptyCandidates: empty, fixedOnly, dormantFixReferences }));

// Exercise allocation AND battle-list construction, including an edit to the candidate area.
function execute(row: Uint8Array, seed: number) {
  let groupPtr = 0, fixPtr = 0, rngPtr = 0;
  const m = new ArmMachine(dump.code, { stubs: new Map([
    [0x30f984, () => groupPtr], // resolve group hash
    [0x31d738, () => rngPtr],   // RNG state
    [0x319170, () => 0],        // current map key, avoid two special-map branches
    [0x31cfb8, () => fixPtr],   // resolve fixed table row (checked below)
  ]) });
  groupPtr = m.alloc(0x30); row.forEach((b, i) => m.wb(groupPtr + i, b));
  rngPtr = m.alloc(8); m.write(rngPtr, seed, 4);
  const encounter = m.alloc(0x500);
  m.run(0x3523b0, [encounter, 0]);
  const selectedFix = m.rb(encounter + 2);
  const allocation = [m.rb(encounter), m.rb(encounter + 1), selectedFix];
  if (allocation[1]) return { allocation };
  fixPtr = m.alloc(0x18);
  fixes.row(selectedFix).forEach((b, i) => m.wb(fixPtr + i, b));
  const master = m.alloc(0xa00), header = m.alloc(4), world = m.alloc(0x500);
  m.write(0x520448, master, 4); m.write(master + 0x96c, header, 4); m.write(header, fixes.rows, 4);
  m.write(0x564638, world, 4);
  m.run(0x190b6c, [encounter]);
  const enemies = Array.from({ length: m.rb(encounter + 0x3a2) }, (_, i) => m.read(encounter + 0x38a + i * 2, 2));
  const lookup = m.calls.find(c => c.target === 0x31cfb8);
  assert.equal(m.read(lookup!.args[0] + 0xc, 4), selectedFix);
  return { allocation, enemies };
}
const original = groups.row(142).slice();
const edited = original.slice();
edited[0] = 1; edited[2] = 1; // add monster #1, weight 1, count code 0
for (const seed of [0, 1, 123456, 0xffffffff]) {
  for (const [label, bytes] of [['original', original], ['candidate edited', edited]] as const) {
    const result = execute(bytes, seed);
    assert.deepEqual(result, { allocation: [0, 0, 34], enemies: [176] });
    console.log(JSON.stringify({ check: label, seed, ...result }));
  }
}
// Clearing only the fixed ID is insufficient: pattern weights must enable normal candidates.
const normal = edited.slice(); normal[0x28] = 0; normal[0x29] = 1; normal[0x2d] = 0;
assert.equal(execute(normal, 0).allocation[1], 1);
console.log('PASS: #142 uses fixed #34 / monster #176 even after candidate edits; normal-pattern control passed.');
