// Giving a monster the look of another game's monster (#100): a button for the monster pages, shown when dumps of
// other games are open, and the picker of those games' looks (photos by game, filtered by name).
import { useState, type ReactNode } from 'react';
import { altIdle, giveMonsterLook, setAltIdle } from '../port/apply';
import { giveItemModel, itemLooks, type ItemLook } from '../port/items';
import { monsterLooks, type MonsterLook } from '../port/looks';
import { TITLES, type TitleKey } from '../rom/titles';
import { Dialog } from './Dialog';
import { Photo } from './Photo';
import { useAsync } from './useAsync';
import { openedKeys, useWorkspace, type Opened } from './workspace';

const titleName = (k: TitleKey): string => TITLES.find((t) => t.key === k)!.name;

/** The games to pick a look from: the shown one first ("この作品"), then the other opened ones. */
const lookSources = (opened: Opened, target: TitleKey): TitleKey[] => [target, ...openedKeys(opened).filter((k) => k !== target)];
const sourceLabel = (k: TitleKey, target: TitleKey): string => (k === target ? `この作品 (${titleName(k)})` : titleName(k));

function LookPicker({ opened, target, onPick, onClose }: { opened: Opened; target: TitleKey; onPick: (look: MonsterLook) => void; onClose: () => void }): ReactNode {
  const sources = lookSources(opened, target);
  const [from, setFrom] = useState<TitleKey>(target);
  const [query, setQuery] = useState('');
  const looks = useAsync(() => monsterLooks(opened, from), [opened, from]);
  const q = query.trim();
  const shown = Array.isArray(looks) ? looks.filter((l) => !q || l.names.some((n) => n.includes(q)) || String(l.design) === q) : [];
  return (
    <Dialog title="モンスターの見た目を選ぶ" onClose={onClose}>
      <p className="muted small">この作品のモンスターはそのデザインの行を使い、ほかの作品のモンスターはモデル・テクスチャ・ボーン・モーションを変換して足します。</p>
      <div className="row">
        {sources.map((k) => <button key={k} className={k === from ? 'primary' : undefined} onClick={() => setFrom(k)}>{sourceLabel(k, target)}</button>)}
        <input type="search" placeholder="名前で絞り込み" className="picker-search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list">
        {looks === undefined ? <div className="muted">読み込み中…</div>
          : looks instanceof Error ? <div className="error">{looks.message}</div>
          : (
            <div className="monster-grid">
              {shown.map((l) => (
                <button key={l.design} className="monster-cell" title={l.names.join('・')} onClick={() => onPick(l)}>
                  <Photo model={l.model} className="photo photo-lg" />
                  <span>{l.names[0]}</span>
                  <span className="muted small">{`デザイン ${l.design}${l.names.length > 1 ? ` ほか ${l.names.length - 1} 体` : ''}`}</span>
                </button>
              ))}
              {!shown.length && <div className="muted">見つかりません</div>}
            </div>
          )}
      </div>
    </Dialog>
  );
}

/**
 * "見た目を選ぶ…" for monster `row` of the shown game `target`: a look of another monster of this game, or of another
 * opened game's (ported). `onDone` gets the design row once the look is given.
 */
export function PortLookButton({ target, row, onDone }: { target: TitleKey; row: number; onDone: (design: number) => void }): ReactNode {
  const ws = useWorkspace();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!ws?.opened[target]) return null;
  const pick = async (look: MonsterLook): Promise<void> => {
    setPicking(false);
    setError('');
    setBusy(look.title === target ? `「${look.names[0]}」の見た目にしています…` : `${titleName(look.title)} の「${look.names[0]}」を変換しています…`);
    try {
      onDone(await giveMonsterLook(ws.opened, target, row, look));
    } catch (err) {
      console.error(err);
      setError(`見た目を変えられませんでした: ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <button className="small" disabled={!!busy} title="この作品のほかのモンスターの見た目 (デザインの行) を使うか、開いているほかの作品のモンスターのモデル・テクスチャ・ボーン・モーションを変換して、このモンスターの見た目にします"
        onClick={() => setPicking(true)}>見た目を選ぶ…</button>
      <AltIdleToggle target={target} row={row} onDone={() => onDone(-1)} />
      {busy && <span className="muted small">{busy}</span>}
      {error && <div className="error">{error}</div>}
      {picking && <LookPicker opened={ws.opened} target={target} onPick={pick} onClose={() => setPicking(false)} />}
    </>
  );
}

function ItemModelPicker({ opened, target, onPick, onClose }: { opened: Opened; target: TitleKey; onPick: (look: ItemLook) => void; onClose: () => void }): ReactNode {
  const sources = lookSources(opened, target);
  const [from, setFrom] = useState<TitleKey>(target);
  const [query, setQuery] = useState('');
  const looks = useAsync(() => itemLooks(opened, from), [opened, from]);
  const q = query.trim();
  const shown = Array.isArray(looks) ? looks.filter((l) => !q || l.name.includes(q) || String(l.id) === q) : [];
  return (
    <Dialog title="アイテムのモデルを選ぶ" onClose={onClose}>
      <p className="muted small">この作品のアイテムのモデルはそのまま、ほかの作品のものは変換して使います。</p>
      <div className="row">
        {sources.map((k) => <button key={k} className={k === from ? 'primary' : undefined} onClick={() => setFrom(k)}>{sourceLabel(k, target)}</button>)}
        <input type="search" placeholder="名前で絞り込み" className="picker-search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list">
        {looks === undefined ? <div className="muted">読み込み中…</div>
          : looks instanceof Error ? <div className="error">{looks.message}</div>
          : (
            <div className="monster-grid">
              {shown.map((l) => (
                <button key={l.id} className="monster-cell" onClick={() => onPick(l)}>
                  <Photo model={l.model} className="photo photo-lg" />
                  <span>{l.name}</span>
                  <span className="muted small">{`#${l.id}`}</span>
                </button>
              ))}
              {!shown.length && <div className="muted">見つかりません</div>}
            </div>
          )}
      </div>
    </Dialog>
  );
}

/** "モデルを選ぶ…" for item `id` of the shown game: another item's model of this game, or of another opened game's (converted). */
export function PortItemButton({ target, id, onDone }: { target: TitleKey; id: number; onDone: () => void }): ReactNode {
  const ws = useWorkspace();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!ws?.opened[target]) return null;
  const pick = async (look: ItemLook): Promise<void> => {
    setPicking(false);
    setError('');
    setBusy(look.title === target ? `「${look.name}」のモデルにしています…` : `${titleName(look.title)} の「${look.name}」を変換しています…`);
    try {
      await giveItemModel(ws.opened, target, id, look);
      onDone();
    } catch (err) {
      console.error(err);
      setError(`モデルを変えられませんでした: ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <button className="small" disabled={!!busy} title="この作品のほかのアイテムのモデルを使うか、開いているほかの作品のアイテムのモデル (テクスチャ・ボーン・アニメを含む) を変換して、このアイテムのモデルにします"
        onClick={() => setPicking(true)}>モデルを選ぶ…</button>
      {busy && <span className="muted small">{busy}</span>}
      {error && <div className="error">{error}</div>}
      {picking && <ItemModelPicker opened={ws.opened} target={target} onPick={pick} onClose={() => setPicking(false)} />}
    </>
  );
}

/**
 * The battle's other idle (`002_` instead of `001_`): a switch of the monster row. Only a look with a looping `002_`
 * animation should have it on.
 */
export function AltIdleToggle({ target, row, onDone }: { target: TitleKey; row: number; onDone: () => void }): ReactNode {
  const ws = useWorkspace();
  if (!ws?.opened[target]) return null;
  const on = altIdle(ws.opened, target, row);
  const where = target === 'kahara' ? 'MonsterParameter +0x4A bit3' : target === 'oahu' ? 'monsterParameter +0x48 bit9' : 'MonsterParameter +0x18 bit0';
  return (
    <label className="small" title={`${where}。戦闘の待機に 002_ で始まるアニメを使います。見た目にそのアニメがないと待機が止まるので、移植で見た目を変えたときは自動で外します`}>
      <input type="checkbox" checked={on} onChange={(e) => { setAltIdle(ws.opened, target, row, e.target.checked); onDone(); }} />
      戦闘の待機を 002_ にする
    </label>
  );
}
