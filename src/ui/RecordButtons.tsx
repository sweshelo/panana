// Making records in the books of the three games: the buttons of an entry to copy it to a new record and to remove an
// added one, and the "＋ 新しい…" of a book's list, which copies the record picked in a dialog and opens the copy.
// Each book gives what it copies and removes; the labels, the checks and the navigation are the same everywhere.
import { useState, type ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/** How a book adds a record: a copy of another one. */
export interface CopySpec {
  /** The kind of record in the labels ("モンスター", "アイテム"). */
  noun: string;
  /** Whether a record can be added now (the table's limit, room for the messages…), and why not. */
  can: boolean;
  why?: string;
  /** Why record `from` cannot be copied (e.g. its kind has no empty row), or null. */
  cannot?: (from: number) => string | null;
  /** What the copy takes over and where it is exported. */
  info?: string;
  /** Adds a copy of record `from`; returns the new record's id. */
  copy: (from: number) => number;
  href: (id: number) => string;
}

/** How a book removes an added record (only those: the records of the game stay). */
export interface RemoveSpec {
  /** What still refers to the record (it cannot be removed while anything does). */
  used: string[];
  /** Why it cannot be removed otherwise (e.g. only the last added row can go). */
  why?: string;
  remove: () => void;
  /** Where to go once it is removed. */
  next: string;
}

/** Runs a copy, tells the page, and opens the new record. */
function runCopy(spec: CopySpec, from: number, onEdit: () => void): void {
  try {
    const n = spec.copy(from);
    onEdit();
    location.hash = spec.href(n);
  } catch (err) {
    alert(`${spec.noun}を作れませんでした: ${(err as Error).message}`);
  }
}

/** "写して新しい…を作る" for record `from`, and "この…を消す" when `remove` is given (an added record). */
export function CopyRemoveButtons({ copy, from, remove, onEdit }: { copy: CopySpec; from: number; remove?: RemoveSpec; onEdit: () => void }): ReactNode {
  const no = copy.can ? copy.cannot?.(from) ?? null : copy.why ?? '';
  const blocked = remove ? (remove.used.length ? `使われています: ${remove.used.slice(0, 8).join('・')}${remove.used.length > 8 ? ' ほか' : ''}` : remove.why ?? '') : '';
  return (
    <>
      <span className="with-info">
        <button disabled={no !== null} title={no ?? ''} onClick={() => runCopy(copy, from, onEdit)}>{`写して新しい${copy.noun}を作る`}</button>
        {copy.info && <InfoTip text={copy.info} />}
      </span>
      {remove && (
        <button disabled={!!blocked} title={blocked || `追加した${copy.noun}を消します`} onClick={() => {
          remove.remove();
          onEdit();
          location.hash = remove.next;
        }}>{`この${copy.noun}を消す`}</button>
      )}
    </>
  );
}

/**
 * "＋ 新しい…" at the top of a book's list: picks the record to start from in the book's own picker (`picker` gets the
 * title, the pick and the close), copies it and opens the copy, where its look and actions can be chosen.
 */
export function NewRecordButton({ copy, current, picker, onEdit }: {
  copy: CopySpec;
  /** The record shown now (the picker starts there). */
  current: number;
  picker: (p: { title: string; current: number; unavailable: (id: number) => string | null; onPick: (id: number) => void; onClose: () => void }) => ReactNode;
  onEdit: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="row new-record">
      <button className="primary" disabled={!copy.can} title={copy.can ? `元にする${copy.noun}を選んで、その写しを新しい${copy.noun}として足します` : copy.why ?? ''}
        onClick={() => setOpen(true)}>{`＋ 新しい${copy.noun}`}</button>
      {copy.info && <InfoTip text={copy.info} />}
      {open && picker({
        title: `元にする${copy.noun}を選ぶ (写して新しい${copy.noun}を作ります)`,
        current,
        unavailable: (id) => copy.cannot?.(id) ?? null,
        onPick: (id) => { setOpen(false); runCopy(copy, id, onEdit); },
        onClose: () => setOpen(false),
      })}
    </div>
  );
}
