import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { LanaiConditionEditor } from './ConditionEditor';
import type { LanaiContent, LanaiStage } from './contents';
import type { LanaiSession } from './session';
import type { LanaiCondition } from './conditions';
import { cloneLanaiContent, editLanaiStage } from './stageEdit';
export function LanaiStageEditor({ session, content, stage, onClose }: { session: LanaiSession; content: LanaiContent; stage: LanaiStage; onClose: () => void }): ReactNode {
  const [order, setOrder] = useState(stage.order), [stamina, setStamina] = useState(stage.stamina);
  const [visible, setVisible] = useState(stage.visible);
  const [hidden, setHidden] = useState(stage.hidden);
  const pendingScripts = useRef(new Map<number, string>());
  const script = (source: string, change: (value: LanaiCondition) => void): void => {
    const id = Math.max(0, ...session.conditionScripts.keys(), ...pendingScripts.current.keys()) + 1;
    pendingScripts.current.set(id, source); change({kind:0x72, v1:id, v2:0});
  };
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog title="ステージを編集" onClose={onClose}>
    <label className="field"><span>並び順</span><input type="number" min={0} max={4294967295} value={order} onChange={e => setOrder(Number(e.target.value))} /></label>
    <label className="field"><span>必要なスタミナ</span><input type="number" min={0} max={255} value={stamina} onChange={e => setStamina(Number(e.target.value))} /></label>
    <h3>表示・解放条件</h3>
    <p className="small muted">条件が成立すると表示されます。条件なし (0) はいつも表示します。</p>
    <LanaiConditionEditor session={session} value={visible} onChange={setVisible} onScript={source => script(source, setVisible)} />
    <h3>表示しない条件</h3>
    <p className="small muted">この条件が成立すると非表示になります。条件なし (0) は非表示にしません。配信・期限などによる制限は別にあります。</p>
    <LanaiConditionEditor session={session} value={hidden} onChange={setHidden} onScript={source => script(source, setHidden)} />
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={busy} className="primary" onClick={async () => { setBusy(true); try {
      for (const c of [visible, hidden]) if (c.kind === 0x72 && pendingScripts.current.has(c.v1)) session.setConditionScript(c.v1, pendingScripts.current.get(c.v1)!);
      session.codeIps(); // validate version, conflicts and available code space before committing table edits
      await editLanaiStage(session, content, stage, { order, stamina, visible, hidden }); onClose();
    } catch(e) {
      for (const id of pendingScripts.current.keys()) session.conditionScripts.delete(id);
      setError((e as Error).message); setBusy(false);
    } }}>保存</button>
  </Dialog>;
}
export function LanaiContentCreator({ session, content, onClose }: { session: LanaiSession; content: LanaiContent; onClose: () => void }): ReactNode {
  const [title, setTitle] = useState('新しいステージ'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog title="コンテンツを複製して追加" onClose={onClose}>
    <p>選択したステージのマップ・敵・宝・店・会話を写し、新しいコンテンツ番号で追加します。</p>
    <label className="field"><span>ステージ名</span><input value={title} onChange={e => setTitle(e.target.value)} /></label>
    <p className="muted small">実験機能です。元の CRO のイベントコードも写します。元のコンテンツ番号をコード内で使う処理やセーブの共有は自動変換しません。コンテンツ数のゲーム側の上限と実機での動作は未確認です。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={busy || !title.trim()} className="primary" onClick={async () => { setBusy(true); try { const index = await cloneLanaiContent(session, content, title); location.hash = `#/stages/${index}`; onClose(); } catch(e) { setError((e as Error).message); setBusy(false); } }}>{busy ? '作成中…' : '追加する'}</button>
  </Dialog>;
}
