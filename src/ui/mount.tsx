// Bridge from the h()-built shell to React: pages move to React one by one and are mounted into the
// element app.ts already places for them.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** A React root on `el`; the returned function (re-)renders into it. */
export function mountReact(el: HTMLElement): (node: ReactNode) => void {
  const root = createRoot(el);
  return (node) => root.render(node);
}
