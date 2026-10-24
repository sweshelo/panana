// What every game after RPG2 needs to show and play its soundData rows: the names of sound/sound.bcsar (cached in
// IndexedDB by game) and a renderer reading the streams from sound/stream/. RPG3, RPG FREE! and the first game share it.
import { BCSAR_PATH, bcsarSoundNames, SoundNames } from '../game/sound';
import type { Dump } from '../rom/dump';
import { idbGet, idbSet } from '../util/idb';
import { SoundArchive } from './formats';
import { SoundRenderer } from './render';

/** The soundData rows (item IDs, volumes) with the names of the dump's sound.bcsar; without one, rows are only numbered. */
export async function loadSoundNames(dump: Dump, cacheKey: string, items: number[], volumes?: number[]): Promise<SoundNames> {
  let names = (await idbGet<string[]>(cacheKey).catch(() => undefined)) ?? null;
  if (!names)
    try {
      names = bcsarSoundNames(await dump.readRomfs(BCSAR_PATH));
      await idbSet(cacheKey, names).catch(() => {});
    } catch {
      names = null;
    }
  return new SoundNames(items, names, volumes);
}

/** Plays the sounds of the dump's sound/sound.bcsar (its streams from sound/stream/). */
export function openSoundRenderer(dump: Dump): Promise<SoundRenderer> {
  return dump.readRomfs(BCSAR_PATH).then(
    (b) => new SoundRenderer(new SoundArchive(b), (path) => dump.readRomfs(`sound/${path}`)),
    (err: Error) => {
      throw new Error(`${BCSAR_PATH} を読めません (${err.message})`);
    },
  );
}
