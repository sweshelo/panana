// RPG2's world maps (W01, W02, W98, W99; docs/worldmap.md) as the shared world views draw and edit them
// (editor/worldview.ts): the terrain (Wxx_ground.bin, edited through the session), the entrances (section 2), the
// points of section 3, the zones of section 1, and the models of archive D98F0E82 (with the shared textures CC4E7000)
// for the 3D preview.
import type * as THREE from 'three';
import { loadObjectModels, objKey } from '../cgfx/loader';
import { ModelFactory } from '../cgfx/three';
import type { WorldOverlay, WorldPaletteRow, WorldPin, WorldPointSet, WorldRangeSet, WorldSource } from '../editor/worldview';
import { copyGround, ENT, moveEntrance, parseWorldPoints, WORLD_MODEL_ARCHIVE, WORLD_SIZE, WORLD_TEXTURES, type Ground, type WorldInfo } from '../game/worldmap';
import type { Session } from '../session';
import { equalBytes } from '../util/bytes';

/** Base colours by terrain type (worldmapParts +4 bits 0-1). */
const TERRAIN_RGB: [number, number, number][] = [[84, 140, 76], [196, 176, 112], [118, 118, 126], [92, 146, 170]];

/** Colour of a worldmapParts row: its terrain type, a little lighter or darker per row. */
export function partRgb(part: number, flags: Uint8Array | null): [number, number, number] {
  if (!part) return [29, 63, 110];
  const base = TERRAIN_RGB[flags ? (flags[part] ?? 0) & 3 : 0]!;
  const k = 0.85 + ((part * 7) % 5) * 0.06;
  return base.map((c) => Math.min(255, Math.round(c * k))) as [number, number, number];
}
export const rgbHex = ([r, g, b]: [number, number, number]): string => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

interface Snapshot {
  entrances: Uint8Array[];
  ground: Ground | null;
}

export class KaharaWorldSource implements WorldSource {
  readonly size = WORLD_SIZE;
  readonly start: [number, number];
  readonly rangeSets: WorldRangeSet[] = [];
  readonly pointSets: WorldPointSet[];
  readonly overlays: WorldOverlay[];
  onModel = (): void => {};
  private readonly listeners = new Set<() => void>();
  private rev = 0;
  /** Model hash -> its factory (each part's bcres with the shared textures). */
  private readonly models = new Map<number, ModelFactory>();
  /** Model hash -> the model's name ("wld_flat_00"), once loaded. */
  private readonly names = new Map<number, string>();
  private readonly objects = new Map<number, ModelFactory | null>();
  private disposed = false;
  /** The terrain has a Wxx_ground.bin (W01 / W02): it can be painted. */
  private readonly editable: boolean;

  constructor(
    readonly session: Session,
    readonly world: WorldInfo,
  ) {
    const { game } = session;
    this.editable = session.groundEditable(world);
    const first = session.entrancesOf(world)[0];
    this.start = first ? [ENT.x(first) + 0.5, ENT.y(first) + 0.5] : [150, 150];
    const points = parseWorldPoints(game.db.get(world.sections[3]!));
    this.pointSets = [{ key: 'points', label: '区画 3 の地点', color: '#ffffff', square: true, list: () => points.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })) }];
    const zone = game.db.get(world.sections[1]!);
    this.overlays = zone.length
      ? [{ key: 'zone', label: '区画 1 (環境のゾーン、推定)', on: false, colors: ['', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.32)', 'rgba(220,240,255,0.45)'], value: (x, y) => ((zone[(y * WORLD_SIZE + x) >> 2] ?? 0) >> (((y * WORLD_SIZE + x) & 3) * 2)) & 3 }]
      : [];
  }

  /** Tell the views that the data changed (the pages call it after their own edits). */
  changed(): void {
    this.rev++;
    for (const f of [...this.listeners]) f();
  }
  on(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  revision(): number {
    return this.rev;
  }

  ground(): Ground | null {
    return this.editable ? this.session.groundOf(this.world) : null;
  }
  palette(): WorldPaletteRow[] {
    // row 1 is the sea (bgpt_wld_sea), not put in cells
    return [{ row: 0, label: 'なし (海)', flags: 0 }, ...this.session.game.worldParts().filter((p) => p.model && p.row !== 1).map((p) => ({ row: p.row, label: this.names.get(p.model) ?? `種類 ${p.flags & 3}`, flags: p.flags }))];
  }
  partFlags(part: number): number {
    return this.session.game.worldPartFlags()?.[part] ?? 0;
  }
  partColor(part: number): string {
    return rgbHex(partRgb(part, this.session.game.worldPartFlags()));
  }
  paint(x: number, y: number, part: number, rot: number): boolean {
    const g = this.ground();
    if (!g) return false;
    const i = y * WORLD_SIZE + x;
    if (g.parts[i] === part && (g.rots[i] === rot || !part)) return false;
    const next = copyGround(g);
    next.parts[i] = part;
    next.rots[i] = part ? rot : 0;
    this.session.setGround(this.world, next);
    this.changed();
    return true;
  }

  entrances(): WorldPin[] {
    const original = this.session.originalEntrances(this.world);
    return this.session.entrancesOf(this.world).map((r, i) => ({
      x: ENT.x(r) + 0.5, y: ENT.y(r) + 0.5, plain: false,
      color: !original[i] || !equalBytes(original[i]!, r) ? '#e0b04c' : '#ff5a5a',
    }));
  }
  private setEntrance(i: number, next: Uint8Array): void {
    const l = this.session.entrancesOf(this.world).slice();
    l[i] = next;
    this.session.setEntrances(this.world, l);
    this.changed();
  }
  moveEntrance(i: number, cx: number, cy: number): void {
    const r = this.session.entrancesOf(this.world)[i];
    if (r) this.setEntrance(i, moveEntrance(r, Math.floor(cx), Math.floor(cy)));
  }
  nudgeEntrance(i: number, dx: number, dy: number): void {
    const r = this.session.entrancesOf(this.world)[i];
    if (r) this.setEntrance(i, moveEntrance(r, ENT.x(r) + dx, ENT.y(r) + dy));
  }

  snapshot(): Snapshot {
    const g = this.ground();
    return { entrances: this.session.entrancesOf(this.world).map((r) => r.slice()), ground: g && copyGround(g) };
  }
  restore(s: unknown): void {
    const snap = s as Snapshot;
    this.session.setEntrances(this.world, snap.entrances);
    if (snap.ground && this.editable) this.session.setGround(this.world, snap.ground);
    this.changed();
  }

  // ---- 3D

  async load3d(): Promise<string> {
    const { game } = this.session;
    const refs = [...new Set(game.worldParts().map((p) => p.model).filter((h) => h))].map((entry) => ({ archive: WORLD_MODEL_ARCHIVE, entry }));
    const sets = await loadObjectModels(game, [...refs, { archive: WORLD_MODEL_ARCHIVE, entry: WORLD_TEXTURES }]);
    if (this.disposed) return '';
    const errors: string[] = [];
    // the terrain's models name the shared textures (their own come first)
    const shared = sets.get(objKey(WORLD_MODEL_ARCHIVE, WORLD_TEXTURES))?.textures ?? new Map();
    if (!shared.size) errors.push('共有のテクスチャ (CC4E7000) を読めません');
    for (const { entry } of refs) {
      const set = sets.get(objKey(WORLD_MODEL_ARCHIVE, entry));
      const m = set?.models.get(entry);
      if (set && m) {
        this.models.set(entry, new ModelFactory({ ...set, textures: new Map([...shared, ...set.textures]) }));
        this.names.set(entry, m.name.replace(/^wld_/, ''));
      } else errors.push(...(set?.errors ?? [`${entry.toString(16)} を読めません`]));
    }
    this.changed(); // the palette has the models' names now
    return errors.length ? `モデルの一部を読めませんでした: ${errors.slice(0, 3).join(' / ')}` : '';
  }
  private partHash(part: number): number {
    return this.session.game.worldParts()[part]?.model ?? 0;
  }
  hasPartModel(part: number): boolean {
    return this.models.has(this.partHash(part));
  }
  partModel(part: number): THREE.Object3D | null {
    const h = this.partHash(part);
    return this.models.get(h)?.instance(h) ?? null;
  }
  entranceMark3d(i: number): { make: () => THREE.Object3D | null; angle: number } | null {
    const r = this.session.entrancesOf(this.world)[i];
    if (!r) return null;
    const row = ENT.model(r) || (this.session.game.worldParts()[ENT.part(r)]?.object ?? 0);
    const ref = row ? this.session.game.master.objectModel(row) : null;
    return ref ? { make: () => this.object(row)?.instance(ref.entry) ?? null, angle: (-ENT.rot(r) * Math.PI) / 2 } : null;
  }

  private object(row: number): ModelFactory | null {
    if (!this.objects.has(row)) {
      this.objects.set(row, null);
      const ref = this.session.game.master.objectModel(row);
      if (ref)
        void loadObjectModels(this.session.game, [ref]).then((sets) => {
          const set = sets.get(objKey(ref.archive, ref.entry));
          if (this.disposed || !set?.models.size) return;
          this.objects.set(row, new ModelFactory(set));
          this.onModel();
        }, () => {});
    }
    return this.objects.get(row) ?? null;
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.models.values()) f.dispose();
    for (const f of this.objects.values()) f?.dispose();
  }
}
