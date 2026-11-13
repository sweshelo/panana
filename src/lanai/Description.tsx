import type { ReactNode } from 'react';
import { MessageEditor } from '../ui/message';
import { lanaiMessageSource } from './MessageSource';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** Edit the encoded text form so ruby and control tags survive a change. */
export function LanaiDescription({
  session,
  table,
  row,
  onEdit,
}: {
  session: LanaiSession;
  table: LanaiTable;
  row: number;
  onEdit: () => void;
}): ReactNode {
  const offset = table.fields.find((f) => f.name === 'message')?.offset;
  if (offset === undefined) return null;
  return (
    <div>
      <MessageEditor
        key={`${table.name}/${row}`}
        texts={lanaiMessageSource(session, table, offset)}
        id={row}
        compact
        apply={(fn) => {
          fn();
          onEdit();
        }}
      />
      <div className="muted small">ルビや制御タグも編集できます。同じ説明を参照するデータにも反映されます。</div>
    </div>
  );
}
