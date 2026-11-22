import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MOUSE } from 'three';
import type { LanaiContent } from './contents';
import {
  parseStageScript,
  scriptExprText,
  vecText,
  type ScriptArg,
  type ScriptNode,
  type ScriptWho,
} from './eventScript';
import { LanaiEditState } from './mapedit';
import type { LanaiMapInfo } from './maps';
import { LanaiMapView } from './mapview';
import { previewReferencedRows, runPreviewNodes } from './previewSequence';
import type { LanaiSession } from './session';
import { useAsync } from '../ui/useAsync';
import { soundPlayer } from '../sound/player';
import { requireAudible } from '../sound/render';

const whoText = (who: ScriptWho): string => (who.kind === 'chara' ? `obj(${who.row})` : who.kind);
const argText = (a: ScriptArg): string => {
  switch (a.k) {
    case 'i':
      return Math.abs(a.v) >= 0x40 ? `0x${(a.v >>> 0).toString(16).toUpperCase()}` : String(a.v);
    case 'f':
      return String(Math.round(a.v * 1000) / 1000);
    case 'v':
      return `vec(${a.x}, ${a.y}, ${a.z})`;
    case 'c':
    case 'p':
      return whoText(a.who);
    case 'own':
      return 'selfRow';
    case 'm':
      return '';
    case 'x':
      return scriptExprText(a.e);
    case 'vx':
      return vecText(a.e);
  }
};
/** A statement as the log shows it: the Script API call with its arguments. */
const previewCommand = (node: ScriptNode): string => {
  if (node.op !== 'call') return node.op;
  const c = node.call;
  const [cls, name] = c.name.split('::');
  const args = c.args
    .filter((a) => a.k !== 'm')
    .map(argText)
    .join(', ');
  return `${c.self ? whoText(c.self) : cls}.${name}(${args})`;
};

interface PreviewLogLine {
  text: string;
  skipped: boolean;
}

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
  const [log, setLog] = useState<PreviewLogLine[]>([]);
  const runId = useRef(0);
  const functionName = script.value?.functions.some((f) => f.name === selected)
    ? selected
    : (script.value?.functions[0]?.name ?? '');
  const fn = script.value?.functions.find((f) => f.name === functionName);
  const binding = script.value?.events.find((e) => e.fn === functionName && e.group === view.info.dungeon);
  const self = binding && binding.trigger !== 'start' && binding.trigger !== 'intro' ? binding.row : null;
  // the events the function names are marked among the numbers
  useEffect(() => {
    view.setIds(view.showIds, previewReferencedRows(fn?.body ?? [], self), null);
    return () => view.setIds(view.showIds, new Set(), null);
  }, [view, fn, self]);
  /** The event the statement acts on (its number is lit while it runs). */
  const rowOf = (who: ScriptWho | null | undefined): number | null =>
    !who || who.kind === 'hero' ? null : who.kind === 'self' ? self : who.row;
  useEffect(() => {
    view.scene.canvas.style.filter = `brightness(${1 - fade})`;
    return () => {
      view.scene.canvas.style.filter = '';
    };
  }, [view, fade]);

  const stop = (): void => {
    runId.current++;
    soundPlayer.stop();
    view.clearPreview();
    setRunning(false);
    setFade(0);
    setStatus('停止しました。マップの表示を戻しました。');
  };
  useEffect(() => {
    setRunning(false);
    setFade(0);
    setStatus('');
    setLog([]);
    return () => {
      runId.current++;
      soundPlayer.stop();
      view.clearPreview();
    };
  }, [view, source, functionName]);

  const play = async (): Promise<void> => {
    if (!fn) return;
    const clock = view.hostWindow;
    runId.current++;
    const id = runId.current;
    view.beginPreview(self);
    setFade(0);
    setRunning(true);
    setLog([]);
    onStart?.();
    const alive = (): boolean => runId.current === id;
    const animate = (seconds: number, update: (fraction: number) => void): Promise<void> =>
      new Promise((resolve) => {
        const start = clock.performance.now();
        let last = -Infinity;
        const step = (): void => {
          if (!alive()) return resolve();
          const now = clock.performance.now();
          const fraction = seconds <= 0 ? 1 : Math.min(1, (now - start) / (seconds * 1000));
          if (fraction >= 1 || now - last >= 40) {
            update(fraction);
            last = now;
          }
          if (fraction >= 1) resolve();
          else clock.requestAnimationFrame(step);
        };
        step();
      });
    const ensure = async (who: ScriptWho): Promise<void> => {
      await view.previewActor(who);
      if (!alive()) throw new Error('停止');
    };
    const lastAnim = new Map<string, number>();
    let returned = false;
    let skippedCount = 0;
    try {
      await runPreviewNodes(
        fn.body,
        alive,
        async (action, node, index) => {
          setStatus(`${index + 1} / ${fn.body.length}: ${previewCommand(node)}`);
          view.setIds(view.showIds, undefined, 'who' in action ? rowOf(action.who) : null);
          switch (action.kind) {
            case 'anim': {
              await ensure(action.who);
              const seconds = view.previewMotion(action.who, action.id);
              lastAnim.set(whoText(action.who), clock.performance.now() + seconds * 1000);
              break;
            }
            case 'waitAnim': {
              const until = lastAnim.get(whoText(action.who));
              if (until === undefined) throw new Error('対応する StartAnimation を再生できなかったため省略しました。');
              const remaining = Math.max(0, until - clock.performance.now()) / 1000;
              await animate(remaining, () => {});
              break;
            }
            case 'move': {
              await ensure(action.who);
              const from = view.previewPosition(action.who);
              const seconds = Math.min(10, Math.max(0.2, Math.hypot(action.x - from.x, action.z - from.z) / 500));
              await animate(seconds, (t) =>
                view.previewSetPosition(
                  action.who,
                  from.x + (action.x - from.x) * t,
                  from.y + (action.y - from.y) * t,
                  from.z + (action.z - from.z) * t,
                ),
              );
              break;
            }
            case 'turn':
              await ensure(action.who);
              view.previewSetAngle(action.who, action.degrees);
              await animate(0.4, () => {});
              break;
            case 'face': {
              await ensure(action.who);
              await ensure(action.to);
              const a = view.previewPosition(action.who),
                b = view.previewPosition(action.to);
              view.previewSetAngle(action.who, (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI);
              break;
            }
            case 'show':
              await ensure(action.who);
              view.previewSetVisible(action.who, action.on);
              break;
            case 'none':
              break;
            case 'camera':
              if (action.who) {
                await ensure(action.who);
                view.previewFocus(action.who);
              } else view.fit();
              await animate(action.seconds, () => {});
              break;
            case 'fade': {
              const from = action.out ? 0 : 1,
                to = action.out ? 1 : 0;
              await animate(action.seconds, (t) => setFade(from + (to - from) * t));
              break;
            }
            case 'wait':
              await animate(action.seconds, () => {});
              break;
            case 'se': {
              const session = view.st.maps.session;
              const sounds = await session.sounds();
              const index = sounds.index(action.id);
              if (index === null) throw new Error(`SoundData 行 ${action.id} に音がありません。`);
              await soundPlayer.play(
                `preview:lanai:${index}`,
                async () => requireAudible(await (await session.soundRendererFor(action.id)).render(index, 8, false)),
                false,
              );
              if (soundPlayer.state.error) throw new Error(soundPlayer.state.error.message);
              break;
            }
            case 'return':
              setStatus('return で終了しました。');
              returned = true;
              break;
          }
          if (alive())
            setLog((previous) => [...previous, { text: `${index + 1}. ${previewCommand(node)}`, skipped: false }]);
        },
        (node, index, reason) => {
          skippedCount++;
          setLog((previous) => [
            ...previous,
            { text: `${index + 1}. ${previewCommand(node)} — ${reason}`, skipped: true },
          ]);
          setStatus(`${index + 1} / ${fn.body.length}: ${previewCommand(node)} を省略`);
        },
      );
      if (alive() && !returned)
        setStatus(`再生が終わりました${skippedCount ? `（${skippedCount} 件を省略）` : ''}。停止で表示を戻せます。`);
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
      <pre className="script-preview-log" role="log" aria-label="プレビューのログ" aria-live="polite">
        <code>
          {log.length
            ? log.map((line, index) => (
                <span key={index} className={line.skipped ? 'script-preview-skipped' : undefined}>
                  {line.text}
                </span>
              ))
            : '再生すると命令のログが表示されます。'}
        </code>
      </pre>
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
  onMap,
  onInsert,
}: {
  session: LanaiSession;
  content: LanaiContent;
  source: string;
  /** Told the map shown (its MapGroup is the one the editor's lines of talk are of). */
  onMap?: (info: LanaiMapInfo | undefined) => void;
  /** Writes a text at the editor's cursor (obj(N) of a picked event). */
  onInsert?: (text: string) => void;
}): ReactNode {
  const [showIds, setShowIds] = useState(true);
  const [picked, setPicked] = useState<number | null>(null);
  const loaded = useAsync(() => import('./maps').then((m) => m.lanaiMaps(session, content)), [session, content]);
  const maps = loaded && !(loaded instanceof Error) ? loaded : null;
  const [name, setName] = useState('');
  const [view, setView] = useState<LanaiMapView | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const options = maps?.maps.filter((m) => !m.world) ?? [];
  const info = options.find((m) => m.name === name) ?? options[0];
  const latestOnMap = useRef(onMap);
  latestOnMap.current = onMap;
  useEffect(() => latestOnMap.current?.(info), [info]);
  useEffect(() => {
    if (!maps || !info || !host.current) return;
    const container = host.current;
    const hostWindow = container.ownerDocument.defaultView ?? window;
    // The wheel belongs to OrbitControls while the pointer is over the preview. Keep the docs pane still.
    const preventOuterScroll = (event: WheelEvent): void => event.preventDefault();
    // Firefox's middle-click autoscroll otherwise competes with OrbitControls' middle-button pan.
    const preventMiddleDrag = (event: MouseEvent | PointerEvent): void => {
      if (event.button === 1) event.preventDefault();
    };
    container.addEventListener('wheel', preventOuterScroll, { capture: true, passive: false });
    const state = new LanaiEditState(maps);
    state.open(info);
    const next = new LanaiMapView(state, info, hostWindow);
    next.scene.pointer = null;
    next.scene.controls.mouseButtons.LEFT = MOUSE.ROTATE;
    next.scene.pixelRatioLimit = 1;
    next.showMoves = false;
    next.showLinks = false;
    next.scene.canvas.addEventListener('pointerdown', preventMiddleDrag, { capture: true });
    next.scene.canvas.addEventListener('mousedown', preventMiddleDrag, { capture: true });
    next.scene.canvas.addEventListener('auxclick', preventMiddleDrag);
    container.append(next.scene.canvas);
    // a click (not a drag) on a number picks its event
    let down: [number, number] | null = null;
    const press = (event: PointerEvent): void => {
      down = [event.clientX, event.clientY];
    };
    const release = (event: PointerEvent): void => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) return;
      const row = next.pickId(event.clientX, event.clientY);
      if (row !== null) setPicked(row);
    };
    next.scene.canvas.addEventListener('pointerdown', press);
    next.scene.canvas.addEventListener('pointerup', release);
    setView(next);
    setPicked(null);
    const frame = hostWindow.requestAnimationFrame(() => {
      next.scene.resizeToCanvas();
      next.fit();
    });
    return () => {
      hostWindow.cancelAnimationFrame(frame);
      container.removeEventListener('wheel', preventOuterScroll, true);
      next.scene.canvas.removeEventListener('pointerdown', preventMiddleDrag, true);
      next.scene.canvas.removeEventListener('mousedown', preventMiddleDrag, true);
      next.scene.canvas.removeEventListener('auxclick', preventMiddleDrag);
      next.scene.canvas.removeEventListener('pointerdown', press);
      next.scene.canvas.removeEventListener('pointerup', release);
      next.scene.canvas.remove();
      next.dispose();
      state.dispose();
      setView(null);
    };
  }, [maps, info]);
  useEffect(() => view?.setIds(showIds), [view, showIds]);
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
      {view && (
        <div className="row small">
          <label>
            <input type="checkbox" checked={showIds} onChange={(e) => setShowIds(e.target.checked)} />
            イベント番号 (#N) を表示
          </label>
          <span className="muted">
            黄色は選んだ関数が使うイベント、白は再生中に動かしているもの。番号をクリックすると obj(番号) を書けます。
          </span>
        </div>
      )}
      {view && picked !== null && (
        <div className="row small">
          <span>{view.eventLabel(picked)}</span>
          {onInsert && (
            <button className="small" onClick={() => onInsert(`obj(${picked})`)}>
              {`obj(${picked}) をカーソルの位置に書く`}
            </button>
          )}
          <button className="small" onClick={() => setPicked(null)}>
            閉じる
          </button>
        </div>
      )}
      {view && <p className="muted small">ドラッグで回転、ホイールで拡大・縮小できます。</p>}
      {view && <ScriptPreviewControls key={info?.hash} view={view} source={source} />}
    </section>
  );
}
