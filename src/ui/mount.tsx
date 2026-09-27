// Bridges between React and elements built outside it (the map editor's canvases, three.js viewers).
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** A React root on `el`; the returned function (re-)renders into it. */
export function mountReact(el: HTMLElement): (node: ReactNode) => void {
  const root = createRoot(el);
  return (node) => root.render(node);
}

/** An element built outside React (three.js viewers, the map editor), placed here. */
export function Dom({ node, className }: { node: HTMLElement; className?: string }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    box.current?.append(node);
    return () => node.remove();
  }, [node]);
  return <div ref={box} className={className} style={className ? undefined : { display: 'contents' }} />;
}
