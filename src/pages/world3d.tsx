// The 3D preview of an RPG2 world map (W01 / W02): the terrain's parts (worldmapParts +0x00, bcres of D98F0E82 with their
// own textures) around the camera and the entrances' models (section 2 +0x18, else worldmapParts +8), drawn by the
// shared world scene (editor/worldscene.ts). Clicking near an entrance selects it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadObjectModels, objKey } from '../cgfx/loader';
import { ModelFactory } from '../cgfx/three';
import { WorldScene, type WorldMark } from '../editor/worldscene';
import { ENT, WORLD_MODEL_ARCHIVE, WORLD_SIZE, WORLD_TEXTURES, type WorldInfo, type WorldPart } from '../game/worldmap';
import type { Session } from '../session';

/** Base colours by terrain type (worldmapParts +4 bits 0-1), and the sea (no part). */
const TERRAIN_RGB: [number, number, number][] = [[84, 140, 76], [196, 176, 112], [118, 118, 126], [92, 146, 170]];
export const SEA_RGB: [number, number, number] = [22, 48, 92];

/** Colour of a worldmapParts row: its terrain type, a little lighter or darker per row. */
export function partRgb(part: number, flags: Uint8Array | null): [number, number, number] {
  if (!part) return SEA_RGB;
  const base = TERRAIN_RGB[flags ? (flags[part] ?? 0) & 3 : 0]!;
  const k = 0.85 + ((part * 7) % 5) * 0.06;
  return base.map((c) => Math.min(255, Math.round(c * k))) as [number, number, number];
}
export const rgbHex = ([r, g, b]: [number, number, number]): string => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

export function World3D({ session, world, entrances, selected, revision, onSelect }: {
  session: Session;
  world: WorldInfo;
  entrances: Uint8Array[];
  selected: number;
  /** Bumped when the terrain changed (the view is synced again). */
  revision: number;
  onSelect: (i: number) => void;
}): ReactNode {
  const { game } = session;
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<WorldScene | null>(null);
  const [status, setStatus] = useState('');
  // what the marks read (kept current without rebuilding the scene)
  const live = useRef({ entrances, selected, onSelect });
  live.current = { entrances, selected, onSelect };

  useEffect(() => {
    const ws = new WorldScene('view3d', WORLD_SIZE);
    scene.current = ws;
    box.current!.append(ws.scene.canvas);
    let disposed = false;
    const parts: WorldPart[] = game.worldParts();
    const flags = game.worldPartFlags();
    /** Model hash -> its factory (each bcres has its own textures). */
    const models = new Map<number, ModelFactory>();
    /** mapObject row -> its factory (null while loading or when it has none). */
    const objects = new Map<number, ModelFactory | null>();
    ws.terrain = {
      size: WORLD_SIZE,
      part: (i) => session.groundOf(world)?.parts[i] ?? 0,
      rot: (i) => session.groundOf(world)?.rots[i] ?? 0,
      flags: (p) => flags?.[p] ?? 0,
      hasModel: (p) => models.has(parts[p]?.model ?? 0),
      model: (p) => models.get(parts[p]?.model ?? 0)?.instance(parts[p]!.model) ?? null,
      color: (p) => rgbHex(partRgb(p, flags)),
    };
    const object = (row: number): ModelFactory | null => {
      if (!objects.has(row)) {
        objects.set(row, null);
        const ref = game.master.objectModel(row);
        if (ref)
          void loadObjectModels(game, [ref]).then((sets) => {
            const set = sets.get(objKey(ref.archive, ref.entry));
            if (disposed || !set?.models.size) return;
            objects.set(row, new ModelFactory(set));
            ws.sync(true);
          }, () => {});
      }
      return objects.get(row) ?? null;
    };
    ws.marks = (): WorldMark[] =>
      live.current.entrances.map((r, i): WorldMark => {
        const row = ENT.model(r) || (parts[ENT.part(r)]?.object ?? 0);
        const ref = row ? game.master.objectModel(row) : null;
        return {
          x: ENT.x(r) + 0.5, y: ENT.y(r) + 0.5, angle: (-ENT.rot(r) * Math.PI) / 2,
          make: ref ? () => object(row)?.instance(ref.entry) ?? null : undefined,
          color: '#ff5a5a',
          selected: i === live.current.selected,
        };
      });
    ws.scene.pointer = {
      down: (cx, cy, e) => {
        if (e.button !== 0) return;
        let best = -1, bd = 2.5 * 2.5;
        live.current.entrances.forEach((r, i) => {
          const d = (ENT.x(r) + 0.5 - cx) ** 2 + (ENT.y(r) + 0.5 - cy) ** 2;
          if (d < bd) [best, bd] = [i, d];
        });
        if (best >= 0) live.current.onSelect(best);
      },
      move: () => {},
      up: () => {},
      leave: () => {},
    };
    setStatus('地形のモデルを読み込み中…');
    const refs = [...new Set(parts.map((p) => p.model).filter((h) => h))].map((entry) => ({ archive: WORLD_MODEL_ARCHIVE, entry }));
    void loadObjectModels(game, [...refs, { archive: WORLD_MODEL_ARCHIVE, entry: WORLD_TEXTURES }]).then(
      (sets) => {
        if (disposed) return;
        const errors: string[] = [];
        // the terrain's models name the shared textures (their own come first)
        const shared = sets.get(objKey(WORLD_MODEL_ARCHIVE, WORLD_TEXTURES))?.textures ?? new Map();
        if (!shared.size) errors.push('共有のテクスチャ (CC4E7000) を読めません');
        for (const { entry } of refs) {
          const set = sets.get(objKey(WORLD_MODEL_ARCHIVE, entry));
          if (set?.models.size) models.set(entry, new ModelFactory({ ...set, textures: new Map([...shared, ...set.textures]) }));
          else errors.push(...(set?.errors ?? [`${entry.toString(16)} を読めません`]));
        }
        setStatus(errors.length ? `モデルの一部を読めませんでした: ${errors.slice(0, 3).join(' / ')}` : '');
        ws.clear();
      },
      (err: Error) => !disposed && setStatus(`地形のモデルを読み込めませんでした (色の板で表示します): ${err.message}`),
    );
    const r = live.current.entrances[live.current.selected];
    ws.focus(r ? ENT.x(r) + 0.5 : 150, r ? ENT.y(r) + 0.5 : 150);
    return () => {
      disposed = true;
      for (const f of models.values()) f.dispose();
      for (const f of objects.values()) f?.dispose();
      ws.scene.canvas.remove();
      ws.dispose();
      scene.current = null;
    };
  }, [session, game, world]);

  // follow the selection and the edits
  useEffect(() => {
    const r = entrances[selected];
    if (r) scene.current?.focus(ENT.x(r) + 0.5, ENT.y(r) + 0.5);
  }, [selected, world]);
  useEffect(() => {
    scene.current?.sync(true);
  }, [revision, entrances]);

  return (
    <div className="world-3d">
      <div className="muted small">{status || `3D: 画面の中心のまわり 45 × 45 セルを描きます。右ドラッグで回転、中ドラッグで移動、ホイールで拡大。入口の近くをクリックで選びます。`}</div>
      <div className="pane world-3d-pane" ref={box} />
    </div>
  );
}
