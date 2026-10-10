// 電波人間のRPG FREE! (lanai) maps (naauao lanai/map.md): the facing codec of tiles, and (with the dumps) the map table,
// the map database, the documents and the tile models.
import { describe, expect, test } from 'bun:test';
import { buildTiles, LANAI_ROT_CODEC, parseTiles, type TileLayout } from '../src/game/sections';

const LAYOUT: TileLayout = { size: 20, rot: 0x10, letter: 0x11, pad: 0x12, rotCodec: LANAI_ROT_CODEC };

describe('lanai tile facing', () => {
  const rec = (facing: number): Uint8Array => {
    const b = new Uint8Array(20);
    b[0] = 5;
    b[4] = 3;
    b[6] = 4;
    b[0x10] = facing;
    b[0x11] = 0x7a;
    return b;
  };

  test('4 / 2 / 1 / 8 are the turns 0 / 1 / 2 / 3', () => {
    for (const [byte, rot] of [[4, 0], [2, 1], [1, 2], [8, 3]] as const) {
      const [t] = parseTiles(rec(byte), LAYOUT);
      expect(t).toMatchObject({ kind: 5, x: 3, y: 4, rot, rotHi: 0 });
      expect(buildTiles([t!], LAYOUT)).toEqual(rec(byte));
    }
  });

  test('turning a tile writes the matching byte; a byte of no turn is kept', () => {
    const [t] = parseTiles(rec(4), LAYOUT);
    t!.rot = 3;
    expect(buildTiles([t!], LAYOUT)[0x10]).toBe(8);
    const [odd] = parseTiles(rec(3), LAYOUT);
    expect(buildTiles([odd!], LAYOUT)).toEqual(rec(3));
  });
});
