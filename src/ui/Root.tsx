// The application: the start screen, loading a dump (with the base MOD saved last time), and the pages.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapEditor } from '../editor/mapeditor';
import { Game } from '../game/game';
import { saveDumpCache } from '../rom/cache';
import { baseModFromFiles, type BaseMod, type Dump } from '../rom/dump';
import { Session } from '../session';
import { idbGet, idbSet } from '../util/idb';
import { Shell } from './Shell';
import { StartScreen } from './StartScreen';

const BASEMOD_KEY = 'basemod/v1';
type SavedBaseMod = { label: string; romfs: [string, Uint8Array][]; ips: Uint8Array | null };

async function savedBaseMod(): Promise<BaseMod | null> {
  const s = await idbGet<SavedBaseMod>(BASEMOD_KEY);
  return s ? { label: s.label, romfs: new Map(s.romfs), ips: s.ips } : null;
}

type State =
  | { kind: 'start'; error?: string }
  | { kind: 'loading' }
  | { kind: 'ready'; session: Session; editor: MapEditor; id: number };

/** The session and the map editor of a game (the edits saved last time are restored). */
async function openPages(game: Game, autoRestore: boolean): Promise<{ session: Session; editor: MapEditor }> {
  const session = await Session.open(game, autoRestore);
  return { session, editor: await MapEditor.create(session) };
}

export function Root(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'start' });
  /** The dump as opened (without the base MOD). */
  const rawDump = useRef<Dump | null>(null);
  const ids = useRef(0);

  // The map editor listens to the keyboard until it is replaced.
  const editor = state.kind === 'ready' ? state.editor : null;
  useEffect(() => () => editor?.dispose(), [editor]);

  const load = async (open: () => Promise<Dump>): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const dump = await open();
      if (dump.titleVersion !== undefined && dump.titleVersion !== 1040)
        throw new Error(`TitleVersion が ${dump.titleVersion} です。このエディタは v1.1.0 (1040) 専用です。`);
      rawDump.current = dump;
      const game = await Game.load(dump, await savedBaseMod());
      if (!dump.label.endsWith('(キャッシュ)')) saveDumpCache(dump, (await Game.load(dump)).neededFiles()).catch(() => {});
      setState({ kind: 'ready', ...(await openPages(game, false)), id: ++ids.current });
    } catch (err) {
      console.error(err);
      setState({ kind: 'start', error: (err as Error).message });
    }
  };

  /** Reload the game with another base MOD, keeping the edits (they are saved first). */
  const reloadWith = async (session: Session, mod: BaseMod | null): Promise<void> => {
    await idbSet(BASEMOD_KEY, mod ? { label: mod.label, romfs: [...mod.romfs], ips: mod.ips } satisfies SavedBaseMod : null);
    session.saveNow();
    const pages = await openPages(await Game.load(rawDump.current!, mod), true);
    pages.editor.setStatus(mod ? `土台の MOD: ${mod.label}` : '土台の MOD を外しました');
    setState({ kind: 'ready', ...pages, id: ++ids.current });
  };

  const pickBaseMod = (session: Session): void => {
    const game = session.game;
    if (game.baseMod && confirm(`今の土台: ${game.baseMod.label}\n外しますか? (「キャンセル」で別のフォルダを選ぶ)`)) {
      reloadWith(session, null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      try {
        const label = files[0]!.webkitRelativePath.split('/')[0] || 'MOD';
        const mod = baseModFromFiles(label, await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
        await reloadWith(session, mod);
      } catch (err) {
        alert(`MOD として読めませんでした: ${(err as Error).message}`);
      }
    });
    input.click();
  };

  if (state.kind === 'loading') return <div className="start"><p>読み込み中…</p></div>;
  if (state.kind === 'start') return <StartScreen error={state.error} onOpen={load} />;
  const { session } = state;
  return (
    <Shell
      key={state.id}
      session={session}
      editor={state.editor}
      onPickBaseMod={() => pickBaseMod(session)}
      onChangeDump={() => setState({ kind: 'start' })}
    />
  );
}
