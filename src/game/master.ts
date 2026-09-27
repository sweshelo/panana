// Master data archive 56562135: map tables (docs/map.md §4) and message files.
import { findByName, parseArchive, rebuildArchive, unpackEntry, type Archive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { equalBytes, u16, u32, w16 } from '../util/bytes';
import { Gmsg, MessageStore, type MessageFile } from './gmsg';

export const MASTER_ARCHIVE = '56562135';
export const TILESETS = 12;
export const LETTERS = 8;

/** What picks a map's mapData row (MapInfo satisfies it). */
export interface MapRef {
  hash: number;
  dungeon: number;
  /** mapData key of the map itself (0 = none; code.bin map row +0x10 at run time). */
  mapDataKey: number;
  /** The map has an indoor tile (kinds 15-27, run-time flag +0xA8CD; see isIndoor). */
  indoor?: boolean;
}

export class GmsgFile {
  readonly first: number;
  readonly last: number;
  constructor(private readonly data: Uint8Array) {
    if (String.fromCharCode(...data.subarray(0, 4)) !== 'GMSG') throw new Error('GMSG ではありません');
    this.first = u32(data, 8);
    this.last = u32(data, 12);
  }
  text(id: number): string | undefined {
    if (id < this.first || id > this.last) return undefined;
    const tbl = u32(this.data, 0x18);
    const base = u32(this.data, 0x1c);
    const i = id - this.first;
    const a = u32(this.data, tbl + i * 4);
    const b = id < this.last ? u32(this.data, tbl + i * 4 + 4) : this.data.length - base;
    let s = '';
    // the first unit is the type code (FUN_00310438 returns the position after it)
    for (let o = base + a + 2; o + 1 < base + b; o += 2) {
      const c = u16(this.data, o);
      if (c === 0) {
        if (s) break;
        continue; // some messages start with 0 (e.g. conditionData names)
      }
      if (c === 0x0a) s += ' ';
      else if (c >= 0x20 && !(c >= 0xe000 && c < 0xf900)) s += String.fromCharCode(c);
      else s += '\u0001';
    }
    // "[0001]'base[0001](ruby[0001])" -> base; drop the leading type code and other control codes.
    return s.replace(/\u0001'(.*?)\u0001\((.*?)\u0001\)/g, '$1').replace(/\u0001/g, '');
  }
}

export class Master {
  readonly archive: Archive;
  readonly mapGroup: GsTable;
  /** mapData.bin (edits to it are exported, like the tables of {@link table}). */
  readonly mapData: GsTable;
  readonly mapResource: GsTable;
  readonly mapParts: GsTable;
  /** Object models: {u32 archive, u32 model entry, f32 radius, ...} (runtime master +0x3D4). */
  readonly mapObject: GsTable;
  /** Characters: +0 flags (bit0-2 = 0: NPC), +8 u16 mapObject row (runtime master +0x32C). */
  readonly mapChara: GsTable;
  /** Treasure: 10 x {u16 item, u16 weight} (runtime master +0x310, FUN_00305dc8). */
  readonly treasureGroup: GsTable;
  private readonly treasureEntry: ArcEntry;
  private readonly treasureOriginal: Uint8Array;
  /** itemData.bin (edits to it are exported, like the tables of {@link table}). */
  readonly itemData: GsTable;
  private readonly messages: GmsgFile[] = [];
  /** The same message files, for editing (edited messages are exported with this archive). */
  readonly texts: MessageStore;

  constructor(bytes: Uint8Array) {
    this.archive = parseArchive(bytes);
    const table = (name: string): GsTable => {
      const f = findByName(this.archive, name);
      if (!f) throw new Error(`マスター (56562135) に ${name} がありません`);
      return new GsTable(f.body);
    };
    this.mapGroup = table('mapGroup.bin');
    this.mapResource = table('mapResource.bin');
    this.mapParts = table('mapParts.bin');
    this.mapObject = table('mapObject.bin');
    this.mapChara = this.table('mapChara.bin');
    const tg = findByName(this.archive, 'treasureGroup.bin');
    if (!tg) throw new Error('マスター (56562135) に treasureGroup.bin がありません');
    this.treasureEntry = tg.entry;
    this.treasureOriginal = tg.body.slice();
    this.treasureGroup = new GsTable(tg.body);
    this.itemData = this.table('itemData.bin');
    this.mapData = this.table('mapData.bin');
    const gmsgs: MessageFile[] = [];
    for (const e of this.archive.entries) {
      if (e.type !== 6) continue;
      const { name, body } = unpackEntry(this.archive, e);
      if (name && /_JP\.gsmb$/.test(name)) {
        try {
          this.messages.push(new GmsgFile(body));
        } catch {
          /* other variants */
        }
      }
      try {
        const gmsg = new Gmsg(body);
        gmsgs.push({ name: name ?? `エントリ ${e.index}`, entryIndex: e.index, gmsg, editable: gmsg.roundTrips() });
      } catch {
        /* not a message file */
      }
    }
    this.texts = new MessageStore(gmsgs);
  }

  /** Any other table of the archive (e.g. 'monsterParameter.bin'); edits to it are exported. */
  table(name: string): GsTable {
    let t = this.extra.get(name);
    if (!t) {
      const f = findByName(this.archive, name);
      if (!f) throw new Error(`マスター (56562135) に ${name} がありません`);
      t = { table: new GsTable(f.body), entry: f.entry, original: f.body.slice() };
      this.extra.set(name, t);
    }
    return t.table;
  }
  private readonly extra = new Map<string, { table: GsTable; entry: ArcEntry; original: Uint8Array }>();

  /** Names of the tables (besides treasureGroup) that differ from the archive. */
  changedTables(): string[] {
    return [...this.extra].filter(([, t]) => !equalBytes(t.table.data, t.original)).map(([n]) => n);
  }

  /** Original bytes of a row of a table (before any edit). */
  originalRow(name: string, row: number): Uint8Array {
    const t = this.table(name);
    const o = t.offset + row * t.rowSize;
    return this.extra.get(name)!.original.subarray(o, o + t.rowSize);
  }

  /** Rows of a table in the archive (rows past it were appended by an edit). */
  originalRows(name: string): number {
    this.table(name);
    return u32(this.extra.get(name)!.original, 0);
  }

  restoreTable(name: string, bytes: Uint8Array): void {
    this.table(name).data = bytes.slice();
  }

  /** Anything to export in this archive. */
  changed(): boolean {
    return this.treasureChanged() || this.changedTables().length > 0;
  }

  /** mapData [4] = field BGM, [5] = battle BGM, [6] = footsteps (soundData rows) of a map. */
  sounds(map: MapRef): { bgm: number; battle: number; steps: number } {
    const r = this.mapData.row(this.mapDataRow(map));
    return { bgm: r[4]!, battle: r[5]!, steps: r[6]! };
  }

  /** Set a sound of a mapData row ([4] field BGM, [5] battle BGM, [6] footsteps; a soundData row). */
  setSound(mapDataRow: number, slot: 'bgm' | 'battle' | 'steps', soundRow: number): void {
    this.mapData.row(mapDataRow)[{ bgm: 4, battle: 5, steps: 6 }[slot]] = soundRow;
  }

  message(id: number): string | undefined {
    const t = this.texts.plain(id);
    if (t !== undefined) return t;
    for (const m of this.messages) {
      const t = m.text(id);
      if (t !== undefined) return t;
    }
    return undefined;
  }

  /** mapGroup +0x14 is a u16 message ID (+0x16 is another field, non-zero for K / M / S rows). */
  dungeonName(dungeon: number): string {
    if (dungeon < 0 || dungeon >= this.mapGroup.rows) return '';
    return this.message(u16(this.mapGroup.row(dungeon), 0x14)) ?? '';
  }

  /** Event archive of a dungeon (mapGroup +0x0C; holds dXX_EventObject.bin). */
  eventArchive(dungeon: number): number {
    if (dungeon < 0 || dungeon >= this.mapGroup.rows) return 0;
    return u32(this.mapGroup.row(dungeon), 0x0c);
  }

  /** 10 slots of a treasureGroup row. */
  treasureSlots(row: number): { item: number; weight: number }[] {
    if (row < 0 || row >= this.treasureGroup.rows) return [];
    const r = this.treasureGroup.row(row);
    return Array.from({ length: 10 }, (_, i) => ({ item: u16(r, i * 4), weight: u16(r, i * 4 + 2) }));
  }

  setTreasureSlot(row: number, slot: number, item: number, weight: number): void {
    const r = this.treasureGroup.row(row);
    w16(r, slot * 4, item);
    w16(r, slot * 4 + 2, weight);
  }

  /** Append a treasureGroup row (its hash goes to the table's index). Returns the row number. */
  addTreasureRow(slots: { item: number; weight: number }[]): number {
    const t = this.treasureGroup;
    const row = new Uint8Array(t.rowSize);
    for (let i = 0; i < 10; i++) {
      const s = slots[i] ?? { item: 0, weight: 1 };
      w16(row, i * 4, s.item);
      w16(row, i * 4 + 2, s.weight);
    }
    const used = t.hashes();
    let hash = (0x7e500000 + t.rows) >>> 0;
    while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
    return t.append(row, hash);
  }

  restoreTreasure(bytes: Uint8Array): void {
    this.treasureGroup.data = bytes.slice();
  }

  treasureChanged(): boolean {
    return !equalBytes(this.treasureGroup.data, this.treasureOriginal);
  }

  treasureRowChanged(row: number): boolean {
    const o = this.treasureGroup.offset + row * this.treasureGroup.rowSize;
    if (o + this.treasureGroup.rowSize > this.treasureOriginal.length || row >= u32(this.treasureOriginal, 0)) return true;
    return !equalBytes(this.treasureGroup.row(row), this.treasureOriginal.subarray(o, o + this.treasureGroup.rowSize));
  }

  /** This master archive with the edited tables re-packed (every other entry copied verbatim). */
  buildArchive(): Uint8Array {
    const repl = new Map([[this.treasureEntry.index, this.treasureGroup.data]]);
    for (const [, t] of this.extra) if (!equalBytes(t.table.data, t.original)) repl.set(t.entry.index, t.table.data);
    for (const [i, b] of this.texts.replacements()) repl.set(i, b);
    // new messages: a message file of their own, packed like the archive's other message files
    const add = this.texts.newFile();
    const like = this.archive.entries[this.texts.files[0]?.entryIndex ?? -1];
    return rebuildArchive(this.archive, repl, add && like ? [{ hash: add.hash, name: add.name, body: add.bytes, like }] : []);
  }

  itemName(id: number): string {
    if (id <= 0 || id >= this.itemData.rows) return '';
    return this.message(u32(this.itemData.row(id), 0x0c)) ?? '';
  }

  /** mapObject row -> {archive, entry} of its model (0 = none). */
  objectModel(row: number): { archive: number; entry: number } | null {
    if (row <= 0 || row >= this.mapObject.rows) return null;
    const r = this.mapObject.row(row);
    const archive = u32(r, 0);
    return archive ? { archive, entry: u32(r, 4) } : null;
  }

  /** mapData row of a dungeon (mapGroup +0x26; +0x27 for its indoor maps, e.g. the houses of a town). */
  dungeonMapDataRow(dungeon: number, indoor = false): number {
    if (dungeon < 0 || dungeon >= this.mapGroup.rows) return 0;
    return this.mapGroup.row(dungeon)[indoor ? 0x27 : 0x26]!;
  }

  /**
   * mapData row of a map, as FUN_001c4ec4 picks it: designedMap rows 1-5 (+0 map, +0x0C mapData row), else the
   * dungeon's (mapGroup +0x26, or +0x27 when the map is indoor: FUN_0021f9f4 has set +0xA8CD just before);
   * then the map's own mapData key wins.
   */
  mapDataRow(map: MapRef): number {
    let row = this.designedMapData().get(map.hash) ?? this.dungeonMapDataRow(map.dungeon, map.indoor);
    if (map.mapDataKey) {
      this.mapDataIndex ??= this.mapData.hashIndex();
      row = this.mapDataIndex.get(map.mapDataKey) ?? row;
    }
    return row < this.mapData.rows ? row : 0;
  }
  private mapDataIndex?: Map<number, number>;

  private designedMapData(): Map<number, number> {
    if (!this.designed) {
      this.designed = new Map();
      const f = findByName(this.archive, 'designedMap.bin');
      if (f) {
        const t = new GsTable(f.body);
        for (let i = 1; i < Math.min(t.rows, 6); i++) {
          const r = t.row(i);
          if (u32(r, 0)) this.designed.set(u32(r, 0), u32(r, 0x0c));
        }
      }
    }
    return this.designed;
  }
  private designed?: Map<number, number>;

  /** Tileset of a map = mapData[mapDataRow][0]. */
  tileset(map: MapRef): number {
    return this.mapData.row(this.mapDataRow(map))[0]!;
  }

  /** mapResource row of a map = mapData[...][1]. */
  resourceRow(map: MapRef): number {
    return this.mapData.row(this.mapDataRow(map))[1]!;
  }

  /**
   * mapResource row that holds the models of a tileset: the map's own when its tileset matches, else the first
   * mapData row with that tileset (and a model archive) gives it. The editor shows another tileset this way.
   */
  tilesetResource(tileset: number, map: MapRef): number {
    if (tileset === this.tileset(map)) return this.resourceRow(map);
    for (let i = 1; i < this.mapData.rows; i++) {
      const r = this.mapData.row(i);
      if (r[0] === tileset && r[1]! < this.mapResource.rows && this.modelArchive(r[1]!)) return r[1]!;
    }
    return this.resourceRow(map);
  }

  /** Model archive of a mapResource row ([0], e.g. 46910AB6). */
  modelArchive(resourceRow: number): number {
    return u32(this.mapResource.row(resourceRow), 0);
  }

  resourceArchives(resourceRow: number): number[] {
    const r = this.mapResource.row(resourceRow);
    const out: number[] = [];
    for (let i = 0; i + 4 <= r.length; i += 4) out.push(u32(r, i));
    return out;
  }

  /** Model hash of (tile kind, tileset, letter index); 0 = cannot be placed. */
  partModel(kind: number, tileset: number, letterIdx: number): number {
    const row = kind + 1;
    if (row < 0 || row >= this.mapParts.rows || tileset < 0 || tileset >= TILESETS) return 0;
    return u32(this.mapParts.row(row), 8 + tileset * 0x20 + letterIdx * 4);
  }

  /**
   * Tile kinds with a model: kind -> letter indices worth offering. Unused letters repeat the default
   * model in mapParts, so only letter 0 and letters with a different model are listed.
   */
  palette(tileset: number): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let kind = 0; kind + 1 < this.mapParts.rows; kind++) {
      const base = this.partModel(kind, tileset, 0);
      if (!base) continue;
      const letters = [0];
      const seen = new Set([base]);
      for (let l = 1; l < LETTERS; l++) {
        const h = this.partModel(kind, tileset, l);
        if (h && !seen.has(h)) {
          seen.add(h);
          letters.push(l);
        }
      }
      out.set(kind, letters);
    }
    return out;
  }
}
