// Radar chart (SVG) with a handle per axis that can be dragged along its axis to change the value.
// The centre is the minimum; the original values are drawn as a dashed outline.

export interface RadarAxis {
  label: string;
  value: number;
  /** Value before any edit (dashed outline). */
  original: number;
}

export interface RadarOptions {
  min: number;
  max: number;
  /** Rings to draw (values), e.g. [-9, -5, 0, 5, 10]. */
  rings: number[];
  /** Value shown next to a handle while dragging. */
  format: (v: number, axis: number) => string;
  onChange: (axis: number, value: number) => void;
  size?: number;
}

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

export function radar(axes: RadarAxis[], o: RadarOptions): SVGSVGElement {
  const size = o.size ?? 320;
  const c = size / 2;
  const R = size / 2 - 52;
  const n = axes.length;
  const span = o.max - o.min;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number): [number, number] => {
    const r = ((Math.max(o.min, Math.min(o.max, v)) - o.min) / span) * R;
    return [c + Math.cos(angle(i)) * r, c + Math.sin(angle(i)) * r];
  };
  const poly = (vals: number[]): string => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const svg = el('svg', { class: 'radar', viewBox: `0 0 ${size} ${size}`, width: size, height: size });

  for (const ring of o.rings) {
    const label = el('text', { class: 'ring-label', x: c + 3, y: pt(0, ring)[1] - 2 });
    label.textContent = `${ring > 0 ? '+' : ''}${ring}`;
    svg.append(el('polygon', { class: ring === 0 ? 'ring zero' : 'ring', points: poly(axes.map(() => ring)) }), label);
  }
  axes.forEach((a, i) => {
    const [x, y] = pt(i, o.max);
    svg.append(el('line', { class: 'axis', x1: c, y1: c, x2: x, y2: y }));
    const lx = c + Math.cos(angle(i)) * (R + 22);
    const ly = c + Math.sin(angle(i)) * (R + 22);
    const t = el('text', { class: 'axis-label', x: lx, y: ly + 4, 'text-anchor': Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end' });
    t.textContent = a.label;
    svg.append(t);
  });
  const vals = axes.map((a) => a.value);
  if (axes.some((a) => a.original !== a.value)) svg.append(el('polygon', { class: 'shape original', points: poly(axes.map((a) => a.original)) }));
  const shape = el('polygon', { class: 'shape', points: poly(vals) });
  svg.append(shape);
  const tip = el('text', { class: 'radar-tip', x: 0, y: 0 });

  axes.forEach((a, i) => {
    const [x, y] = pt(i, a.value);
    const handle = el('circle', { class: a.value !== a.original ? 'handle edited' : 'handle', cx: x, cy: y, r: 7 });
    const title = el('title', {});
    title.textContent = `${a.label} ${o.format(a.value, i)}`;
    handle.append(title);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const valueAt = (ev: PointerEvent): number => {
        const m = svg.getScreenCTM();
        if (!m) return vals[i]!;
        const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
        const proj = (p.x - c) * Math.cos(angle(i)) + (p.y - c) * Math.sin(angle(i));
        return Math.max(o.min, Math.min(o.max, Math.round(o.min + (proj / R) * span)));
      };
      const move = (ev: PointerEvent): void => {
        vals[i] = valueAt(ev);
        const [hx, hy] = pt(i, vals[i]!);
        handle.setAttribute('cx', String(hx));
        handle.setAttribute('cy', String(hy));
        shape.setAttribute('points', poly(vals));
        tip.textContent = `${a.label} ${o.format(vals[i]!, i)}`;
        tip.setAttribute('x', String(hx + 10));
        tip.setAttribute('y', String(hy - 10));
      };
      const up = (ev: PointerEvent): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        tip.textContent = '';
        const v = valueAt(ev);
        if (v !== a.value) o.onChange(i, v);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      move(e);
    });
    svg.append(handle);
  });
  svg.append(tip);
  return svg;
}
