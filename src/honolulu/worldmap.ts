// 電波人間のRPG (初代)'s world map (naauao honolulu/worldmap.md): not a field to walk but the pier's 2D screen, the islands
// of PierData (49C917B7 エントリ 1, 10 rows fixed in the code) as icons on the sea of the lower screen. A row names the
// dungeon it goes to, its icon (one of 7 layouts), its position for each ship stage (0〜1 / 2 / 3) and the ship stage it
// needs. The telescope's frame shows a circle of the sea at stages 0〜2 and the whole screen at 3. The 3D islands of the
// base (物体 11〜20) do not read the positions, and their models are fixed by the row.
//
// The pictures come from the darc of the same archive (entry 0): the sea, the telescope's frames, the island icons.
import { unpackEntry } from '../archive/gsarc';
import type { MessageStore } from '../game/gmsg';
import type { TableRows } from '../game/tablerows';
import { readBclim, type Bclim } from '../layout/bclim';
import { readDarc } from '../layout/darc';
import type { Dump } from '../rom/dump';
import { HonoluluMaster } from './master';
import { HONOLULU_PIER_DATA, HONOLULU_PIER_ICONS } from './tables';

export const HONOLULU_PIER_ARCHIVE = '49C917B7';
export const HONOLULU_PIER_TABLE = HONOLULU_PIER_DATA.file;
/** The rows the code reads (`cmp r6, #0xa`); the menus have parts for no more. */
export const HONOLULU_PIER_ROWS = 10;

/** The lower screen: positions are from its middle, +x right, +y up (pixels). */
export const PIER_SCREEN = { width: 320, height: 240 } as const;

/** A circle the telescope shows (centre from the middle of the screen, +y up). */
export interface PierScope {
  x: number;
  y: number;
  r: number;
}

/** A position of the three ship stages: its fields, the stages that use it and the telescope's hole there. */
export interface PierStage {
  /** The ship stage shown (save variable 0x26). */
  stage: number;
  label: string;
  x: string;
  y: string;
  /** The stages that place the icons here. */
  stages: number[];
  /** undefined: no frame (the whole screen). */
  scope?: PierScope;
  /** The frame's picture (timg/): the hole of the circle. */
  telescope?: string;
}

/**
 * The three positions. Stages 0〜1 play pier_btm_Telescope_Small (its picture telescope_02, a hole of radius about 81),
 * 2 _Big (telescope_01, about 108), 3 hides the frame (naauao worldmap.md §4.1; the radii are measured on the pictures).
 */
export const PIER_STAGES: PierStage[] = [
  { stage: 1, label: 'いかだ (船 0〜1)', x: 'x1', y: 'y1', stages: [0, 1], scope: { x: 0, y: 4, r: 81 }, telescope: 'telescope_02' },
  { stage: 2, label: 'ふね (船 2)', x: 'x2', y: 'y2', stages: [2], scope: { x: 0, y: 4, r: 108 }, telescope: 'telescope_01' },
  { stage: 3, label: 'クルーザー (船 3)', x: 'x3', y: 'y3', stages: [3] },
];

/** The stage whose position a ship stage uses (0 and 1 share the first). */
export const pierStageOf = (ship: number): PierStage => PIER_STAGES.find((s) => s.stages.includes(ship)) ?? PIER_STAGES[0]!;

/** An icon's size on the screen (island_* layouts: 32 × 32, last 32 × 48). */
export const pierIconSize = (icon: number): { width: number; height: number } => ({ width: 32, height: HONOLULU_PIER_ICONS[icon] === 'last' ? 48 : 32 });

/** The progress value of each dungeon (dungeonData's row) at which its icon gets the star: fixed in the code (0x2C2468). */
export const PIER_STAR_PROGRESS: Record<number, number> = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 4, 7: 5, 8: 5, 9: 5, 10: 7, 11: 15 };

/** The dungeon the middle island (デンパ島, not a row) goes to (FUN_001FD330(…, 0xD)). */
export const PIER_HOME_DUNGEON = 13;

/** One island: a row of PierData read through its definition. */
export interface PierIsland {
  row: number;
  dungeon: number;
  icon: number;
  /** The positions of the three ship stages (PIER_STAGES' order). */
  at: [number, number][];
  ship: number;
}

export class HonoluluWorldmap {
  constructor(readonly pier: HonoluluMaster) {}

  static async load(dump: Dump, texts?: MessageStore): Promise<HonoluluWorldmap> {
    return new HonoluluWorldmap(await HonoluluMaster.load(dump, texts, HONOLULU_PIER_ARCHIVE));
  }

  get rows(): TableRows {
    return this.pier.rows(HONOLULU_PIER_TABLE);
  }

  /** The islands as they are now (or as the ROM has them). */
  islands(original = false): PierIsland[] {
    const r = this.rows;
    const get = (row: number, key: string): number => (original ? r.original(row, key) : r.get(row, key));
    return Array.from({ length: Math.min(r.rows, HONOLULU_PIER_ROWS) }, (_, row) => ({
      row,
      dungeon: get(row, 'dungeon'),
      icon: get(row, 'icon'),
      at: PIER_STAGES.map((s): [number, number] => [get(row, s.x), get(row, s.y)]),
      ship: get(row, 'ship'),
    }));
  }

  island(row: number, original = false): PierIsland {
    return this.islands(original)[row]!;
  }

  set(row: number, key: 'dungeon' | 'icon' | 'ship', v: number): void {
    this.rows.set(row, key, v);
  }

  /** Moves an island at one stage (PIER_STAGES' index), or at all three. */
  move(row: number, stage: number | 'all', x: number, y: number): void {
    for (const [i, s] of PIER_STAGES.entries()) {
      if (stage !== 'all' && stage !== i) continue;
      this.rows.set(row, s.x, x);
      this.rows.set(row, s.y, y);
    }
  }

  changed(row: number): boolean {
    return this.rows.changed(row);
  }

  revert(row: number): void {
    this.rows.revert(row);
  }

  /** Whether the island shows at a ship stage (+0x10 ≤ the stage). */
  static shows(island: PierIsland, ship: number): boolean {
    return island.ship <= ship;
  }

  /** What may not look right in the game: an island off the screen, outside the telescope, never shown. */
  static problems(island: PierIsland, dungeons: number): string[] {
    const out: string[] = [];
    const { width, height } = pierIconSize(island.icon);
    if (!(island.icon in HONOLULU_PIER_ICONS)) out.push(`アイコン ${island.icon} は島のレイアウト (58〜64) ではありません。`);
    if (island.dungeon < 1 || island.dungeon >= dungeons) out.push(`行き先 ${island.dungeon} は dungeonData にないダンジョンです。`);
    else if (!(island.dungeon in PIER_STAR_PROGRESS)) out.push('この行き先にはクリアの星が付きません (星の条件はダンジョン 1〜11 だけ)。');
    if (island.ship > 3) out.push('要る船の段階が 3 を超えているので、島が出ません。');
    if (island.ship === 0) out.push('要る船の段階 0 (船がなくても出る) はゲームで確かめていません。');
    for (const [i, s] of PIER_STAGES.entries()) {
      // a stage the island never shows at does not matter
      if (Math.max(...s.stages) < island.ship) continue;
      const [x, y] = island.at[i]!;
      if (Math.abs(x) + width / 2 > PIER_SCREEN.width / 2 || Math.abs(y) + height / 2 > PIER_SCREEN.height / 2) out.push(`${s.label}: 画面の外にはみ出ています。`);
      else if (s.scope && Math.hypot(x - s.scope.x, y - s.scope.y) > s.scope.r) out.push(`${s.label}: 望遠鏡の穴 (半径 約 ${s.scope.r}) の外なので、枠に隠れると推定されます。`);
    }
    return out;
  }
}

/** The pictures of the pier's screen (the darc of 49C917B7): timg/ by name without the extension. */
export class PierImages {
  private constructor(readonly images: Map<string, Bclim>) {}

  static read(pier: HonoluluMaster): PierImages {
    const entry = pier.archive.entries.find((e) => e.index === 0);
    if (!entry) throw new Error(`${HONOLULU_PIER_ARCHIVE} にレイアウト (エントリ 0) がありません`);
    const files = readDarc(unpackEntry(pier.archive, entry).body);
    const images = new Map<string, Bclim>();
    for (const [path, b] of files) {
      const m = /^timg\/(.+)\.bclim$/.exec(path);
      if (m) images.set(m[1]!, readBclim(b));
    }
    return new PierImages(images);
  }

  /** The part of a picture the layout shows (the sea and the frames: 320 × 240 of 512 × 256; last: its lower 48 rows). */
  get(name: string): Bclim | undefined {
    const im = this.images.get(name);
    if (!im) return undefined;
    if (name === 'pier_btm_bg' || name.startsWith('telescope_')) return crop(im, 0, 0, PIER_SCREEN.width, PIER_SCREEN.height);
    if (name === 'island_last') return crop(im, 0, im.height - 48, 32, 48);
    // デンパ島: a 64 × 64 picture whose island is in the top left corner (the pane is 32 × 32; the UVs are not read)
    if (name === 'island_main') return crop(im, 0, 0, 32, 36);
    return im;
  }

  /** An island's icon (menuList's row). */
  icon(icon: number): Bclim | undefined {
    const name = HONOLULU_PIER_ICONS[icon];
    return name ? this.get(`island_${name}`) : undefined;
  }
}

function crop(im: Bclim, x: number, y: number, width: number, height: number): Bclim {
  const w = Math.min(width, im.width - x);
  const h = Math.min(height, im.height - y);
  const rgba = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) rgba.set(im.rgba.subarray(((y + r) * im.width + x) * 4, ((y + r) * im.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, rgba };
}
