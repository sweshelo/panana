// RPG3's world map W01 as the shared world views draw and edit it (editor/worldview.ts): the terrain and the entrances
// of OahuWorld (worldmap.ts), the encounter ranges (land / sea), the chests, props and event ranges, the dark sea and
// slot 7, and the models of archive 0E820000 for the 3D preview.
import type * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import type { WorldOverlay, WorldPaletteRow, WorldPin, WorldPointSet, WorldRangeSet, WorldSource } from '../editor/worldview';
import type { Ground } from '../game/worldmap';
import type { Dump } from '../rom/dump';
import { oahuObjectModels, oahuWorldModels } from './mapModels';
import {
  entranceCell, moveEntrance, OAHU_WORLD_MODELS, OAHU_WORLD_SIZE, OAHU_WORLD_TEXTURES, parseChests, parseEventRanges, parseProps, partColor, WE, WS, grid2,
  worldObjectAngle, type OahuWorld,
} from './worldmap';

/** Colours of the entrances by worldmapParts row (88〜93). */
export const ENTRANCE_COLORS: Record<number, string> = { 88: '#ff9f43', 89: '#ff6b6b', 90: '#48dbfb', 91: '#f368e0', 92: '#feca57', 93: '#1dd1a1' };
/** Keys of the range and point sets (WorldSelection.set). */
export const OAHU_RANGE_SLOT: Record<string, typeof WS.land | typeof WS.sea> = { land: WS.land, sea: WS.sea };
export const OAHU_POINT_SLOT: Record<string, typeof WS.chests | typeof WS.props | typeof WS.events> = { chests: WS.chests, props: WS.props, events: WS.events };

interface Snapshot {
  sections: [number, Uint8Array][];
  ground: Uint8Array | null;
}

export class OahuWorldSource implements WorldSource {
  readonly size = OAHU_WORLD_SIZE;
  readonly start: [number, number] = [218, 260];
  readonly rangeSets: WorldRangeSet[];
  readonly pointSets: WorldPointSet[];
  readonly overlays: WorldOverlay[];
  onModel = (): void => {};
  private factory: ModelFactory | null = null;
  private readonly objects = new Map<number, ModelFactory | null>();
  private disposed = false;

  constructor(
    private readonly dump: Dump,
    readonly world: OahuWorld,
  ) {
    const w = world;
    const ranges = (key: string, label: string, color: string, fill: string): WorldRangeSet => ({
      key, label, color, fill, snap: 3,
      list: () => w.ranges(OAHU_RANGE_SLOT[key]!),
      set: (l) => {
        const slot = OAHU_RANGE_SLOT[key]!;
        w.setRanges(slot, l.map((r, i) => ({ hash: w.ranges(slot)[i]?.hash ?? 0, ...r })));
      },
    });
    this.rangeSets = [ranges('land', 'エンカウントの範囲 (陸)', '#b8f58a', 'rgba(184,245,138,0.10)'), ranges('sea', 'エンカウントの範囲 (海)', '#7fd3ff', 'rgba(127,211,255,0.10)')];
    this.pointSets = [
      { key: 'chests', label: '宝箱', color: '#ffd54f', square: true, list: () => parseChests(w.section(WS.chests)) },
      {
        key: 'props', label: '置物', color: '#bdbdbd',
        list: () => parseProps(w.section(WS.props)),
        mark3d: (i) => {
          const p = parseProps(w.section(WS.props))[i];
          return p ? { make: () => this.objectModel(p.value), angle: worldObjectAngle(p.dir ?? 0), scale: w.maps.objectScale(p.value) } : null;
        },
      },
      { key: 'events', label: 'イベントの範囲', color: '#b388ff', list: () => parseEventRanges(w.section(WS.events)) },
    ];
    const explored = new Set(w.explored().map(([x, y]) => y * OAHU_WORLD_SIZE + x));
    this.overlays = [
      { key: 'dark', label: '暗い海 (区画 1。濃いほど暗い)', on: true, colors: ['', 'rgba(0,0,12,0.22)', 'rgba(0,0,12,0.42)', 'rgba(0,0,12,0.62)'], value: (x, y) => grid2(w.section(WS.dark), x, y), steps: 3 },
      { key: 'explored', label: '区画 7 の初期値 (推定: 地図の開けた範囲)', on: false, colors: ['', 'rgba(255,255,255,0.35)'], value: (x, y) => (explored.has(y * OAHU_WORLD_SIZE + x) ? 1 : 0) },
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
    // the terrain's parts (rows without a model are the entrances' kinds, not terrain; row 1 is the sea under everything)
    return this.world.parts.filter((p) => p.row === 0 || (p.model && p.row !== 1)).map((p) => ({ row: p.row, label: p.name.replace(/^bgpt_wld_|\.bch$/g, '') || `行 ${p.row}`, flags: p.flags }));
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
      const part = WE.part(r);
      return { x, y, plain: !part, color: part ? ENTRANCE_COLORS[part] ?? '#ffffff' : '#ffffff', ring: this.world.ports.has(WE.id(r)) ? '#7fd3ff' : undefined };
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

  snapshot(): Snapshot {
    const w = this.world;
    return { sections: [WS.entrances, WS.land, WS.sea].map((k): [number, Uint8Array] => [k, w.section(k).slice()]), ground: w.groundSnapshot() };
  }
  restore(s: unknown): void {
    const snap = s as Snapshot;
    for (const [k, b] of snap.sections) this.world.setSection(k, b);
    if (snap.ground) this.world.restoreGround(snap.ground);
  }

  // ---- 3D

  async load3d(): Promise<string> {
    await this.world.load(this.dump);
    const set = await oahuWorldModels(this.dump, OAHU_WORLD_MODELS, OAHU_WORLD_TEXTURES, this.world.parts.map((p) => p.model));
    if (this.disposed) return '';
    this.factory = new ModelFactory(set);
    return set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
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
    const row = WE.model(r) || (WE.part(r) ? this.world.parts[WE.part(r)]?.object ?? 0 : 0);
    return row ? { make: () => this.objectModel(row), angle: worldObjectAngle(WE.dir(r)), scale: this.world.maps.objectScale(row) } : null;
  }

  private objectModel(row: number): THREE.Object3D | null {
    if (!this.objects.has(row)) {
      this.objects.set(row, null);
      const ref = this.world.maps.objectModel(row);
      if (ref)
        void oahuObjectModels(this.dump, ref).then((set) => {
          if (this.disposed || !set.models.size) return;
          this.objects.set(row, new ModelFactory(set));
          this.onModel();
        }, () => {});
      return null;
    }
    const f = this.objects.get(row);
    const ref = this.world.maps.objectModel(row);
    return f && ref ? f.instance(ref.entry) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.dispose();
  }
}
