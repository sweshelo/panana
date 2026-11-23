// The picker of things stacked at one point (a double click with the select tool): a row of icons by the pointer.
// Hovering an icon selects it for a look (the views and the inspector show it), a click keeps it, Escape or a click
// elsewhere goes back to what was selected before.
import { SECTION_COLORS } from './legend';
import type { Selection } from './model';

export interface StackCandidate {
  sel: Selection;
  /** Short name under the icon. */
  label: string;
  /** Longer text of the tooltip (section, number, position). */
  title: string;
  /** Section of a record (its colour and shape); undefined for the floor tile. */
  section?: number;
}

export interface StackPickHost {
  readonly selection: Selection;
  select(s: Selection): void;
}

let open: (() => void) | null = null;

/** Close the open picker (if any) without choosing. */
export function closeStackPicker(): void {
  open?.();
}

/** The icon of a record: the shape and colour the 2D view draws it with. */
function glyph(doc: Document, section: number | undefined): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  const shape = (tag: string, attrs: Record<string, string>): void => {
    const el = doc.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('fill', section === undefined ? '#6b7280' : (SECTION_COLORS[section] ?? '#9aa0a6'));
    el.setAttribute('stroke', 'rgba(0,0,0,0.7)');
    svg.append(el);
  };
  if (section === undefined) shape('rect', { x: '-10', y: '-10', width: '20', height: '20', rx: '2' });
  else if (section === 3) shape('polygon', { points: '0,-10 10,0 0,10 -10,0' });
  else if (section === 4) shape('rect', { x: '-8', y: '-8', width: '16', height: '16' });
  else if (section === 7) shape('rect', { x: '-10', y: '-3', width: '20', height: '6' });
  else shape('circle', { r: '8' });
  return svg;
}

/** Show the picker at client coordinates (x, y) of `doc` (the document of the clicked canvas). */
export function showStackPicker(
  host: StackPickHost,
  items: StackCandidate[],
  x: number,
  y: number,
  doc: Document = document,
): void {
  closeStackPicker();
  const win = doc.defaultView ?? window;
  const before = host.selection;
  let chosen = false;
  const box = doc.createElement('div');
  box.className = 'stack-picker';
  box.setAttribute('role', 'menu');
  const close = (): void => {
    if (open !== close) return;
    open = null;
    box.remove();
    win.removeEventListener('pointerdown', outside, true);
    win.removeEventListener('keydown', key, true);
    if (!chosen) host.select(before);
  };
  const outside = (e: PointerEvent): void => {
    if (!box.contains(e.target as Node)) close();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  for (const it of items) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.title = it.title;
    b.setAttribute('role', 'menuitem');
    const name = doc.createElement('span');
    name.textContent = it.label;
    b.append(glyph(doc, it.section), name);
    b.addEventListener('pointerenter', () => host.select(it.sel));
    b.addEventListener('focus', () => host.select(it.sel));
    b.addEventListener('click', () => {
      chosen = true;
      host.select(it.sel);
      close();
    });
    box.append(b);
  }
  box.addEventListener('pointerleave', () => {
    if (!chosen) host.select(before);
  });
  doc.body.append(box);
  // keep it on the screen
  const r = box.getBoundingClientRect();
  box.style.left = `${Math.max(4, Math.min(x + 8, win.innerWidth - r.width - 4))}px`;
  box.style.top = `${Math.max(4, Math.min(y + 8, win.innerHeight - r.height - 4))}px`;
  open = close;
  win.addEventListener('pointerdown', outside, true);
  win.addEventListener('keydown', key, true);
  box.querySelector('button')?.focus({ preventScroll: true });
}
