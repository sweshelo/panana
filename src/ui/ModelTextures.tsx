// The textures a book's model is drawn with (the set the viewer and the photo use: for a colour variant, the variant's),
// folded under the 3D view. Shared by the monster books of RPG2, RPG3 and RPG FREE!.
import { useEffect, useState, type ReactNode } from 'react';
import { modelSet, type ModelRef } from '../pages/modelview';
import { TextureThumb } from './TextureThumb';
import { useAsync } from './useAsync';

export function ModelTextures({ model }: { model: ModelRef | null }): ReactNode {
  // read once the page is in the browser (the textures are decoded with the model)
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  const set = useAsync(() => (shown && model ? modelSet(model) : Promise.resolve(null)), [shown, model?.key]);
  if (!set || set instanceof Error) return null;
  const textures = [...set.set.textures.values()];
  if (!textures.length) return null;
  return (
    <details className="model-textures">
      <summary>{`テクスチャ (${textures.length})`}</summary>
      <div className="bch-textures">{textures.map((t) => <TextureThumb key={t.name} t={t} />)}</div>
    </details>
  );
}
