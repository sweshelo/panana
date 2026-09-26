// The interactive model viewer (three.js, one per page) placed in a React page.
import { useEffect, useMemo, type ReactNode } from 'react';
import { ModelViewer, type ModelRef } from '../pages/modelview';
import { Dom } from './mount';

export function ModelView({ model, name, motionHints }: { model: ModelRef | null; name: string; motionHints?: Record<string, string> }): ReactNode {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one viewer (WebGL context) for the page's lifetime
  const viewer = useMemo(() => new ModelViewer(motionHints), []);
  const key = model?.key ?? '';
  useEffect(() => {
    viewer.show(model, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the model changes
  }, [viewer, key]);
  return <Dom node={viewer.el} />;
}
