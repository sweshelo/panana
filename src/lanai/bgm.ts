import { rendererOf, titleName, type BgmCandidate } from '../port/bgm';
import { SOUND_PREFIX, portedPath, templateSound } from '../port/sounds';
import { SoundArchive } from '../sound/formats';
import { requireAudible } from '../sound/render';
import { addStreamSounds, cstmChannels, cstmFromPcm } from '../sound/write';
import { openedDump, type Opened } from '../ui/workspace';
import type { LanaiSession } from './session';

/** FREE!'s BGM fields reference SoundData rows directly; no RPG2 slot patch is needed. */
export async function portLanaiBgm(o: Opened, s: LanaiSession, c: BgmCandidate, max: number): Promise<number> {
  const bytes = await s.readSoundArchive();
  const a = new SoundArchive(bytes);
  // Include the source index: distinct sounds may have the same name in one archive.
  const base = `${c.kind === 'se' ? 'SE' : 'BGM'}_${SOUND_PREFIX[c.title]}_${c.name}_${c.index}`;
  let name = base;
  let previous = -1;
  const legacy = `BGM_${SOUND_PREFIX[c.title]}_${c.name}`;
  const old = c.kind === 'se' ? -1 : a.sounds.findIndex((x) => x.name === legacy);
  if (old >= 0 && s.soundFiles.has(`sound/${portedPath(legacy)}`)) {
    name = legacy;
    previous = old;
  } else {
    for (let suffix = 2; ; suffix++) {
      previous = a.sounds.findIndex((x) => x.name === name);
      if (previous < 0 || s.soundFiles.has(`sound/${portedPath(name)}`)) break;
      name = `${base}_${suffix}`;
    }
  }
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
  if (!r || !dump || !sound) throw new Error(`${titleName(c.title)} の音を読めません`);
  const path = r.archive.file(sound.fileId);
  const stream =
    sound.type === 'stream' && typeof path === 'string'
      ? await dump.readRomfs(`sound/${path}`)
      : c.kind === 'se'
        ? cstmFromPcm(requireAudible(await r.render(c.index, 8, false)))
        : null;
  if (!stream) throw new Error(`${titleName(c.title)} の音を移植できません`);
  const index = previous >= 0 ? previous : a.sounds.length;
  const built =
    previous >= 0
      ? bytes
      : addStreamSounds(bytes, templateSound(a), [
          {
            name,
            path: portedPath(name),
            volume: sound.type === 'stream' ? sound.volume : 127,
            channels: cstmChannels(stream),
          },
        ]);
  const template = Array.from({ length: table.rows }, (_, row) => row).find((row) => {
    const sound = a.sounds[table.u32(row, 0) & 0xffffff];
    return c.kind === 'se' ? sound?.name.startsWith('SE_') : sound?.type === 'stream' && sound.name.startsWith('BGM_');
  });
  if (template === undefined) throw new Error('音のひな形がありません');
  const row = table.addRow(template);
  table.setU32(row, 0, (0x01000000 | index) >>> 0);
  s.soundFiles.set(s.soundArchivePath(), built);
  if (previous < 0) s.soundFiles.set(`sound/${portedPath(name)}`, stream);
  s.soundsChanged();
  s.edited();
  return row;
}
