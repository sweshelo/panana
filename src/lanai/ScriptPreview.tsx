import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LanaiContent } from './contents';
import { parseStageScript, type ScriptWho } from './eventScript';
import { LanaiEditState } from './mapedit';
import type { LanaiMapInfo } from './maps';
import { LanaiMapView } from './mapview';
import { previewProblem, runPreviewNodes } from './previewSequence';
import type { LanaiSession } from './session';
import { useAsync } from '../ui/useAsync';

const whoText = (who: ScriptWho): string => (who.kind === 'chara' ? `chara(${who.row})` : who.kind);

export function ScriptPreviewControls({
  view,
  source,
  onStart,
}: {
  view: LanaiMapView;
  source: string;
  onStart?: () => void;
}): ReactNode {
  const script = useMemo(() => {
    try {
      return { value: parseStageScript(source), error: '' };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [source]);
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [fade, setFade] = useState(0);
  const runId = useRef(0);
  const functionName = script.value?.functions.some((f) => f.name === selected)
    ? selected
    : (script.value?.functions[0]?.name ?? '');
  const fn = script.value?.functions.find((f) => f.name === functionName);
  const binding = script.value?.events.find((e) => e.fn === functionName && e.group === view.info.dungeon);
  const self = binding && binding.trigger !== 'start' && binding.trigger !== 'intro' ? binding.row : null;
  const unsupported =
    fn?.body.flatMap((n, i) => {
      const p = previewProblem(n);
      return p ? [`${i + 1}. ${p}`] : [];
    }) ?? [];

  useEffect(() => {
    view.scene.canvas.style.filter = `brightness(${1 - fade})`;
    return () => {
      view.scene.canvas.style.filter = '';
    };
  }, [view, fade]);

  const stop = (): void => {
    runId.current++;
    view.clearPreview();
    setRunning(false);
    setFade(0);
    setStatus('停止しました。マップの表示を戻しました。');
  };
  useEffect(() => {
    setRunning(false);
    setFade(0);
    setStatus('');
    return () => {
      runId.current++;
      view.clearPreview();
    };
  }, [view, source, functionName]);

  const play = async (): Promise<void> => {
    if (!fn) return;
    runId.current++;
    const id = runId.current;
    view.beginPreview(self);
    setFade(0);
    setRunning(true);
    onStart?.();
    const alive = (): boolean => runId.current === id;
    const animate = (seconds: number, update: (fraction: number) => void): Promise<void> =>
      new Promise((resolve) => {
        const start = performance.now();
        const step = (): void => {
          if (!alive()) return resolve();
          const fraction = seconds <= 0 ? 1 : Math.min(1, (performance.now() - start) / (seconds * 1000));
          update(fraction);
          view.previewTick();
          if (fraction >= 1) resolve();
          else requestAnimationFrame(step);
        };
        step();
      });
    const ensure = async (who: ScriptWho): Promise<void> => {
      await view.previewActor(who);
      if (!alive()) throw new Error('停止');
    };
    const lastAnim = new Map<string, number>();
    let returned = false;
    try {
      await runPreviewNodes(fn.body, alive, async (node, index) => {
        setStatus(`${index + 1} / ${fn.body.length}: ${node.op}`);
        switch (node.op) {
          case 'anim': {
            await ensure(node.who);
            const seconds = view.previewMotion(node.who, node.id);
            lastAnim.set(whoText(node.who), performance.now() + seconds * 1000);
            break;
          }
          case 'waitAnim': {
            const remaining = Math.max(0, (lastAnim.get(whoText(node.who)) ?? 0) - performance.now()) / 1000;
            await animate(remaining, () => {});
            break;
          }
          case 'move': {
            await ensure(node.who);
            const from = view.previewPosition(node.who);
            const seconds = Math.min(10, Math.max(0.2, Math.hypot(node.x - from.x, node.z - from.z) / 500));
            await animate(seconds, (t) =>
              view.previewSetPosition(
                node.who,
                from.x + (node.x - from.x) * t,
                from.y + (node.y - from.y) * t,
                from.z + (node.z - from.z) * t,
              ),
            );
            break;
          }
          case 'turn':
            await ensure(node.who);
            view.previewSetAngle(node.who, node.degrees);
            await animate(0.4, () => {});
            break;
          case 'face': {
            await ensure(node.who);
            await ensure(node.to);
            const a = view.previewPosition(node.who),
              b = view.previewPosition(node.to);
            view.previewSetAngle(node.who, (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI);
            break;
          }
          case 'show':
            await ensure(node.who);
            view.previewSetVisible(node.who, node.on);
            break;
          case 'camera':
            if (node.who) {
              await ensure(node.who);
              view.previewFocus(node.who);
            } else view.fit();
            await animate(node.seconds, () => {});
            break;
          case 'fade': {
            const from = node.out ? 0 : 1,
              to = node.out ? 1 : 0;
            await animate(node.seconds, (t) => setFade(from + (to - from) * t));
            break;
          }
          case 'wait':
            await animate(node.seconds, () => {});
            break;
          case 'return':
            setStatus('return で終了しました。');
            returned = true;
            break;
        }
      });
      if (alive() && !returned) setStatus('再生が終わりました。停止で表示を戻せます。');
    } catch (e) {
      if (alive()) setStatus((e as Error).message);
    } finally {
      if (alive()) setRunning(false);
    }
  };

  return (
    <div className="script-preview-controls">
      <div className="row">
        <label>
          関数{' '}
          <select value={functionName} onChange={(e) => setSelected(e.target.value)}>
            {(script.value?.functions ?? []).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!fn || running} onClick={() => void play()}>
          ▶ 再生
        </button>
        <button onClick={stop}>■ 停止・リセット</button>
      </div>
      {script.error && <p className="error small">{script.error}</p>}
      {!script.error && !fn && <p className="muted small">プレビューする関数がありません。</p>}
      {fn && (
        <p className="muted small">
          MapGroup {view.info.dungeon} / {view.info.name}
          {self !== null ? ` / self: イベント ${self}` : ''}
        </p>
      )}
      {unsupported.length > 0 && <p className="muted small">停止する命令: {unsupported.join(' / ')}</p>}
      {status && (
        <p className="small" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

/** The full-source page owns a separate, read-only map view for its preview. */
export function StagePreviewScene({
  session,
  content,
  source,
}: {
  session: LanaiSession;
  content: LanaiContent;
  source: string;
}): ReactNode {
  const loaded = useAsync(() => import('./maps').then((m) => m.lanaiMaps(session, content)), [session, content]);
  const maps = loaded && !(loaded instanceof Error) ? loaded : null;
  const [name, setName] = useState('');
  const [view, setView] = useState<LanaiMapView | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const options = maps?.maps.filter((m) => !m.world) ?? [];
  const info = options.find((m) => m.name === name) ?? options[0];
  useEffect(() => {
    if (!maps || !info || !host.current) return;
    const state = new LanaiEditState(maps);
    state.open(info);
    const next = new LanaiMapView(state, info);
    next.scene.pointer = null;
    next.showMoves = false;
    next.showLinks = false;
    host.current.append(next.scene.canvas);
    setView(next);
    const frame = requestAnimationFrame(() => next.fit());
    return () => {
      cancelAnimationFrame(frame);
      next.scene.canvas.remove();
      next.dispose();
      state.dispose();
      setView(null);
    };
  }, [maps, info]);
  return (
    <section className="stage-preview" aria-label="演出プレビュー">
      <div className="row">
        <h3>演出プレビュー</h3>
        <label>
          マップ{' '}
          <select value={info?.name ?? ''} onChange={(e) => setName(e.target.value)}>
            {options.map((m: LanaiMapInfo) => (
              <option key={m.hash} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loaded instanceof Error && <p className="error small">{loaded.message}</p>}
      {!loaded && <p className="muted small">マップを読み込み中…</p>}
      <div className="stage-preview-canvas" ref={host} />
      {view && <ScriptPreviewControls key={info?.hash} view={view} source={source} />}
    </section>
  );
}
