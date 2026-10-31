// Everything the editor reads from a dump (docs/map-editor-design.md §4).
import { findByName, findEntry, parseArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { overlayDump, type BaseMod, type Dump } from '../rom/dump';
import { switchPatchVersion } from '../rom/ips';
import { hex8, u32 } from '../util/bytes';
import { idbGet, idbSet } from '../util/idb';
import { CodeBin, type MapInfo } from './codebin';
import { EventTable } from './events';
import type { CodePatch } from './patch';
import { MapDb, MAPDB_ARCHIVE, MAPDB_ENTRY } from './mapdb';
import { Master, MASTER_ARCHIVE, TILESETS, type MapRef } from './master';
import { isIndoor } from './objects';
import { MonsterBook, MONSTER_DESIGN_ARCHIVE, MONSTER_MODEL_ARCHIVE } from './monsters';
import { ITEM_MODEL_ARCHIVES, SHOP_ARCHIVE } from './items';
import { loadDoc, type MapDoc } from './sections';
import { groundFromTiles, parseEntrances, parseGround, type Ground, type WorldInfo, type WorldPart } from './worldmap';
import { BCSAR_PATH, bcsarSoundNames, SoundNames, type SoundRows } from './sound';
import { SoundArchive } from '../sound/formats';
import { SoundRenderer } from '../sound/render';

export interface TilesetSource {
  /** mapResource row. */
  resource: number;
  tileset: number;
  modelArchive: string;
  textureArchive: string;
  textureEntry: number;
}

/** What the game needs of the ported sounds (port/sounds.ts). */
export interface SoundPorts {
  /** sound.bcsar as the game has it. */
  originalBcsar(): Promise<Uint8Array>;
  /** Names of the ported sounds, in their order after the game's own. */
  names(): string[];
}

export class Game {
  readonly code: CodeBin;
  master: Master;
  /** Master archive bytes the export starts from (the ROM's, or an existing MOD's 56562135). */
  masterBytes: Uint8Array;
  masterLabel = 'ROM';
  /** MOD the edits are built on (elpulse mod/out), or null. */
  baseMod: BaseMod | null = null;
  /** Version of the generic switch patch in code.bin (0 = none; docs/events.md §7). */
  switchVersion = 0;
  /** Code patches (game/patch.ts), exported in code.ips when enabled. */
  codePatches: CodePatch[] = [];
  /** Whether the export writes Panana's code MOD "ドロップ率の天井を撤廃" (game/dropcap.ts) to code.ips. */
  dropCap = false;
  /** The Lv difference of Panana's code MOD "レベルステルス" (game/levelstealth.ts) written to code.ips, or 0 when it is off. */
  levelStealth = 0;
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

  /** Load from a dump, optionally with a base MOD on top (its RomFS files and code.ips). */
  static async load(raw: Dump, baseMod: BaseMod | null = null): Promise<Game> {
    const dump = baseMod ? overlayDump(raw, baseMod) : raw;
    const [master, db] = await Promise.all([dump.readRomfs(MASTER_ARCHIVE), dump.readRomfs(MAPDB_ARCHIVE)]);
    const g = new Game(dump, master, db);
    g.baseMod = baseMod;
    g.switchVersion = switchPatchVersion(dump.code);
    if (baseMod) g.masterLabel = baseMod.romfs.has(MASTER_ARCHIVE) ? baseMod.label : 'ROM';
    return g;
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

  /** RomFS root files made by the editor (the event archives of new dungeons): name -> bytes. Exported as they are. */
  readonly addedFiles = new Map<string, Uint8Array>();

  /** A root RomFS file: one made by the editor, else the dump's (with the base MOD's). */
  readFile(name: string): Promise<Uint8Array> {
    const f = this.addedFiles.get(name.toUpperCase());
    return f ? Promise.resolve(f.slice()) : this.dump.readRomfs(name);
  }

  /** Entrances of a world map as edited (the session replaces this; validate.ts uses it). */
  entrances: (w: WorldInfo) => Uint8Array[] = (w) => parseEntrances(this.db.get(w.sections[2]!));

  private readonly events = new Map<number, Promise<EventTable | null>>();

  /** Read a dungeon's EventObject table again next time (its mapGroup row changed: a new dungeon). */
  forgetEvents(dungeon: number): void {
    this.events.delete(dungeon);
  }

  /** EventObject table of a dungeon (null when it has none). */
  eventTable(dungeon: number): Promise<EventTable | null> {
    let p = this.events.get(dungeon);
    if (!p) {
      const a = this.master.eventArchive(dungeon);
      p = a
        ? this.readFile(hex8(a))
            .then((b) => EventTable.fromArchive(dungeon, this.master.mapGroup.row(dungeon)[0x1c]!, hex8(a), b))
            .catch(() => null)
        : Promise.resolve(null);
      this.events.set(dungeon, p);
    }
    return p;
  }

  private monsterBook: Promise<MonsterBook> | null = null;

  /** Monsters and encounter groups (needs MonsterDesign from 2713402F). */
  monsters(): Promise<MonsterBook> {
    this.monsterBook ??= this.dump.readRomfs(MONSTER_DESIGN_ARCHIVE).then((b) => new MonsterBook(this.master, b));
    return this.monsterBook;
  }

  private soundNames: Promise<SoundNames> | null = null;

  /** The BGMs ported from other games (port/sounds.ts), once installed on the dump. */
  soundPorts: SoundPorts | null = null;

  /**
   * Names of soundData rows (from sound/sound.bcsar when the dump has it, the game's own cached by name only, then the
   * ported ones). The rows are read from soundData as it is now.
   */
  sounds(): Promise<SoundNames> {
    this.soundNames ??= (async () => {
      const t = this.master.table('soundData.bin');
      const rows: SoundRows = {
        get count() {
          return t.rows;
        },
        item: (r) => u32(t.row(r), 0),
        volume: (r) => (t.rowSize >= 0xc ? u32(t.row(r), 8) : 0),
      };
      return new SoundNames(rows, await this.soundNameList());
    })();
    return this.soundNames;
  }

  private async soundNameList(): Promise<string[] | null> {
    const key = 'sound/names/v1';
    let names = (await idbGet<string[]>(key).catch(() => undefined)) ?? null;
    if (!names)
      try {
        names = bcsarSoundNames(await (this.soundPorts ? this.soundPorts.originalBcsar() : this.dump.readRomfs(BCSAR_PATH)));
        await idbSet(key, names).catch(() => {});
      } catch {
        return null;
      }
    return this.soundPorts ? [...names, ...this.soundPorts.names()] : names;
  }

  /** Sounds were ported: the names and the player read sound.bcsar again. */
  async soundsChanged(): Promise<void> {
    this.renderer = null;
    if (this.soundNames) (await this.soundNames).setNames(await this.soundNameList());
  }

  private renderer: Promise<SoundRenderer> | null = null;

  /** Plays the sounds of sound/sound.bcsar (read when first needed; its streams from sound/stream/). */
  soundRenderer(): Promise<SoundRenderer> {
    this.renderer ??= this.dump.readRomfs(BCSAR_PATH).then(
      (b) => new SoundRenderer(new SoundArchive(b), (path) => this.dump.readRomfs(`sound/${path}`)),
      (err: Error) => {
        this.renderer = null;
        throw new Error(`${BCSAR_PATH} を読めません (${err.message})`);
      },
    );
    return this.renderer;
  }

  /** Reads a root archive again next time (a port added entries to it). */
  forgetArchive(name: string): void {
    this.archives.delete(name);
  }

  archive(name: string): Promise<Archive> {
    let a = this.archives.get(name);
    if (!a) {
      a = this.dump.readRomfs(name).then(parseArchive);
      this.archives.set(name, a);
    }
    return a;
  }

  /** Dungeon maps (D, K, S... that have tiles, and the added ones), grouped for the map list. */
  editableMaps(): MapInfo[] {
    // The list groups the maps by dungeon, so the added ones (at the end of code.maps) show up in their dungeon.
    return this.code.maps.filter((m) => m.dungeon >= 0 && (m.added || this.db.get(m.sections[0]!).length > 0));
  }

  /** World maps with entrances (section 2) in the map DB. */
  worldMaps(): WorldInfo[] {
    return this.code.worlds.filter((w) => this.db.get(w.sections[2]!).length > 0);
  }

  private readonly grounds = new Map<number, Ground | null>();

  /** Terrain of a world map (Wxx_ground.bin of the master archive, or section 0 for W98 / W99), or null. */
  ground(w: WorldInfo): Ground | null {
    if (!this.grounds.has(w.hash)) {
      let g: Ground | null = null;
      if (w.groundFile) {
        const arc = this.master.archive;
        const e = findEntry(arc, w.groundEntry);
        const body = findByName(arc, w.groundFile)?.body ?? (e ? unpackEntry(arc, e).body : null);
        g = body ? parseGround(body) : null;
      } else if (this.db.get(w.sections[0]!).length) g = groundFromTiles(this.db.get(w.sections[0]!));
      this.grounds.set(w.hash, g);
    }
    return this.grounds.get(w.hash)!;
  }

  private parts: WorldPart[] | undefined;

  /** worldmapParts (docs/worldmap.md §4): the model (archive D98F0E82), the flags and the entrances' mapObject row. */
  worldParts(): WorldPart[] {
    if (this.parts === undefined) {
      this.parts = [];
      for (const name of ['worldmapParts.bin', 'WorldmapParts.bin']) {
        try {
          const t = this.master.table(name);
          this.parts = Array.from({ length: t.rows }, (_, i) => {
            const r = t.row(i);
            return { row: i, model: u32(r, 0), flags: r[4] ?? 0, object: r[8] ?? 0 };
          });
          break;
        } catch {
          /* try the next name */
        }
      }
    }
    return this.parts;
  }

  private partFlags: Uint8Array | null | undefined;

  /** worldmapParts +4 flags per row (null when the table is not found). docs/worldmap.md §4. */
  worldPartFlags(): Uint8Array | null {
    if (this.partFlags === undefined) {
      this.partFlags = null;
      for (const name of ['worldmapParts.bin', 'WorldmapParts.bin']) {
        try {
          const t = this.master.table(name);
          this.partFlags = Uint8Array.from({ length: t.rows }, (_, i) => t.row(i)[4] ?? 0);
          break;
        } catch {
          /* try the next name */
        }
      }
    }
    return this.partFlags;
  }

  doc(info: MapInfo): MapDoc {
    return loadDoc(this.db, info);
  }

  /** What picks the map's mapData row, with the indoor flag from its tiles (the edited doc when given). */
  mapRef(info: MapInfo, doc: MapDoc = this.doc(info)): MapRef {
    return { hash: info.hash, dungeon: info.dungeon, mapDataKey: info.mapDataKey, indoor: isIndoor(doc) };
  }

  /** Where the tile models of a map come from; `tileset` shows the map with another tileset (default: its own). */
  tilesetSource(map: MapRef, tileset = this.master.tileset(map)): TilesetSource {
    const resource = this.master.tilesetResource(tileset, map);
    const a = this.master.resourceArchives(resource);
    return {
      resource,
      tileset,
      modelArchive: hex8(a[0]!),
      textureArchive: hex8(a[1]!),
      textureEntry: a[2]!,
    };
  }

  /** Root RomFS files the editor needs for every dungeon (to cache them). */
  neededFiles(): string[] {
    const out = new Set([MASTER_ARCHIVE, MAPDB_ARCHIVE, MONSTER_DESIGN_ARCHIVE, SHOP_ARCHIVE, MONSTER_MODEL_ARCHIVE, ...ITEM_MODEL_ARCHIVES]);
    for (const m of this.editableMaps()) {
      const ref = this.mapRef(m);
      // Every tileset (the editor can show a map with another one).
      for (let t = 0; t < TILESETS; t++) {
        const s = this.tilesetSource(ref, t);
        if (s.modelArchive !== '00000000') out.add(s.modelArchive);
        if (s.textureArchive !== '00000000') out.add(s.textureArchive);
      }
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

