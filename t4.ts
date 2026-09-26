import { openImage } from './src/rom/dump'; import { CIA } from './test/env';
import { parseArchive, unpackEntry } from './src/archive/gsarc'; import { hex8 } from './src/util/bytes';
import { parseCgfx, unwrapT8 } from './src/cgfx/cgfx';
const d = await openImage(Bun.file(CIA), 'cia');
const arc = parseArchive(await d.readRomfs(process.argv[2] ?? '46910AB6'));
for (const e of arc.entries) {
  const { path, cgfx } = unwrapT8(unpackEntry(arc, e).body);
  try {
    const f = parseCgfx(cgfx);
    const m = f.models[0];
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let v = 0, t = 0;
    for (const me of m?.meshes ?? []) { v += me.positions.length / 3; t += me.indices.length / 3;
      for (let i = 0; i < me.positions.length; i += 3) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k]!, me.positions[i + k]!); bb[k + 3] = Math.max(bb[k + 3]!, me.positions[i + k]!); } }
    console.log(hex8(e.hash), path.split('/').pop(), m?.name, 'meshes', m?.meshes.length, 'v', v, 't', t, 'bb', bb.map(x => Math.round(x)).join(','),
      '| mats', m?.materials.map(x => `${x.name}[${x.textures.filter(Boolean).join('+')}] c${x.cull} l${x.layer} w${x.wrapS}${x.wrapT} uv${x.uv.scaleU},${x.uv.scaleV}`).join(' '),
      '| tex', f.textures.map(x => `${x.name}(${x.width}x${x.height} f${x.format})`).join(' '),
      '| attrs', (m?.meshes ?? []).map(me => [me.normals ? 'n' : '', me.uvs ? 't' : '', me.colors ? 'c' : ''].join('')).join(','));
  } catch (err) { console.log(hex8(e.hash), path, 'ERR', (err as Error).message); }
}
