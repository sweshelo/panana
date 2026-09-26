// One opened dump: the game, the editing state shared by every page, the books, and the saving and restoring of
// edits (IndexedDB).
import { EditorState } from './editor/state';
import { mapLabel } from './editor/labels';
import type { MapInfo } from './game/codebin';
import type { EventTable } from './game/events';
import type { Game } from './game/game';
import { ItemBook } from './game/items';
import { MapDb } from './game/mapdb';
import type { MonsterBook } from './game/monsters';
import { makeMap, type NewMapSpec } from './game/newmap';
import { loadDoc, sectionBytes, type MapDoc } from './game/sections';
import { ShopStock } from './game/shops';
import type { SoundNames } from './game/sound';
import { buildEntrances, parseEntrances, type WorldInfo } from './game/worldmap';
import { equalBytes } from './util/bytes';
import { idbGet, idbSet } from './util/idb';

const TABLE_LABELS: Record<string, string> = { 'monsterParameter.bin': 'モンスターの能力', 'monsterGroup.bin': 'モンスターの群れ', 'itemData.bin': 'アイテム' };
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

  private constructor(
    readonly game: Game,
    readonly book: MonsterBook | null,
    readonly sounds: SoundNames | null,
  ) {
    this.st = new EditorState(game);
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
    const added = this.game.code
      .addedMaps()
      .map(({ hash, name, dungeon, dungeonCode, floor, mapDataKey, sections, extra }) => ({ hash, name, dungeon, dungeonCode, floor, mapDataKey, sections, extra }));
    idbSet(EDITS_KEY, { added, worlds, maps, events, treasure: master.treasureChanged() ? master.treasureGroup.data : null, tables, messages: master.texts.saved(), shops });
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
      added?: MapInfo[];
    };
    const edits = await idbGet<Saved>(EDITS_KEY);
    if (!edits) return;
    const game = this.game;
    // New maps first: the names below and the saved sections refer to them.
    const added = (edits.added ?? []).filter((m) => !game.code.byHash(m.hash));
    for (const m of added) game.code.addMap(m);
    const names = Object.keys(edits.maps).map((h) => mapLabel(game, Number(h)));
    const nEvents = Object.keys(edits.events).length;
    const tables = Object.keys(edits.tables ?? {});
    const nMessages = edits.messages?.length ?? 0;
    const nShops = edits.shops?.length ?? 0;
    const worlds = Object.keys(edits.worlds ?? {}).map((h) => mapLabel(game, Number(h)));
    if (!names.length && !nEvents && !edits.treasure && !tables.length && !nMessages && !nShops && !worlds.length) return;
    const what = [names.join(', '), worlds.map((w) => `${w} の入口`).join(', '), nEvents ? `イベントの表 ${nEvents} 個` : '', edits.treasure ? '宝箱の中身' : '', tables.map(tableLabel).join(', '), nMessages ? `メッセージ ${nMessages} 個` : '', nShops ? `店の品揃え ${nShops} 店` : ''].filter(Boolean).join(' / ');
    if (!auto && !confirm(`前回の編集が残っています (${what})。読み込みますか?\n「キャンセル」で破棄します。`)) {
      game.code.removeMaps(added.map((m) => m.hash));
      await idbSet(EDITS_KEY, null);
      return;
    }
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
    for (const [d, bytes] of Object.entries(edits.events)) {
      const t = await game.eventTable(Number(d));
      if (t) {
        t.restore(bytes);
        this.st.events.set(Number(d), t);
      }
    }
    if (edits.treasure) game.master.restoreTreasure(edits.treasure);
    for (const [n, bytes] of Object.entries(edits.tables ?? {})) game.master.restoreTable(n, bytes);
    if (edits.messages) game.master.texts.restore(edits.messages);
    if (tables.length) this.book?.reload();
    if (nShops) {
      const { items, stock } = await this.items(); // after the tables, so the items are read with their edits
      stock?.restore(edits.shops!);
      if (stock) items.setShops(stock.lists);
    }
  }
}
