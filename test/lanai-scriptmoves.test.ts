// The move() statements of a script as points on a map (scriptMoves.ts): reading them from a function's text and
// writing a new position back into it.
import { describe, expect, test } from 'bun:test';
import { scriptDocFromSource, type ScriptDoc } from '../src/lanai/eventScript';
import { coordText, mapScriptMoves, scriptMoves, withScriptMove } from '../src/lanai/scriptMoves';

describe('scriptMoves', () => {
  test('reads whom and where, skipping comments', () => {
    const body = [
      'move(hero, 1750, 0, 2750)',
      '// move(hero, 1, 2, 3)',
      '/* move(self, 9, 9, 9) */',
      'move( chara( 0x0C ) , -250.5 ,10, 0x1F4 )',
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
    // the 3 of self's x is not the 3 of a chara row before it
    expect(m[2]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['3', '3', '3']);
  });

  test('reads who.move(x, y, z) as well, in the order of the text', () => {
    const body = 'chara(3).move(1, 2, 3)\nmove(hero, 4, 5, 6)\nself . move( -7 , 8, 0x10 )\nxhero.move(1, 1, 1)';
    const m = scriptMoves(body);
    expect(m.map((x) => [x.who, x.x, x.y, x.z, x.line])).toEqual([
      [{ kind: 'chara', row: 3 }, 1, 2, 3, 1],
      [{ kind: 'hero' }, 4, 5, 6, 2],
      [{ kind: 'self' }, -7, 8, 16, 3],
    ]);
    // the 3 of the chara row is not taken for a number
    expect(m[0]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['1', '2', '3']);
    expect(m[2]!.spans.map(([a, b]) => body.slice(a, b))).toEqual(['-7', '8', '0x10']);
    expect(withScriptMove(body, 0, 250, 0, 750).split('\n')[0]).toBe('chara(3).move(250, 0, 750)');
  });

  test('a position written as a variable or vec() is not a point', () => {
    expect(scriptMoves('move(hero, A, 0, 0)\nhero.MoveTo(vec(1, 2, 3), 0, 0, 0, 0, 0)')).toEqual([]);
  });

  test('writes a new position into the k-th move() only', () => {
    const body = 'talk(0x10)\nmove(hero, 250, 5, 250)\nmove(chara(3), 1, 2, 3) // to the door\n';
    expect(withScriptMove(body, 1, 1000.004, 2, -750)).toBe(
      'talk(0x10)\nmove(hero, 250, 5, 250)\nmove(chara(3), 1000, 2, -750) // to the door\n',
    );
    expect(withScriptMove(body, 0, 12.5, 5, 0)).toBe(
      'talk(0x10)\nmove(hero, 12.5, 5, 0)\nmove(chara(3), 1, 2, 3) // to the door\n',
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
