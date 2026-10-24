// The view of a 初代 map: the top-down grid shared with the other map pages (editor/gridcanvas.ts), driven by the
// editor's Controller (hover, picking a tile or a record) on a view-only edit state, so the shared panes (layers,
// status bar) work as on RPG3's and RPG FREE!'s pages. There is no 3D view yet: the tiles' models are not traced
// (naauao#49). Tiles are drawn as glyphs with their kind; the records as marks facing their way.
import { Controller } from '../editor/controller';
import { drawHover, drawSelection } from '../editor/draw2d';
import { drawTileGlyph, GridCanvas } from '../editor/gridcanvas';
import { SECTION_COLORS } from '../editor/legend';
import type { MapPageView } from '../editor/mappage';
import { MapEditState } from '../editor/model';
import { recCellPos, type MapDoc, type Rec } from '../game/sections';
import { Signal } from '../ui/useEditorState';
import { HONOLULU_CHEST2_SECTION, HONOLULU_CHEST_SECTION, HONOLULU_EXIT_SECTION, HONOLULU_GRID, HONOLULU_LAYOUTS, HONOLULU_OBJECT_SECTION, HONOLULU_POINT_SECTIONS, HONOLULU_ROT_CODEC } from './maps';

/** The open map (read only: the page does not edit 初代's maps yet). */
export class HonoluluMapState extends MapEditState<never, null> {
  override readonly readOnly = true;
  readonly layouts = HONOLULU_LAYOUTS;
  readonly pointSections = HONOLULU_POINT_SECTIONS;

  /** Shows `doc` (a map with what one of its floors places). */
  show(doc: MapDoc): void {
    this.docs.set(doc.hash, doc);
    this.current = doc;
    this.selection = { type: 'none' };
    this.emit('map');
  }

  protected saveTables(): null {
    return null;
  }
  protected restoreTables(): void {}
  placeStamp(): [number, number] {
    throw new Error('初代のマップは表示だけです');
  }
  duplicateRecord(): Rec {
    throw new Error('初代のマップは表示だけです');
  }
}

/** A colour per tile kind (their roles are not known: neighbouring kinds get far hues). */
export const honoluluKindColor = (k: number): string => `hsl(${(k * 47) % 360} 40% 62%)`;

/** The turn a record faces (+0x08 of the props; the others have none). */
export function recFacing(section: number, rec: Rec): number {
  return section === HONOLULU_OBJECT_SECTION ? Math.max(0, HONOLULU_ROT_CODEC.decode(rec.raw[8]!)) : -1;
}

export class HonoluluMapView implements MapPageView {
  readonly grid: GridCanvas;
  readonly ctl: Controller;
  readonly signal = new Signal();
  readonly hover = new Signal();
  status = '';
  errorMsg = '';

  constructor(readonly st: HonoluluMapState) {
    this.ctl = new Controller(st);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), HONOLULU_GRID);
    this.grid.pointer = {
      down: (cx, cy, e) => this.ctl.down(cx, cy, e),
      move: (cx, cy) => this.ctl.move(cx, cy),
      up: () => this.ctl.up(),
      leave: () => this.ctl.leave(),
    };
    this.ctl.onHover = () => {
      this.grid.draw();
      this.hover.emit();
    };
    st.on(() => this.grid.draw());
  }

  get doc(): MapDoc {
    return this.st.current!;
  }

  fit(): void {
    this.grid.fitCells(this.doc.tiles);
  }

  refresh(): void {
    this.grid.draw();
    this.signal.emit();
  }

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.st.current;
    if (!doc) return;
    const layers = this.ctl.layers, sel = this.st.selection;
    if (layers.tiles) for (const t of doc.tiles) drawTileGlyph(g, s, t.x, t.y, honoluluKindColor(t.kind), -1, String(t.kind));
    for (const k of [...HONOLULU_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, HONOLULU_LAYOUTS[k]!);
        const x = px * s, y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const rad = Math.max(3, s * (k === HONOLULU_OBJECT_SECTION ? 0.3 : 0.2));
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        g.beginPath();
        const dir = recFacing(k, r);
        if (dir >= 0) {
          // a triangle pointing the way the prop faces (0 = up)
          const a = (dir * Math.PI) / 2;
          for (const [dx, dy] of [[0, -1], [0.8, 0.7], [-0.8, 0.7]] as const) {
            const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
            g.lineTo(x + rx * rad, y + ry * rad);
          }
          g.closePath();
        } else if (k === HONOLULU_CHEST_SECTION || k === HONOLULU_CHEST2_SECTION) g.rect(x - rad, y - rad, rad * 2, rad * 2);
        else if (k === HONOLULU_EXIT_SECTION) {
          g.moveTo(x, y - rad);
          g.lineTo(x + rad, y);
          g.lineTo(x, y + rad);
          g.lineTo(x - rad, y);
          g.closePath();
        } else g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
    drawSelection(g, s, this.st);
    drawHover(g, s, this.st, this.ctl.hover);
  }
}
