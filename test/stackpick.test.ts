import { describe, expect, test } from 'bun:test';
import { Controller } from '../src/editor/controller';
import { MapEditState } from '../src/editor/model';
import type { StackCandidate } from '../src/editor/stackpick';
import { LAYOUTS, setRecCellPos, type MapDoc, type Rec } from '../src/game/sections';

class StackState extends MapEditState<never, null> {
  readonly layouts = LAYOUTS;
  readonly pointSections = [3, 4, 5];
  protected saveTables() {
    return null;
  }
  protected restoreTables() {}
  placeStamp(): [number, number] {
    throw new Error('unused');
  }
  duplicateRecord(_doc: MapDoc, _section: number, rec: Rec) {
    return rec;
  }
}

function rec(section: number, cx: number, cy: number): Rec {
  const L = LAYOUTS[section]!;
  const r: Rec = { raw: new Uint8Array(L.size), x: 0, y: 0 };
  setRecCellPos(r, L, cx, cy);
  return r;
}

function setup() {
  const st = new StackState();
  st.current = {
    hash: 1,
    name: 'T',
    dungeon: 0,
    floor: 0,
    tiles: [{ x: 2, y: 2, kind: 1, letter: 0, rot: 0 } as MapDoc['tiles'][number]],
    recs: { 3: [rec(3, 2.5, 2.5)], 4: [rec(4, 2.5, 2.5)], 5: [rec(5, 6.5, 6.5)] },
    sec6Header: new Uint8Array(8),
    cells6: [],
    raw: {},
  };
  const ctl = new Controller(st);
  const opened: StackCandidate[][] = [];
  ctl.onStack = (items) => opened.push(items);
  return { st, ctl, opened };
}

const press = (t: number) => ({ shiftKey: false, button: 0, clientX: 10, clientY: 10, timeStamp: t });

describe('picking one of the things stacked at a point', () => {
  test('lists the records there nearest first, then the tile', () => {
    const { ctl } = setup();
    const items = ctl.stackAt(2.5, 2.5);
    expect(items.map((i) => i.sel)).toEqual([
      { type: 'rec', section: 3, index: 0 },
      { type: 'rec', section: 4, index: 0 },
      { type: 'tiles', cells: [[2, 2]] },
    ]);
  });
  test('the status bar tells of the double click over stacked things', () => {
    const { ctl } = setup();
    ctl.move(2.5, 2.5);
    expect(ctl.stackHint()).toContain('3 件');
    ctl.move(6.5, 6.5);
    expect(ctl.stackHint()).toBeNull();
  });
  test('a double click opens the picker where several things are stacked', () => {
    const { st, ctl, opened } = setup();
    ctl.down(2.5, 2.5, press(1000));
    ctl.up();
    expect(st.selection).toEqual({ type: 'rec', section: 3, index: 0 });
    ctl.down(2.5, 2.5, press(1200));
    ctl.up();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toHaveLength(3);
  });
  test('slow clicks, a lone record and presses without a pointer only select', () => {
    const { ctl, opened } = setup();
    ctl.down(2.5, 2.5, press(1000));
    ctl.up();
    ctl.down(2.5, 2.5, press(2000));
    ctl.up();
    ctl.down(6.5, 6.5, press(3000));
    ctl.up();
    ctl.down(6.5, 6.5, press(3100));
    ctl.up();
    ctl.down(2.5, 2.5, { shiftKey: false, button: 0 });
    ctl.up();
    ctl.down(2.5, 2.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(opened).toHaveLength(0);
  });
});
