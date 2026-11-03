// Produce an isolated test package; never installs it into an emulator profile.
// bun scripts/save201/package.ts <unmodified-v1.1.0-code.bin> <output.zip>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPatches, patchRecords } from '../../src/game/patch';
import { SAVE_PATCH, SAVE_PATCH_ID, savePatchProblem } from '../../src/game/savepatch';
import { buildIps } from '../../src/rom/ips';
import { buildModZip } from '../../src/export/pack';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: bun scripts/save201/package.ts <code.bin> <output.zip>');
const code = new Uint8Array(readFileSync(input));
const problem = savePatchProblem(code);
if (problem) throw new Error(problem);
const built = buildPatches(code, [SAVE_PATCH]).get(SAVE_PATCH_ID)!;
if (built.errors.length) throw new Error(JSON.stringify(built.errors));
const ips = buildIps(patchRecords([built]), code);
const zip = buildModZip(new Map([['exefs/code.ips', ips]]));
writeFileSync(output, zip);
console.log(`Created test package (${zip.length} bytes); runtime ${built.cave![1] - built.cave![0]} bytes. No emulator files changed.`);
