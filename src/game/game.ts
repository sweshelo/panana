// Everything the editor reads from a dump (docs/map-editor-design.md §4).
import { findEntry, parseArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import type { Dump } from '../rom/dump';
import { hex8 } from '../util/bytes';
import { CodeBin, type MapInfo } from './codebin';
import { EventTable } from './events';
import { MapDb, MAPDB_ARCHIVE, MAPDB_ENTRY } from './mapdb';
import { Master, MASTER_ARCHIVE } from './master';
import { loadDoc, type MapDoc } from './sections';

export interface TilesetSource {
  /** mapResource row. */
  resource: number;
  tileset: number;
  modelArchive: string;
  textureArchive: string;
  textureEntry: number;
}

export class Game {
  readonly code: CodeBin;
  master: Master;
  /** Master archive bytes the export starts from (the ROM's, or an existing MOD's 56562135). */
  masterBytes: Uint8Array;
  masterLabel = 'ROM';
  readonly dbArchive: Archive;
  readonly dbEntry: ArcEntry;
  readonly dbBytes: Uint8Array;
  readonly db: MapDb;
  private readonly archives = new Map<string, Promise<Archive>>();

  private constructor(readonly dump: Dump, masterBytes: Uint8Array, dbArchiveBytes: Uint8Array) {
    this.code = new CodeBin(dump.code);
    this.master = new Master(masterBytes);
    this.masterBytes = masterBytes;
    this.dbArchive = parseArchive(dbArchiveBytes);
    const e = findEntry(this.dbArchive, MAPDB_ENTRY);
    if (!e) throw new Error(`${MAPDB_ARCHIVE} にマップ DB (${hex8(MAPDB_ENTRY)}) がありません`);
    this.dbEntry = e;
    this.dbBytes = unpackEntry(this.dbArchive, e).body;
    this.db = new MapDb(this.dbBytes);
  }

  static async load(dump: Dump): Promise<Game> {
    const [master, db] = await Promise.all([dump.readRomfs(MASTER_ARCHIVE), dump.readRomfs(MAPDB_ARCHIVE)]);
    return new Game(dump, master, db);
  }

  /**
   * Use another 56562135 (e.g. the item MOD's) for item names and treasure tables, and as the base of
   * the exported master archive.
   */
  setMaster(bytes: Uint8Array, label: string): void {
    const m = new Master(bytes);
    this.master = m;
    this.masterBytes = bytes;
    this.masterLabel = label;
  }

  private readonly events = new Map<number, Promise<EventTable | null>>();

  /** EventObject table of a dungeon (null when it has none). */
  eventTable(dungeon: number): Promise<EventTable | null> {
    let p = this.events.get(dungeon);
    if (!p) {
      const a = this.master.eventArchive(dungeon);
      p = a
        ? this.dump
            .readRomfs(hex8(a))
            .then((b) => EventTable.fromArchive(dungeon, this.master.mapGroup.row(dungeon)[0x1c]!, hex8(a), b))
            .catch(() => null)
        : Promise.resolve(null);
      this.events.set(dungeon, p);
    }
    return p;
  }

  archive(name: string): Promise<Archive> {
    let a = this.archives.get(name);
    if (!a) {
      a = this.dump.readRomfs(name).then(parseArchive);
      this.archives.set(name, a);
    }
    return a;
  }

  /** Dungeon maps (D, K, S... that have tiles), grouped for the map list. */
  editableMaps(): MapInfo[] {
    return this.code.maps.filter((m) => m.dungeon >= 0 && this.db.get(m.sections[0]!).length > 0);
  }

  doc(info: MapInfo): MapDoc {
    return loadDoc(this.db, info);
  }

  tilesetSource(dungeon: number): TilesetSource {
    const resource = this.master.resourceRow(dungeon);
    const a = this.master.resourceArchives(resource);
    return {
      resource,
      tileset: this.master.tileset(dungeon),
      modelArchive: hex8(a[0]!),
      textureArchive: hex8(a[1]!),
      textureEntry: a[2]!,
    };
  }

  /** Root RomFS files the editor needs for every dungeon (to cache them). */
  neededFiles(): string[] {
    const out = new Set([MASTER_ARCHIVE, MAPDB_ARCHIVE]);
    for (const m of this.editableMaps()) {
      const s = this.tilesetSource(m.dungeon);
      if (s.modelArchive !== '00000000') out.add(s.modelArchive);
      if (s.textureArchive !== '00000000') out.add(s.textureArchive);
      const ev = this.master.eventArchive(m.dungeon);
      if (ev) out.add(hex8(ev));
    }
    for (let i = 1; i < this.master.mapObject.rows; i++) {
      const o = this.master.objectModel(i);
      if (o) out.add(hex8(o.archive));
    }
    const have = new Set(this.dump.names());
    return [...out].filter((n) => have.has(n));
  }
}
