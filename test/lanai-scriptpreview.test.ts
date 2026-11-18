import { expect, test } from 'bun:test';
import { parseStageScript } from '../src/lanai/eventScript';
import { runPreviewNodes } from '../src/lanai/previewSequence';

const body = (source: string) => parseStageScript(`function demo() { ${source} }`).functions[0]!.body;

test('preview preserves source order and skips an unverified sound', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body('move(hero, 250, 0, 250); wait(0.1); se(0x84); turn(hero, 90)'),
    () => true,
    async (node) => {
      seen.push(node.op);
    },
    (node, index, reason) => {
      seen.push(`skip ${index + 1}: ${node.op}`);
      expect(reason).toContain('音の再生を省略');
    },
  );
  expect(seen).toEqual(['move', 'wait', 'skip 3: se', 'turn']);
});

test('preview cancellation and return prevent later actions', async () => {
  const seen: string[] = [];
  let live = true;
  await runPreviewNodes(
    body('move(hero, 250, 0, 250); turn(hero, 90)'),
    () => live,
    async (node) => {
      seen.push(node.op);
      live = false;
    },
    () => {},
  );
  expect(seen).toEqual(['move']);

  seen.length = 0;
  await runPreviewNodes(
    body('return; turn(hero, 90)'),
    () => true,
    async (node) => {
      seen.push(node.op);
    },
    () => {},
  );
  expect(seen).toEqual(['return']);
});

test('preview skips a branch without guessing game state, then continues', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body('if (monsters() == 0) { turn(hero, 90) }; move(hero, 250, 0, 250)'),
    () => true,
    async (node) => {
      seen.push(node.op);
    },
    (node, _index, reason) => {
      seen.push(`skip ${node.op}`);
      expect(reason).toContain('分岐全体を省略');
    },
  );
  expect(seen).toEqual(['skip if', 'move']);
});

test('preview logs a failed visual action and continues', async () => {
  const seen: string[] = [];
  await runPreviewNodes(
    body('anim(hero, 0x80000003); turn(hero, 90)'),
    () => true,
    async (node) => {
      if (node.op === 'anim') throw new Error('モデルにモーションがありません');
      seen.push(node.op);
    },
    (node, _index, reason) => seen.push(`skip ${node.op}: ${reason}`),
  );
  expect(seen).toEqual(['skip anim: モデルにモーションがありません', 'turn']);
});
