// Bridges between the h()-built map editor and React.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** A React root on `el`; the returned function (re-)renders into it. */
export function mountReact(el: HTMLElement): (node: ReactNode) => void {
  const root = createRoot(el);
  return (node) => root.render(node);
}

/** A React tree as an element, rendered right away (for the map editor's panels, which are built with h()). */
export function reactElement(node: ReactNode, tag: 'div' | 'span' = 'div'): HTMLElement {
  const el = document.createElement(tag);
  el.style.display = 'contents';
  const root = createRoot(el);
  flushSync(() => root.render(node));
  return el;
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
