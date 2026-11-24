// The positions the stage's event script writes (move() / walk() / SetPos(vec(…)), scriptMoves.ts) that run on the map
// of the script page's preview: where each sends whom, in the script's world units and in the map's cells, with the
// numbers to edit. They are written into the editor's text (not saved yet); the points are drawn and dragged in the
// preview's 3D view (mapview.ts moveText / movePointer).
import { useEffect, useState, type ReactNode } from 'react';
import { useSignal } from '../ui/useEditorState';
import type { LanaiMapView, LanaiMovePoint } from './mapview';
import { coordText, worldToCell } from './scriptMoves';

/** A number field that writes its value when it loses focus or Enter is pressed. */
function CoordField({ label, value, set }: { label: string; value: number; set: (v: number) => void }): ReactNode {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) set(v);
    else setText(String(value));
  };
  return (
    <label className="move-coord">
      <span>{label}</span>
      <input
        aria-label={label}
        className="mono"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

const cellText = (w: number): string => coordText(worldToCell(w));

function MoveRow({ view, p }: { view: LanaiMapView; p: LanaiMovePoint }): ReactNode {
  const a = view.activeMove;
  const active = !!a && a.fn === p.fn && a.k === p.k;
  const { x, y, z } = p.move;
  const pick = (): void => {
    view.activeMove = { fn: p.fn, k: p.k };
    view.grid.centerOn(worldToCell(x), worldToCell(z));
    view.scene.centerOn(worldToCell(x), worldToCell(z));
    view.drawMoves();
    view.signal.emit();
  };
  return (
    <li className={active ? 'move-row active' : 'move-row'}>
      <button type="button" className="link" title="プレビューの中心に移す" onClick={pick}>
        {p.label}
      </button>
      <span className="muted small">{` ${p.move.line} 行目`}</span>
      <div className="move-coords">
        <CoordField label="x" value={x} set={(v) => view.setMove(p, v, y, z)} />
        <CoordField label="y (高さ)" value={y} set={(v) => view.setMove(p, x, v, z)} />
        <CoordField label="z" value={z} set={(v) => view.setMove(p, x, y, v)} />
      </div>
      <div className="muted small">{`マップのセル: 横 ${cellText(x)}・縦 ${cellText(z)}`}</div>
    </li>
  );
}

export function ScriptMovePanel({ view }: { view: LanaiMapView }): ReactNode {
  useSignal(view.signal);
  const points = view.movePoints();
  return (
    <>
      <h3>スクリプトの座標 (move・SetPos)</h3>
      {!points.length ? (
        <p className="muted small">
          このマップで実行される関数に、数で書いた move() / walk() / SetPos(vec(…)) はありません
          (関数をこのマップのレコード・スタートに割り当てると、その位置がこことプレビューに出ます)。
        </p>
      ) : (
        <ul className="move-list">
          {points.map((p) => (
            <MoveRow key={`${p.fn}/${p.k}`} view={view} p={p} />
          ))}
        </ul>
      )}
      <details>
        <summary className="small">move(だれに, x, y, z)・SetPos(vec(x, y, z)) の座標</summary>
        <p className="muted small">
          ワールド座標で、1 セル = 500。x がマップの横 (2D の右へ増える)、z が縦 (2D の下へ増える)、y が高さ (床 =
          0)。セル (c) の中心は 250 + 500 × c です。例: 横 3・縦 5 のセルの中心は move(hero, 1750, 0, 2750)。
        </p>
        <p className="muted small">
          プレビューの下向きの円錐をドラッグすると、x と z がエディタの本文に書き込まれます (50 単位にそろう。Alt
          を押しながらだと 1 単位)。y はそのままです。点線は、動く前にいた場所 (キャラのレコード・同じ関数の前の位置)
          からの道筋です。数字は関数の中の順番です。
        </p>
        <p className="muted small">
          エディタの本文 (保存前) を読み書きします。本文が読めない間 (書きかけの文法の誤り)
          は出ません。割り当ては保存済みのものを使います。
        </p>
      </details>
    </>
  );
}
