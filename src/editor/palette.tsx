// Tile palette shared by the games: one compact grid, including the automatic brush.
import { useMemo, type ReactNode } from 'react';
import type { ModelFactory } from '../cgfx/three';
import { letterByte, letterIndex } from '../game/sections';
import { InfoTip } from '../ui/InfoTip';
import { useEditorState } from '../ui/useEditorState';
import { kindColor, kindName, ROT_ARROW } from './legend';
import type { MapEditState } from './model';
import { renderThumb } from './thumbs';

export function Palette({
  st,
  factory,
  palette,
  partModel,
  rotDir,
}: {
  st: MapEditState;
  factory: ModelFactory | null;
  palette: Map<number, number[]>;
  partModel: (kind: number, letter: number) => number;
  rotDir?: readonly number[];
}): ReactNode {
  useEditorState(st);
  const thumbs = useMemo(() => new Map<string, string | null>(), [factory, st.tileset]);
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
  const hasAutomatic = !!st.autoProfile;
  const automatic = !!b.auto && hasAutomatic;
  const label = automatic ? '自動' : `${b.kind} ${letterIndex(b.letter) ? String.fromCharCode(b.letter) : '既定'}`;
  const rot = (d: 1 | -1): void => {
    st.brush = { ...b, rot: (b.rot + d + 4) & 3 };
    st.emit('tool');
  };
  return (
    <div className="palette">
      <div className="brush-info">
        <span className="brush-label" title={automatic ? '自動配置' : kindName(b.kind)}>
          {label}
        </span>
        <button disabled={automatic} aria-label="左に回す" title="左に回す (Shift+R)" onClick={() => rot(-1)}>
          ⟲
        </button>
        <span className="rot" title={`${b.rot * 90}°`}>
          {ROT_ARROW[rotDir?.[b.rot] ?? b.rot]}
        </span>
        <button disabled={automatic} aria-label="右に回す" title="右に回す (R)" onClick={() => rot(1)}>
          ⟳
        </button>
        <InfoTip text="チップを選ぶと配置に切り替わります。ドラッグで連続配置。消しゴム (E) で削除、選択 (V) で編集、範囲選択 (M) でコピーできます。" />
      </div>
      {automatic && (
        <div className="auto-variant-option">
          <label title="既定を最も多く抽選。床は部屋の中央1マスだけ、辺・角はそれぞれ抽選します。">
            <input
              type="checkbox"
              checked={st.autoRandomVariants}
              onChange={(event) => {
                st.autoRandomVariants = event.target.checked;
                st.emit('tool');
              }}
            />{' '}
            バリエーション
          </label>
          <InfoTip text="既定が最も多く出る分布でバリエーションを抽選します。床は部屋の中央1マスのみ対象です。オフにすると、以後の自動配置では既定のチップを使います。" />
        </div>
      )}
      <div className="pal-items tile-grid" role="group" aria-label="マップチップ">
        {hasAutomatic && (
          <button
            className={'pal-item' + (automatic ? ' active' : '')}
            aria-pressed={automatic}
            title="自動: 外から描く線は通路、部屋から描くと拡張。2×2 以上の面は部屋。通路で部屋の辺を塗ると接続。"
            onClick={() => {
              st.brush = { ...st.brush, auto: true };
              st.setTool('paint');
            }}
          >
            <span className="pal-swatch auto-swatch" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 8h20v20H8ZM18 8v20M8 18h20M28 18h12v22H18V28" />
                <path d="m34 5 1.5 4.5L40 11l-4.5 1.5L34 17l-1.5-4.5L28 11l4.5-1.5Z" fill="currentColor" />
              </svg>
            </span>
            <span className="pal-label">自動</span>
          </button>
        )}
        {[...palette].flatMap(([kind, letters]) =>
          letters.map((l) => {
            const hash = partModel(kind, l);
            const url = thumb(hash);
            const variant = l ? String.fromCharCode(0x60 + l) : '既定';
            const active = !automatic && b.kind === kind && letterIndex(b.letter) === l;
            return (
              <button
                key={`${kind}/${l}`}
                className={'pal-item' + (active ? ' active' : '')}
                aria-pressed={active}
                aria-label={`${kindName(kind)} ${kind} ${variant}`}
                title={`${kind} ${kindName(kind)} / ${variant}${factory?.modelName(hash) ? ` / ${factory.modelName(hash)}` : ''}`}
                onClick={() => {
                  st.brush = { ...st.brush, auto: false, kind, letter: letterByte(l) };
                  st.setTool('paint');
                }}
              >
                {url ? (
                  <img src={url} alt="" />
                ) : (
                  <span className="pal-swatch" style={{ background: kindColor(kind) }} />
                )}
                <span className="pal-label">{`${kind} ${variant}`}</span>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
