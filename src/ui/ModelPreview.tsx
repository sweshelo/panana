// A button that opens a model in the viewer (pages/modelview) in a <dialog>: for models a page names but doesn't show,
// such as a battle background.
import { useState, type ReactNode } from 'react';
import type { ModelRef } from '../pages/modelview';
import { Dialog } from './Dialog';
import { ModelView } from './ModelView';

export function ModelPreviewButton({ model, name, label = '3D で見る', note }: { model: ModelRef | null; name: string; label?: string; note?: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="small" disabled={!model} title={model ? `${name} を 3D で見る` : 'モデルがありません'} onClick={() => setOpen(true)}>{label}</button>
      {open && model && (
        <Dialog title={name} onClose={() => setOpen(false)}>
          <ModelView model={model} name={name} />
          {note && <p className="muted small">{note}</p>}
        </Dialog>
      )}
    </>
  );
}
