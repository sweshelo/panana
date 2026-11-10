// Reproduce the stage condition mapping and the native API inventory using local decrypted CIAs.
// bun scripts/research/lanai-stages.ts [--api] [--disasm]
import { openImages } from '../../src/rom/dump';
import { LanaiSession } from '../../src/lanai/session';
import { crsExports } from '../../src/lanai/scriptApi';
import { lanaiContents } from '../../src/lanai/contents';
import { conditionText } from '../../src/lanai/conditions';
import { disassemble } from '../../src/game/disasm';
import { u32, hex8 } from '../../src/util/bytes';
const dump = await openImages([Bun.file('roms/lanai-base.cia'), Bun.file('roms/lanai-update.cia')], f => (f as File).name);
const s = await LanaiSession.open(dump, { fresh: true });
if (process.argv.includes('--api')) {
  for (const api of crsExports(await dump.readUpdateRomfs!('app/lanai.crs'))) if (/^(Script\w*|StageResult|IntroCommon)::/.test(api.name)) console.log(`${hex8(api.address)}\t${api.name}\t${api.symbol}`);
} else if (process.argv.includes('--disasm')) {
  for (const [start, end] of [[0x1d6cd4,0x1d6d68], [0x2a9024,0x2a908c], [0x2c70ac,0x2c71cc], [0x2fcd38,0x2fcd60]]) {
    for(let a=start!;a<end!;a+=4) console.log(`${hex8(a)} ${disassemble(u32(dump.code,a-0x100000),a).text}`);
  }
} else {
  const t = s.need('MapStageIntegration'); const counts = new Map<number,number>();
  for (const c of lanaiContents(s)) for (const stage of c.stages) {
    const read = (offset: number) => ({kind:t.u8(stage.row,offset+8),v1:t.u32(stage.row,offset),v2:t.u32(stage.row,offset+4)});
    const visible = read(0x1c), hidden = read(0x28);
    if(visible.kind) counts.set(visible.kind,(counts.get(visible.kind)??0)+1);
    if(hidden.kind) counts.set(hidden.kind,(counts.get(hidden.kind)??0)+1);
    console.log(`${c.index}\t${stage.name}\t表示: ${conditionText(visible)}\t非表示: ${conditionText(hidden)}`);
  }
  console.log('条件の種類別件数 (種類 0 を除く):', Object.fromEntries(counts));
}
