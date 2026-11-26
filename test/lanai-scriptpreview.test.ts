import { expect, test } from 'bun:test';
import { parseStageScript } from '../src/lanai/eventScript';
import { previewAction, previewReferencedRows, runPreviewNodes } from '../src/lanai/previewSequence';

const body = (source: string) => parseStageScript(`function demo() { ${source} }`).functions[0]!.body;

test('the library and Script API calls the preview shows', () => {
  expect(body('move(hero, 250, 0, 750)').map(previewAction)).toEqual([
    { kind: 'move', who: { kind: 'hero' }, x: 250, y: 0, z: 750 },
    { kind: 'none' },
  ]);
  const turn = previewAction(body('obj(3).turn(90)')[0]!);
  expect(turn).toMatchObject({ kind: 'turn', who: { kind: 'chara', row: 3 } });
  expect(typeof turn !== 'string' && turn.kind === 'turn' && Math.round(turn.degrees)).toBe(90);
  expect(body('camera(obj(4), 1.5)').map(previewAction)).toEqual([
    { kind: 'none' },
    { kind: 'camera', who: { kind: 'chara', row: 4 }, seconds: 1.5 },
    { kind: 'none' },
  ]);
  expect(previewAction(body('ScriptSystem.FadeOutWait(0.5, 2)')[0]!)).toEqual({
    kind: 'fade',
    out: true,
    seconds: 0.5,
  });
  expect(previewAction(body('hero.StartAnimation(0x80000003, 0, 1, 0)')[0]!)).toEqual({
    kind: 'anim',
    who: { kind: 'hero' },
    id: 0x80000003,
  });
  expect(previewAction(body('ScriptFlag.AddGold(5)')[0]!)).toContain('プレビューできません');
});

test('preview preserves source order and runs a sound', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body(
      'hero.MoveTo(vec(250, 0, 250), 0, 0, 0, 0, 0); ScriptSystem.WaitTime(0.1); ScriptSound.Play(0x7A, 0); turn(hero, 90)',
    ),
    () => true,
    async (action) => {
      seen.push(action.kind);
    },
    () => {
      throw new Error('音の実行を省略してはいけません');
    },
  );
  expect(seen).toEqual(['move', 'wait', 'se', 'turn', 'wait']);
});

test('preview cancellation and return prevent later actions', async () => {
  const seen: string[] = [];
  let live = true;
  await runPreviewNodes(
    body('hero.SetVisible(0); turn(hero, 90)'),
    () => live,
    async (action) => {
      seen.push(action.kind);
      live = false;
    },
    () => {},
  );
  expect(seen).toEqual(['show']);

  seen.length = 0;
  await runPreviewNodes(
    body('return; turn(hero, 90)'),
    () => true,
    async (action) => {
      seen.push(action.kind);
    },
    () => {},
  );
  expect(seen).toEqual(['return']);
});

test('preview skips a branch without guessing game state, then continues', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body('if (ScriptMap.GetMonsterLimitCount() == 0) { turn(hero, 90) }; hero.SetVisible(1)'),
    () => true,
    async (action) => {
      seen.push(action.kind);
    },
    (node, _index, reason) => {
      seen.push(`skip ${node.op}`);
      expect(reason).toContain('分岐全体を省略');
    },
  );
  expect(seen).toEqual(['skip if', 'show']);
});

test('preview logs a failed visual action and continues', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body('hero.StartAnimation(0x80000003, 0, 1, 0); hero.SetVisible(1)'),
    () => true,
    async (action) => {
      if (action.kind === 'anim') throw new Error('モデルにモーションがありません');
      seen.push(action.kind);
    },
    (node, _index, reason) => seen.push(`skip ${node.op}: ${reason}`),
  );
  expect(seen).toEqual(['skip call: モデルにモーションがありません', 'show']);
});

test('the events a function names are found for the preview to mark', () => {
  const rows = (source: string, self: number | null = null) =>
    [...previewReferencedRows(body(source), self)].sort((a, b) => a - b);
  // obj(N) as the receiver, as an argument, and after the library's functions are written out
  expect(rows('face(obj(3), hero); camera(obj(7), 1)')).toEqual([3, 7]);
  // the event numbers of the calls that take one, and inside a condition's branches
  expect(rows('openDoor(5); if (ScriptMap.GetMapChara(9)) { ScriptMap.DeleteEventObject(9) }')).toEqual([5, 9]);
  // self is the event the function is given to
  expect(rows('talk(0x80000001)', 12)).toEqual([12]);
  expect(rows('talk(0x80000001)')).toEqual([]);
  expect(rows('hero.SetVisible(false)')).toEqual([]);
});
