// A screen of a game (the 3DS's 320 × 240 lower screen) with pictures laid on it and markers placed by their centre, as
// an SVG: the markers are picked with a click, dragged (and moved with the arrow keys) when the page edits them. 初代's
// world map (the pier's islands) uses it; the coordinates are the screen's pixels from its top left, the page turns its
// own (the layout's: from the middle, +y up) into them.
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/** An RGBA8 picture (a decoded BCLIM, a texture). */
export interface ScreenImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** A picture over the whole screen or a part of it (top left corner). */
export interface ScreenLayer {
  key: string;
  image?: ScreenImage;
  x?: number;
  y?: number;
  opacity?: number;
}

export interface ScreenMarker {
  id: number;
  /** The centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  image?: ScreenImage;
  /** Shown on the marker when it has no picture, and over it. */
  label: string;
  title?: string;
  /** Shown faintly (not on the screen at this stage). */
  dim?: boolean;
  /** Something may be wrong with it. */
  warn?: boolean;
}

export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
  className?: string;
}

const urls = new WeakMap<ScreenImage, string>();

/** A picture as a data URL (none outside a browser: the tests render without pictures). */
export function imageUrl(im: ScreenImage): string | undefined {
  let u = urls.get(im);
  if (u !== undefined || typeof document === 'undefined') return u;
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(im.rgba), im.width, im.height), 0, 0);
  urls.set(im, (u = c.toDataURL()));
  return u;
}

export function ScreenMap({ width, height, scale = 2, under = [], over = [], circles = [], markers, selected, onSelect, onMove }: {
  width: number;
  height: number;
  scale?: number;
  /** Pictures under the markers (the background). */
  under?: ScreenLayer[];
  /** Pictures over them (a frame). */
  over?: ScreenLayer[];
  circles?: ScreenCircle[];
  markers: ScreenMarker[];
  selected?: number;
  onSelect: (id: number) => void;
  /** Given: the markers can be dragged (whole pixels, the centre kept on the screen). */
  onMove?: (id: number, x: number, y: number) => void;
}): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number } | undefined>();
  const point = (e: PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * width) / r.width, ((e.clientY - r.top) * height) / r.height];
  };
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, Math.round(v)));
  const layer = (l: ScreenLayer): ReactNode => {
    const href = l.image && imageUrl(l.image);
    return href ? <image key={l.key} href={href} x={l.x ?? 0} y={l.y ?? 0} width={l.image!.width} height={l.image!.height} opacity={l.opacity} pointerEvents="none" style={{ imageRendering: 'pixelated' }} /> : null;
  };
  const key = (e: KeyboardEvent): void => {
    if (!onMove || selected === undefined) return;
    const m = markers.find((x) => x.id === selected);
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!m || !d) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    onMove(m.id, clamp(m.x + d[0]! * step, width), clamp(m.y + d[1]! * step, height));
  };
  return (
    <svg ref={svg} className="screen-map" viewBox={`0 0 ${width} ${height}`} width={width * scale} height={height * scale} tabIndex={0} onKeyDown={key}
      onPointerMove={(e) => {
        if (!drag || !onMove) return;
        const [x, y] = point(e);
        onMove(drag.id, clamp(x - drag.dx, width), clamp(y - drag.dy, height));
      }}
      onPointerUp={() => setDrag(undefined)}
      onPointerCancel={() => setDrag(undefined)}>
      <rect className="screen-map-bg" width={width} height={height} />
      {under.map(layer)}
      {circles.map((c, i) => <circle key={i} className={c.className ?? 'screen-map-circle'} cx={c.x} cy={c.y} r={c.r} />)}
      {markers.map((m) => {
        const href = m.image && imageUrl(m.image);
        const x = m.x - m.width / 2;
        const y = m.y - m.height / 2;
        return (
          <g key={m.id} className={`screen-map-marker${m.id === selected ? ' active' : ''}${m.dim ? ' dim' : ''}${m.warn ? ' warn' : ''}${onMove ? ' movable' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(m.id);
              if (!onMove) return;
              const [px, py] = point(e);
              svg.current?.setPointerCapture(e.pointerId);
              setDrag({ id: m.id, dx: px - m.x, dy: py - m.y });
            }}>
            <title>{m.title ?? m.label}</title>
            {href ? <image href={href} x={x} y={y} width={m.width} height={m.height} style={{ imageRendering: 'pixelated' }} />
              : <rect className="screen-map-box" x={x} y={y} width={m.width} height={m.height} rx={4} />}
            <rect className="screen-map-outline" x={x - 1} y={y - 1} width={m.width + 2} height={m.height + 2} rx={3} />
            <text x={m.x} y={y + m.height + 7} className="screen-map-label">{m.label}</text>
          </g>
        );
      })}
      {over.map(layer)}
    </svg>
  );
}
