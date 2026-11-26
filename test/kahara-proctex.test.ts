// RPG2's tileset 11 (the cave of CaveC) gets the field's procedural texture on its `*_pro` materials: with the ROM.
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { KAHARA_PROCTEX_ARCHIVE, KAHARA_PROCTEX_FILE } from '../src/cgfx/loader';
import { parsePctx } from '../src/cgfx/proctex';
import { ModelFactory } from '../src/cgfx/three';
import { buildTileset } from '../src/cgfx/tileset';
import { Game } from '../src/game/game';
import { openImages } from '../src/rom/dump';
import { hex8 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

describe.skipIf(!hasCia)('RPG2 tileset 11 procedural texture', () => {
  test('the floor samples it, a decoration does not', async () => {
    const dump = await openImages([Bun.file(CIA)], (f) => (f as unknown as { name: string }).name);
    const game = await Game.load(dump);
    let row = -1;
    for (let i = 1; i < game.master.mapData.rows && row < 0; i++)
      if (game.master.mapData.row(i)[0] === 11) row = game.master.mapData.row(i)[1]!;
    const a = game.master.resourceArchives(row);
    expect(hex8(a[0]!)).toBe(KAHARA_PROCTEX_ARCHIVE);
    const set = buildTileset(
      (await dump.readRomfs(hex8(a[0]!))).slice(),
      (await dump.readRomfs(hex8(a[1]!))).slice(),
      a[2]!,
    );
    set.proctex = { p: parsePctx(await dump.readRomfs(KAHARA_PROCTEX_FILE)), models: new Set(set.models.keys()) };
    const f = new ModelFactory(set);
    const proc = (hash: number) => {
      const out: boolean[] = [];
      f.instance(hash)!.traverse((o) => {
        if (o instanceof THREE.Mesh) out.push(!!(o.material as THREE.Material).userData.proctex);
      });
      return out;
    };
    expect(proc(game.master.partModel(5, 11, 0))).toEqual([true]); // floor: M_ground (caveC_pro)
    expect(proc(game.master.partModel(5, 11, 2))).not.toContain(true); // moss and mushrooms
    f.dispose();
  });
});
