import type { ScriptArg, ScriptCall, ScriptNode, ScriptWho } from './eventScript';

/** What the map's preview shows of a statement: the Script API calls it can show, read from their arguments. */
export type PreviewAction =
  | { kind: 'anim'; who: ScriptWho; id: number }
  | { kind: 'waitAnim'; who: ScriptWho }
  | { kind: 'move'; who: ScriptWho; x: number; y: number; z: number }
  | { kind: 'turn'; who: ScriptWho; degrees: number }
  | { kind: 'face'; who: ScriptWho; to: ScriptWho }
  | { kind: 'show'; who: ScriptWho; on: boolean }
  /** The camera to an object, or (null) back to the field's. */
  | { kind: 'camera'; who: ScriptWho | null; seconds: number }
  | { kind: 'fade'; out: boolean; seconds: number }
  | { kind: 'wait'; seconds: number }
  | { kind: 'se'; id: number }
  /** A call with nothing to show on the map (the camera paused, a wait the preview does not need). */
  | { kind: 'none' }
  | { kind: 'return' };

const numberOf = (a: ScriptArg | undefined): number | null => (a && (a.k === 'i' || a.k === 'f') ? a.v : null);
const whoOf = (a: ScriptArg | undefined): ScriptWho | null => (a && (a.k === 'c' || a.k === 'p') ? a.who : null);
/** The arguments as the author wrote them (without the ScriptMessageParams). */
const written = (c: ScriptCall): ScriptArg[] => c.args.filter((a) => a.k !== 'm');

/** What a call shows on the map, or null when the preview cannot show it. */
function callAction(c: ScriptCall): PreviewAction | null {
  const [a, b] = written(c);
  const [n0, n1] = [numberOf(a), numberOf(b)];
  const self = c.self;
  switch (c.name) {
    case 'ScriptChara::StartAnimation':
    case 'ScriptPlayer::StartAnimation':
      return self && n0 !== null ? { kind: 'anim', who: self, id: n0 } : null;
    case 'ScriptChara::WaitAnimation':
      return self ? { kind: 'waitAnim', who: self } : null;
    case 'ScriptChara::MoveTo':
      return self && a?.k === 'v' ? { kind: 'move', who: self, x: a.x, y: a.y, z: a.z } : null;
    case 'ScriptChara::RotateTo':
      return self && n0 !== null ? { kind: 'turn', who: self, degrees: (n0 * 180) / Math.PI } : null;
    case 'ScriptChara::RotateCharaTo': {
      const to = whoOf(a);
      return self && to ? { kind: 'face', who: self, to } : null;
    }
    case 'ScriptChara::SetVisible':
      return self && n0 !== null ? { kind: 'show', who: self, on: n0 !== 0 } : null;
    case 'ScriptCamera::MoveEyeAndTarget': {
      const to = whoOf(a);
      return to && n1 !== null ? { kind: 'camera', who: to, seconds: n1 } : null;
    }
    case 'ScriptCamera::MoveFieldCamera':
      return n0 !== null ? { kind: 'camera', who: null, seconds: n0 } : null;
    case 'ScriptSystem::FadeOutWait':
    case 'ScriptSystem::FadeOut':
    case 'ScriptSystem::FadeInWait':
    case 'ScriptSystem::FadeIn':
      return n0 !== null ? { kind: 'fade', out: c.name.includes('Out'), seconds: n0 } : null;
    case 'ScriptSystem::WaitTime':
      return n0 !== null ? { kind: 'wait', seconds: n0 } : null;
    case 'ScriptSound::Play':
      return n0 !== null ? { kind: 'se', id: n0 } : null;
    case 'ScriptCamera::PauseCameraUpdater':
    case 'ScriptCamera::ResumeCameraUpdater':
    case 'ScriptCamera::WaitAnimation':
    case 'ScriptChara::WaitNodeAnimation':
      return { kind: 'none' };
  }
  return null;
}

/** What the preview does for a statement, or why it cannot (a string). Conditions need the game's state. */
export function previewAction(node: ScriptNode): PreviewAction | string {
  switch (node.op) {
    case 'call':
      return callAction(node.call) ?? `${node.call.name} はプレビューできません。省略しました。`;
    case 'return':
      return { kind: 'return' };
    case 'if':
    case 'switch':
      return '条件分岐にはゲーム中の状態が必要です。分岐全体を省略しました。';
    default:
      return `${node.op} はプレビューできません。省略しました。`;
  }
}

/** Execute in source order, skip unsupported or failed actions, and end after return. */
export async function runPreviewNodes(
  nodes: readonly ScriptNode[],
  alive: () => boolean,
  execute: (action: PreviewAction, node: ScriptNode, index: number) => Promise<void>,
  skipped: (node: ScriptNode, index: number, reason: string) => void,
): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    if (!alive()) return;
    const action = previewAction(node);
    if (typeof action === 'string') {
      skipped(node, index, action);
      continue;
    }
    try {
      await execute(action, node, index);
    } catch (e) {
      if (!alive()) return;
      skipped(node, index, (e as Error).message);
      continue;
    }
    if (action.kind === 'return') return;
  }
}
