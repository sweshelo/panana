// A name board: an icon (a model photo or a badge), a one-line name with an optional second line, and the
// entry's "#ID" link to its book. The board itself is a button (usually opening a picker).
import type { ReactNode } from 'react';

export function Board({ icon, name, sub, id, href, edited = false, title, onClick }: {
  icon: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  /** Shown as "#id" and linked to `href`. */
  id?: number;
  href?: string;
  edited?: boolean;
  title?: string;
  onClick?: () => void;
}): ReactNode {
  return (
    <div className={`board${edited ? ' edited' : ''}`}>
      <button className="board-main" title={title} onClick={onClick}>
        <span className="board-icon">{icon}</span>
        <span className="board-text">
          <span className="board-name">{name}</span>
          {sub && <span className="board-sub">{sub}</span>}
        </span>
      </button>
      {id !== undefined && href && <a className="board-id" href={href} draggable={false} title="図鑑で開く">{`#${id}`}</a>}
    </div>
  );
}

/** An empty slot drawn like a board (dashed), e.g. "＋ 追加". */
export function EmptyBoard({ label, title, disabled, onClick }: { label: string; title?: string; disabled?: boolean; onClick: () => void }): ReactNode {
  return <button className="board board-empty" title={title} disabled={disabled} onClick={onClick}>{label}</button>;
}
