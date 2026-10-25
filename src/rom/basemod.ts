// The base MOD of each game: an existing MOD (hash-named RomFS files and code.ips, e.g. elpulse's mod/out) the dump is
// read with (dump.ts overlayDump), so the pages show and edit what the MOD made. The export writes its files under the
// rebuilt ones and its code.ips before Panana's records. One per game, kept in IndexedDB.
import { idbGet, idbSet } from '../util/idb';
import { baseModFromFiles, type BaseMod } from './dump';
import { titleById, type TitleDef, type TitleKey } from './titles';

// RPG2's key is the one from before the other games had a base MOD.
const KEY = (title: TitleKey): string => (title === 'kahara' ? 'basemod/v1' : `basemod/${title}/v1`);
type Saved = { label: string; romfs: [string, Uint8Array][]; ips: Uint8Array | null };

export async function savedBaseMod(title: TitleKey): Promise<BaseMod | null> {
  const s = await idbGet<Saved>(KEY(title)).catch(() => undefined);
  return s ? { label: s.label, romfs: new Map(s.romfs), ips: s.ips } : null;
}

export async function saveBaseMod(title: TitleKey, mod: BaseMod | null): Promise<void> {
  await idbSet(KEY(title), mod ? ({ label: mod.label, romfs: [...mod.romfs], ips: mod.ips } satisfies Saved) : null);
}

/**
 * A base MOD of `title` from the files of a folder (`path` relative to it). A LayeredFS folder names its title ID
 * (`00040000000EF000/romfs/…`), so another game's MOD is refused.
 */
export function baseModFor(title: TitleDef, label: string, files: { name: string; path: string; bytes: Uint8Array }[]): BaseMod {
  for (const f of files)
    for (const part of f.path.split('/')) {
      const t = /^[0-9A-Fa-f]{16}$/.test(part) ? titleById(part) : undefined;
      if (t && t !== title) throw new Error(`『${t.name}』の MOD です (${part})。『${title.name}』の MOD のフォルダを選んでください`);
    }
  return baseModFromFiles(label, files);
}

/**
 * The files of a MOD built on a base MOD, as paths below the title folder ("romfs/…", "exefs/code.ips"): the base's
 * RomFS files unless rebuilt, the rebuilt ones, and code.ips (the base's followed by the game's own records: ips.ts appendIps).
 */
export function packageOn(mod: BaseMod | null, files: Map<string, Uint8Array>, ips: Uint8Array | null): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [name, data] of mod?.romfs ?? []) out.set(`romfs/${name}`, data);
  for (const [name, data] of files) out.set(`romfs/${name}`, data);
  if (ips) out.set('exefs/code.ips', ips);
  return out;
}
