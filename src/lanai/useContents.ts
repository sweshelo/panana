import { useMemo } from 'react';
import { lanaiContents, type LanaiContent } from './contents';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';

/**
 * The contents of the session for a page that stays mounted (the pages are kept while another tab is shown): read
 * again when a content or a stage row is added or taken out, so a content added on the stage page (#216) opens on the
 * map page. The list keeps its identity across other edits (a map edit does not re-read the content's maps).
 */
export function useLanaiContents(session: LanaiSession): LanaiContent[] {
  useLanaiRevision(session);
  const key = `${session.need('Contents').rows}/${session.need('MapStageIntegration').rows}`;
  return useMemo(() => lanaiContents(session), [session, key]);
}
