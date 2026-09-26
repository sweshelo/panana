// React side of EditorState: re-render a component whenever the state emits.
import { useSyncExternalStore } from 'react';
import type { EditorState } from '../editor/state';

/** The state's revision; the calling component re-renders on every emit (doc, selection, tool, map). */
export function useEditorState(st: EditorState): number {
  return useSyncExternalStore(
    (notify) => st.on(notify),
    () => st.revision,
  );
}
