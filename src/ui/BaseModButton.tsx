// The header's button for a game's base MOD (rom/basemod.ts): shows the one in use, takes it off, or asks for a folder
// of an existing MOD (hash-named RomFS files and code.ips) to read the dump with.
import type { ReactNode } from 'react';
import { baseModFor } from '../rom/basemod';
import type { BaseMod } from '../rom/dump';
import type { TitleDef } from '../rom/titles';

/** Asks for the folder of a MOD of `title` (null when nothing was chosen; throws when it is not one). */
export function pickBaseMod(title: TitleDef): Promise<BaseMod | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return resolve(null);
      try {
        const label = files[0]!.webkitRelativePath.split('/')[0] || 'MOD';
        resolve(baseModFor(title, label, await Promise.all(files.map(async (f) => ({ name: f.name, path: f.webkitRelativePath, bytes: new Uint8Array(await f.arrayBuffer()) })))));
      } catch (err) {
        reject(err);
      }
    });
    input.click();
  });
}

/** Takes the base MOD off (when there is one and that is confirmed) or picks another; `onChange` reopens the dump with it. */
export async function changeBaseMod(title: TitleDef, current: BaseMod | null, onChange: (mod: BaseMod | null) => Promise<void>): Promise<void> {
  try {
    if (current && confirm(`今の土台: ${current.label}\n外しますか? (「キャンセル」で別のフォルダを選ぶ)`)) return await onChange(null);
    const mod = await pickBaseMod(title);
    if (mod) await onChange(mod);
  } catch (err) {
    alert(`MOD として読めませんでした: ${(err as Error).message}`);
  }
}

/** The export dialogs' note that the base MOD's files go into the MOD too. */
export function BaseModNote({ mod }: { mod: BaseMod | null }): ReactNode {
  return mod ? <p className="muted small">{`土台の MOD「${mod.label}」の全ファイル${mod.ips ? ' (code.ips を含む)' : ''}も入ります。`}</p> : null;
}

export function BaseModButton({ title, mod, onChange, children }: {
  title: TitleDef;
  mod: BaseMod | null;
  onChange: (mod: BaseMod | null) => Promise<void>;
  /** The label (by default "土台の MOD: <name>"). */
  children?: ReactNode;
}): ReactNode {
  return (
    <button className="base-btn" title="既存の MOD (romfs のファイルと code.ips のフォルダ) を土台にして、その上から編集します。書き出しにはその MOD の全ファイルが入ります" onClick={() => changeBaseMod(title, mod, onChange)}>
      {children ?? `土台の MOD: ${mod?.label ?? 'なし'}`}
    </button>
  );
}
