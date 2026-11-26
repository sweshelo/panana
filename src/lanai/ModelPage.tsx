// Every MapObject model (NPCs, props, gimmicks) and the Denpa field model, with their animations: the skeletal motions
// (the AnimData IDs passed to StartAnimation) and the material animations a model plays on its own (a door, a lamp).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { animationKey } from '../cgfx/player';
import { modelSet } from '../pages/modelview';
import { BookList, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { lanaiAnimationIds, lanaiDenpaModel, lanaiObjectModelRef } from './animationModels';
import { lanaiObjectRef, lanaiObjectScale } from './mapObjects';
import { useLanaiRevision } from './MonsterEditor';
import { LANAI_OBJECT_CATEGORIES, lanaiObjectInfo } from './objectClasses';
import type { LanaiSession } from './session';

type Kind = 'npc' | 'object' | 'denpa';
interface Entry {
  row: number;
  name: string;
  kind: Kind;
  category: string;
  marks: readonly string[];
}
const href = (row: number): string => `#/models/${row === 0 ? 'denpa' : row}`;
/** AnimData rows by who plays them: 0x75〜0x81 the NPCs', 1〜0x5B the Denpa's, the others the objects' (doors…). */
const forKind = (id: number, kind: Kind): boolean => {
  const row = id & 0x7fffffff;
  const npc = row >= 0x75 && row <= 0x81;
  const denpa = row >= 1 && row <= 0x5b;
  return kind === 'npc' ? npc : kind === 'denpa' ? denpa : !npc && !denpa;
};

export function LanaiModelPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const loaded = useAsync(() => lanaiObjectInfo(session), [session, revision]);
  const entries: Entry[] = useMemo(
    () => [
      { row: 0, name: '電波人間（代表モデル）', kind: 'denpa', category: '電波人間', marks: [] },
      ...(loaded && !(loaded instanceof Error) ? [...loaded] : []).map(([row, info]): Entry => ({
        row,
        name: info.file.replace(/\.bch$/u, '') || `MapObject #${row}`,
        kind: info.file.startsWith('npc_') ? 'npc' : 'object',
        category: info.category,
        marks: info.marks,
      })),
    ],
    [loaded],
  );
  const requested = arg === 'denpa' ? 0 : arg && /^\d+$/.test(arg) ? Number(arg) : undefined;
  const selected = useSticky(
    requested,
    (row) => entries.some((entry) => entry.row === row),
    () => entries[1]?.row ?? 0,
  );
  const entry = entries.find((item) => item.row === selected) ?? entries[0]!;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const q = query.trim().toLowerCase();
  const visible = entries.filter(
    (item) =>
      (filter === 'all' || item.category === filter) &&
      (!q || `${item.row} ${item.name} ${item.marks.join(' ')}`.toLowerCase().includes(q)),
  );
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter
          query={query}
          setQuery={setQuery}
          placeholder="モデル名・MapObject 番号で検索"
          filter={filter}
          setFilter={setFilter}
          options={[
            ['all', 'すべて'],
            ['電波人間', '電波人間'],
            ...LANAI_OBJECT_CATEGORIES.map((c): [string, string] => [c, c]),
          ]}
        />
        {loaded instanceof Error && <p className="error">{`モデルの一覧を読めませんでした: ${loaded.message}`}</p>}
        {!loaded && <p className="muted small">モデルを調べています…</p>}
        <BookList
          rows={visible}
          total={entries.length}
          id={(item) => item.row}
          selected={selected}
          href={href}
          columns={[
            { head: '番号', cell: (item) => (item.row ? `#${item.row}` : '') },
            { head: 'モデル', cell: (item) => [item.name, ...item.marks].join(' · ') },
          ]}
          photo={(item) => (
            <Photo
              model={item.kind === 'denpa' ? lanaiDenpaModel(session) : lanaiObjectModelRef(session, item.row)}
              title={item.name}
            />
          )}
          listRef={list}
        />
      </div>
      <div className="book-detail" ref={detail}>
        <ModelDetail key={`${selected}/${revision}`} session={session} entry={entry} revision={revision} />
      </div>
    </div>
  );
}

function ModelDetail({
  session,
  entry,
  revision,
}: {
  session: LanaiSession;
  entry: Entry;
  revision: number;
}): ReactNode {
  const ids = useMemo(() => lanaiAnimationIds(session), [session, revision]);
  const model = entry.kind === 'denpa' ? lanaiDenpaModel(session) : lanaiObjectModelRef(session, entry.row);
  const set = useAsync(() => (model ? modelSet(model) : Promise.resolve(null)), [session, model?.key]);
  const animations =
    set && !(set instanceof Error)
      ? (set.set.models
          .get(set.hash)
          ?.animations.filter((a) => (a.kind === 'skeletal' ? a.skeletal.length : a.material.length) > 0) ?? [])
      : [];
  const hints = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of ids) if (forKind(id.id, entry.kind) && id.prefix && !out[id.prefix]) out[id.prefix] = hex8(id.id);
    return out;
  }, [ids, entry.kind]);
  const ref = entry.kind !== 'denpa' ? lanaiObjectRef(session.table('MapObject'), entry.row) : null;
  const scripted = entry.kind !== 'object';
  return (
    <>
      <div className="book-head">
        <h2>{entry.name}</h2>
        <span className="muted">
          {entry.kind !== 'denpa'
            ? `MapObject #${entry.row}${ref ? `  ${hex8(ref.archive)}/${hex8(ref.entry)}` : ''} · ${entry.category}`
            : 'ROM の共通素材から組み立てた代表モデル'}
        </span>
      </div>
      <div className="book-top">
        <div>
          {scripted ? (
            <>
              <h3>StartAnimation の引数</h3>
              <p>
                <code>
                  {entry.kind === 'npc'
                    ? 'obj(イベント番号).StartAnimation(アニメ ID, 種類, 1, 0)'
                    : 'hero.StartAnimation(アニメ ID, 種類, 1, 0)'}
                </code>
              </p>
              <p>
                例:{' '}
                <code>
                  {entry.kind === 'npc'
                    ? 'obj(3).StartAnimation(0x80000079, 0, 1, 0)'
                    : 'hero.StartAnimation(0x80000003, 0, 1, 0)'}
                </code>
              </p>
              <p className="muted small">
                アニメ ID は AnimData の行 ID で、下の BCH モーション名の接頭辞を選びます。種類 0 は AnimData
                の既定値を使い、1・2 は上書きします。後ろの 2 値は float で、出荷済みイベントの通常値は 1 と 0
                です。内部で 1 つ目は再生速度に掛けられます。 最後の値と種類 1・2 の細かな動作は未確認です。
              </p>
            </>
          ) : (
            <p className="muted small">
              置物・ギミックのモデルです。アニメーションは BCH に入っているものを一覧にしました。ゲームのどの場面で
              再生されるか (扉の開閉など) は AnimData の対応から推測できるものだけ表に出します。
            </p>
          )}
          {entry.marks.length > 0 && <p className="muted small">{`MapObject の設定: ${entry.marks.join('・')}`}</p>}
          {entry.kind === 'denpa' ? (
            <p className="muted small">
              体・頭・顔は ROM の基本パーツを組み立てています。セーブ内の個体の外見やアンテナは反映していません。
            </p>
          ) : (
            <p className="muted small">{`MapObject の表示倍率: ${lanaiObjectScale(session.table('MapObject'), entry.row)}`}</p>
          )}
        </div>
        <div>
          <ModelView model={model} name={entry.name} motionHints={hints} />
          {set instanceof Error && <div className="error">{`モデルを読めませんでした: ${set.message}`}</div>}
          {set && !(set instanceof Error) && set?.set.errors.length > 0 && (
            <div className="muted small">{set.set.errors.join('\n')}</div>
          )}
        </div>
      </div>
      <h3>{`このモデルのアニメーション (${animations.length})`}</h3>
      {!set && <p className="muted">読み込み中…</p>}
      {set && !(set instanceof Error) && animations.length === 0 && (
        <p className="muted">アニメーションはありません。</p>
      )}
      {animations.length > 0 && (
        <table className="enc-table">
          <thead>
            <tr>
              <th>種類</th>
              <th>アニメ ID</th>
              <th>種類の既定値</th>
              <th>AnimData の補間値</th>
              <th>名前</th>
              <th>フレーム</th>
            </tr>
          </thead>
          <tbody>
            {animations.map((a) => {
              const matches = ids.filter((id) => forKind(id.id, entry.kind) && id.prefix === animationKey(a.name));
              return (
                <tr key={`${a.kind}/${a.name}`}>
                  <td>{a.kind === 'skeletal' ? '骨格' : 'マテリアル'}</td>
                  <td className="mono">
                    {matches.length ? matches.map((id) => hex8(id.id)).join(', ') : 'AnimData に対応なし'}
                  </td>
                  <td className="num">{matches.map((id) => id.defaultType).join(', ')}</td>
                  <td className="num">{matches.map((id) => id.blend).join(', ')}</td>
                  <td>{a.name}</td>
                  <td className="num">{a.frames}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
