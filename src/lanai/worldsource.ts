// A RPG FREE! world map (worldmap.ts) as the shared world views draw and edit it (editor/worldview.ts): the terrain of
// slot 9, the entrances, the encounter ranges (land / sea), the event ranges, props and slot 8's objects, the dark sea,
// and the models (terrain: archive 0E820000; entrances and objects: MapObject rows) for the 3D preview.
import type * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import { renderPartThumb } from '../editor/thumbs';
import type {
  WorldOverlay,
  WorldPin,
  WorldPointSet,
  WorldPaletteRow,
  WorldRangeSet,
  WorldSource,
} from '../editor/worldview';
import type { Ground } from '../game/worldmap';
import { oahuWorldModels } from '../oahu/mapModels';
import { entranceCell, grid2, moveEntrance, parseEventRanges, parseProps, partColor } from '../oahu/worldmap';
import { oahuPropAngle } from '../oahu/mapObjects';
import { findEntry, parseArchive, unpackEntry } from '../archive/gsarc';
import { lanaiObjectModels } from './mapModels';
import { lanaiObjectRef, lanaiObjectScale } from './mapObjects';
import {
  entranceTurn,
  LANAI_EO_MODEL,
  LANAI_WORLD_MODELS,
  LANAI_WORLD_SIZE,
  LANAI_WORLD_TEXTURES,
  LW,
  parseWorldObjects,
  WE,
  type LanaiWorld,
} from './worldmap';
import { LANAI_ROT_CODEC } from '../game/sections';

/** Colours of the entrances by WorldmapParts row (88〜93). */
export const LANAI_ENTRANCE_COLORS: Record<number, string> = {
  88: '#ff9f43',
  89: '#ff6b6b',
  90: '#48dbfb',
  91: '#f368e0',
  92: '#feca57',
  93: '#1dd1a1',
};
export const LANAI_RANGE_SLOT: Record<string, typeof LW.land | typeof LW.sea> = { land: LW.land, sea: LW.sea };
export const LANAI_POINT_SLOT: Record<string, typeof LW.events | typeof LW.props | typeof LW.objects> = {
  events: LW.events,
  props: LW.props,
  objects: LW.objects,
};

export class LanaiWorldSource implements WorldSource {
  readonly size = LANAI_WORLD_SIZE;
  readonly start: [number, number];
  readonly rangeSets: WorldRangeSet[];
  readonly pointSets: WorldPointSet[];
  readonly overlays: WorldOverlay[];
  onModel = (): void => {};
  private factory: ModelFactory | null = null;
  private readonly objects = new Map<number, ModelFactory | null>();
  private disposed = false;

  constructor(readonly world: LanaiWorld) {
    const w = world;
    // the middle of the land (the worlds are small islands in the 300 x 300 grid)
    this.start = landCentre(w);
    const ranges = (key: string, label: string, color: string, fill: string): WorldRangeSet => ({
      key,
      label,
      color,
      fill,
      snap: 3,
      list: () => w.ranges(LANAI_RANGE_SLOT[key]!),
      set: (l) => {
        const slot = LANAI_RANGE_SLOT[key]!;
        w.setRanges(
          slot,
          l.map((r, i) => ({ hash: w.ranges(slot)[i]?.hash ?? 0, ...r })),
        );
      },
    });
    this.rangeSets = [
      ranges('land', 'エンカウントの範囲 (陸)', '#b8f58a', 'rgba(184,245,138,0.10)'),
      ranges('sea', 'エンカウントの範囲 (海)', '#7fd3ff', 'rgba(127,211,255,0.10)'),
    ];
    const mo = (): ReturnType<LanaiWorld['maps']['session']['table']> => w.maps.session.table('MapObject');
    this.pointSets = [
      { key: 'events', label: 'イベントの範囲', color: '#b388ff', list: () => parseEventRanges(w.section(LW.events)) },
      {
        key: 'props',
        label: '置物',
        color: '#bdbdbd',
        list: () => parseProps(w.section(LW.props)),
        mark3d: (i) => {
          const p = parseProps(w.section(LW.props))[i];
          return p
            ? {
                make: () => this.objectModel(p.value),
                angle: oahuPropAngle(Math.max(0, LANAI_ROT_CODEC.decode(p.dir ?? 0))),
                scale: lanaiObjectScale(mo(), p.value),
              }
            : null;
        },
      },
      {
        key: 'objects',
        label: '置物・扉 (区画 8)',
        color: '#ffd54f',
        square: true,
        list: () => parseWorldObjects(w.section(LW.objects)),
        mark3d: (i) => {
          const p = parseWorldObjects(w.section(LW.objects))[i];
          const t = w.eventTable();
          const row = p && t && p.value > 0 && p.value < t.rows ? t.u16(p.value, LANAI_EO_MODEL) || 0x20 : 0;
          return row ? { make: () => this.objectModel(row), angle: 0, scale: lanaiObjectScale(mo(), row) } : null;
        },
      },
    ];
    this.overlays = [
      {
        key: 'dark',
        label: '暗い海 (区画 1。濃いほど暗い)',
        on: true,
        colors: ['', 'rgba(0,0,12,0.22)', 'rgba(0,0,12,0.42)', 'rgba(0,0,12,0.62)'],
        value: (x, y) => grid2(w.section(LW.dark), x, y),
        steps: 3,
      },
    ];
  }

  on(f: () => void): () => void {
    return this.world.maps.on(f);
  }
  revision(): number {
    return this.world.revision;
  }
  ground(): Ground | null {
    return this.world.ground;
  }
  palette(): WorldPaletteRow[] {
    // terrain rows (2〜86 have models; row 1 is the sea under everything, 87〜94 are the entrances' kinds)
    return this.world.parts
      .filter((p) => p.row === 0 || (p.model && p.row !== 1))
      .map((p) => ({ row: p.row, label: p.name.replace(/^bgpt_wld_|\.bch$/g, '') || `行 ${p.row}`, flags: p.flags }));
  }
  partFlags(part: number): number {
    return this.world.partFlags(part);
  }
  partColor(part: number): string {
    return partColor(this.world.parts[part]);
  }
  paint(x: number, y: number, part: number, rot: number): boolean {
    return this.world.paint(x, y, part, rot);
  }

  entrances(): WorldPin[] {
    return this.world.entrances().map((r) => {
      const [x, y] = entranceCell(r);
      return { x, y, plain: false, color: LANAI_ENTRANCE_COLORS[WE.part(r)] ?? '#ffffff' };
    });
  }
  moveEntrance(i: number, cx: number, cy: number): void {
    const r = this.world.entrances()[i];
    if (r) this.world.setEntrance(i, moveEntrance(r, Math.round(cx - 0.5 - WE.dx(r)), Math.round(cy - 0.5 - WE.dy(r))));
  }
  nudgeEntrance(i: number, dx: number, dy: number): void {
    const r = this.world.entrances()[i];
    if (r) this.world.setEntrance(i, moveEntrance(r, WE.x(r) + dx, WE.y(r) + dy));
  }

  snapshot(): unknown {
    return this.world.snapshot();
  }
  restore(s: unknown): void {
    this.world.restore(s);
  }

  // ---- 3D

  async load3d(): Promise<string> {
    const w = this.world;
    const dump = w.maps.session.dump;
    if (w.parts.some((p) => p.model && !p.name) && dump.names().includes(LANAI_WORLD_MODELS)) {
      const arc = parseArchive(await dump.readRomfs(LANAI_WORLD_MODELS));
      for (const p of w.parts) {
        const e = p.model ? findEntry(arc, p.model) : undefined;
        if (e) p.name = unpackEntry(arc, e).name ?? '';
      }
    }
    const set = await oahuWorldModels(
      dump,
      LANAI_WORLD_MODELS,
      LANAI_WORLD_TEXTURES,
      w.parts.map((p) => p.model),
    );
    if (this.disposed) return '';
    this.factory = new ModelFactory(set);
    this.thumbs.clear();
    w.maps.changed();
    return set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
  }
  private readonly thumbs = new Map<number, string | null>();
  partThumb(part: number): string | null {
    const h = this.world.parts[part]?.model ?? 0;
    if (!h || !this.factory?.set.models.has(h)) return null;
    if (!this.thumbs.has(h)) {
      const m = this.factory.instance(h);
      this.thumbs.set(h, m ? renderPartThumb(this.factory, m) : null);
    }
    return this.thumbs.get(h) ?? null;
  }
  hasPartModel(part: number): boolean {
    const h = this.world.parts[part]?.model;
    return !!(h && this.factory?.set.models.has(h));
  }
  partModel(part: number): THREE.Object3D | null {
    return this.factory?.instance(this.world.parts[part]?.model ?? 0) ?? null;
  }
  seaModel(): THREE.Object3D | null {
    const h = this.world.parts[1]?.model;
    return h && this.factory ? this.factory.instance(h) : null;
  }
  entranceMark3d(i: number): { make: () => THREE.Object3D | null; angle: number; scale: number } | null {
    const r = this.world.entrances()[i];
    if (!r) return null;
    const row = this.world.entranceObject(r);
    // RPG FREE! uses the dungeon prop angles, without RPG3's extra 180° world-map turn.
    return row
      ? {
          make: () => this.objectModel(row),
          angle: oahuPropAngle(entranceTurn(r)),
          scale: lanaiObjectScale(this.world.maps.session.table('MapObject'), row),
        }
      : null;
  }

  private objectModel(row: number): THREE.Object3D | null {
    const ref = lanaiObjectRef(this.world.maps.session.table('MapObject'), row);
    if (!ref) return null;
    if (!this.objects.has(row)) {
      this.objects.set(row, null);
      void lanaiObjectModels(this.world.maps.session, ref).then(
        (set) => {
          if (this.disposed || !set.models.size) return;
          this.objects.set(row, new ModelFactory(set));
          this.onModel();
        },
        () => {},
      );
      return null;
    }
    return this.objects.get(row)?.instance(ref.entry) ?? null;
  }

  dispose(): void {
    this.world.normalize();
    this.disposed = true;
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.dispose();
  }
}

/** The middle of the entrances (the worlds are small islands in the 300 x 300 grid), else of the grid. */
function landCentre(w: LanaiWorld): [number, number] {
  const list = w.entrances();
  if (!list.length) return [LANAI_WORLD_SIZE / 2, LANAI_WORLD_SIZE / 2];
  return [
    Math.round(list.reduce((n, r) => n + WE.x(r), 0) / list.length),
    Math.round(list.reduce((n, r) => n + WE.y(r), 0) / list.length),
  ];
}
