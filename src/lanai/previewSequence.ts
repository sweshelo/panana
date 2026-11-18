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
    case 'se':
    case 'return':
      return null;
    case 'if':
    case 'switch':
      return '条件分岐にはゲーム中の状態が必要です。分岐全体を省略しました。';
    case 'call':
      return 'Script API 呼び出しはプレビューできません。省略しました。';
    default:
      return `${node.op} はプレビューできません。省略しました。`;
  }
}

/** Execute in source order, skip unsupported or failed actions, and end after return. */
export async function runPreviewNodes(
  nodes: readonly ScriptNode[],
  alive: () => boolean,
  execute: (node: ScriptNode, index: number) => Promise<void>,
  skipped: (node: ScriptNode, index: number, reason: string) => void,
): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    if (!alive()) return;
    const problem = previewProblem(node);
    if (problem) {
      skipped(node, index, problem);
      continue;
    }
    try {
      await execute(node, index);
    } catch (e) {
      if (!alive()) return;
      skipped(node, index, (e as Error).message);
      continue;
    }
    if (node.op === 'return') return;
  }
}
