import { BCSAR_PATH } from '../game/sound';
import { rendererOf, titleName, type BgmCandidate } from '../port/bgm';
import { SOUND_PREFIX, portedPath, templateSound } from '../port/sounds';
import { SoundArchive } from '../sound/formats';
import { addStreamSounds, cstmChannels } from '../sound/write';
import { openedDump, type Opened } from '../ui/workspace';
import type { LanaiSession } from './session';

/** FREE!'s BGM fields reference SoundData rows directly; no RPG2 slot patch is needed. */
export async function portLanaiBgm(o: Opened, s: LanaiSession, c: BgmCandidate, max: number): Promise<number> {
  const read = (n: string): Promise<Uint8Array> => Promise.resolve(s.soundFiles.get(n) ?? s.dump.readRomfs(n));
  const bytes = await read(BCSAR_PATH);
  const a = new SoundArchive(bytes);
  const name = `BGM_${SOUND_PREFIX[c.title]}_${c.name}`;
  const previous = a.sounds.findIndex((x) => x.name === name);
  const table = s.need('SoundData');
  if (previous >= 0) {
    for (let row = table.originalRows; row < table.rows; row++)
      if (table.u32(row, 0) === (0x01000000 | previous) >>> 0) {
        if (row > max) throw new Error('この欄に移植済みの曲の番号を設定できません');
        return row;
      }
  }
  if (table.rows > max) throw new Error('この欄に設定できる曲の追加枠がありません');
  const r = await rendererOf(o, c.title);
  const dump = openedDump(o, c.title);
  const sound = r?.archive.sounds[c.index];
  const path = sound && r?.archive.file(sound.fileId);
  if (!dump || !sound || typeof path !== 'string') throw new Error(`${titleName(c.title)} の曲を読めません`);
  const stream = await dump.readRomfs(`sound/${path}`);
  const index = previous >= 0 ? previous : a.sounds.length;
  const built =
    previous >= 0
      ? bytes
      : addStreamSounds(bytes, templateSound(a), [
          { name, path: portedPath(name), volume: sound.volume, channels: cstmChannels(stream) },
        ]);
  const template = Array.from({ length: table.rows }, (_, row) => row).find((row) => {
    const sound = a.sounds[table.u32(row, 0) & 0xffffff];
    return sound?.type === 'stream' && sound.name.startsWith('BGM_');
  });
  if (template === undefined) throw new Error('BGM のひな形がありません');
  const row = table.addRow(template);
  table.setU32(row, 0, (0x01000000 | index) >>> 0);
  s.soundFiles.set(BCSAR_PATH, built);
  if (previous < 0) s.soundFiles.set(`sound/${portedPath(name)}`, stream);
  s.soundsChanged();
  s.edited();
  return row;
}
