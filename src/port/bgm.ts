// Porting a BGM of another opened game into RPG2 (the sound picker's "ほかの作品" tab): the other game's stream goes into
// RPG2's sound.bcsar as a new sound (sounds.ts), and a soundData row the user picks (1-255: RPG2's mapData and boss
// battles hold one byte, and every such row is a sound of the game) is pointed at it. The row's own sound stays in
// sound.bcsar, so the row can be put back (the BGM page).
import type { Session } from '../session';
import type { SoundRenderer } from '../sound/render';
import { TITLES, type TitleKey } from '../rom/titles';
import { openedDump, openedKeys, type Opened } from '../ui/workspace';
import { u32, w32 } from '../util/bytes';
import { SoundPortStore } from './sounds';

/** A BGM (or ME) stream of another game that can be ported. */
export interface BgmCandidate {
  title: TitleKey;
  /** Sound index in that game's sound.bcsar. */
  index: number;
  name: string;
  kind: 'bgm' | 'me';
}

const SOUND_ITEM = 0x01000000;

/** The player of an opened game's sounds. */
export function rendererOf(o: Opened, key: TitleKey): Promise<SoundRenderer> | null {
  if (key === 'kahara') return o.kahara?.session.game.soundRenderer() ?? null;
  return o[key]?.soundRenderer() ?? null;
}

export const titleName = (key: TitleKey): string => TITLES.find((t) => t.key === key)?.name ?? key;

/** The streams of the other opened games (BGM_* / ME_*), by game. */
export async function bgmCandidates(o: Opened, target: TitleKey = 'kahara'): Promise<BgmCandidate[]> {
  const out: BgmCandidate[] = [];
  for (const key of openedKeys(o)) {
    if (key === target) continue;
    const r = await rendererOf(o, key)?.catch(() => null);
    if (!r) continue;
    r.archive.sounds.forEach((s, index) => {
      if (s.type !== 'stream' || typeof r.archive.file(s.fileId) !== 'string') return;
      const kind = s.name.startsWith('BGM_') ? 'bgm' : s.name.startsWith('ME_') ? 'me' : null;
      if (kind) out.push({ title: key, index, name: s.name, kind });
    });
  }
  return out;
}

/** The soundData rows of RPG2 that play the candidate already (it was ported and given to them). */
export async function rowsPlaying(session: Session, c: BgmCandidate): Promise<number[]> {
  const store = await SoundPortStore.of();
  const p = store.find(c.title, c.name);
  if (!p) return [];
  const i = await store.index(p.name);
  const t = session.game.master.table('soundData.bin');
  const out: number[] = [];
  for (let r = 1; r < t.rows; r++) if (i !== null && u32(t.row(r), 0) === (SOUND_ITEM | i) >>> 0) out.push(r);
  return out;
}

/**
 * Ports the candidate into RPG2 (once: a candidate ported before is reused) and points soundData row `row` at it.
 * Returns the RPG2 sound index (the caller saves the edit).
 */
export async function portBgm(o: Opened, session: Session, c: BgmCandidate, row: number): Promise<number> {
  const r = await rendererOf(o, c.title);
  const dump = openedDump(o, c.title);
  if (!r || !dump) throw new Error(`${titleName(c.title)} を開いていません`);
  const s = r.archive.sounds[c.index];
  const path = s && r.archive.file(s.fileId);
  if (!s || typeof path !== 'string') throw new Error(`${c.name} はストリームではありません`);
  const store = await SoundPortStore.of();
  const index = await store.add(c.title, s.name, await dump.readRomfs(`sound/${path}`), s.volume);
  await session.game.soundsChanged();
  setSoundItem(session, row, (SOUND_ITEM | index) >>> 0);
  return index;
}

/** soundData row +0x00 (the sound it plays; the caller saves). */
export function setSoundItem(session: Session, row: number, item: number): void {
  w32(session.game.master.table('soundData.bin').row(row), 0, item);
}

/** The sound a soundData row played in the game (before any edit). */
export function originalSoundItem(session: Session, row: number): number {
  return u32(session.game.master.originalRow('soundData.bin', row), 0);
}
