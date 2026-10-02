// Message list: the signs and characters of every dungeon with their messages (editable), the maps
// that place them, the story conversations the game's code shows by ID (game/codemessages.ts), and any message by ID.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hexId, MESSAGE_HELP } from '../editor/message';
import type { MapInfo } from '../game/codebin';
import { fnName, STORY_FILE, storyGroups, type CodeMessageGroup } from '../game/codemessages';
import { kindName } from '../game/eventkinds';
import type { EventTable } from '../game/events';
import type { Game } from '../game/game';
import { userKey, usersById, messageUsers, type MessageUser } from '../game/messages';
import { mapShortTitle } from '../game/names';
import type { Session } from '../session';
import { Count, ListFilter, useActiveRow, useEdits, useSticky, type PageProps } from '../ui/book';
import { MessageEditor } from '../ui/message';

const KIND_FILTER: Record<string, (k: number) => boolean> = {
  all: () => true,
  talk: (k) => k >= 0x01 && k <= 0x0a,
  sign: (k) => k === 0x1f,
  other: (k) => k === 0x21,
};

/**
 * When each of the four lines of a conversation (kinds 0x07-0x09) is said: by the story's progress only, checked
 * from the last (FUN_002e6af4 / FUN_00216030; 0x8D[n] = FUN_0031bac4(n + 1), 0x91[n] = FUN_0031d774(n)).
 */
const TALK_SLOTS = [
  '+0x08 序盤 (進行 0x8D[8] ≠ 3)',
  '+0x0C 悪の組織を倒したあと',
  '+0x10 進行 0x8D[9] = 2 のとき',
  '+0x14 クリア後 (0x91[0x18] [0x19] [0x1C] [0x1D] がすべて 2)',
];

type Filter = 'all' | 'talk' | 'sign' | 'other' | 'edited' | 'shared';
type StoryFilter = 'all' | 'edited' | 'shared';

/** A row of the story list: the messages one function shows, or (no group) the MessageField messages nothing names. */
interface StoryRow {
  key: string;
  group?: CodeMessageGroup;
  ids: number[];
}

/** Key of a story group ("fn:0019B564"). */
const storyKey = (g: CodeMessageGroup): string => `fn:${g.fn.toString(16).toUpperCase().padStart(8, '0')}`;
const UNLINKED = 'fn:none';

export function MessagePage({ session, arg, visit }: PageProps): ReactNode {
  const { game } = session;
  const master = game.master;
  const texts = master.texts;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [storyFilter, setStoryFilter] = useState<StoryFilter>('all');
  const [idText, setIdText] = useState('');
  const [users, setUsers] = useState<MessageUser[] | null>(null);
  // Re-read on every visit: the message IDs of the event tables may have been edited in the map editor.
  useEffect(() => {
    let live = true;
    messageUsers(game, session.docOf, session.eventsOf).then((u) => live && setUsers(u));
    return () => {
      live = false;
    };
  }, [game, session, visit]);
  const byId = useMemo(() => usersById(users ?? []), [users]);
  const storyFile = texts.files.find((f) => STORY_FILE.test(f.name));
  const story = useMemo(() => (storyFile ? storyGroups(game.code.code, storyFile.gmsg.first, storyFile.gmsg.last) : []), [game, storyFile]);
  /** MessageField messages that neither the code (as a literal) nor an event row names: IDs the code computes, unused text. */
  const unlinked = useMemo(() => {
    if (!storyFile || !users) return [];
    const known = new Set(story.flatMap((g) => g.ids));
    const out: number[] = [];
    for (let id = storyFile.gmsg.first; id <= storyFile.gmsg.last; id++) if (!known.has(id) && !byId.has(id) && texts.plain(id)?.trim()) out.push(id);
    return out;
  }, [story, storyFile, users, byId, texts]);
  const storyRows = useMemo(
    (): StoryRow[] => [...story.map((g) => ({ key: storyKey(g), group: g, ids: g.ids })), ...(unlinked.length ? [{ key: UNLINKED, ids: unlinked }] : [])],
    [story, unlinked],
  );
  /** "dungeon.row" of an event row, or "id:N" for a single message. */
  const wanted = arg ? (/^0x/i.test(arg) ? `id:${parseInt(arg, 16)}` : arg) : undefined;
  const selected = useSticky(
    wanted,
    (k) => k.startsWith('id:') || !users || (k.startsWith('fn:') ? storyRows.some((r) => r.key === k) : users.some((u) => userKey(u) === k)),
    () => (users?.[0] ? userKey(users[0]) : ''),
  );
  // Which list is shown: switching it selects nothing (the entry stays open until one of the new list is chosen);
  // opening an entry by the route shows its list.
  const [storyMode, setStoryMode] = useState(selected.startsWith('fn:'));
  const [routed, setRouted] = useState(wanted);
  if (routed !== wanted) {
    setRouted(wanted);
    if (wanted) setStoryMode(wanted.startsWith('fn:'));
  }
  /** Whether the selected entry belongs to the list shown (the detail is empty otherwise). */
  const shown = storyMode === selected.startsWith('fn:');
  const none = <div className="muted">一覧から選んでください</div>;
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, `${selected} ${users?.length}`);
  /** Wraps an edit: an undo point in the map editor (its inspector shows the same messages) and saving. */
  const apply = (f: () => void): void => {
    f();
    session.st.emit('doc');
    edited();
  };
  const openId = (): void => {
    const v = idText.trim();
    const id = /^0x/i.test(v) ? parseInt(v, 16) : Number(v);
    if (Number.isInteger(id) && id >= 0) location.hash = `#/messages/${hexId(id)}`;
  };
  const mapNames = (u: MessageUser): string[] => [...new Set(u.places.map((p) => mapShortTitle(p.map, game.code.maps)))];

  const matches = (u: MessageUser): boolean => {
    if (filter === 'edited' && !u.slots.some((s) => texts.isEdited(s.id))) return false;
    if (filter === 'shared' && !u.slots.some((s) => (byId.get(s.id)?.length ?? 0) > 1)) return false;
    if (KIND_FILTER[filter] && !KIND_FILTER[filter](u.kind)) return false;
    const q = query.trim();
    if (!q) return true;
    const hay = [
      master.dungeonName(u.dungeon),
      ...mapNames(u),
      ...u.places.map((p) => p.map.name),
      ...u.slots.flatMap((s) => [texts.preview(s.id, true) ?? '', hexId(s.id), String(s.id)]),
    ];
    return hay.some((t) => t.includes(q));
  };
  const all = users ?? [];
  const rows = all.filter(matches);
  const storyMatches = (r: StoryRow): boolean => {
    if (storyFilter === 'edited' && !r.ids.some((id) => texts.isEdited(id))) return false;
    if (storyFilter === 'shared' && !r.ids.some((id) => byId.has(id))) return false;
    const q = query.trim();
    if (!q) return true;
    const hay = [r.group ? fnName(r.group.fn) : '', ...r.ids.flatMap((id) => [texts.preview(id, true) ?? '', hexId(id), String(id)])];
    return hay.some((t) => t.includes(q));
  };
  const go = (key: string | undefined): void => {
    if (key) location.hash = `#/messages/${key}`;
  };
  const modes = (
    <div className="row msg-modes">
      <button className={storyMode ? '' : 'active'} onClick={() => setStoryMode(false)}>マップのキャラ・看板</button>
      <button className={storyMode ? 'active' : ''} onClick={() => setStoryMode(true)}>イベント・ストーリー</button>
    </div>
  );
  if (storyMode) {
    const shown = storyRows.filter(storyMatches);
    return (
      <div className="book">
        <div className="book-side">
          {modes}
          <ListFilter query={query} setQuery={setQuery} placeholder="本文・関数・ID で検索" filter={storyFilter} setFilter={setStoryFilter}
            options={[['all', 'すべて'], ['edited', '変更したもの'], ['shared', 'マップの行も使うメッセージを含む']]} />
          <div className="book-list" ref={list}>
            <Count shown={shown.length} total={storyRows.length} unit="まとまり" />
            <table className="book-table">
              <thead><tr><th>関数</th><th>件数</th><th>メッセージ</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className={r.key === selected ? 'active' : ''} onClick={() => go(r.key)}>
                    <td className="muted">{r.group ? fnName(r.group.fn) : '(参照なし)'}</td>
                    <td className="num muted">{r.ids.length}</td>
                    <td className="msg-cell">{r.ids.some((id) => texts.isEdited(id)) && <b className="edited">* </b>}{texts.preview(r.ids[0]!, true) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="book-detail">
          {shown ? <StoryDetail key={edits} session={session} row={storyRows.find((r) => r.key === selected)} byId={byId} apply={apply} /> : none}
        </div>
      </div>
    );
  }
  return (
    <div className="book">
      <div className="book-side">
        {modes}
        <ListFilter query={query} setQuery={setQuery} placeholder="本文・マップ名・ID で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['talk', 'キャラクター (会話・一言)'], ['sign', '看板・調べるもの'], ['other', 'ワールドマップ用'], ['edited', '変更したもの'], ['shared', 'ほかの行と同じメッセージを使う']]} />
        <div className="row">
          <input type="text" placeholder="ID (10 進 / 0x…)" size={12} value={idText} onChange={(e) => setIdText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && openId()} />
          <button onClick={openId}>ID で開く</button>
        </div>
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={all.length} unit="行" />
          <table className="book-table">
            <thead><tr><th>ダンジョン</th><th>行</th><th>種類</th><th>メッセージ</th></tr></thead>
            <tbody>
              {rows.map((u) => {
                const key = userKey(u);
                const first = u.slots.find((s) => s.id)?.id ?? 0;
                const edited = u.slots.some((s) => texts.isEdited(s.id));
                return (
                  <tr key={key} className={key === selected ? 'active' : ''} onClick={() => (location.hash = `#/messages/${key}`)}>
                    <td className="muted">{master.dungeonName(u.dungeon) || `D${u.dungeon}`}</td>
                    <td className="num muted">{u.row}</td>
                    <td className="muted">{kindName(u.kind)}</td>
                    <td className="msg-cell">{edited && <b className="edited">* </b>}{first ? texts.preview(first, true) ?? '' : <span className="muted">(なし)</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        {!shown ? none : users && <MessageDetail key={edits} session={session} selected={selected} users={users} byId={byId} apply={apply} />}
      </div>
    </div>
  );
}

function MessageDetail({ session, selected, users, byId, apply }: {
  session: Session; selected: string; users: MessageUser[]; byId: Map<number, MessageUser[]>; apply: (f: () => void) => void;
}): ReactNode {
  const { game } = session;
  const master = game.master;
  /** Other rows that show the same message. */
  const sharedWith = (id: number, self?: MessageUser): ReactNode => {
    const others = (byId.get(id) ?? []).filter((o) => o !== self);
    if (!others.length) return null;
    return (
      <div className="warn-box small">
        {`このメッセージはほかの ${others.length} 行でも使われています (書き換えると全部に効きます): `}
        {others.map((o, i) => (
          <Fragment key={i}>{i ? '、' : ''}<a href={`#/messages/${userKey(o)}`}>{`${master.dungeonName(o.dungeon) || `D${o.dungeon}`} 行 ${o.row}`}</a></Fragment>
        ))}
      </div>
    );
  };
  if (selected.startsWith('id:')) {
    const id = Number(selected.slice(3));
    return (
      <>
        <div className="book-head"><h2>{`メッセージ ${hexId(id)}`}</h2><span className="muted">{id}</span></div>
        <MessageEditor texts={master.texts} id={id} apply={apply} />
        {sharedWith(id)}
        <div className="muted small">{MESSAGE_HELP}</div>
      </>
    );
  }
  const u = users.find((x) => userKey(x) === selected);
  if (!u) return null;
  const talk = u.kind >= 0x07 && u.kind <= 0x09;
  const seen = new Set<number>();
  return (
    <>
      <div className="book-head">
        <h2>{`${master.dungeonName(u.dungeon) || `ダンジョン ${u.dungeon}`} — イベント #${u.row}`}</h2>
        <span className="muted">{`${kindName(u.kind)} (種類 0x${u.kind.toString(16).toUpperCase().padStart(2, '0')})、モデル ${u.model}`}</span>
      </div>
      <h3>置かれている場所</h3>
      {u.places.length
        ? <ul>
            {u.places.map((p, i) => (
              <li key={i}>
                <a href={`#/map/${encodeURIComponent(p.map.name)}`}>{mapShortTitle(p.map, game.code.maps)}</a>
                {' '}<span className="muted">{`${p.map.name} 区画 ${p.section} (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`}</span>
              </li>
            ))}
          </ul>
        : <div className="muted">どのマップにも置かれていません</div>}
      <h3>メッセージ</h3>
      {talk && <div className="muted small">会話は 4 つの台詞を持ち、話しかけた回数ではなくストーリーの進行だけで 1 つを選びます (下の条件を下から順に判定)。進行に合わせて別のキャラに入れ替わるのは、+0x00 / +0x04 と +0x4B / +0x4C の出現条件によります。</div>}
      {u.slots.map((s, i) => {
        const label = talk ? TALK_SLOTS[i]! : `+0x${s.off.toString(16).toUpperCase().padStart(2, '0')}`;
        const dup = seen.has(s.id);
        seen.add(s.id);
        return (
          <div key={i} className="msg-slot">
            <div className="msg-slot-head">{label}{dup && <span className="muted"> (上と同じ ID)</span>}</div>
            {!dup && <MessageEditor texts={master.texts} id={s.id} apply={apply} />}
            {!dup && sharedWith(s.id, u)}
          </div>
        );
      })}
      <div className="muted small">{MESSAGE_HELP} メッセージ ID を付け替えるときは、マップ編集でこの行を選んでください。</div>
    </>
  );
}

/** The messages one function of the code shows (or the MessageField messages nothing names), in ID order. */
function StoryDetail({ session, row, byId, apply }: {
  session: Session; row: StoryRow | undefined; byId: Map<number, MessageUser[]>; apply: (f: () => void) => void;
}): ReactNode {
  const master = session.game.master;
  if (!row) return <div className="muted">MessageField が見つかりません</div>;
  const g = row.group;
  return (
    <>
      <div className="book-head">
        <h2>{g ? `イベント ${fnName(g.fn)}` : 'どこから使われるか分からないメッセージ'}</h2>
        <span className="muted">{`MessageField ${row.ids.length} 件`}</span>
      </div>
      <div className="muted small">
        {g
          ? `ゲームのコード (code.bin) がメッセージ ID を直接持っている関数ごとにまとめています。関数の区切りは直前の push 命令からの推定なので、小さな関数が前の関数とまとまることがあります。ID を読み込む命令: ${g.refs.map((r) => `0x${r.at.toString(16).toUpperCase()}`).join(', ')}`
          : 'コードにもマップのイベント行にも ID が見つからない MessageField のメッセージです。「先頭の ID + n」で計算して引くもの (味の感想、施設の NPC の続きなど) や、使われていないテスト用の文が含まれます。'}
      </div>
      {row.ids.map((id) => {
        const users = byId.get(id) ?? [];
        return (
          <div key={id} className="msg-slot">
            <MessageEditor texts={master.texts} id={id} apply={apply} />
            {users.length > 0 && (
              <div className="muted small">
                {'マップのイベント行でも使われています: '}
                {users.map((o, i) => (
                  <Fragment key={i}>{i ? '、' : ''}<a href={`#/messages/${userKey(o)}`}>{`${master.dungeonName(o.dungeon) || `D${o.dungeon}`} 行 ${o.row}`}</a></Fragment>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="muted small">{MESSAGE_HELP}</div>
    </>
  );
}
