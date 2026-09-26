// Radar chart (SVG) with a handle per axis that can be dragged along its axis to change the value.
// The centre is the minimum; the original values are drawn as a dashed outline.
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

export interface RadarAxis {
  label: string;
  value: number;
  /** Value before any edit (dashed outline). */
  original: number;
}

export interface RadarProps {
  axes: RadarAxis[];
  min: number;
  max: number;
  /** Rings to draw (values), e.g. [-9, -5, 0, 5, 10]. */
  rings: number[];
  /** Value shown next to a handle while dragging. */
  format: (v: number, axis: number) => string;
  onChange: (axis: number, value: number) => void;
  size?: number;
}

export function Radar({ axes, min, max, rings, format, onChange, size = 320 }: RadarProps): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  /** The axis being dragged and its value so far. */
  const [drag, setDrag] = useState<{ axis: number; value: number } | null>(null);
  const c = size / 2;
  const R = size / 2 - 52;
  const n = axes.length;
  const span = max - min;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number): [number, number] => {
    const r = ((Math.max(min, Math.min(max, v)) - min) / span) * R;
    return [c + Math.cos(angle(i)) * r, c + Math.sin(angle(i)) * r];
  };
  const poly = (vals: number[]): string => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const vals = axes.map((a, i) => (drag?.axis === i ? drag.value : a.value));

  const valueAt = (i: number, e: PointerEvent): number => {
    const m = svg.current?.getScreenCTM();
    if (!m) return vals[i]!;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const proj = (p.x - c) * Math.cos(angle(i)) + (p.y - c) * Math.sin(angle(i));
    return Math.max(min, Math.min(max, Math.round(min + (proj / R) * span)));
  };

  const tip = drag ? pt(drag.axis, drag.value) : null;
  return (
    <svg ref={svg} className="radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {rings.map((ring) => (
        <g key={ring}>
          <polygon className={ring === 0 ? 'ring zero' : 'ring'} points={poly(axes.map(() => ring))} />
          <text className="ring-label" x={c + 3} y={pt(0, ring)[1] - 2}>{`${ring > 0 ? '+' : ''}${ring}`}</text>
        </g>
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, max);
        const lx = c + Math.cos(angle(i)) * (R + 22);
        const ly = c + Math.sin(angle(i)) * (R + 22);
        return (
          <g key={i}>
            <line className="axis" x1={c} y1={c} x2={x} y2={y} />
            <text className="axis-label" x={lx} y={ly + 4} textAnchor={Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'}>{a.label}</text>
          </g>
        );
      })}
      {axes.some((a) => a.original !== a.value) && <polygon className="shape original" points={poly(axes.map((a) => a.original))} />}
      <polygon className="shape" points={poly(vals)} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, vals[i]!);
        return (
          <circle
            key={i}
            className={a.value !== a.original ? 'handle edited' : 'handle'}
            cx={x}
            cy={y}
            r={7}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ axis: i, value: valueAt(i, e) });
            }}
            onPointerMove={(e) => drag?.axis === i && setDrag({ axis: i, value: valueAt(i, e) })}
            onPointerUp={(e) => {
              if (drag?.axis !== i) return;
              setDrag(null);
              const v = valueAt(i, e);
              if (v !== a.value) onChange(i, v);
            }}
          >
            <title>{`${a.label} ${format(a.value, i)}`}</title>
          </circle>
        );
      })}
      {drag && tip && (
        <text className="radar-tip" x={tip[0] + 10} y={tip[1] - 10}>{`${axes[drag.axis]!.label} ${format(drag.value, drag.axis)}`}</text>
      )}
    </svg>
  );
}
