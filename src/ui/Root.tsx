// The application: the start screen, loading the dumps (with the base MOD saved last time) and the pages. Dumps of
// several games can be open at once (#100): one game's pages are shown, the others stay loaded for the pickers.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapEditor } from '../editor/mapeditor';
import { Game } from '../game/game';
import { saveDumpCache } from '../rom/cache';
import { savedBaseMod, saveBaseMod } from '../rom/basemod';
import { openDumps, type BaseMod, type Dump } from '../rom/dump';
import type { TitleKey } from '../rom/titles';
import { Session } from '../session';
import { PortStore } from '../port/store';
import { SoundPortStore } from '../port/sounds';
import { forgetArchives } from '../cgfx/loader';
import { HonoluluSession } from '../honolulu/session';
import { LanaiSession } from '../lanai/session';
import { HonoluluShell } from './HonoluluShell';
import { LanaiShell } from './LanaiShell';
import { OahuShell } from './OahuShell';
import { OahuSession } from '../oahu/session';
import { RomDialog, TitleChoiceDialog } from './RomDialog';
import { Shell } from './Shell';
import { StartScreen } from './StartScreen';
import { openedKeys, setShownWorkspace, WorkspaceContext, type Opened, type Workspace } from './workspace';

/** Opens a game on its saved base MOD; when that fails, the base MOD is taken off and the dump opened without it. */
async function withSavedMod<T>(key: TitleKey, open: (mod: BaseMod | null) => Promise<T>): Promise<T> {
  const mod = await savedBaseMod(key);
  if (!mod) return open(null);
  try {
    return await open(mod);
  } catch (err) {
    console.error(err);
    await saveBaseMod(key, null);
    alert(`土台の MOD「${mod.label}」を重ねると開けなかったので、外して開きます: ${(err as Error).message}`);
    return open(null);
  }
}

/** The opened dumps, the game shown, and a number per opening so that a reopened game's pages are built anew. */
interface Ready {
  opened: Opened;
  active: TitleKey;
  ids: Record<TitleKey, number>;
}

type State =
  | { kind: 'start'; error?: string }
  | { kind: 'loading' }
  | { kind: 'ready'; ready: Ready };

/** The session and the map editor of a game (the edits saved last time are restored). */
async function openPages(game: Game, autoRestore: boolean): Promise<{ session: Session; editor: MapEditor }> {
  forgetArchives();
  await PortStore.install(game.dump);
  game.soundPorts = await SoundPortStore.install(game.dump);
  const session = await Session.open(game, autoRestore);
  return { session, editor: await MapEditor.create(session) };
}

export function Root(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'start' });
  /** RPG2's dump as opened (without the base MOD). */
  const rawDump = useRef<Dump | null>(null);
  const ids = useRef(0);
  /** The hash each game's pages were left at, to come back to it. */
  const hashes = useRef(new Map<TitleKey, string>());
  const [roms, setRoms] = useState(false);
  /** The games of the dumps just opened together, while asking which one to show. */
  const [choice, setChoice] = useState<TitleKey[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [romError, setRomError] = useState<string | null>(null);
  const ready = state.kind === 'ready' ? state.ready : null;

  // RPG2's map editor listens to the keyboard until it is replaced or closed.
  const editor = ready?.opened.kahara?.editor ?? null;
  useEffect(() => () => editor?.dispose(), [editor]);

  /** Opens one dump as the pages of its game (RPG2's session is restored without asking when it replaces one). */
  const openOne = async (dump: Dump, opened: Opened): Promise<Opened> => {
    if (dump.title.key === 'oahu') return { ...opened, oahu: await withSavedMod('oahu', (mod) => OahuSession.open(dump, mod)) };
    if (dump.title.key === 'honolulu') return { ...opened, honolulu: await withSavedMod('honolulu', (mod) => HonoluluSession.open(dump, mod)) };
    if (dump.title.key === 'lanai') {
      opened.lanai?.saveNow();
      return { ...opened, lanai: await withSavedMod('lanai', (baseMod) => LanaiSession.open(dump, { baseMod })) };
    }
    if (dump.titleVersion !== undefined && dump.titleVersion !== 1040)
      throw new Error(`TitleVersion が ${dump.titleVersion} です。電波人間のRPG2 は v1.1.0 (1040) 専用です。`);
    const before = opened.kahara;
    before?.session.saveNow();
    rawDump.current = dump;
    const pages = await withSavedMod('kahara', async (mod) => openPages(await Game.load(dump, mod), !!before));
    if (!dump.label.endsWith('(キャッシュ)')) saveDumpCache(dump, (await Game.load(dump)).neededFiles()).catch(() => {});
    return { ...opened, kahara: pages };
  };

  /** Opens `dumps` on top of what is open; the first of them is shown (asked when they are of several games). */
  const openAll = async (dumps: Dump[], prev: Ready | null): Promise<Ready> => {
    let opened: Opened = prev?.opened ?? {};
    const idsOf = { ...(prev?.ids ?? { kahara: 0, oahu: 0, lanai: 0, honolulu: 0 }) };
    for (const d of dumps) {
      opened = await openOne(d, opened);
      idsOf[d.title.key] = ++ids.current;
    }
    const active = dumps[0]!.title.key;
    if (prev) {
      hashes.current.set(prev.active, location.hash);
      if (active !== prev.active || dumps.some((d) => d.title.key === prev.active)) history.replaceState(null, '', location.pathname + location.search + (hashes.current.get(active) ?? ''));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else if (location.hash) {
      // a hash left from before names another game's page: every game opens on its first page (the maps)
      history.replaceState(null, '', location.pathname + location.search);
    }
    const games = [...new Set(dumps.map((d) => d.title.key))];
    setChoice(games.length > 1 ? games : null);
    if (active !== 'kahara') opened.kahara?.editor.hide();
    return { opened, active, ids: idsOf };
  };

  /** The start screen's choice: the dumps of one or more games. */
  const load = async (open: () => Promise<Dump | Dump[]>): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const got = await open();
      const dumps = Array.isArray(got) ? got : [got];
      if (!dumps.length) throw new Error('ダンプがありません');
      setState({ kind: 'ready', ready: await openAll(dumps, null) });
    } catch (err) {
      console.error(err);
      setState({ kind: 'start', error: (err as Error).message });
    }
  };

  /** More dumps from the list of the opened ROMs. */
  const add = async (files: File[]): Promise<void> => {
    if (!ready) return;
    setRomError(null);
    setBusy(`${files.map((f) => f.name).join('・')} を読み込み中…`);
    try {
      const dumps = await openDumps(files, (f) => (f as File).name);
      setState({ kind: 'ready', ready: await openAll(dumps, ready) });
      setRoms(false);
    } catch (err) {
      console.error(err);
      setRomError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const show = (key: TitleKey): void => {
    if (!ready || !ready.opened[key]) return;
    hashes.current.set(ready.active, location.hash);
    history.replaceState(null, '', location.pathname + location.search + (hashes.current.get(key) ?? ''));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    if (key !== 'kahara') ready.opened.kahara?.editor.hide();
    setState({ kind: 'ready', ready: { ...ready, active: key } });
    setRoms(false);
    setChoice(null);
  };

  const unload = (key: TitleKey): void => {
    if (!ready) return;
    const opened = { ...ready.opened };
    if (key === 'kahara') opened.kahara?.session.saveNow();
    else opened[key]?.saveNow();
    delete opened[key];
    hashes.current.delete(key);
    const rest = openedKeys(opened);
    if (!rest.length) {
      setRoms(false);
      setState({ kind: 'start' });
      return;
    }
    const active = key === ready.active ? rest[0]! : ready.active;
    if (active !== ready.active) {
      history.replaceState(null, '', location.pathname + location.search + (hashes.current.get(active) ?? ''));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    setState({ kind: 'ready', ready: { ...ready, opened, active } });
  };

  const toStart = (): void => {
    if (ready) for (const k of openedKeys(ready.opened)) k === 'kahara' ? ready.opened.kahara!.session.saveNow() : ready.opened[k]!.saveNow();
    hashes.current.clear();
    setRoms(false);
    setChoice(null);
    setState({ kind: 'start' });
  };

  /** Reload RPG2 with another base MOD, keeping the edits (they are saved first). */
  const reloadWith = async (session: Session, mod: BaseMod | null): Promise<void> => {
    if (!ready) return;
    session.saveNow();
    const pages = await openPages(await Game.load(rawDump.current!, mod), true);
    await saveBaseMod('kahara', mod);
    pages.editor.setStatus(mod ? `土台の MOD: ${mod.label}` : '土台の MOD を外しました');
    setState({ kind: 'ready', ready: { ...ready, opened: { ...ready.opened, kahara: pages }, ids: { ...ready.ids, kahara: ++ids.current } } });
  };

  /** Reopens RPG3, FREE! or the first game on another base MOD, keeping the edits (they are saved first). */
  const reopenWith = async (key: Exclude<TitleKey, 'kahara'>, mod: BaseMod | null): Promise<void> => {
    if (!ready) return;
    const o = ready.opened;
    let next: Partial<Opened>;
    if (key === 'oahu') {
      o.oahu!.saveNow();
      next = { oahu: await OahuSession.open(o.oahu!.raw, mod) };
    } else if (key === 'lanai') {
      o.lanai!.saveNow();
      next = { lanai: await LanaiSession.open(o.lanai!.raw, { baseMod: mod }) };
    } else {
      o.honolulu!.saveNow();
      next = { honolulu: await HonoluluSession.open(o.honolulu!.raw, mod) };
    }
    await saveBaseMod(key, mod);
    setState({ kind: 'ready', ready: { ...ready, opened: { ...o, ...next }, ids: { ...ready.ids, [key]: ++ids.current } } });
  };

  const workspace = useMemo((): Workspace | null => ready && { opened: ready.opened, active: ready.active, showRoms: () => { setRomError(null); setRoms(true); } }, [ready]);
  setShownWorkspace(workspace);

  if (state.kind === 'loading') return <div className="start"><p>読み込み中…</p></div>;
  if (state.kind === 'start' || !ready || !workspace) return <StartScreen error={state.kind === 'start' ? state.error : undefined} onOpen={load} />;
  const { opened, active } = ready;
  const replace = (o: Partial<Opened>): void => setState({ kind: 'ready', ready: { ...ready, opened: { ...ready.opened, ...o }, ids: { ...ready.ids, [active]: ++ids.current } } });
  let shell: ReactNode;
  if (active === 'oahu' && opened.oahu)
    shell = <OahuShell key={ready.ids.oahu} session={opened.oahu} onSession={(session) => replace({ oahu: session })} onBaseMod={(mod) => reopenWith('oahu', mod)} />;
  else if (active === 'lanai' && opened.lanai)
    shell = <LanaiShell key={ready.ids.lanai} session={opened.lanai} onSession={(session) => replace({ lanai: session })} onBaseMod={(mod) => reopenWith('lanai', mod)} />;
  else if (active === 'honolulu' && opened.honolulu)
    shell = <HonoluluShell key={ready.ids.honolulu} session={opened.honolulu} onBaseMod={(mod) => reopenWith('honolulu', mod)} />;
  else if (opened.kahara)
    shell = <Shell key={ready.ids.kahara} session={opened.kahara.session} editor={opened.kahara.editor} onBaseMod={(mod) => reloadWith(opened.kahara!.session, mod)} />;
  return (
    <WorkspaceContext.Provider value={workspace}>
      {shell}
      {roms && (
        <RomDialog opened={opened} active={active} busy={busy} error={romError} onShow={show} onClose={() => { if (!busy) setRoms(false); }}
          onUnload={unload} onAdd={add} onStart={toStart} />
      )}
      {choice && !roms && <TitleChoiceDialog opened={opened} keys={choice.filter((k) => opened[k])} onPick={show} onClose={() => setChoice(null)} />}
    </WorkspaceContext.Provider>
  );
}
