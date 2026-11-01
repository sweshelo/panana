// The textures a book's model is drawn with (the set the viewer and the photo use: for a colour variant, the variant's),
// folded under the 3D view. Shared by the monster books of RPG2, RPG3 and RPG FREE!. Each texture can be saved as a
// PNG, and, where the book passes `replace`, replaced with an image.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CgfxTexture } from '../cgfx/cgfx';
import { modelSet, type ModelRef } from '../pages/modelview';
import type { TextureImage } from '../port/textures';
import { TextureThumb } from './TextureThumb';
import { useAsync } from './useAsync';

export function ModelTextures({ model, replace, replaceInfo }: {
  model: ModelRef | null;
  /** Replaces texture `name` with an image of its size. */
  replace?: (name: string, image: TextureImage) => Promise<void>;
  /** The replace button's tooltip. */
  replaceInfo?: string;
}): ReactNode {
  // read once the page is in the browser (the textures are decoded with the model)
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  // kept here: a replaced texture gives the model another key, and the list is read again
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const set = useAsync(() => (shown && model ? modelSet(model) : Promise.resolve(null)), [shown, model?.key]);
  if (!set || set instanceof Error) return busy ? <div className="muted small">{busy}</div> : null;
  const textures = [...set.set.textures.values()];
  if (!textures.length) return null;
  const pick = async (t: CgfxTexture, file: File): Promise<void> => {
    if (!replace) return;
    setNote(null);
    setBusy(`${t.name} を差し替えています…`);
    try {
      const { image, resized } = await readImage(file, t.width, t.height);
      await replace(t.name, image);
      setNote({ text: resized ? `${t.name}: 画像を ${t.width}×${t.height} に合わせて差し替えました` : `${t.name} を差し替えました` });
    } catch (err) {
      console.error(err);
      setNote({ text: `差し替えられませんでした: ${(err as Error).message}`, error: true });
    } finally {
      setBusy('');
    }
  };
  return (
    <details className="model-textures" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{`テクスチャ (${textures.length})`}</summary>
      {(busy || note) && <div className={!busy && note?.error ? 'error' : 'muted small'}>{busy || note?.text}</div>}
      <div className="bch-textures">
        {textures.map((t) => (
          <TextureThumb key={t.name} t={t}>
            <span className="row">
              <button className="small" title="このテクスチャを PNG で保存します" onClick={() => savePng(t)}>PNG</button>
              {replace && <ReplaceButton disabled={!!busy} title={replaceInfo} onFile={(f) => void pick(t, f)} />}
            </span>
          </TextureThumb>
        ))}
      </div>
    </details>
  );
}

function ReplaceButton({ disabled, title, onFile }: { disabled: boolean; title?: string; onFile: (f: File) => void }): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="small" disabled={disabled} title={title} onClick={() => input.current?.click()}>差し替え…</button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (f) onFile(f);
      }} />
    </>
  );
}

function savePng(t: CgfxTexture): void {
  const c = document.createElement('canvas');
  c.width = t.width;
  c.height = t.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `${t.name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

/** An image file as RGBA of `w` × `h` (scaled when its size differs). */
async function readImage(file: File, w: number, h: number): Promise<{ image: TextureImage; resized: boolean }> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const resized = bmp.width !== w || bmp.height !== h;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { image: { width: w, height: h, rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer) }, resized };
}
