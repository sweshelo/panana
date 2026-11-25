// Write the CRO of RPG FREE! contents to files: bun scripts/research/dump-cro.ts OUT_DIR 22 23 28
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lanaiContents } from '../../src/lanai/contents';
import { LanaiSession } from '../../src/lanai/session';
import { contentScript } from '../../src/lanai/stageEdit';
import { openImages } from '../../src/rom/dump';
import { LANAI_BASE, LANAI_UPDATE } from '../../test/env';

const [out, ...nums] = process.argv.slice(2);
mkdirSync(out!, { recursive: true });
const dump = await openImages(
  [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
  (f) => (f as unknown as { name: string }).name,
);
const s = await LanaiSession.open(dump);
for (const n of nums) {
  const c = lanaiContents(s).find((c) => c.index === Number(n))!;
  await Bun.write(
    join(out!, `contents${n.padStart(4, '0')}.cro`),
    (await contentScript(s, c, await s.archive(c.archive))).body,
  );
}
