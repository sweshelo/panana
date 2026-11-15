// NPC and Denpa field motions, with the AnimData IDs passed to StartAnimation and an interactive BCH preview.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { animationKey } from '../cgfx/player';
import { modelSet } from '../pages/modelview';
import { BookList, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { ModelView } from '../ui/ModelView';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import {
  lanaiAnimationIds,
  lanaiDenpaModel,
  lanaiNpcModel,
  lanaiNpcModels,
  type LanaiNpcModel,
} from './animationModels';
import { lanaiObjectRef, lanaiObjectScale } from './mapObjects';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';

type Filter = 'all' | 'npc' | 'denpa';
type Entry = LanaiNpcModel & { kind: 'npc' | 'denpa' };
const href = (row: number): string => `#/animations/${row === 0 ? 'denpa' : row}`;
const forKind = (id: number, kind: Entry['kind']): boolean => {
  const row = id & 0x7fffffff;
  return kind === 'npc' ? row >= 0x75 && row <= 0x81 : row >= 1 && row <= 0x5b;
};

export function LanaiAnimationPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const loaded = useAsync(() => lanaiNpcModels(session), [session, revision]);
  const npcs = loaded && !(loaded instanceof Error) ? loaded : [];
  const entries: Entry[] = useMemo(
    () => [
      { row: 0, name: '電波人間（代表モデル）', kind: 'denpa' },
      ...npcs.map((npc): Entry => ({ ...npc, kind: 'npc' })),
    ],
    [npcs],
  );
  const requested = arg === 'denpa' ? 0 : arg && /^\d+$/.test(arg) ? Number(arg) : undefined;
  const selected = useSticky(
    requested,
    (row) => entries.some((entry) => entry.row === row),
    () => npcs[0]?.row ?? 0,
  );
  const entry = entries.find((item) => item.row === selected) ?? entries[0]!;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const visible = entries.filter(
    (item) =>
      (filter === 'all' || item.kind === filter) &&
      (!query.trim() || `${item.row} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase())),
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
            ['npc', 'NPC'],
            ['denpa', '電波人間'],
          ]}
        />
        {loaded instanceof Error && <p className="error">{`NPC モデルを読めませんでした: ${loaded.message}`}</p>}
        {!loaded && <p className="muted small">NPC モデルを調べています…</p>}
        <BookList
          rows={visible}
          total={entries.length}
          id={(item) => item.row}
          selected={selected}
          href={href}
          columns={[
            { head: '種類', cell: (item) => (item.kind === 'npc' ? 'NPC' : '電波人間') },
            { head: 'モデル', cell: (item) => item.name },
          ]}
          listRef={list}
        />
      </div>
      <div className="book-detail" ref={detail}>
        <AnimationDetail key={`${selected}/${revision}`} session={session} entry={entry} revision={revision} />
      </div>
    </div>
  );
}

function AnimationDetail({
  session,
  entry,
  revision,
}: {
  session: LanaiSession;
  entry: Entry;
  revision: number;
}): ReactNode {
  const ids = useMemo(() => lanaiAnimationIds(session), [session, revision]);
  const model = entry.kind === 'denpa' ? lanaiDenpaModel(session) : lanaiNpcModel(session, entry.row);
  const set = useAsync(() => (model ? modelSet(model) : Promise.resolve(null)), [session, model?.key]);
  const motions =
    set && !(set instanceof Error) && set
      ? (set.set.models.get(set.hash)?.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length) ?? [])
      : [];
  const hints = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of ids) if (forKind(id.id, entry.kind) && id.prefix && !out[id.prefix]) out[id.prefix] = hex8(id.id);
    return out;
  }, [ids, entry.kind]);
  const ref = entry.kind === 'npc' ? lanaiObjectRef(session.table('MapObject'), entry.row) : null;
  return (
    <>
      <div className="book-head">
        <h2>{entry.name}</h2>
        <span className="muted">
          {entry.kind === 'npc'
            ? `MapObject #${entry.row}${ref ? `  ${hex8(ref.archive)}/${hex8(ref.entry)}` : ''}`
            : 'ROM の共通素材から組み立てた代表モデル'}
        </span>
      </div>
      <div className="book-top">
        <div>
          <h3>StartAnimation の引数</h3>
          <p>
            <code>
              {entry.kind === 'npc'
                ? 'chara(イベント番号).StartAnimation(アニメ ID, 種類, 1, 0)'
                : 'hero.StartAnimation(アニメ ID, 種類, 1, 0)'}
            </code>
          </p>
          <p>
            例:{' '}
            <code>
              {entry.kind === 'npc'
                ? 'chara(3).StartAnimation(0x80000079, 0, 1, 0)'
                : 'hero.StartAnimation(0x80000003, 0, 1, 0)'}
            </code>
          </p>
          <p className="muted small">
            アニメ ID は AnimData の行 ID で、下の BCH モーション名の接頭辞を選びます。種類 0 は AnimData
            の既定値を使い、1・2 は上書きします。後ろの 2 値は float で、出荷済みイベントの通常値は 1 と 0 です。内部で
            1 つ目は再生速度に掛けられます。 最後の値と種類 1・2 の細かな動作は未確認です。
          </p>
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
      <h3>{`このモデルのモーション (${motions.length})`}</h3>
      {!set && <p className="muted">読み込み中…</p>}
      {set && !(set instanceof Error) && motions.length === 0 && <p className="muted">骨格モーションはありません。</p>}
      {motions.length > 0 && (
        <table className="enc-table">
          <thead>
            <tr>
              <th>アニメ ID</th>
              <th>種類の既定値</th>
              <th>AnimData の補間値</th>
              <th>モーション名</th>
              <th>フレーム</th>
            </tr>
          </thead>
          <tbody>
            {motions.map((motion) => {
              const matches = ids.filter((id) => forKind(id.id, entry.kind) && id.prefix === animationKey(motion.name));
              return (
                <tr key={motion.name}>
                  <td className="mono">
                    {matches.length ? matches.map((id) => hex8(id.id)).join(', ') : 'AnimData に対応なし'}
                  </td>
                  <td className="num">{matches.map((id) => id.defaultType).join(', ')}</td>
                  <td className="num">{matches.map((id) => id.blend).join(', ')}</td>
                  <td>{motion.name}</td>
                  <td className="num">{motion.frames}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
