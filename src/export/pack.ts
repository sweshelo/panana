// Export (docs/map-editor-design.md §8): map DB -> LZ10 -> archive A90C8038 -> LayeredFS zip.
import { zipSync } from 'fflate';
import { rebuildArchive } from '../archive/gsarc';
import type { Game } from '../game/game';
import type { EventTable } from '../game/events';
import type { MapInfo } from '../game/codebin';
import { MapDb, MAPDB_ARCHIVE } from '../game/mapdb';
import { buildMapPatch, readExtension, type AddedMap } from '../game/mappatch';
import { appendIps } from '../rom/ips';
import { buildPatches, patchRecords, type CodePatch } from '../game/patch';
import { MASTER_ARCHIVE } from '../game/master';
import { sectionBytes, type MapDoc } from '../game/sections';
import { TITLE_ID } from '../rom/dump';
import { equalBytes } from '../util/bytes';

/** Map DB entries replaced as they are: [hash, bytes] (the edited sections of the world maps). */
export type DbEntries = [number, Uint8Array][];

/** Rebuild the map database with the sections of the given documents (and the given entries). */
export function buildMapDb(game: Game, docs: Iterable<MapDoc>, entries: DbEntries = []): { db: Uint8Array; changed: number } {
  const db = new MapDb(game.dbBytes);
  const all = [...docs];
  // New maps that were never opened are written empty (sections with their initial content).
  for (const m of game.code.addedMaps()) if (!game.db.has(m.hash) && !all.some((d) => d.hash === m.hash)) all.push(game.doc(m));
  docs = all;
  let changed = 0;
  for (const [h, bytes] of entries) {
    if (equalBytes(bytes, game.db.get(h))) continue;
    db.set(h, bytes);
    changed++;
  }
  for (const doc of docs) {
    const info = game.code.byHash(doc.hash);
    if (!info) throw new Error(`マップ ${doc.name} が code.bin の表にありません`);
    for (let k = 0; k < 10; k++) {
      const h = info.sections[k]!;
      const bytes = sectionBytes(doc, k);
      if (info.added && !db.has(h)) {
        // A new map: every section needs an entry (the game's search does not check the hash; docs/new-map.md §5).
        db.add(h, bytes);
        changed++;
        continue;
      }
      if (equalBytes(bytes, game.db.get(h))) continue;
      if (!db.has(h)) {
        if (!bytes.length) continue;
        throw new Error(`${doc.name} の区画 ${k} (${h.toString(16)}) はマップ DB にないので書けません`);
      }
      db.set(h, bytes);
      changed++;
    }
  }
  return { db: db.build(), changed };
}

/** The new A90C8038 archive (only the map DB entry is re-packed). */
export function buildArchive(game: Game, docs: Iterable<MapDoc>, entries: DbEntries = []): { archive: Uint8Array; changed: number } {
  const { db, changed } = buildMapDb(game, docs, entries);
  const archive = rebuildArchive(game.dbArchive, new Map([[game.dbEntry.index, db]]));
  return { archive, changed };
}

export const MOD_ROOT = `${TITLE_ID}/romfs`;
export const MOD_PATH = `${MOD_ROOT}/${MAPDB_ARCHIVE}`;

/**
 * RomFS files of the MOD: A90C8038 when maps (or world map entries) changed, the event archives of edited dungeons, and the
 * master archive (56562135, built on game.masterBytes) when its tables or messages changed.
 */
export function buildModFiles(game: Game, docs: MapDoc[], events: EventTable[], treasure: boolean, entries: DbEntries = []): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (docs.length || entries.length || game.code.addedMaps().some((m) => !game.db.has(m.hash)))
    out.set(MAPDB_ARCHIVE, buildArchive(game, docs, entries).archive);
  for (const t of events) out.set(t.archiveName, t.buildArchive());
  if (treasure || game.master.texts.changed()) out.set(MASTER_ARCHIVE, game.master.buildArchive());
  return out;
}

/**
 * Everything to install: the base MOD's RomFS files (unless rebuilt here) + the rebuilt ones, and its
 * code.ips. Keys are paths below the title folder ("romfs/A90C8038", "exefs/code.ips").
 */
export function modPackage(game: Game, files: Map<string, Uint8Array>, extra: CodePatch[] = []): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [name, data] of game.baseMod?.romfs ?? []) out.set(`romfs/${name}`, data);
  for (const [name, data] of files) out.set(`romfs/${name}`, data);
  const ips = codeIps(game, extra);
  if (ips) out.set('exefs/code.ips', ips);
  return out;
}

/**
 * code.ips of the MOD: the base MOD's, plus the tables of the new maps when there are any (or when the base has
 * an older extension, which is rebuilt; docs/new-map.md §2), the enabled code patches and `extra` (Panana's own
 * patches, e.g. game/boss.ts BOSS_PATCH).
 */
export function codeIps(game: Game, extra: CodePatch[] = []): Uint8Array | null {
  let ips = game.baseMod?.ips ?? null;
  const added = game.code.addedMaps();
  if (added.length || readExtension(game.dump.code)) ips = appendIps(ips, buildMapPatch(game.dump.code, added.map(addedMap)).records, game.dump.code);
  // code patches (the event page); ones with errors are left out
  const records = patchRecords(buildPatches(game.dump.code, exportedPatches(game, extra)).values());
  if (records.length) ips = appendIps(ips, records, game.dump.code);
  return ips;
}

/** The code patches written to code.ips: the enabled ones of the patch list, then `extra`. */
export const exportedPatches = (game: Game, extra: CodePatch[] = []): CodePatch[] => [...game.codePatches.filter((p) => p.enabled), ...extra];

const addedMap = (m: MapInfo): AddedMap => ({
  hash: m.hash,
  sections: m.sections,
  name: m.name,
  dungeon: m.dungeon,
  floor: m.floor,
  mapDataKey: m.mapDataKey,
  extra: m.extra,
});

/** The LayeredFS zip of a package: its paths under the title's folder (RPG2's unless another title ID is given). */
export function buildModZip(pkg: Map<string, Uint8Array>, titleId = TITLE_ID): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {};
  for (const [path, data] of pkg) entries[`${titleId}/${path}`] = [data, { level: 0, mtime: new Date(1980, 0, 1) }];
  return zipSync(entries);
}
