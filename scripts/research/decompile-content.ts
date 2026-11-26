// Write a content's CRO events back as script: bun scripts/research/decompile-content.ts 22 [group.row ...]
import { lanaiContents } from '../../src/lanai/contents';
import { decompileContentCro } from '../../src/lanai/croDecompile';
import { LanaiSession } from '../../src/lanai/session';
import { contentScript } from '../../src/lanai/stageEdit';
import { openImages } from '../../src/rom/dump';
import { LANAI_BASE, LANAI_UPDATE } from '../../test/env';

const dump = await openImages(
  [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
  (f) => (f as unknown as { name: string }).name,
);
const s = await LanaiSession.open(dump);
const c = lanaiContents(s).find((c) => c.index === Number(process.argv[2]))!;
const d = decompileContentCro((await contentScript(s, c, await s.archive(c.archive))).body);
const want = process.argv.slice(3);
for (const e of d.events) {
  const b = e.bindings.map((b) => `${b.trigger} g${b.group} r${b.row}`).join(', ');
  if (want.length && !e.bindings.some((x) => want.includes(`${x.group}.${x.row & 0xffff}`))) continue;
  console.log(`--- ${e.cls} : ${e.base} [${b}]`);
  console.log(e.text);
  if (e.notes.length) console.log('NOTES:', e.notes.join(' | '));
}
