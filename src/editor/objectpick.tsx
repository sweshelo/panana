// Picking one thing placed on a map (an event's record, an exit, a world map entrance) from a dialog that shows each
// candidate's model and where it is on the map, instead of a <select> of numbers and coordinates.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadComposite, loadObjectModels, objKey } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, type MonsterBook } from '../game/monsters';
import type { Game } from '../game/game';
import { OBJ_INVISIBLE } from '../game/objects';
import type { MapDoc } from '../game/sections';
import { WORLD_MODEL_ARCHIVE, WORLD_TEXTURES } from '../game/worldmap';
import type { ModelRef } from '../pages/modelview';
import { GridPicker, type GridEntry, type PickerChoice } from '../ui/GridPicker';
import { Photo } from '../ui/Photo';
import { hex8 } from '../util/bytes';
import { kindColor } from './legend';

/** The model of a mapObject row as a photo source (null: none, or the invisible marker). */
export function objectRef(game: Game, row: number): ModelRef | null {
  if (!row || row === OBJ_INVISIBLE) return null;
  const ref = game.master.objectModel(row);
  if (!ref) return null;
  return {
    key: `mapobject/${hex8(ref.archive)}/${hex8(ref.entry)}`,
    load: async () => {
      const set = (await loadObjectModels(game, [ref])).get(objKey(ref.archive, ref.entry));
      return set?.models.has(ref.entry) ? { set, hash: ref.entry } : null;
    },
  };
}

/** The model of a monster (a MonsterParameter row, 1-based as in the book) as a photo source. */
export function monsterModelRef(game: Game, book: MonsterBook | null, monster: number): ModelRef | null {
  const m = book?.monster(monster);
  const x = m ? book!.modelOf(m) : null;
  if (!x) return null;
  return {
    key: `monster/${hex8(x.model)}/${hex8(x.texture)}`,
    load: async () => ({ set: await loadComposite(game, MONSTER_MODEL_ARCHIVE, x.model, x.texture), hash: x.model }),
  };
}

/** The monster showing a MonsterDesign row (the first one in the book), as a photo source. */
export function designModelRef(game: Game, book: MonsterBook | null, design: number): ModelRef | null {
  const m = book?.monsters.find((x) => x.design === design);
  return m ? monsterModelRef(game, book, m.row) : null;
}

/** The model of a world map entrance: its own mapObject row, else its worldmapParts row's model. */
export function entranceRef(game: Game, model: number, part: number): ModelRef | null {
  if (model) return objectRef(game, model);
  const entry = game.worldParts()[part]?.model ?? 0;
  if (!entry) return null;
  return {
    key: `worldpart/${hex8(entry)}`,
    load: async () => {
      const sets = await loadObjectModels(game, [{ archive: WORLD_MODEL_ARCHIVE, entry }, { archive: WORLD_MODEL_ARCHIVE, entry: WORLD_TEXTURES }]);
      const set = sets.get(objKey(WORLD_MODEL_ARCHIVE, entry));
      const shared = sets.get(objKey(WORLD_MODEL_ARCHIVE, WORLD_TEXTURES))?.textures ?? new Map();
      return set?.models.has(entry) ? { set: { ...set, textures: new Map([...shared, ...set.textures]) }, hash: entry } : null;
    },
  };
}

/** A candidate: its value (written to the field), its picture and where it is. */
export interface PlacedChoice {
  value: number;
  name: string;
  /** Second line (e.g. "セル (13.5, 10.5)"). */
  sub?: string;
  model: ModelRef | null;
  /** Shown instead of a model photo (a character without a model, an event range). */
  badge?: string;
  /** The map and the cell it is on, for the location picture. */
  where?: { doc: MapDoc; x: number; y: number };
  category?: string;
  keywords?: string;
}

/** A small top-down picture of a map's tiles with a marker on one cell. */
export function MapSpot({ doc, x, y }: { doc: MapDoc; x: number; y: number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const tiles = doc.tiles;
    const xs = tiles.map((t) => t.x).concat([Math.floor(x)]);
    const ys = tiles.map((t) => t.y).concat([Math.floor(y)]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const s = Math.max(1, Math.min(8, Math.floor(c.width / Math.max(w, h))));
    const ox = Math.floor((c.width - w * s) / 2), oy = Math.floor((c.height - h * s) / 2);
    g.clearRect(0, 0, c.width, c.height);
    for (const t of tiles) {
      g.fillStyle = kindColor(t.kind);
      g.fillRect(ox + (t.x - x0) * s, oy + (t.y - y0) * s, s, s);
    }
    const px = ox + (x - x0) * s, py = oy + (y - y0) * s;
    g.beginPath();
    g.arc(px, py, Math.max(3, s * 0.8), 0, Math.PI * 2);
    g.fillStyle = '#ff3b3b';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#fff';
    g.stroke();
  }, [doc, x, y]);
  return <canvas ref={ref} className="map-spot" width={64} height={64} />;
}

function ChoiceIcon({ c }: { c: PlacedChoice }): ReactNode {
  return (
    <span className="placed-icons">
      {c.model ? <Photo model={c.model} className="photo photo-lg" />
        : <span className="photo photo-lg stamp-badge" aria-hidden="true">{c.badge ?? '◇'}</span>}
      {c.where && <MapSpot doc={c.where.doc} x={c.where.x} y={c.where.y} />}
    </span>
  );
}

/**
 * A button showing the chosen thing (its model and name); clicking it opens a dialog of every candidate with its model
 * and its place on the map. `extra` are choices that are not on the map (なし, 主人公 …). A value that is neither is
 * shown with `missing` as its label.
 */
export function PlacedPickButton({ title, value, choices, extra = [], missing, onChange }: {
  title: string;
  value: number;
  choices: PlacedChoice[];
  extra?: { value: number; label: string; sub?: string }[];
  missing?: (value: number) => string;
  onChange: (value: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const cur = choices.find((c) => c.value === value);
  const curExtra = extra.find((c) => c.value === value);
  const label = cur ? cur.name : curExtra ? curExtra.label : missing ? missing(value) : `${value}`;
  // GridPicker wants distinct ids: index the entries, and put the extra choices below 0.
  const cats = categoryIds(choices);
  const entries: GridEntry[] = choices.map((c, i) => ({
    id: i + 1, name: c.name, sub: c.sub, icon: <ChoiceIcon c={c} />, keywords: `${c.keywords ?? ''} ${c.sub ?? ''}`,
    category: c.category ? cats.get(c.category) : undefined,
  }));
  const categories = cats.size > 1 ? Object.fromEntries([...cats].map(([k, v]) => [v, k])) : undefined;
  const pickerChoices: PickerChoice[] = extra.map((c, i) => ({ value: -1 - i, label: c.label, sub: c.sub }));
  const current = cur ? choices.indexOf(cur) + 1 : curExtra ? -1 - extra.indexOf(curExtra) : undefined;
  return (
    <>
      <button type="button" className="tileset-button placed-button" title={cur?.sub ?? curExtra?.sub ?? ''} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {cur ? (cur.model ? <Photo model={cur.model} /> : <span className="photo stamp-badge" aria-hidden="true">{cur.badge ?? '◇'}</span>) : null}
        <span>{label}{cur?.sub && <span className="muted small">{`  ${cur.sub}`}</span>}<span className="muted"> ▾</span></span>
      </button>
      {open && (
        <GridPicker title={title} entries={entries} current={current} choices={pickerChoices} categories={categories} groupByCategory={!!categories}
          wide placeholder="名前・種類・番号で絞り込み"
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            const v = id > 0 ? choices[id - 1]?.value : extra[-1 - id]?.value;
            if (v !== undefined) onChange(v);
          }} />
      )}
    </>
  );
}

function categoryIds(choices: PlacedChoice[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of choices) if (c.category && !out.has(c.category)) out.set(c.category, out.size + 1);
  return out;
}
