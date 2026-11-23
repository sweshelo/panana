// The procedural texture of the CaveC tiles (src/cgfx/proctex.ts, lanaiTileModels): with the ROM.
import { beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { procTexPhase } from '../src/cgfx/proctex';
import { ModelFactory } from '../src/cgfx/three';
import { LANAI_PROCTEX_FILE, lanaiProcTex, lanaiTileModels } from '../src/lanai/mapModels';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const CAVEC_FLOOR = { archive: 0xd17b0000, entry: 0xb640f000 };
const source = (textureArchive: number, textureEntry: number) => ({
  mapData: -1,
  tileset: 0,
  partsName: '',
  resource: 0,
  textureArchive,
  textureEntry,
});

describe.skipIf(!hasLanai)('RPG FREE! CaveC procedural texture', () => {
  let s: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
  });

  test('proctex_mud03 reads as the loader does', async () => {
    const p = await lanaiProcTex(s, LANAI_PROCTEX_FILE);
    expect([p.combiner, p.clampU, p.clampV, p.lutWidth, p.lutOffset, p.coordScale]).toEqual([5, 3, 3, 128, 0, 2]);
    expect(p.noise).toBe(true);
    expect(p.amplitude).toEqual([2, 1]);
    expect(p.phase).toEqual([3.5, 1.5]);
    expect(p.mode).toEqual([1, 1]);
    expect(p.uvRange).toEqual([0, 1, 0, 1]);
    expect(p.color[3]).toBeCloseTo(0.914, 3);
    // the phase swings by sin: U every 1750 ticks (29.2 s), V every 750 (12.5 s)
    expect(procTexPhase(p, 0)).toEqual([0, 0]);
    expect(procTexPhase(p, 1750 / 4)[0]).toBeCloseTo(3.5, 4);
    expect(procTexPhase(p, 750 / 4)[1]).toBeCloseTo(1.5, 4);
    expect(procTexPhase(p, 1750)[0]).toBeCloseTo(0, 4);
  });

  test('the CaveC parts get it, other tilesets do not; stage 0 samples texture 3', async () => {
    const set = await lanaiTileModels(s, source(0x3dc60000, 0x4dfba400), [CAVEC_FLOOR]);
    expect(set.proctex?.models.has(CAVEC_FLOOR.entry)).toBe(true);
    const f = new ModelFactory(set);
    const tile = f.instance(CAVEC_FLOOR.entry)!;
    expect(f.animated).toBe(true);
    const mats: THREE.ShaderMaterial[] = [];
    tile.traverse((o) => {
      if (o instanceof THREE.Mesh) mats.push(o.material as THREE.ShaderMaterial);
    });
    expect(mats.every((m) => m.userData.proctex && m.fragmentShader.includes('vColor.rgb * t3.rgb'))).toBe(true);
    f.placeOnGrid(tile, 3, 4, 1);
    tile.traverse((o) => {
      if (o instanceof THREE.Mesh)
        o.onBeforeRender(
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
        );
    });
    expect((mats[0]!.uniforms.ptTile!.value as THREE.Vector3).toArray()).toEqual([3, 4, Math.PI / 2]);
    f.tick(750 / 4 / 60);
    expect((mats[0]!.uniforms.ptPhase!.value as THREE.Vector2).y).toBeCloseTo(1.5, 4);
    f.dispose();

    const relic = await lanaiTileModels(s, source(0x3dc60000, 0x6d3a9800), [
      { archive: 0x4da30000, entry: 0x1109e400 },
    ]);
    expect(relic.proctex).toBeUndefined();
  });
});
