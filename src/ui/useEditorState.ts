// React side of the map editors' state (editor/state.ts MapEditState) (and of the map editor's own signals): re-render a component whenever they emit.
import { useSyncExternalStore } from 'react';
import type { MapEditState } from '../editor/state';

/** The state's revision; the calling component re-renders on every emit (doc, selection, tool, map). */
export function useEditorState(st: MapEditState): number {
  return useSyncExternalStore(
    (notify) => st.on(notify),
    () => st.revision,
  );
}

/** Something outside React that components re-render on (the map editor's view settings, the hovered cell). */
export class Signal {
  revision = 0;
  private listeners = new Set<() => void>();
  readonly subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  readonly get = (): number => this.revision;
  emit(): void {
    this.revision++;
    for (const f of [...this.listeners]) f();
  }
}

export function useSignal(s: Signal): number {
  return useSyncExternalStore(s.subscribe, s.get);
}
