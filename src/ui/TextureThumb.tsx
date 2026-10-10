// One texture (decoded RGBA) as a thumbnail with its name, size and format: the RomFS viewer's BCH view and the books'
// texture lists.
import { useEffect, useRef, type ReactNode } from 'react';
import type { CgfxTexture } from '../cgfx/cgfx';
import { TEX_FORMAT } from '../cgfx/texture';

export function TextureThumb({ t }: { t: CgfxTexture }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = t.width;
    c.height = t.height;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
  }, [t]);
  return (
    <figure className="bch-texture">
      <canvas ref={canvas} title={`${t.width}×${t.height}`} />
      <figcaption>
        <span className="mono">{t.name}</span>
        <span className="muted small">{`${t.width}×${t.height} ${TEX_FORMAT[t.format] ?? t.format}`}</span>
      </figcaption>
    </figure>
  );
}
