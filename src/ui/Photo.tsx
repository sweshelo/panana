// Photo (rendered thumbnail) of a model, made once it scrolls into view.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { modelPhoto, type ModelRef } from '../pages/modelview';

export function Photo({ model, className = 'photo', title }: { model: ModelRef | null; className?: string; title?: string }): ReactNode {
  const box = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const key = model?.key ?? '';
  useEffect(() => {
    setUrl(null);
    if (!model) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      modelPhoto(model).then((u) => live && setUrl(u));
    });
    io.observe(box.current!);
    return () => {
      live = false;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the model is identified by its key
  }, [key]);
  return (
    <span ref={box} className={className} title={title}>
      {url && <img src={url} alt="" />}
    </span>
  );
}
