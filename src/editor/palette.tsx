// Tile palette: (kind, letter) pairs of the current tileset that have a model, with thumbnails. Shared by both
// games: the game gives the palette of the tileset (kind -> letter indices) and the model of a (kind, letter).
import { useMemo, type ReactNode } from 'react';
import type { ModelFactory } from '../cgfx/three';
import { letterByte, letterIndex } from '../game/sections';
import { useEditorState } from '../ui/useEditorState';
import { kindColor, kindName, ROT_ARROW } from './legend';
import type { MapEditState } from './state';
import { renderThumb } from './thumbs';

export function Palette({ st, factory, palette, partModel }: {
  st: MapEditState;
  factory: ModelFactory | null;
  /** Tile kind -> letter indices of the open map's tileset. */
  palette: Map<number, number[]>;
  /** Model hash of a (kind, letter index) in the open map's tileset. */
  partModel: (kind: number, letter: number) => number;
}): ReactNode {
  useEditorState(st);
  /** Thumbnails by tileset / model hash (rendered once per factory). */
  const thumbs = useMemo(() => new Map<string, string | null>(), [factory]);
  const thumb = (hash: number): string | null => {
    const key = `${st.tileset}/${hash}`;
    let url = thumbs.get(key);
    if (url === undefined && factory) {
      url = renderThumb(factory, hash);
      thumbs.set(key, url);
    }
    return url ?? null;
  };
  const b = st.brush;
  const rot = (d: 1 | -1): void => {
    st.brush = { ...b, rot: (b.rot + d + 4) & 3 };
    st.emit('tool');
  };
  return (
    <div className="palette">
      <h3>タイル</h3>
      <div className="brush-info">
        <span>{`ブラシ: 種類 ${b.kind}${letterIndex(b.letter) ? String.fromCharCode(b.letter) : ''} `}</span>
        <button title="左に回す (Shift+R)" onClick={() => rot(-1)}>⟲</button>
        <span className="rot">{` ${ROT_ARROW[b.rot]} ${b.rot * 90}° `}</span>
        <button title="右に回す (R)" onClick={() => rot(1)}>⟳</button>
      </div>
      <div className="palette-list">
        {[...palette].map(([kind, letters]) => (
          <div key={kind} className="pal-kind">
            <div className="pal-kind-name">{`${kind} ${kindName(kind)}`}</div>
            <div className="pal-items">
              {letters.map((l) => {
                const hash = partModel(kind, l);
                const url = thumb(hash);
                const active = b.kind === kind && letterIndex(b.letter) === l;
                return (
                  <button
                    key={l}
                    className={'pal-item' + (active ? ' active' : '')}
                    title={`${kind}${l ? String.fromCharCode(0x60 + l) : ''} ${factory?.modelName(hash) ?? ''}`}
                    onClick={() => {
                      st.brush = { ...st.brush, kind, letter: letterByte(l) };
                      st.setTool('paint');
                    }}
                  >
                    {url ? <img src={url} alt="" /> : <div className="pal-swatch" style={{ background: kindColor(kind) }} />}
                    <span className="pal-label">{l ? String.fromCharCode(0x60 + l) : '既定'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
