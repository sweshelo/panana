// The position fields of a record in the inspectors (RPG3 / RPG FREE!): records with f32 offsets are edited as cell
// coordinates with decimals (the position the game uses, as the snapping places them), with the ROM's integer and
// offset shown below; the others by their integer units.
import type { ReactNode } from 'react';
import { recCellPos, type Rec, type RecordLayout } from '../game/sections';
import { f32 } from '../util/bytes';
import { NumberInput } from '../ui/book';
import type { MapEditState } from './model';
import { freeIn, placeRec } from './snap';

const UNIT_NAME: Record<string, string> = { cell: 'マス', fine: '1/5 マス', quarter: '1/4 マス', world: 'ワールド' };

export function RecPositionFields({ st, rec, L }: { st: MapEditState; rec: Rec; L: RecordLayout }): ReactNode {
  const [cx, cy] = recCellPos(rec, L);
  const max = L.unit === 'cell' ? 29 : 299;
  const ints = (
    <div className="row">
      <label className="field">
        <span>{`x (${UNIT_NAME[L.unit] ?? L.unit})`}</span>
        <NumberInput
          value={rec.x}
          min={0}
          max={max}
          onCommit={(v) =>
            st.edit(() => {
              rec.x = v;
            })
          }
        />
      </label>
      <label className="field">
        <span>y</span>
        <NumberInput
          value={rec.y}
          min={0}
          max={max}
          onCommit={(v) =>
            st.edit(() => {
              rec.y = v;
            })
          }
        />
      </label>
    </div>
  );
  if (!freeIn(L))
    return (
      <>
        {ints}
        <p className="muted small">{`セル (${cx.toFixed(2)}, ${cy.toFixed(2)})`}</p>
      </>
    );
  const dx = f32(rec.raw, L.fxo!),
    dy = f32(rec.raw, L.fyo!);
  const off = (d: number): string => (d ? ` ${d > 0 ? '+' : '−'} ずれ ${Math.abs(d).toFixed(2)}` : '');
  return (
    <>
      <div className="row">
        <label className="field">
          <span>x (マス)</span>
          <NumberInput
            value={cx}
            min={0}
            max={30}
            step={0.01}
            title="小数で好きな位置に置けます (ずれの欄に入ります)"
            onCommit={(v) => st.edit(() => placeRec(rec, L, v, cy))}
          />
        </label>
        <label className="field">
          <span>y (マス)</span>
          <NumberInput
            value={cy}
            min={0}
            max={30}
            step={0.01}
            title="小数で好きな位置に置けます (ずれの欄に入ります)"
            onCommit={(v) => st.edit(() => placeRec(rec, L, cx, v))}
          />
        </label>
      </div>
      <details>
        <summary className="small muted">{`ROM の値: x ${rec.x}${off(dx)}、y ${rec.y}${off(dy)}`}</summary>
        <p className="muted small">
          {`整数 (${UNIT_NAME[L.unit]} 単位) とずれ (小数、1/5 マス単位) を足した所に置かれます。整数だけを変えると、ずれはそのまま残ります。`}
        </p>
        {ints}
      </details>
    </>
  );
}
