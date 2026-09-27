// Modal <dialog> with a title and a close button (the pickers of the pages).
import { useEffect, useRef, type ReactNode } from 'react';
import { InfoTipScope } from './InfoTip';

export function Dialog({ title, wide = true, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current!;
    dlg.showModal();
    return () => dlg.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={'picker' + (wide ? ' wide' : '')}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose() /* backdrop */}
    >
      <div className="picker-head">
        <h2>{title}</h2>
        <button onClick={onClose}>閉じる</button>
      </div>
      <InfoTipScope><div>{children}</div></InfoTipScope>
    </dialog>
  );
}
