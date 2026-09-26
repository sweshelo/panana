// Export (docs/map-editor-design.md §8): map DB -> LZ10 -> archive A90C8038 -> LayeredFS zip.
import { zipSync } from 'fflate';
import { rebuildArchive } from '../archive/gsarc';
import type { Game } from '../game/game';
import type { EventTable } from '../game/events';
import { MapDb, MAPDB_ARCHIVE } from '../game/mapdb';
import { MASTER_ARCHIVE } from '../game/master';
import { sectionBytes, type MapDoc } from '../game/sections';
import { TITLE_ID } from '../rom/dump';
import { equalBytes } from '../util/bytes';

/** Rebuild the map database with the sections of the given documents. */
export function buildMapDb(game: Game, docs: Iterable<MapDoc>): { db: Uint8Array; changed: number } {
  const db = new MapDb(game.dbBytes);
  let changed = 0;
  for (const doc of docs) {
    const info = game.code.byHash(doc.hash);
    if (!info) throw new Error(`マップ ${doc.name} が code.bin の表にありません`);
    for (let k = 0; k < 10; k++) {
      const h = info.sections[k]!;
      const bytes = sectionBytes(doc, k);
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
export function buildArchive(game: Game, docs: Iterable<MapDoc>): { archive: Uint8Array; changed: number } {
  const { db, changed } = buildMapDb(game, docs);
  const archive = rebuildArchive(game.dbArchive, new Map([[game.dbEntry.index, db]]));
  return { archive, changed };
}

export const MOD_ROOT = `${TITLE_ID}/romfs`;
export const MOD_PATH = `${MOD_ROOT}/${MAPDB_ARCHIVE}`;

/**
 * RomFS files of the MOD: A90C8038 when maps changed, the event archives of edited dungeons, and the
 * master archive (56562135, built on game.masterBytes) when treasure contents changed.
 */
export function buildModFiles(game: Game, docs: MapDoc[], events: EventTable[], treasure: boolean): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (docs.length) out.set(MAPDB_ARCHIVE, buildArchive(game, docs).archive);
  for (const t of events) out.set(t.archiveName, t.buildArchive());
  if (treasure) out.set(MASTER_ARCHIVE, game.master.buildArchive());
  return out;
}

export function buildModZip(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {};
  for (const [name, data] of files) entries[`${MOD_ROOT}/${name}`] = [data, { level: 0, mtime: new Date(1980, 0, 1) }];
  return zipSync(entries);
}
