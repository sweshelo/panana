// Keeps the files the editor needs in IndexedDB so the dump does not have to be selected every time.
import { idbGet, idbSet } from '../util/idb';
import type { Dump } from './dump';

const MANIFEST = 'dump/manifest';
const VERSION = 1;

interface Manifest {
  version: number;
  label: string;
  titleVersion?: number;
  names: string[];
  savedAt: number;
}

export async function saveDumpCache(dump: Dump, names: string[]): Promise<void> {
  await idbSet('dump/code.bin', dump.code);
  for (const n of names) await idbSet('dump/romfs/' + n, await dump.readRomfs(n));
  const m: Manifest = { version: VERSION, label: dump.label, titleVersion: dump.titleVersion, names, savedAt: Date.now() };
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
