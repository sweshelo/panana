import type { ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import type { LanaiSession } from './session';
import type { LanaiItem } from './items';
import { lanaiBattleActions, usesItemInfo } from './battleActions';
import { u32 } from '../util/bytes';

export function LanaiItemFields({ session, item }: { session: LanaiSession; item: LanaiItem }): ReactNode {
  const core = session.need('ItemDataCore');
  const original = core.originalRow(item.core);
  const number = (label: string, offset: number, size: 1 | 4, mask = size === 1 ? 255 : 0xffffffff): ReactNode => {
    const value = (size === 1 ? core.u8(item.core, offset) : core.u32(item.core, offset)) & mask;
    const before = original ? (size === 1 ? original[offset]! : u32(original, offset)) & mask : value;
    return (
      <label className="stat">
        <span className="muted">{label}</span>
        <span>
          <NumberInput
            value={value >>> 0}
            min={0}
            max={mask}
            className={`num-input${value !== before ? ' edited' : ''}`}
            title={value !== before ? `元の値 ${before >>> 0}` : label}
            onCommit={(v) => {
              if (size === 4) core.setU32(item.core, offset, v);
              else core.setU8(item.core, offset, (core.u8(item.core, offset) & ~mask) | v);
              session.edited();
            }}
          />
          {offset === 4 || offset === 8 ? ' G' : ''}
        </span>
      </label>
    );
  };
  const use = session.table('UseItemInfo');
  const row = use && usesItemInfo(item.kind) ? use.find(core.u32(item.core, 0)) : -1;
  const actions = row > 0 ? lanaiBattleActions(session) : [];
  const action = use && row > 0 ? use.u32(row, 4) : 0;
  const old = use && row > 0 ? use.originalRow(row) : null;
  const shared =
    row > 0
      ? Array.from({ length: core.rows }, (_, r) => r).filter(
          (r) => usesItemInfo(core.u8(r, 0x32)) && core.u32(r, 0) === core.u32(item.core, 0),
        ).length
      : 0;
  return (
    <div className="item-fields">
      <div className="stats">
        {number('買値', 4, 4)}
        {number('売値', 8, 4)}
        {number('☆', 0x33, 1, 15)}
        {number('所持上限', 0x34, 1)}
      </div>
      {use && row > 0 && (
        <label className="model-line">
          使うと{' '}
          <select
            aria-label="使ったときの効果"
            value={action}
            className={old && u32(old, 4) !== action ? 'edited' : ''}
            onChange={(e) => {
              use.setU32(row, 4, Number(e.target.value));
              session.edited();
            }}
          >
            <option value={0}>なし</option>
            {action >= actions.length && <option value={action}>{`#${action} (表にない)`}</option>}
            {actions
              .filter((a) => a.row > 0)
              .map((a) => (
                <option key={a.row} value={a.row}>{`#${a.row} ${a.name}`}</option>
              ))}
          </select>
          {shared > 1 && (
            <span className="muted small">{` この効果の行は ${shared} 件で共有しています。変更はすべてに反映されます。`}</span>
          )}
        </label>
      )}
    </div>
  );
}
