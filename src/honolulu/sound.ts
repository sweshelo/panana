// BGM and sound effects of 電波人間のRPG (初代, #176): the soundData rows (master エントリ 64, read as RPG2 / RPG3's) and
// the places known to use them. Only mapData +0x07 so far: the floor's BGM by the data (every row names a BGM_FLD_* of
// its tileset, or BGM_ILD_ROOT), passed to FUN_0020C2A0 (naauao honolulu/map.md §3.3) and not checked in the game; bossBgm, soundDataType and the BGMs of the code are sweshelo/naauao#55.
import type { HonoluluMaster } from './master';

/** One place that uses a soundData row. */
export interface HonoluluSoundUse {
  /** What uses it ("mapData +0x07"). */
  what: string;
  /** Where ("mapData 行 3"). */
  where: string;
  /** The dungeons that take that mapData row (dungeonData +0x16). */
  dungeons: string[];
  /** A guess from the code, not checked in the game. */
  unsure?: boolean;
}

/** soundData row -> the places that use it. */
export function honoluluSoundUses(master: HonoluluMaster): Map<number, HonoluluSoundUse[]> {
  const out = new Map<number, HonoluluSoundUse[]>();
  const context = master.context();
  const dungeons = master.rows('dungeonData.bin');
  const byMapData = new Map<number, string[]>();
  for (let r = 1; r < dungeons.rows; r++) {
    const m = dungeons.get(r, 'mapData');
    byMapData.set(m, [...(byMapData.get(m) ?? []), context.rowName?.('dungeonData.bin', r) || `ダンジョン ${r}`]);
  }
  const mapData = master.rows('mapData.bin');
  for (let r = 0; r < mapData.rows; r++) {
    const s = mapData.get(r, 'sound');
    if (!s) continue;
    out.set(s, [...(out.get(s) ?? []), { what: '階の BGM (mapData +0x07)', where: `mapData 行 ${r}`, dungeons: byMapData.get(r) ?? [], unsure: true }]);
  }
  return out;
}
