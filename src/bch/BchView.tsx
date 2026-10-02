// RomFS viewer: a BCH (types 2, 8, 10 of RPG3's archives) — its models in the 3D viewer, its textures, and the
// names of its animations.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TEX_FORMAT } from '../cgfx/texture';
import type { CgfxTexture } from '../cgfx/cgfx';
import type { FormatViewProps } from '../romfs/formats';
import { ModelView } from '../ui/ModelView';
import { bchOffset, bchSummary, parseBch } from './bch';
import { bchBytesRef } from './models';

function TextureThumb({ t }: { t: CgfxTexture }): ReactNode {
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

export function BchView({ body }: FormatViewProps): ReactNode {
  const parsed = useMemo(() => {
    try {
      const bch = body.subarray(bchOffset(body));
      return { summary: bchSummary(bch), file: parseBch(bch) };
    } catch (err) {
      return err as Error;
    }
  }, [body]);
  const [model, setModel] = useState(0);
  if (parsed instanceof Error) return <div className="error">{`BCH を読めませんでした: ${parsed.message}`}</div>;
  const { summary, file } = parsed;
  const m = file.models[Math.min(model, file.models.length - 1)];
  const h = summary.header;
  return (
    <div className="bch-view">
      <div className="row">
        <span className="muted">{`H3D 0x${h.backward.toString(16)} (変換 ${h.converter})`}</span>
        <span className="muted">{`モデル ${file.models.length}、テクスチャ ${file.textures.length}、骨格アニメーション ${summary.skeletalAnimations.length}、材質アニメーション ${summary.materialAnimations.length}`}</span>
        {bchOffset(body) > 0 && <span className="muted">{`BCH は +0x${bchOffset(body).toString(16).toUpperCase()} から`}</span>}
      </div>
      {file.models.length > 1 && (
        <div className="row">
          <select value={model} onChange={(e) => setModel(Number(e.target.value))}>
            {file.models.map((x, i) => <option key={i} value={i}>{x.name || `モデル ${i}`}</option>)}
          </select>
        </div>
      )}
      {m && (
        <>
          <ModelView model={bchBytesRef(body, model)} name={m.name || 'model'} />
          <div className="row muted small">
            {`${m.meshes.length} メッシュ、${m.meshes.reduce((n, x) => n + x.indices.length / 3, 0).toLocaleString()} 三角形、${m.materials.length} 材質、${m.bones.length} ボーン`}
          </div>
        </>
      )}
      {file.textures.length > 0 && <div className="bch-textures">{file.textures.map((t) => <TextureThumb key={t.name} t={t} />)}</div>}
      {summary.skeletalAnimations.length + summary.materialAnimations.length > 0 && (
        <details className="bch-anims">
          <summary>アニメーション</summary>
          <ul className="mono small">
            {summary.skeletalAnimations.map((n) => <li key={`s/${n}`}>{n}</li>)}
            {summary.materialAnimations.map((n) => <li key={`m/${n}`}>{`${n} (材質)`}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
