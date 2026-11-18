import { expect, test } from 'bun:test';
import { parseStageScript } from '../src/lanai/eventScript';
import { runPreviewNodes } from '../src/lanai/previewSequence';

const body = (source: string) => parseStageScript(`function demo() { ${source} }`).functions[0]!.body;

test('preview preserves source order and stops before an unverified sound', async () => {
  const seen: string[] = [];
  await expect(
    runPreviewNodes(
      body('move(hero, 250, 0, 250); wait(0.1); se(0x84); turn(hero, 90)'),
      () => true,
      async (node) => {
        seen.push(node.op);
      },
    ),
  ).rejects.toThrow('3 番目: se()');
  expect(seen).toEqual(['move', 'wait']);
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
  );
  expect(seen).toEqual(['move']);

  seen.length = 0;
  await runPreviewNodes(
    body('return; turn(hero, 90)'),
    () => true,
    async (node) => {
      seen.push(node.op);
    },
  );
  expect(seen).toEqual(['return']);
});

test('preview never guesses a branch from unknown game state', async () => {
  const seen: string[] = [];
  await expect(
    runPreviewNodes(
      body('if (monsters() == 0) { turn(hero, 90) }'),
      () => true,
      async (node) => {
        seen.push(node.op);
      },
    ),
  ).rejects.toThrow('条件分岐にはゲーム中の状態が必要');
  expect(seen).toEqual([]);
});
