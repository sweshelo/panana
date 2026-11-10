import { describe, expect, test } from 'bun:test';
import { autoTiles, cellKey, turnMask, type AutoCell } from '../src/editor/autotile';
import { KAHARA_AUTO } from '../src/game/autotile';
import { Controller } from '../src/editor/controller';
import { MapEditState } from '../src/editor/model';
import { LAYOUTS, type MapDoc, type Rec, type Tile } from '../src/game/sections';

const keys = (points: number[][]): Set<string> => new Set(points.map(([x, y]) => cellKey(x!, y!)));
const square = (n: number): number[][] => Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)]);
const solve = (points: number[][], base: AutoCell[] = []): AutoCell[] => autoTiles(base, keys(points), KAHARA_AUTO);
const at = (tiles: AutoCell[], x: number, y: number): AutoCell => tiles.find((t) => t.x === x && t.y === y)!;
const room = (): AutoCell[] => solve(square(3));

describe('automatic terrain topology', () => {
  test('isolated, straight, bend, T and crossing', () => {
    expect(at(solve([[1, 1]]), 1, 1).kind).toBe(1);
    for (const [points, kind, rot] of [
      [
        [
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        1,
        0,
      ],
      [
        [
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        2,
        0,
      ],
      [
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        3,
        0,
      ],
      [
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 0],
          [1, 2],
        ],
        0,
        0,
      ],
    ] as const)
      expect(at(solve(points.map((p) => [...p])), 1, 1)).toMatchObject({ kind, rot });
  });
  test('a filled drag forms floor, four edges and rotated corners', () => {
    const tiles = room();
    expect(at(tiles, 1, 1).kind).toBe(5);
    for (const [x, y, rot] of [
      [1, 0, 0],
      [2, 1, 1],
      [1, 2, 2],
      [0, 1, 3],
    ])
      expect(at(tiles, x!, y!)).toMatchObject({ kind: 7, rot });
    for (const [x, y, rot] of [
      [0, 0, 0],
      [2, 0, 1],
      [2, 2, 2],
      [0, 2, 3],
    ])
      expect(at(tiles, x!, y!)).toMatchObject({ kind: 14, rot });
  });
  test('concave and opposite concave corners use 8 and 13', () => {
    expect(at(solve(square(3).filter(([x, y]) => !(x === 2 && y === 0))), 1, 1)).toMatchObject({ kind: 8, rot: 0 });
    expect(at(solve(square(3).filter(([x, y]) => !(x === 0 && y === 0) && !(x === 2 && y === 2))), 1, 1)).toMatchObject(
      { kind: 13, rot: 0 },
    );
  });
  test('corridors entering all four sides turn edges into entrances', () => {
    for (const [x, y, ox, oy, rot] of [
      [1, 0, 1, -1, 0],
      [2, 1, 3, 1, 1],
      [1, 2, 1, 3, 2],
      [0, 1, -1, 1, 3],
    ]) {
      const tiles = solve(
        [
          [ox!, oy!],
          [x!, y!],
        ],
        room(),
      );
      expect(at(tiles, x!, y!)).toMatchObject({ kind: 9, rot });
      expect(at(tiles, 1, 1).kind).toBe(5);
    }
  });
  test('corner connections use 10, 11 and 12', () => {
    // Top right corner: room to south/west; corridor to north and/or east.
    for (const [extra, kind, rot] of [
      [[[2, -1]], 11, 1],
      [[[3, 0]], 12, 0],
      [
        [
          [2, -1],
          [3, 0],
        ],
        10,
        0,
      ],
    ] as const) {
      expect(at(solve([...extra.map((p) => [...p]), [2, 0]], room()), 2, 0)).toMatchObject({ kind, rot });
    }
  });
  test('order independent and remote/special tiles are preserved', () => {
    const points = square(4);
    const canonical = (ts: AutoCell[]) => ts.sort((a, b) => a.y - b.y || a.x - b.x);
    expect(canonical(solve(points))).toEqual(canonical(solve([...points].reverse())));
    const special = { x: 8, y: 8, kind: 42, rot: 3 };
    expect(solve([[0, 0]], [special])).not.toContainEqual(special);
  });
  test('a different vocabulary reuses the same solver', () => {
    const profile = { isolated: 101, parts: KAHARA_AUTO.parts.map((p) => ({ ...p, kind: p.kind + 100 })) };
    const tiles = autoTiles([], keys(square(3)), profile);
    expect(at(tiles, 1, 1).kind).toBe(105);
    expect(turnMask(14, 1)).toBe(13);
  });
});
class State extends MapEditState<never, null> {
  readonly layouts = LAYOUTS;
  readonly pointSections = [];
  override get autoProfile() {
    return KAHARA_AUTO;
  }
  protected saveTables() {
    return null;
  }
  protected restoreTables() {}
  placeStamp(): [number, number] {
    throw new Error('unused');
  }
  duplicateRecord(_d: MapDoc, _s: number, r: Rec) {
    return r;
  }
}
const doc = (): MapDoc => ({
  hash: 1,
  name: 'test',
  dungeon: 0,
  floor: 0,
  tiles: [],
  recs: {},
  sec6Header: new Uint8Array(),
  cells6: [],
  raw: {},
});
test('one drag has one undo, redo restores topology and manual painting exits automatic mode', () => {
  const st = new State();
  st.current = doc();
  st.brush = { auto: true, kind: 5, rot: 0, letter: 0x61 };
  st.setTool('paint');
  const ctl = new Controller(st);
  ctl.down(0, 0, { shiftKey: false, button: 0 });
  ctl.move(2, 0);
  ctl.move(2, 1);
  ctl.move(0, 1);
  ctl.up();
  expect(st.current.tiles).toHaveLength(6);
  const saved = st.current.tiles.map((t) => ({ ...t }));
  expect(saved.every((t) => [7, 14].includes(t.kind))).toBe(true);
  st.undo();
  expect(st.current!.tiles).toEqual([]);
  expect(st.canUndo()).toBe(false);
  st.redo();
  expect(st.current!.tiles).toEqual(saved);
  st.brush = { kind: 42, rot: 3, letter: 0x61 };
  ctl.down(5, 5, { shiftKey: false, button: 0 });
  ctl.up();
  expect(at(st.current!.tiles, 5, 5)).toMatchObject({ kind: 42, rot: 3 });
});
test('automatic updates preserve record metadata and unsupported cells', () => {
  const st = new State();
  st.current = doc();
  const tile: Tile = { x: 1, y: 0, kind: 1, rot: 0, letter: 0x62, rotHi: 128, pad: 999 };
  st.current.tiles = [tile, { ...tile, x: 9, kind: 42 }];
  st.brush = { auto: true, kind: 5, rot: 0, letter: 0x61 };
  st.setTool('paint');
  const ctl = new Controller(st);
  ctl.down(0, 0, { shiftKey: false, button: 0 });
  ctl.up();
  expect(st.current.tiles[0]).toMatchObject({ rotHi: 128, pad: 999, letter: 0x62 });
  expect(st.current.tiles[1]).toMatchObject({ kind: 42, x: 9 });
});
import { Game } from '../src/game/game';
import { EditorState } from '../src/editor/state';
import { openImage } from '../src/rom/dump';
import { buildTiles, parseTiles } from '../src/game/sections';
import { CIA, hasCia } from './env';

test.skipIf(!hasCia)('Kahara ROM: automatic palette, controller and serialized tile records', async () => {
  const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  const st = new EditorState(game);
  st.open(game.code.byName('D01B02001')!);
  expect(st.autoProfile).toBe(KAHARA_AUTO);
  st.current!.tiles = [];
  st.brush = { auto: true, kind: 5, rot: 0, letter: 0x7a };
  st.setTool('paint');
  const ctl = new Controller(st);
  ctl.down(1, 1, { button: 0, shiftKey: false });
  ctl.move(3, 1);
  ctl.move(3, 2);
  ctl.move(1, 2);
  ctl.up();
  const tiles = st.current!.tiles;
  expect(tiles).toHaveLength(6);
  expect(parseTiles(buildTiles(tiles))).toEqual(tiles);
  for (const t of tiles) expect(game.master.partModel(t.kind, st.tileset, 0)).not.toBe(0);
  const indoor = game.code.maps.find((m) => game.doc(m).tiles.some((t) => t.kind >= 15 && t.kind <= 27))!;
  st.open(indoor);
  expect(st.autoProfile).toBeUndefined();
});

test('joining two existing rooms updates both entrances', () => {
  const left = room().map((t) => ({ ...t, x: t.x + 1, y: t.y + 1 }));
  const right = room().map((t) => ({ ...t, x: t.x + 6, y: t.y + 1 }));
  const tiles = solve(
    [
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
    ],
    [...left, ...right],
  );
  expect(at(tiles, 3, 2)).toMatchObject({ kind: 9, rot: 1 });
  expect(at(tiles, 6, 2)).toMatchObject({ kind: 9, rot: 3 });
  expect(at(tiles, 4, 2).kind).toBe(1);
  expect(at(tiles, 5, 2).kind).toBe(1);
});
test('undo or switching maps during a drag cancels its remaining automatic edits', () => {
  for (const undo of [true, false]) {
    const st = new State();
    st.current = doc();
    st.brush = { auto: true, kind: 5, rot: 0, letter: 0x61 };
    st.setTool('paint');
    const ctl = new Controller(st);
    ctl.down(1, 1, { button: 0, shiftKey: false });
    if (undo) st.undo();
    else st.current = { ...doc(), hash: 2 };
    ctl.move(2, 1);
    ctl.up();
    expect(st.current!.tiles).toHaveLength(0);
  }
});
describe('gesture start distinguishes corridors from room expansion', () => {
  const base = () => room().map((t) => ({ ...t, x: t.x + 2, y: t.y + 2 }));
  test('a path begun outside and drawn alongside a room remains a corridor with closed room walls', () => {
    const tiles = solve(
      [
        [1, 2],
        [1, 3],
        [1, 4],
      ],
      base(),
    );
    expect(at(tiles, 1, 3)).toMatchObject({ kind: 1, rot: 1 });
    for (const [x, y] of [
      [2, 2],
      [2, 3],
      [2, 4],
    ]) {
      expect(at(tiles, x!, y!)).toEqual(at(base(), x!, y!));
    }
  });
  test('the same line can expand the room when its start is on existing room floor', () => {
    const tiles = solve(
      [
        [2, 3],
        [1, 3],
        [1, 2],
        [1, 4],
      ],
      base(),
    );
    expect(at(tiles, 1, 3)).toMatchObject({ kind: 7, rot: 3 });
    expect(at(tiles, 2, 3).kind).toBe(5);
  });
  test('an outside start stays a corridor even after its final point paints the room edge', () => {
    const tiles = solve(
      [
        [1, 2],
        [1, 3],
        [1, 4],
        [2, 3],
      ],
      base(),
    );
    expect(at(tiles, 1, 3)).toMatchObject({ kind: 3, rot: 3 });
    expect(at(tiles, 2, 3)).toMatchObject({ kind: 9, rot: 3 });
    expect(at(tiles, 1, 2).kind).toBe(4);
  });
  test('a newly painted room alongside another does not automatically merge it', () => {
    const tiles = solve(
      [
        [0, 2],
        [1, 2],
        [0, 3],
        [1, 3],
      ],
      base(),
    );
    expect(at(tiles, 1, 2)).toMatchObject({ kind: 14, rot: 1 });
    expect(at(tiles, 2, 2)).toEqual(at(base(), 2, 2));
  });
  test('start intent is stable when other points are revisited or reordered', () => {
    const points = keys([
      [1, 3],
      [2, 3],
      [1, 2],
      [1, 4],
    ]);
    const canonical = (ts: AutoCell[]) => ts.sort((a, b) => a.y - b.y || a.x - b.x);
    expect(canonical(autoTiles(base(), points, KAHARA_AUTO, '1,3'))).toEqual(
      canonical(autoTiles(base(), new Set([...points].reverse()), KAHARA_AUTO, '1,3')),
    );
    expect(at(autoTiles(base(), points, KAHARA_AUTO, '2,3'), 1, 3).kind).toBe(7);
    expect(at(autoTiles(base(), points, KAHARA_AUTO, '1,3'), 1, 3).kind).toBe(3);
  });
});

test('controller keeps pointer-down intent while the drag subsequently crosses room floor', () => {
  const make = (): State => {
    const st = new State();
    st.current = doc();
    st.current.tiles = room().map((t) => ({ ...t, x: t.x + 2, y: t.y + 2, rotHi: 0, pad: 0, letter: 0x61 }));
    st.brush = { auto: true, kind: 5, rot: 0, letter: 0x61 };
    st.setTool('paint');
    return st;
  };
  const outside = make();
  const ctl = new Controller(outside);
  ctl.down(1, 2, { button: 0, shiftKey: false });
  ctl.move(1, 4);
  ctl.move(1, 3);
  ctl.move(2, 3);
  ctl.move(1, 3);
  ctl.up();
  expect(at(outside.current!.tiles, 1, 3)).toMatchObject({ kind: 3, rot: 3 });
  expect(at(outside.current!.tiles, 2, 3)).toMatchObject({ kind: 9, rot: 3 });
  const inside = make();
  const ctl2 = new Controller(inside);
  ctl2.down(2, 3, { button: 0, shiftKey: false });
  ctl2.move(1, 3);
  ctl2.move(1, 2);
  ctl2.move(1, 4);
  ctl2.up();
  expect(at(inside.current!.tiles, 1, 3)).toMatchObject({ kind: 7, rot: 3 });
  expect(at(inside.current!.tiles, 2, 3).kind).toBe(5);
});
import { roomGroups } from '../src/editor/autotile';
import { letterByte, letterIndex } from '../src/game/sections';
import { normalVariant, roomCenters, roomVariantLetters } from '../src/editor/autotile-variants';
import { spyOn } from 'bun:test';

describe('distinct rooms retain default doorways', () => {
  const first = () => room().map((t) => ({ ...t, x: t.x + 1, y: t.y + 1 }));
  const overlay = (base: AutoCell[], updates: AutoCell[]): AutoCell[] => [
    ...new Map([...base, ...updates].map((t) => [cellKey(t.x, t.y), t])).values(),
  ];
  test('touching rooms connect through entrances rather than being merged into floor', () => {
    const base = [...first(), ...room().map((t) => ({ ...t, x: t.x + 4, y: t.y + 1 }))];
    const tiles = overlay(
      base,
      solve(
        [
          [3, 2],
          [4, 2],
        ],
        base,
      ),
    );
    expect(at(tiles, 3, 2)).toMatchObject({ kind: 9, rot: 1 });
    expect(at(tiles, 4, 2)).toMatchObject({ kind: 9, rot: 3 });
    const groups = roomGroups(tiles, KAHARA_AUTO);
    expect(groups.get('2,2')).not.toBe(groups.get('5,2'));
    const variants = roomVariantLetters(
      tiles,
      KAHARA_AUTO,
      () => [0, 1, 2, 3],
      true,
      () => 0.99,
    );
    expect(variants.get('3,2')).toBe(0);
    expect(variants.get('4,2')).toBe(0);
  });
  test('a corridor begun inside one room does not extend the destination room', () => {
    const base = [...first(), ...room().map((t) => ({ ...t, x: t.x + 5, y: t.y + 1 }))];
    const tiles = overlay(
      base,
      solve(
        [
          [3, 2],
          [4, 2],
          [5, 2],
        ],
        base,
      ),
    );
    expect(at(tiles, 3, 2)).toMatchObject({ kind: 9, rot: 1 });
    expect(at(tiles, 4, 2)).toMatchObject({ kind: 1, rot: 0 });
    expect(at(tiles, 5, 2)).toMatchObject({ kind: 9, rot: 3 });
    expect(at(tiles, 5, 1)).toMatchObject({ kind: 14, rot: 0 });
  });
});

describe('room variation policy', () => {
  test('normal weights favour the default and decrease for subsequent available variants', () => {
    const counts = [0, 0, 0, 0];
    for (let index = 0; index < 10000; index++) counts[normalVariant([0, 1, 2, 3], (index + 0.5) / 10000)]!++;
    expect(counts[0]!).toBeGreaterThan(counts[1]!);
    expect(counts[1]!).toBeGreaterThan(counts[2]!);
    expect(counts[2]!).toBeGreaterThan(counts[3]!);
    expect(counts[0]! / counts[1]!).toBeCloseTo(Math.exp(0.5), 2);
    expect(normalVariant([0], 0.999)).toBe(0);
    expect([0, 2, 6]).toContain(normalVariant([6, 2], 0.95));
  });
  test('only one central floor varies; edges and corners vary but corridors and entrances do not', () => {
    const base = solve(square(5));
    const tiles = [
      ...new Map(
        [
          ...base,
          ...solve(
            [
              [2, -1],
              [2, 0],
            ],
            base,
          ),
        ].map((t) => [cellKey(t.x, t.y), t]),
      ).values(),
    ];
    const letters = roomVariantLetters(
      tiles,
      KAHARA_AUTO,
      () => [0, 1, 2, 3],
      true,
      () => 0.95,
    );
    expect([...roomCenters(tiles, KAHARA_AUTO)]).toEqual(['2,2']);
    for (const tile of tiles) {
      const value = letters.get(cellKey(tile.x, tile.y));
      if (tile.kind === 5) expect(value).toBe(tile.x === 2 && tile.y === 2 ? 2 : 0);
      if ([7, 14].includes(tile.kind)) expect(value).toBe(2);
      if ([1, 4, 9].includes(tile.kind)) expect(value).toBe(0);
    }
  });
  test('even-sized and irregular rooms choose one available central floor, independently per room', () => {
    const even = solve(square(4));
    expect([...roomCenters(even, KAHARA_AUTO)]).toEqual(['1,1']);
    const both = [...even, ...room().map((t) => ({ ...t, x: t.x + 7 }))];
    expect([...roomCenters(both, KAHARA_AUTO)].sort()).toEqual(['1,1', '8,1']);
    expect(roomCenters(solve(square(2)), KAHARA_AUTO).size).toBe(0);
  });
  test('disabled variations use defaults and never draw random samples', () => {
    let calls = 0;
    const letters = roomVariantLetters(
      solve(square(5)),
      KAHARA_AUTO,
      () => [0, 1, 2],
      false,
      () => {
        calls++;
        return 0.99;
      },
    );
    expect(new Set(letters.values())).toEqual(new Set([0]));
    expect(calls).toBe(0);
  });
});
class VariationState extends State {
  override autoVariantLetters() {
    return [0, 1, 2, 3];
  }
}
const variationState = (): VariationState => {
  const st = new VariationState();
  st.current = doc();
  st.brush = { auto: true, kind: 5, rot: 0, letter: 0x63 };
  st.setTool('paint');
  return st;
};
const drawSquare = (ctl: Controller, n: number): void => {
  ctl.down(0, 0, { button: 0, shiftKey: false });
  for (const [x, y] of square(n)) ctl.move(x!, y!);
};
test('controller variation draws are stable within a gesture, preserve undo/redo, and obey the checkbox', () => {
  const random = spyOn(Math, 'random').mockReturnValue(0.95);
  try {
    for (const enabled of [true, false]) {
      const st = variationState();
      st.autoRandomVariants = enabled;
      const ctl = new Controller(st);
      drawSquare(ctl, 5);
      const before = st.current!.tiles.map((t) => ({ ...t }));
      ctl.move(0, 0);
      ctl.up();
      expect(st.current!.tiles).toEqual(before);
      const floors = st.current!.tiles.filter((t) => t.kind === 5 && letterIndex(t.letter) !== 0);
      expect(floors).toHaveLength(enabled ? 1 : 0);
      if (enabled) expect(floors[0]).toMatchObject({ x: 2, y: 2, letter: letterByte(2) });
      for (const tile of st.current!.tiles.filter((t) => [7, 14].includes(t.kind)))
        expect(letterIndex(tile.letter)).toBe(enabled ? 2 : 0);
      st.undo();
      expect(st.current!.tiles).toEqual([]);
      st.redo();
      expect(st.current!.tiles).toEqual(before);
    }
  } finally {
    random.mockRestore();
  }
});
test('expansion moves central floor decoration and leaves other rooms untouched', () => {
  const random = spyOn(Math, 'random').mockReturnValue(0.95);
  try {
    const st = variationState();
    const ctl = new Controller(st);
    drawSquare(ctl, 5);
    ctl.up();
    const remote = room().map((t) => ({ ...t, x: t.x + 15, rotHi: 0, pad: 0, letter: letterByte(3) }));
    st.current!.tiles.push(...remote);
    ctl.down(4, 2, { button: 0, shiftKey: false });
    for (let y = 0; y < 5; y++) {
      ctl.move(5, y);
      ctl.move(6, y);
    }
    ctl.up();
    expect(at(st.current!.tiles, 2, 2)).toMatchObject({ kind: 5, letter: letterByte(0) });
    expect(at(st.current!.tiles, 3, 2)).toMatchObject({ kind: 5, letter: letterByte(2) });
    for (const tile of remote) expect(at(st.current!.tiles, tile.x, tile.y)).toEqual(tile);
  } finally {
    random.mockRestore();
  }
});

test('room-to-room entrances use default variants through the controller in all orientations', () => {
  const random = spyOn(Math, 'random').mockReturnValue(0.95);
  const rotate = (tile: AutoCell, rot: number): AutoCell => {
    let { x, y } = tile;
    for (let i = 0; i < rot; i++) [x, y] = [-y, x];
    return { ...tile, x: x + 10, y: y + 10, rot: (tile.rot + rot) % 4 };
  };
  try {
    for (let rot = 0; rot < 4; rot++) {
      const st = variationState();
      const base = [...room(), ...room().map((tile) => ({ ...tile, x: tile.x + 3 }))];
      st.current!.tiles = base.map((tile) => ({ ...rotate(tile, rot), letter: letterByte(3), pad: 0, rotHi: 0 }));
      const from = rotate({ x: 2, y: 1, kind: 9, rot: 1 }, rot),
        to = rotate({ x: 3, y: 1, kind: 9, rot: 3 }, rot);
      const ctl = new Controller(st);
      ctl.down(from.x, from.y, { button: 0, shiftKey: false });
      ctl.move(to.x, to.y);
      ctl.up();
      expect(at(st.current!.tiles, from.x, from.y)).toMatchObject({ ...from, letter: letterByte(0) });
      expect(at(st.current!.tiles, to.x, to.y)).toMatchObject({ ...to, letter: letterByte(0) });
    }
  } finally {
    random.mockRestore();
  }
});
