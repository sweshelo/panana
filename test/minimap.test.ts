import { describe, expect, test } from 'bun:test';
import { autoTiles, cellKey, type AutoCell } from '../src/editor/autotile';
import { minimapCells, drawTerrainMinimap } from '../src/editor/minimap';
import { KAHARA_AUTO } from '../src/game/autotile';
const room = (): AutoCell[] =>
  autoTiles([], new Set(Array.from({ length: 9 }, (_, i) => cellKey(i % 3, Math.floor(i / 3)))), KAHARA_AUTO);
const cell = (tiles: ReturnType<typeof minimapCells>, x: number, y: number) =>
  tiles.find((tile) => tile.x === x && tile.y === y)!;
const overlay = (base: AutoCell[], updates: AutoCell[]) => [
  ...new Map([...base, ...updates].map((tile) => [cellKey(tile.x, tile.y), tile])).values(),
];
describe('minimap follows room and corridor openings', () => {
  test('a wall between touching rooms is visible until an actual doorway is painted', () => {
    const base = [...room(), ...room().map((tile) => ({ ...tile, x: tile.x + 3 }))];
    const closed = minimapCells(base, KAHARA_AUTO);
    expect(cell(closed, 2, 1).walls).toContainEqual({ direction: 1, from: 0, to: 1 });
    expect(cell(closed, 2, 1).connected & 2).toBe(0);
    const terrain = overlay(base, autoTiles(base, new Set(['2,1', '3,1']), KAHARA_AUTO));
    const opened = minimapCells(terrain, KAHARA_AUTO);
    expect(cell(opened, 2, 1).doors & 2).toBe(2);
    expect(cell(opened, 3, 1).doors & 8).toBe(8);
    expect(cell(opened, 2, 1).walls).toContainEqual({ direction: 1, from: 0, to: 0.3 });
    expect(cell(opened, 2, 1).walls).toContainEqual({ direction: 1, from: 0.7, to: 1 });
    expect(cell(opened, 2, 1).walls).not.toContainEqual({ direction: 1, from: 0, to: 1 });
    expect(cell(opened, 1, 1).walls).toEqual([]);
  });
  test('passing a corridor alongside a closed wall does not draw false connections', () => {
    const base = room().map((tile) => ({ ...tile, x: tile.x + 1 }));
    const terrain = overlay(base, autoTiles(base, new Set(['0,0', '0,1', '0,2']), KAHARA_AUTO));
    const minimap = minimapCells(terrain, KAHARA_AUTO);
    expect(cell(minimap, 0, 1).connected).toBe(5);
    expect(cell(minimap, 1, 1).walls).toContainEqual({ direction: 3, from: 0, to: 1 });
    expect(cell(minimap, 1, 1).doors).toBe(0);
  });
  test('corridor entrances retain their opening, for each rotation', () => {
    for (const [x, y, ox, oy, rot] of [
      [1, 0, 1, -1, 0],
      [2, 1, 3, 1, 1],
      [1, 2, 1, 3, 2],
      [0, 1, -1, 1, 3],
    ] as const) {
      const base = room();
      const terrain = overlay(base, autoTiles(base, new Set([cellKey(ox, oy), cellKey(x, y)]), KAHARA_AUTO));
      const minimap = minimapCells(terrain, KAHARA_AUTO);
      expect(cell(minimap, x, y).doors).toBe(1 << rot);
      expect(cell(minimap, ox, oy).connected).toBe(1 << ((rot + 2) % 4));
    }
  });
  test('kind zero is a crossing, inner corners are rotated, and unknown/wall tiles are excluded', () => {
    const cross: AutoCell[] = [
      { x: 1, y: 1, kind: 0, rot: 0 },
      { x: 1, y: 0, kind: 1, rot: 1 },
      { x: 2, y: 1, kind: 1, rot: 0 },
      { x: 1, y: 2, kind: 1, rot: 1 },
      { x: 0, y: 1, kind: 1, rot: 0 },
    ];
    const tiles = minimapCells(
      [
        ...cross,
        { x: 8, y: 8, kind: 8, rot: 2 },
        { x: 10, y: 10, kind: 6, rot: 0 },
        { x: 12, y: 12, kind: 42, rot: 0 },
      ],
      KAHARA_AUTO,
    );
    expect(cell(tiles, 1, 1)).toMatchObject({ room: false, connected: 15 });
    expect(cell(tiles, 8, 8)).toMatchObject({ room: true, corners: 4 });
    expect(tiles.some((tile) => tile.kind === 6 || tile.kind === 42)).toBe(false);
  });
  test('last tile record wins and rendering draws walls and amber thresholds', () => {
    const base = [...room(), ...room().map((tile) => ({ ...tile, x: tile.x + 3 }))];
    const terrain = overlay(base, autoTiles(base, new Set(['2,1', '3,1']), KAHARA_AUTO));
    expect(
      minimapCells([...terrain, { x: 1, y: 1, kind: 6, rot: 0 }], KAHARA_AUTO).some(
        (tile) => tile.x === 1 && tile.y === 1,
      ),
    ).toBe(false);
    const strokes: string[] = [];
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect() {},
      moveTo() {},
      lineTo() {},
      beginPath() {},
      stroke() {
        strokes.push(this.strokeStyle);
      },
    };
    drawTerrainMinimap(context as unknown as CanvasRenderingContext2D, 30, terrain, KAHARA_AUTO);
    expect(strokes).toContain('#cfe3ff');
    expect(strokes).toContain('#f5d68a');
  });
});
