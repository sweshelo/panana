// Tables in code.bin (v1.1.0, flat binary with base address 0x100000). docs/map.md §0-§2.
import { cstr, s32, u32 } from '../util/bytes';
import { readWorldTable, type WorldInfo } from './worldmap';

export * from './codeconst';
import { BASE, MAP_DATA_KEYS, MAP_DATA_NONE, MAP_ROWS, MAP_SECTIONS, MAP_SECTIONS_ROWS, MAP_TABLE, MAP_TABLE_ROWS, PROBE_MAP } from './codeconst';
import { readExtension } from './mappatch';

export interface MapInfo {
  hash: number;
  name: string; // "D01B02001"
  dungeon: number; // mapGroup row
  dungeonCode: string; // "D01"
  floor: number;
  /**
   * mapData key of the map (map row +0x10 at run time; 0 = none). When set, the map uses that mapData row
   * (tileset, textures, BGM) instead of its dungeon's (e.g. デンパ島のどうくつ inside 海底トンネル).
   */
  mapDataKey: number;
  /** Section 0..9 hashes (section 0 = the map hash). */
  sections: number[];
  /** Map row +0x14 (u32; the low byte goes to the map runtime +0xA8CB). */
  extra: number;
  /** Added by the editor (PNMP extension of code.bin or this session), not in the game. docs/new-map.md. */
  added?: boolean;
}

export class CodeBin {
  /** Every map: the 205 of 0x4C1A74 in table order, then the added ones. */
  readonly maps: MapInfo[];
  /** World maps (their own section table; not in {@link maps}). docs/worldmap.md. */
  readonly worlds: WorldInfo[];
  constructor(readonly code: Uint8Array) {
    const at = (addr: number): number => addr - BASE;
    if (code.length < at(MAP_TABLE) + MAP_TABLE_ROWS * 16) throw new Error('code.bin が短すぎます');
    const str = (ptr: number): string => {
      if (ptr < BASE || ptr >= BASE + code.length) throw new Error('code.bin: 文字列のポインタが範囲外です (バージョン違い?)');
      return cstr(code, at(ptr));
    };
    const sections = new Map<number, number[]>();
    for (let i = 0; i < MAP_SECTIONS_ROWS; i++) {
      const o = at(MAP_SECTIONS) + i * 40;
      const row: number[] = [];
      for (let k = 0; k < 10; k++) row.push(u32(code, o + k * 4));
      sections.set(row[0]!, row);
    }
    const ext = readExtension(code);
    const added = new Set<number>();
    for (const row of ext?.sections ?? []) {
      sections.set(row[0]!, row);
      added.add(row[0]!);
    }
    const none = u32(code, at(MAP_DATA_NONE));
    const mapDataKey = (row: number): number => {
      const k = (row - MAP_ROWS) / 0x1c;
      // Rows outside the table at 0x5204F4 were moved there by the extension, with the key already in +0x10.
      const inTable = k >= 0 && k < MAP_SECTIONS_ROWS && Number.isInteger(k);
      const key = inTable ? u32(code, at(MAP_DATA_KEYS) + k * 4) : u32(code, at(row) + 0x10);
      return key === none ? 0 : key;
    };
    const info = new Map<number, MapInfo>();
    for (let i = 0; i < MAP_TABLE_ROWS; i++) {
      const o = at(MAP_TABLE) + i * 16;
      const dungeon = u32(code, o);
      const dungeonCode = str(u32(code, o + 4));
      const n = u32(code, o + 8);
      const arr = u32(code, o + 12);
      for (let j = 0; j < n; j++) {
        const r = at(arr) + j * 0x1c;
        const hash = u32(code, r);
        const secs = sections.get(hash);
        if (!secs) continue;
        info.set(hash, {
          hash,
          name: str(u32(code, r + 0x18)),
          dungeon,
          dungeonCode,
          floor: s32(code, r + 4),
          mapDataKey: mapDataKey(arr + j * 0x1c),
          sections: secs,
          extra: u32(code, r + 0x14),
          ...(added.has(hash) ? { added: true } : {}),
        });
      }
    }
    if (!sections.has(PROBE_MAP) || info.get(PROBE_MAP)?.name !== 'D01B02001') {
      throw new Error('code.bin の表が v1.1.0 の位置にありません。v1.1.0 (TitleVersion 1040) のダンプを使ってください。');
    }
    // Table order of 0x4C1A74 (maps without a name keep "?").
    this.maps = [...sections.values()].map(
      (secs) =>
        info.get(secs[0]!) ?? {
          hash: secs[0]!,
          name: '?' + secs[0]!.toString(16).toUpperCase(),
          dungeon: -1,
          dungeonCode: '',
          floor: 0,
          mapDataKey: 0,
          sections: secs,
          extra: 0,
        },
    );
    this.worlds = readWorldTable(code, BASE);
  }

  /** World map of a map ID (A8654391 = W01 ...). */
  world(hash: number): WorldInfo | undefined {
    return this.worlds.find((w) => w.hash === hash);
  }

  /** Add a map made in the editor (it is written to code.bin by the export, docs/new-map.md). */
  addMap(info: MapInfo): void {
    if (this.byHash(info.hash)) throw new Error(`マップ ${info.name} はもうあります`);
    this.maps.push({ ...info, added: true });
  }

  /** Undo {@link addMap} (saved edits that were then thrown away). */
  removeMaps(hashes: number[]): void {
    for (const h of hashes) {
      const i = this.maps.findIndex((m) => m.hash === h && m.added);
      if (i >= 0) this.maps.splice(i, 1);
    }
  }

  /** Maps added by the editor (read from the PNMP extension, or added in this session). */
  addedMaps(): MapInfo[] {
    return this.maps.filter((m) => m.added);
  }

  byHash(hash: number): MapInfo | undefined {
    return this.maps.find((m) => m.hash === hash);
  }
  byName(name: string): MapInfo | undefined {
    return this.maps.find((m) => m.name.toUpperCase() === name.toUpperCase());
  }
}
