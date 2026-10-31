// Porting a BGM of another opened game into RPG2 (the sound picker's "ほかの作品" tab): the other game's stream goes into
// RPG2's sound.bcsar as a new sound (sounds.ts), and a soundData row is added after the game's (418-) to play it. The
// BGM fields hold one byte, so they name the added rows as 0x80- (the code patch of game/bgmext.ts).
import type { Session } from '../session';
import type { SoundRenderer } from '../sound/render';
import { TITLES, type TitleKey } from '../rom/titles';
import { openedDump, openedKeys, type Opened } from '../ui/workspace';
import { u32, w32 } from '../util/bytes';
import { BGM_EXT_BASE, BGM_EXT_SLOTS } from '../game/bgmext';
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
/** The row an added row is copied from (BGM_TITLE: a stream BGM). */
const TEMPLATE_ROW = 1;

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

/** The added soundData row (418-) that plays RPG2's sound `index`, or null. */
export function addedRowOf(session: Session, index: number): number | null {
  const t = session.game.master.table('soundData.bin');
  for (let r = BGM_EXT_BASE; r < t.rows; r++) if (u32(t.row(r), 0) === (SOUND_ITEM | index) >>> 0) return r;
  return null;
}

/** The added rows that play the ported candidates: "title/name" -> soundData row. */
export async function portedRows(session: Session): Promise<Map<string, number>> {
  const store = await SoundPortStore.of();
  const out = new Map<string, number>();
  for (const p of store.list()) {
    const i = await store.index(p.name);
    const r = i === null ? null : addedRowOf(session, i);
    if (r !== null) out.set(`${p.from.title}/${p.from.name}`, r);
  }
  return out;
}

/**
 * Ports the candidate into RPG2 (once: a candidate ported before is reused) and gives it a soundData row after the
 * game's. Returns the row (the caller saves the edit).
 */
export async function portBgm(o: Opened, session: Session, c: BgmCandidate): Promise<number> {
  const r = await rendererOf(o, c.title);
  const dump = openedDump(o, c.title);
  if (!r || !dump) throw new Error(`${titleName(c.title)} を開いていません`);
  const s = r.archive.sounds[c.index];
  const path = s && r.archive.file(s.fileId);
  if (!s || typeof path !== 'string') throw new Error(`${c.name} はストリームではありません`);
  const store = await SoundPortStore.of();
  const index = await store.add(c.title, s.name, await dump.readRomfs(`sound/${path}`), s.volume);
  await session.game.soundsChanged();
  return addedRowOf(session, index) ?? addSoundRow(session, index);
}

/** Appends a soundData row playing sound `index` (a copy of a BGM row). */
function addSoundRow(session: Session, index: number): number {
  const t = session.game.master.table('soundData.bin');
  if (t.rows < BGM_EXT_BASE) throw new Error(`soundData が ${t.rows} 行しかありません (${BGM_EXT_BASE} 行のはず)`);
  if (t.rows >= BGM_EXT_BASE + BGM_EXT_SLOTS) throw new Error(`移植した BGM は ${BGM_EXT_SLOTS} 曲までです`);
  const row = t.row(TEMPLATE_ROW).slice();
  w32(row, 0, (SOUND_ITEM | index) >>> 0);
  let hash = 0;
  if (t.indexOffset) {
    const used = t.hashes();
    hash = (0x7e730000 + t.rows) >>> 0;
    while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
  }
  return t.append(row, hash);
}
