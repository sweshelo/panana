// Picking a field message (MessageField) by its text: the boss battle's messages in the map editor. New IDs can't be
// made, so the list starts with the messages nothing uses (the code names no such ID as a literal and no event row
// has it); the others can be picked too, with who uses them shown.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import { fnName, STORY_FILE, storyGroups } from '../game/codemessages';
import { messageUsers, type MessageUser } from '../game/messages';
import type { Session } from '../session';
import { Dialog } from './Dialog';

type Show = 'free' | 'all';

export function MessagePicker({ session, current, onPick, onClose }: {
  session: Session;
  current: number;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const { game } = session;
  const texts = game.master.texts;
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('free');
  const [users, setUsers] = useState<MessageUser[] | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    messageUsers(game, session.docOf, session.eventsOf).then((u) => live && setUsers(u));
    return () => {
      live = false;
    };
  }, [game, session]);
  const file = texts.files.find((f) => STORY_FILE.test(f.name));
  /** id -> who uses it ("コード FUN_…" / "イベント d.row"). */
  const usedBy = useMemo(() => {
    const out = new Map<number, string[]>();
    if (!file) return out;
    const add = (id: number, who: string): void => void out.set(id, [...(out.get(id) ?? []), who]);
    for (const g of storyGroups(game.code.code, file.gmsg.first, file.gmsg.last)) for (const id of g.ids) add(id, `コード ${fnName(g.fn)}`);
    for (const u of users ?? []) for (const s of u.slots) if (s.id) add(s.id, `イベント ${u.dungeon}.${u.row}`);
    return out;
  }, [game, file, users]);
  const ids = useMemo(() => {
    if (!file) return [];
    const out: number[] = [];
    for (let id = file.gmsg.first; id <= file.gmsg.last; id++) if (file.gmsg.has(id)) out.push(id);
    return out;
  }, [file]);
  useEffect(() => list.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), [users]);
  const q = query.trim();
  const shown = ids.filter((id) => {
    if (id === current) return true;
    if (show === 'free' && (usedBy.get(id)?.length ?? 0) > 0) return false;
    if (!q) return true;
    return (texts.preview(id, true) ?? '').includes(q) || hexId(id).toLowerCase() === q.toLowerCase() || String(id) === q;
  });
  return (
    <Dialog title="メッセージを選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="本文か ID で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="free">使われていないもの</option>
          <option value="all">すべて</option>
        </select>
      </div>
      <div className="muted small">
        新しい ID は作れないので、使われていないメッセージ (テスト用の文など) を選んで、本文を書き換えて使ってください。
        {!users && ' (イベントの行を読んでいます…)'}
      </div>
      <div className="picker-list" ref={list}>
        <table className="picker-table">
          <tbody>
            {shown.map((id) => {
              const who = usedBy.get(id) ?? [];
              return (
                <tr key={id} className={`pick${id === current ? ' current' : ''}`} onClick={() => onPick(id)}>
                  <td className="num">{hexId(id)}</td>
                  <td>
                    {texts.preview(id, true) || <span className="muted">(空)</span>}
                    {texts.isEdited(id) && <b className="edited"> · 変更あり</b>}
                  </td>
                  <td className="muted small" title={who.join('\n')}>{who.length ? `使用中: ${who[0]}${who.length > 1 ? ` ほか ${who.length - 1}` : ''}` : ''}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td className="muted">見つかりません</td></tr>}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
