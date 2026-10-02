// Keeps the files the editor needs in IndexedDB so the dump does not have to be selected every time.
import { idbGet, idbSet } from '../util/idb';
import type { Dump } from './dump';
import { KAHARA, TITLES } from './titles';

const MANIFEST = 'dump/manifest';
const VERSION = 3; // 3: + 2713402F (MonsterDesign), 49A43B63 (ShopItem), monster / item models

interface Manifest {
  version: number;
  label: string;
  /** TitleDef.key (missing in caches saved before RPG3: RPG2). */
  title?: string;
  titleVersion?: number;
  names: string[];
  savedAt: number;
}

export async function saveDumpCache(dump: Dump, names: string[]): Promise<void> {
  await idbSet('dump/code.bin', dump.code);
  for (const n of names) await idbSet('dump/romfs/' + n, await dump.readRomfs(n));
  const m: Manifest = { version: VERSION, label: dump.label, title: dump.title.key, titleVersion: dump.titleVersion, names, savedAt: Date.now() };
  await idbSet(MANIFEST, m);
}

export async function cachedDumpInfo(): Promise<Manifest | undefined> {
  const m = await idbGet<Manifest>(MANIFEST);
  return m && m.version === VERSION ? m : undefined;
}

export async function openCachedDump(): Promise<Dump | undefined> {
  const m = await cachedDumpInfo();
  if (!m) return undefined;
  const code = await idbGet<Uint8Array>('dump/code.bin');
  if (!code) return undefined;
  return {
    label: m.label + ' (キャッシュ)',
    title: TITLES.find((t) => t.key === m.title) ?? KAHARA,
    titleVersion: m.titleVersion,
    code,
    names: () => m.names,
    readRomfs: async (name) => {
      const b = await idbGet<Uint8Array>('dump/romfs/' + name);
      if (!b) throw new Error(`キャッシュに ${name} がありません。ダンプを選び直してください。`);
      return b;
    },
  };
}
