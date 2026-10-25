// One opened dump: the game, the editing state shared by every page, the books, and the saving and restoring of
// edits (IndexedDB).
import { EditorState } from './editor/state';
import { mapLabel } from './editor/labels';
import type { MapInfo } from './game/codebin';
import type { EventTable } from './game/events';
import type { CodePatch } from './game/patch';
import type { Game } from './game/game';
import { ItemBook } from './game/items';
import { MapDb } from './game/mapdb';
import type { MonsterBook } from './game/monsters';
import { makeMap, type NewMapSpec } from './game/newmap';
import { makeDungeon, type NewDungeonSpec } from './game/newdungeon';
import type { AddedDungeon } from './game/mappatch';
import { loadDoc, sectionBytes, type MapDoc } from './game/sections';
import { ShopStock } from './game/shops';
import type { SoundNames } from './game/sound';
import { buildEntrances, buildGround, parseEntrances, type Ground, type WorldInfo } from './game/worldmap';
import { findByName, findEntry, unpackEntry, type ArcEntry } from './archive/gsarc';
import { equalBytes } from './util/bytes';
import { idbGet, idbSet } from './util/idb';

const TABLE_LABELS: Record<string, string> = { 'monsterParameter.bin': 'モンスターの能力', 'monsterGroup.bin': 'モンスターの群れ', 'itemData.bin': 'アイテム', 'mapData.bin': 'マップの設定 (BGM・足音)', 'soundData.bin': '音', 'monsterFixGroup.bin': 'ボス戦の敵 (固定の組)', 'mapChara.bin': 'マップのキャラ (ボスの姿)', 'actionData.bin': 'アクション (ワザ)', 'mapGroup.bin': 'ダンジョンの設定' };
export const tableLabel = (name: string): string => TABLE_LABELS[name] ?? name;
const EDITS_KEY = 'edits/v2';

export interface ItemData {
  items: ItemBook;
  stock: ShopStock | null;
}

export class Session {
  readonly st: EditorState;
  /** Items and what each shop sells, shared by the item book and the shop list (built on first use). */
  private itemData: Promise<ItemData> | null = null;
  /** The shop lists, once the item data was read (nothing to save or export before). */
  stock: ShopStock | null = null;
  private saveTimer = 0;
  /** Edited entrances (section 2) of the world maps, by map ID. */
  readonly worldEdits = new Map<number, Uint8Array[]>();
  /** Edited terrains of the world maps with a Wxx_ground.bin (W01 / W02), by map ID. */
  readonly groundEdits = new Map<number, Ground>();

  private constructor(
    readonly game: Game,
    readonly book: MonsterBook | null,
    readonly sounds: SoundNames | null,
  ) {
    this.st = new EditorState(game);
    game.entrances = this.entrancesOf;
  }

  /** Reads the books and restores the saved edits (asking first unless `autoRestore`). */
  static async open(game: Game, autoRestore = false): Promise<Session> {
    const [book, sounds] = await Promise.all([
      game.monsters().catch((err) => {
        console.warn('monsters', err);
        return null;
      }),
      game.sounds(),
    ]);
    const s = new Session(game, book, sounds);
    await s.restoreEdits(autoRestore);
    return s;
  }

  /** The map as edited so far (or as in the game). */
  readonly docOf = (m: MapInfo): MapDoc => this.st.docs.get(m.hash) ?? this.game.doc(m);
  /** The event table of a dungeon as edited so far. */
  readonly eventsOf = async (d: number): Promise<EventTable | null> => this.st.events.get(d) ?? this.game.eventTable(d);

  /** Entrances of a world map as in the game. */
  readonly originalEntrances = (w: WorldInfo): Uint8Array[] => parseEntrances(this.game.db.get(w.sections[2]!));
  /** Entrances of a world map as edited so far. */
  readonly entrancesOf = (w: WorldInfo): Uint8Array[] => this.worldEdits.get(w.hash) ?? this.originalEntrances(w);

  setEntrances(w: WorldInfo, list: Uint8Array[]): void {
    this.worldEdits.set(w.hash, list);
    this.scheduleSave();
  }

  /** World maps whose entrances differ from the game. */
  changedWorlds(): WorldInfo[] {
    return this.game.code.worlds.filter((w) => {
      const e = this.worldEdits.get(w.hash);
      return !!e && !equalBytes(buildEntrances(e), this.game.db.get(w.sections[2]!));
    });
  }

  /** The terrain of a world map as edited so far (null: none to read). */
  groundOf(w: WorldInfo): Ground | null {
    return this.groundEdits.get(w.hash) ?? this.game.ground(w);
  }

  /** Whether a world map's terrain can be edited (its Wxx_ground.bin is in the master). */
  groundEditable(w: WorldInfo): boolean {
    return !!this.groundEntry(w) && !!this.game.ground(w);
  }

  private readonly groundEntries = new Map<number, { entry: ArcEntry; body: Uint8Array } | null>();

  /** The master's Wxx_ground.bin of a world map (found once: the lookup unpacks the archive's entries). */
  private groundEntry(w: WorldInfo): { entry: ArcEntry; body: Uint8Array } | null {
    if (!w.groundFile) return null;
    if (!this.groundEntries.has(w.hash)) {
      const arc = this.game.master.archive;
      const e = findByName(arc, w.groundFile) ?? (() => {
        const x = findEntry(arc, w.groundEntry);
        return x ? { entry: x, body: unpackEntry(arc, x).body } : undefined;
      })();
      this.groundEntries.set(w.hash, e ?? null);
    }
    return this.groundEntries.get(w.hash)!;
  }

  /** Terrains edited since their master entry was last rebuilt. */
  private readonly groundsDirty = new Set<number>();

  /** Put an edited terrain in place (null = the ROM's); its master entry is rebuilt by {@link flushGrounds}. */
  setGround(w: WorldInfo, g: Ground | null): void {
    if (!this.groundEntry(w)) return;
    if (g) this.groundEdits.set(w.hash, g);
    else this.groundEdits.delete(w.hash);
    this.groundsDirty.add(w.hash);
    this.scheduleSave();
  }

  /** Rebuild the master's Wxx_ground.bin of the edited terrains (with their pools; before saving and exporting). */
  flushGrounds(): void {
    for (const h of this.groundsDirty) {
      const w = this.game.code.worlds.find((x) => x.hash === h);
      const f = w && this.groundEntry(w);
      if (!f) continue;
      const g = this.groundEdits.get(h);
      this.game.master.setRawEntry(f.entry, g ? buildGround(f.body, g) : f.body);
    }
    this.groundsDirty.clear();
  }

  /** World maps whose terrain differs from the ROM's. */
  changedGrounds(): WorldInfo[] {
    return this.game.code.worlds.filter((w) => {
      const e = this.groundEdits.get(w.hash), o = this.game.ground(w);
      return !!e && !!o && (!equalBytes(e.parts, o.parts) || !equalBytes(e.rots, o.rots));
    });
  }

  /** Map DB entries to replace for the edited world maps: [section hash, bytes]. */
  worldSections(): [number, Uint8Array][] {
    return this.changedWorlds().map((w) => [w.sections[2]!, buildEntrances(this.entrancesOf(w))]);
  }

  /** Add a new map to a dungeon (docs/new-map.md): it is written to code.bin (code.ips) and the map DB by the export. */
  addMap(spec: NewMapSpec): MapInfo {
    const { info, doc } = makeMap(this.game, spec);
    this.game.code.addMap(info);
    this.st.docs.set(info.hash, doc);
    this.saveNow();
    return this.game.code.byHash(info.hash)!;
  }

  /**
   * Add a new dungeon (game/newdungeon.ts) with its first map, made like {@link addMap} from a map of any dungeon.
   * The mapGroup row, the name message and the event archive are saved with the other edits.
   */
  async addDungeon(spec: NewDungeonSpec, first: Omit<NewMapSpec, 'dungeon' | 'newDungeonCode'>): Promise<MapInfo> {
    const game = this.game;
    const mg = game.master.mapGroup;
    const before = mg.data.slice();
    const nd = await makeDungeon(game, spec, new Set([...game.dump.names(), ...game.addedFiles.keys()]));
    let map: { info: MapInfo; doc: MapDoc };
    try {
      map = makeMap(game, { ...first, dungeon: nd.dungeon, newDungeonCode: nd.code });
    } catch (e) {
      mg.data = before;
      game.master.texts.removeAdded(nd.nameId);
      throw e;
    }
    game.addedFiles.set(nd.archiveName, nd.archive);
    game.forgetEvents(nd.dungeon);
    game.code.addDungeon({ dungeon: nd.dungeon, code: nd.code });
    game.code.addMap(map.info);
    this.st.docs.set(map.info.hash, map.doc);
    this.saveNow();
    return game.code.byHash(map.info.hash)!;
  }

  items(): Promise<ItemData> {
    this.itemData ??= ShopStock.load(this.game)
      .catch(() => null)
      .then((stock) => {
        this.stock = stock;
        return { items: new ItemBook(this.game, stock?.lists ?? new Map()), stock };
      });
    return this.itemData;
  }

  readonly scheduleSave = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  };

  saveNow(): void {
    clearTimeout(this.saveTimer);
    this.flushGrounds();
    const st = this.st;
    const maps: Record<number, Record<number, Uint8Array>> = {};
    for (const d of st.modifiedDocs()) {
      const secs: Record<number, Uint8Array> = {};
      for (const k of st.changedSections(d)) secs[k] = sectionBytes(d, k);
      maps[d.hash] = secs;
    }
    const events: Record<number, Uint8Array> = {};
    for (const [d, t] of st.events) if (t.changed()) events[d] = t.data;
    const master = this.game.master;
    const tables: Record<string, Uint8Array> = {};
    for (const n of master.changedTables()) tables[n] = master.table(n).data;
    const shops = this.stock?.saved() ?? [];
    const worlds: Record<number, Uint8Array> = {};
    for (const w of this.changedWorlds()) worlds[w.hash] = buildEntrances(this.entrancesOf(w));
    const grounds: Record<number, Uint8Array> = {};
    for (const w of this.changedGrounds()) {
      const g = this.groundEdits.get(w.hash)!;
      const b = new Uint8Array(g.parts.length * 2);
      b.set(g.parts);
      b.set(g.rots, g.parts.length);
      grounds[w.hash] = b;
    }
    const added = this.game.code
      .addedMaps()
      .map(({ hash, name, dungeon, dungeonCode, floor, mapDataKey, sections, extra }) => ({ hash, name, dungeon, dungeonCode, floor, mapDataKey, sections, extra }));
    const dungeons: AddedDungeon[] = this.game.code.dungeons.map(({ dungeon, code }) => ({ dungeon, code }));
    const files: Record<string, Uint8Array> = Object.fromEntries(this.game.addedFiles);
    const patches = this.game.codePatches;
    const direct = this.book?.directChanged() ? this.book.directData!.data : null;
    idbSet(EDITS_KEY, { added, dungeons, files, worlds, grounds, maps, events, treasure: master.treasureChanged() ? master.treasureGroup.data : null, tables, messages: master.texts.saved(), shops, patches, ...(this.game.dropCap ? { dropCap: true } : {}), direct, design: this.book?.designChanged() ? this.book.designData() : null });
  }

  private async restoreEdits(auto: boolean): Promise<void> {
    type Saved = {
      maps: Record<number, Record<number, Uint8Array>>;
      events: Record<number, Uint8Array>;
      treasure: Uint8Array | null;
      tables?: Record<string, Uint8Array>;
      messages?: [number, Uint16Array][];
      shops?: [number, number[]][];
      worlds?: Record<number, Uint8Array>;
      /** Terrains of the world maps: parts then rotations (300 x 300 each). */
      grounds?: Record<number, Uint8Array>;
      added?: MapInfo[];
      /** New dungeons (game/newdungeon.ts) and the RomFS files made for them (their event archives). */
      dungeons?: AddedDungeon[];
      files?: Record<string, Uint8Array>;
      patches?: CodePatch[];
      /** Panana's code MOD "ドロップ率の天井を撤廃" is on (game/dropcap.ts). */
      dropCap?: boolean;
      /** monsterDesign.bin (2713402F) when monsters got a design of their own. */
      design?: Uint8Array | null;
      /** directData of 2713402F (the performances of the actions), when edited. */
      direct?: Uint8Array | null;
    };
    const edits = await idbGet<Saved>(EDITS_KEY);
    if (!edits) return;
    const game = this.game;
    // New dungeons and maps first: the names below and the saved sections refer to them.
    const dungeons = (edits.dungeons ?? []).filter((d) => !game.code.dungeons.some((x) => x.dungeon === d.dungeon));
    for (const d of dungeons) game.code.addDungeon(d);
    const added = (edits.added ?? []).filter((m) => !game.code.byHash(m.hash));
    for (const m of added) game.code.addMap(m);
    const names = Object.keys(edits.maps).map((h) => mapLabel(game, Number(h)));
    const nEvents = Object.keys(edits.events).length;
    const tables = Object.keys(edits.tables ?? {});
    const nMessages = edits.messages?.length ?? 0;
    const nShops = edits.shops?.length ?? 0;
    const worlds = Object.keys(edits.worlds ?? {}).map((h) => mapLabel(game, Number(h)));
    const grounds = Object.keys(edits.grounds ?? {}).map((h) => mapLabel(game, Number(h)));
    const nPatches = edits.patches?.length ?? 0;
    const direct = edits.direct && this.book?.directData ? edits.direct : null;
    if (!names.length && !nEvents && !edits.treasure && !tables.length && !nMessages && !nShops && !worlds.length && !grounds.length && !nPatches && !edits.dropCap && !direct && !edits.design) return;
    const what = [names.join(', '), worlds.map((w) => `${w} の入口`).join(', '), grounds.map((w) => `${w} の地形`).join(', '), nEvents ? `イベントの表 ${nEvents} 個` : '', edits.treasure ? '宝箱の中身' : '', tables.map(tableLabel).join(', '), edits.design ? 'モンスターのデザイン' : '', nMessages ? `メッセージ ${nMessages} 個` : '', nShops ? `店の品揃え ${nShops} 店` : '', nPatches ? `コードのパッチ ${nPatches} 個` : '', edits.dropCap ? 'ドロップ率の天井の撤廃' : '', direct ? 'ワザの演出' : ''].filter(Boolean).join(' / ');
    if (!auto && !confirm(`前回の編集が残っています (${what})。読み込みますか?\n「キャンセル」で破棄します。`)) {
      game.code.removeMaps(added.map((m) => m.hash));
      for (const d of dungeons) game.code.removeDungeon(d.dungeon);
      await idbSet(EDITS_KEY, null);
      return;
    }
    for (const [name, bytes] of Object.entries(edits.files ?? {})) game.addedFiles.set(name.toUpperCase(), bytes);
    // The new dungeons' mapGroup rows name their event archives (read below).
    if (edits.tables?.['mapGroup.bin']) game.master.restoreTable('mapGroup.bin', edits.tables['mapGroup.bin']);
    for (const d of dungeons) game.forgetEvents(d.dungeon);
    const tmp = new MapDb(game.dbBytes);
    for (const [hash, secs] of Object.entries(edits.maps)) {
      const info = game.code.byHash(Number(hash));
      if (!info) continue;
      for (const [k, bytes] of Object.entries(secs)) {
        const h = info.sections[Number(k)]!;
        if (tmp.has(h)) tmp.set(h, bytes);
        else tmp.add(h, bytes); // a section of a new map
      }
      this.st.docs.set(info.hash, loadDoc(tmp, info));
    }
    for (const [hash, bytes] of Object.entries(edits.worlds ?? {})) {
      if (game.code.world(Number(hash))) this.worldEdits.set(Number(hash), parseEntrances(bytes));
    }
    for (const [hash, bytes] of Object.entries(edits.grounds ?? {})) {
      const w = game.code.worlds.find((x) => x.hash === Number(hash));
      const n = bytes.length / 2;
      if (w && this.groundEditable(w) && n === this.game.ground(w)!.parts.length) this.setGround(w, { parts: bytes.slice(0, n), rots: bytes.slice(n) });
    }
    this.flushGrounds();
    for (const [d, bytes] of Object.entries(edits.events)) {
      const t = await game.eventTable(Number(d));
      if (t) {
        t.restore(bytes);
        this.st.events.set(Number(d), t);
      }
    }
    if (edits.patches) game.codePatches = edits.patches;
    game.dropCap = !!edits.dropCap;
    if (edits.treasure) game.master.restoreTreasure(edits.treasure);
    for (const [n, bytes] of Object.entries(edits.tables ?? {})) game.master.restoreTable(n, bytes);
    if (edits.messages) game.master.texts.restore(edits.messages);
    if (direct) this.book!.restoreDirect(direct);
    if (edits.design) this.book?.restoreDesign(edits.design);
    if (tables.length || edits.design || nMessages) this.book?.reload();
    if (nShops) {
      const { items, stock } = await this.items(); // after the tables, so the items are read with their edits
      stock?.restore(edits.shops!);
      if (stock) items.setShops(stock.lists);
    }
  }
}
