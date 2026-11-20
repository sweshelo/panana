// The move() statements of the stage's event script that run on the open map (scriptMoves.ts), on the map's page: where
// each sends whom, in the script's world units and in the map's cells, with the numbers to edit. The points are drawn
// and dragged in the 2D / 3D views (mapview.ts).
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
      <button type="button" className="link" title="2D・3D の画面の中心に移す" onClick={pick}>
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

export function ScriptMovePanel({ view, stageHref }: { view: LanaiMapView; stageHref: string }): ReactNode {
  useSignal(view.signal);
  const points = view.movePoints();
  return (
    <>
      <h3>スクリプトの移動 (move)</h3>
      {!points.length ? (
        <p className="muted small">
          このマップで実行される関数に move() はありません (関数をこのマップのレコード・スタートに割り当てると、 その
          move() の行き先がここと 2D・3D の画面に出ます)。
        </p>
      ) : (
        <ul className="move-list">
          {points.map((p) => (
            <MoveRow key={`${p.fn}/${p.k}`} view={view} p={p} />
          ))}
        </ul>
      )}
      <details>
        <summary className="small">move(だれに, x, y, z) の座標</summary>
        <p className="muted small">
          ワールド座標で、1 セル = 500。x がマップの横 (2D の右へ増える)、z が縦 (2D の下へ増える)、y が高さ (床 =
          0)。セル (c) の中心は 250 + 500 × c です。例: 横 3・縦 5 のセルの中心は move(hero, 1750, 0, 2750)。
        </p>
        <p className="muted small">
          2D・3D の画面の◆ (3D では下向きの円錐) をドラッグすると、x と z がスクリプトに書き込まれます (50
          単位にそろう。Alt を押しながらだと 1 単位)。y はそのままです。点線は、動く前にいた場所
          (キャラのレコード・同じ関数の前の move()) からの道筋です。数字は関数の中の move() の順番です。
        </p>
        <p className="muted small">
          保存済みのスクリプトを表示・編集します。スクリプトのエディタ (<a href={stageHref}>ステージのページ</a>
          の「スクリプトを編集」)
          で書きかけの本文は、保存するまでここに出ません。エディタはフォーカスが外れると保存します。
        </p>
      </details>
    </>
  );
}
