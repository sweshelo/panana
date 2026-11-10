import { expect, test } from 'bun:test';
import * as THREE from 'three';
import type { ModelFactory } from '../src/cgfx/three';
import { PartThumbnails, type ThumbnailModel } from '../src/editor/part-thumbnails';
import { partTemplateKey, templateCategory } from '../src/editor/recordparts';
import { OahuEditState } from '../src/oahu/mapedit';
import type { OahuMaps, OahuMapInfo } from '../src/oahu/maps';
import { LanaiEditState } from '../src/lanai/mapedit';
import type { LanaiMaps, LanaiMapInfo } from '../src/lanai/maps';
import type { MapDoc } from '../src/game/sections';
const model = (dispose: () => void): ThumbnailModel => ({
  hash: 1,
  factory: { instance: () => new THREE.Group(), dispose } as unknown as ModelFactory,
});
test('thumbnail cache deduplicates requests and releases temporary model resources', async () => {
  let loads = 0,
    disposed = 0,
    renders = 0;
  const thumbs = new PartThumbnails(
    async (_id: number) => {
      loads++;
      return model(() => disposed++);
    },
    () => {
      renders++;
      return 'png';
    },
  );
  const first = thumbs.get('1', 1),
    second = thumbs.get('1', 1);
  expect(first).toBe(second);
  expect(await first).toBe('png');
  expect(await thumbs.get('1', 1)).toBe('png');
  expect(loads).toBe(1);
  expect(renders).toBe(1);
  expect(disposed).toBe(1);
});
test('closing a map while a preview loads prevents rendering and still frees the model', async () => {
  let finish!: (m: ThumbnailModel) => void;
  let disposed = 0,
    renders = 0;
  const thumbs = new PartThumbnails(
    () =>
      new Promise<ThumbnailModel>((resolve) => {
        finish = resolve;
      }),
    () => {
      renders++;
      return 'png';
    },
  );
  const pending = thumbs.get('late', 1);
  thumbs.dispose();
  finish(model(() => disposed++));
  expect(await pending).toBeNull();
  expect(renders).toBe(0);
  expect(disposed).toBe(1);
  expect(await thumbs.get('late', 1)).toBeNull();
});
test('a failed thumbnail render frees resources and returns a marker fallback', async () => {
  let disposed = 0;
  const thumbs = new PartThumbnails(
    async () => model(() => disposed++),
    () => {
      throw new Error('bad model');
    },
  );
  expect(await thumbs.get('bad', 1)).toBeNull();
  expect(disposed).toBe(1);
});
test('template keys survive refreshed descriptors and keep source records distinct; miscellaneous parts share gimmicks', () => {
  const t = { section: 5, source: 'map', label: 'same', raw: new Uint8Array([1, 2, 3]) };
  expect(partTemplateKey(t)).toBe(partTemplateKey({ ...t, raw: t.raw.slice() }));
  expect(partTemplateKey({ ...t, source: 'other' })).not.toBe(partTemplateKey(t));
  expect(partTemplateKey({ ...t, raw: new Uint8Array([1, 2, 4]) })).not.toBe(partTemplateKey(t));
  expect(templateCategory(5)).toBe('ギミック');
  expect(templateCategory(8)).toBe('ギミック');
  expect(templateCategory(4)).toBe('宝箱');
});
const doc = (hash: number): MapDoc => ({
  hash,
  name: 'map' + hash,
  dungeon: hash,
  floor: 1,
  tiles: [],
  recs: {},
  sec6Header: new Uint8Array(),
  cells6: [],
  raw: {},
});
test('Oahu clears region-bound templates when changing dungeons, without losing prop selection', () => {
  const maps = {
    doc: (info: OahuMapInfo) => doc(info.hash),
    tileSource: () => ({ tileset: 0 }),
  } as unknown as OahuMaps;
  const st = new OahuEditState(maps);
  const a = { hash: 1, dungeon: 1 } as OahuMapInfo,
    b = { hash: 2, dungeon: 2 } as OahuMapInfo;
  st.open(a);
  st.stamp = { type: 'template', t: { section: 4, source: 'a', label: 'chest', raw: new Uint8Array(), event: null } };
  st.setTool('place');
  st.open(b);
  expect(st.stamp).toBeNull();
  expect(st.tool).toBe('select');
  st.stamp = { type: 'prop', row: 9, dir: 2 };
  st.setTool('place');
  st.open(a);
  expect(st.stamp).toEqual({ type: 'prop', row: 9, dir: 2 });
});
test('Lanai clears group-bound templates when changing MapGroups', () => {
  const maps = {
    on: () => () => {},
    doc: (info: LanaiMapInfo) => doc(info.hash),
    tileSource: () => ({ mapData: 0, tileset: 0 }),
  } as unknown as LanaiMaps;
  const st = new LanaiEditState(maps);
  const a = { hash: 1, dungeon: 1 } as LanaiMapInfo,
    b = { hash: 2, dungeon: 2 } as LanaiMapInfo;
  st.open(a);
  st.stamp = { type: 'template', t: { section: 4, source: 'a', label: 'chest', raw: new Uint8Array() } };
  st.setTool('place');
  st.open(b);
  expect(st.stamp).toBeNull();
  expect(st.tool).toBe('select');
});
