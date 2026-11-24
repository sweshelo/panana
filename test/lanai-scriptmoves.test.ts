// The move() statements of a script as points on a map (scriptMoves.ts): reading them from a function's text and
// writing a new position back into it.
import { describe, expect, test } from 'bun:test';
import { scriptDocFromSource, type ScriptDoc } from '../src/lanai/eventScript';
import {
  coordText,
  mapScriptMoves,
  scriptMoves,
  sourceScriptMoves,
  withMoveAt,
  withScriptMove,
} from '../src/lanai/scriptMoves';

describe('scriptMoves', () => {
  test('reads whom and where, skipping comments', () => {
    const body = [
      'move(hero, 1750, 0, 2750)',
      '// move(hero, 1, 2, 3)',
      '/* move(self, 9, 9, 9) */',
      'move( obj( 0x0C ) , -250.5 ,10, 0x1F4 )',
      'move(self, 3, 3, 3)',
    ].join('\n');
    const m = scriptMoves(body);
    expect(m.map((x) => [x.who, x.x, x.y, x.z, x.line])).toEqual([
      [{ kind: 'hero' }, 1750, 0, 2750, 1],
      [{ kind: 'chara', row: 12 }, -250.5, 10, 500, 4],
      [{ kind: 'self' }, 3, 3, 3, 5],
    ]);
    // the spans are where the numbers are written
    expect(m[1]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['-250.5', '10', '0x1F4']);
    // the 3 of self's x is not the 3 of an obj row before it
    expect(m[2]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['3', '3', '3']);
  });

  test('reads who.move(x, y, z) and walk as well, in the order of the text', () => {
    const body = 'obj(3).move(1, 2, 3)\nwalk(hero, 4, 5, 6)\nself . walk( -7 , 8, 0x10 )\nxhero.move(1, 1, 1)';
    const m = scriptMoves(body);
    expect(m.map((x) => [x.who, x.x, x.y, x.z, x.line])).toEqual([
      [{ kind: 'chara', row: 3 }, 1, 2, 3, 1],
      [{ kind: 'hero' }, 4, 5, 6, 2],
      [{ kind: 'self' }, -7, 8, 16, 3],
    ]);
    // the 3 of the obj row is not taken for a number
    expect(m[0]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['1', '2', '3']);
    expect(m[2]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['-7', '8', '0x10']);
    expect(withScriptMove(body, 0, 250, 0, 750).split('\n')[0]).toBe('obj(3).move(250, 0, 750)');
  });

  test('a position written as a variable or vec() is not a point', () => {
    expect(scriptMoves('move(hero, A, 0, 0)\nhero.MoveTo(vec(1, 2, 3), 0, 0, 0, 0, 0)')).toEqual([]);
  });

  test('reads who.SetPos(vec(x, y, z)) as a point', () => {
    const got = scriptMoves('obj(17).SetPos(vec(20000, 0, 20000))\nobj(17).SetPos(vec(3750, 0, 2750))');
    expect(got.map((m) => [m.who, m.x, m.y, m.z, m.line])).toEqual([
      [{ kind: 'chara', row: 17 }, 20000, 0, 20000, 1],
      [{ kind: 'chara', row: 17 }, 3750, 0, 2750, 2],
    ]);
    expect(withScriptMove('obj(17).SetPos(vec(3750, 0, 2750))', 0, 1250, 0, 250)).toBe(
      'obj(17).SetPos(vec(1250, 0, 250))',
    );
  });

  test('writes a new position into the k-th move() only', () => {
    const body = 'talk(0x10)\nmove(hero, 250, 5, 250)\nmove(obj(3), 1, 2, 3) // to the door\n';
    expect(withScriptMove(body, 1, 1000.004, 2, -750)).toBe(
      'talk(0x10)\nmove(hero, 250, 5, 250)\nmove(obj(3), 1000, 2, -750) // to the door\n',
    );
    expect(withScriptMove(body, 0, 12.5, 5, 0)).toBe(
      'talk(0x10)\nmove(hero, 12.5, 5, 0)\nmove(obj(3), 1, 2, 3) // to the door\n',
    );
    expect(withScriptMove(body, 2, 0, 0, 0)).toBe(body);
    // the text still compiles
    expect(() => scriptDocFromSource(`function f() {\n${withScriptMove(body, 1, 7, 8, 9)}}\n`)).not.toThrow();
  });

  test('coordText', () => {
    expect([coordText(1750), coordText(-0.0001), coordText(12.345), coordText(-3.5)]).toEqual([
      '1750',
      '0',
      '12.35',
      '-3.5',
    ]);
  });
});

describe('mapScriptMoves', () => {
  const doc: ScriptDoc = {
    vars: [],
    functions: [
      { name: 'walk', body: 'move(self, 500, 0, 750)\nmove(self, 1000, 0, 750)' },
      { name: 'elsewhere', body: 'move(hero, 0, 0, 0)' },
      { name: 'opening', body: 'move(hero, 250, 0, 250)' },
      { name: 'unbound', body: 'move(hero, 1, 1, 1)' },
      { name: 'still', body: 'talk(0x10)' },
    ],
    bindings: [
      { trigger: 'talk', group: 2, row: 7, fn: 'walk' },
      { trigger: 'talk', group: 2, row: 8, fn: 'elsewhere' },
      { trigger: 'start', group: 2, row: 0, fn: 'opening' },
      { trigger: 'talk', group: 2, row: 7, fn: 'still' },
    ],
  };

  test('the functions given to the records of the map and to its group start', () => {
    const got = mapScriptMoves(doc, 2, new Set([7]));
    expect(got.map((f) => [f.fn, f.rows, f.moves.map((m) => [m.x, m.z])])).toEqual([
      [
        'walk',
        [7],
        [
          [500, 750],
          [1000, 750],
        ],
      ],
      ['opening', [], [[250, 250]]],
    ]);
    expect(mapScriptMoves(doc, 3, new Set([7]))).toEqual([]);
  });
});

describe('sourceScriptMoves', () => {
  const source = [
    'var OPEN: bit',
    '',
    'function open_warp() {',
    '  OPEN = 1',
    '  obj(17).SetPos(vec(3750, 0, 2750))   // back',
    '}',
    '',
    'function unbound() {',
    '  move(hero, 1, 1, 1)',
    '}',
    '',
  ].join('\n');
  const bindings = [{ trigger: 'talk' as const, group: 2, row: 9, fn: 'open_warp' }];

  test('reads the bound functions of the editor text, with the lines and spans of the whole text', () => {
    const got = sourceScriptMoves(source, bindings, 2, new Set([9]));
    expect(got.map((f) => [f.fn, f.rows, f.moves.map((m) => [m.x, m.z, m.line])])).toEqual([
      ['open_warp', [9], [[3750, 2750, 5]]],
    ]);
    const written = withMoveAt(source, got[0]!.moves[0]!, 1250, 0, 750);
    expect(written.split('\n')[4]).toBe('  obj(17).SetPos(vec(1250, 0, 750))   // back');
    expect(written.split('\n').length).toBe(source.split('\n').length);
  });

  test('a text that does not read has no points', () => {
    expect(sourceScriptMoves('function f( {', bindings, 2, new Set([9]))).toEqual([]);
  });
});
