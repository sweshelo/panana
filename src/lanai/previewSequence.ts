import type { ScriptNode } from './eventScript';

/** Only actions with a local, reversible representation can run. Conditions need the game's state. */
export function previewProblem(node: ScriptNode): string | null {
  switch (node.op) {
    case 'anim':
    case 'waitAnim':
    case 'move':
    case 'turn':
    case 'face':
    case 'show':
    case 'camera':
    case 'fade':
    case 'wait':
    case 'return':
      return null;
    case 'se':
      return 'se() の番号と音の表の対応は未確認です。誤った音を鳴らさないため停止しました。';
    case 'if':
    case 'switch':
      return '条件分岐にはゲーム中の状態が必要です。ここで停止しました。';
    case 'call':
      return 'Script API 呼び出しはプレビューできません。ここで停止しました。';
    default:
      return `${node.op} はプレビューできません。ここで停止しました。`;
  }
}

/** Execute in source order and stop before an unsupported action or after return. */
export async function runPreviewNodes(
  nodes: readonly ScriptNode[],
  alive: () => boolean,
  execute: (node: ScriptNode, index: number) => Promise<void>,
): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    if (!alive()) return;
    const problem = previewProblem(node);
    if (problem) throw new Error(`${index + 1} 番目: ${problem}`);
    await execute(node, index);
    if (node.op === 'return') return;
  }
}
