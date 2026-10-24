// The shop book shared by the games (ui/ShopBook): a cell that edits its row writes it through the book's setRow, so
// the book redraws (a write the book does not make leaves its view as it was: 初代's 目玉 box did not change, #153).
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ShopBook } from '../src/ui/ShopBook';

interface Row { item: number; on: boolean }

describe('ShopBook', () => {
  test("a cell's setRow writes the shop's rows with that row replaced", () => {
    let rows: Row[] = [{ item: 1, on: false }, { item: 2, on: false }];
    const writes: Row[][] = [];
    let setSecond: ((next: Row) => void) | undefined;
    renderToString(
      <ShopBook<Row>
        shops={[{ id: 0, label: '店 0' }]} arg="0" href={(id) => `#/shops/${id}`}
        rows={() => rows} original={() => rows} same={(a, b) => a.item === b.item && a.on === b.on}
        item={(id) => ({ name: `品 ${id}` })} newRow={(_, item) => ({ item, on: false })}
        columns={() => [{ head: '印', cell: (r, i, setRow) => { if (i === 1) setSecond = setRow; return r.on ? '●' : ''; } }]}
        setRows={(_, next) => { writes.push(next); rows = next; }}
        picker={() => null} />,
    );
    expect(setSecond).toBeDefined();
    setSecond!({ item: 2, on: true });
    expect(writes).toEqual([[{ item: 1, on: false }, { item: 2, on: true }]]);
  });
});
