// The dumps open at the same time (one per game, #100): the one shown, the others kept loaded so that a page can
// pick a monster or an item of another game. Root holds them; the shells and the pickers read them from this context.
import { createContext, useContext } from 'react';
import type { MapEditor } from '../editor/mapeditor';
import type { HonoluluSession } from '../honolulu/session';
import type { LanaiSession } from '../lanai/session';
import type { OahuSession } from '../oahu/session';
import type { BaseMod, Dump } from '../rom/dump';
import { TITLES, type TitleKey } from '../rom/titles';
import type { Session } from '../session';

/** The opened dumps by game. */
export interface Opened {
  kahara?: { session: Session; editor: MapEditor };
  oahu?: OahuSession;
  lanai?: LanaiSession;
  honolulu?: HonoluluSession;
}

export interface Workspace {
  opened: Opened;
  /** The game whose pages are shown. */
  active: TitleKey;
  /** Shows the list of the opened dumps (and adding more). */
  showRoms(): void;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

/** The opened dumps (null outside the shells, e.g. in the tests that draw a page alone). */
export const useWorkspace = (): Workspace | null => useContext(WorkspaceContext);

/** The dump of an opened game. */
export function openedDump(o: Opened, key: TitleKey): Dump | undefined {
  if (key === 'kahara') return o.kahara?.session.game.dump;
  return o[key]?.dump;
}

/** The base MOD an opened game is read with. */
export function openedBaseMod(o: Opened, key: TitleKey): BaseMod | null {
  if (key === 'kahara') return o.kahara?.session.game.baseMod ?? null;
  return o[key]?.baseMod ?? null;
}

/** The opened games, in the order of TITLES. */
export const openedKeys = (o: Opened): TitleKey[] => TITLES.map((t) => t.key).filter((k) => !!o[k]);
