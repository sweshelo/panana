// Encounter groups (monsterGroup): every row with its candidates and the maps that use it (section 6);
// the candidates can be edited, and a group can be copied into a new row.
import { useMemo, type ReactNode } from 'react';
import { countLabel, GROUP_PATTERNS, GROUP_SLOTS, type MonsterBook, type MonsterGroup } from '../game/monsters';
import { FIX_SLOTS } from '../game/boss';
import { mapTitle } from '../game/names';
import { hex8 } from '../util/bytes';
import type { Session } from '../session';
import { NumberInput, useEdits, useSticky, type PageProps } from '../ui/book';
import { GroupList, groupHref, GroupSlotEditor, groupUses, rpg2Monster, type GroupUse } from '../ui/GroupDetail';
import { MonsterPicker } from '../ui/MonsterPicker';
import { Dialog } from '../ui/Dialog';
import { CopyRemoveButtons, NewRecordButton, type CopySpec } from '../ui/RecordButtons';

export { groupHref, groupUses, type GroupUse };

/** Copying a group to a new row (the buttons of a group and the list's "＋ 新しい群れ"). */
function groupCopy(book: MonsterBook): CopySpec {
  return {
    noun: '群れ',
    can: true,
    info: 'この群れを写した新しい行を作ります。マップ編集の「出現する敵」で選べます。',
    copy: (row) => book.copyGroup(row),
    href: groupHref,
  };
}

export function GroupPage({ session, arg, visit, book }: PageProps & { book: MonsterBook }): ReactNode {
  const { game } = session;
  const [edits, edited] = useEdits();
  // Recomputed on every visit: the maps may have been edited.
  const uses = useMemo(() => groupUses(game, session.docOf), [game, session, visit, edits]);
  const selected = useSticky(
    arg !== undefined && arg !== '' ? Number(arg) : undefined,
    (r) => !!book.groups[r],
    () => 0,
  );
  const onEdit = (): void => {
    session.scheduleSave();
    edited();
  };
  const g = book.groups[selected];
  return (
    <div className="book">
      <div className="book-side">
        <NewRecordButton
          copy={groupCopy(book)}
          current={selected}
          onEdit={onEdit}
          picker={(p) => (
            <Dialog title={p.title} onClose={p.onClose}>
              <div className="group-picker">
                <GroupList game={game} book={book} uses={uses} selected={p.current} onSelect={(g) => p.onPick(g.row)} />
              </div>
            </Dialog>
          )}
        />
        <GroupList
          game={game}
          book={book}
          uses={uses}
          selected={selected}
          onSelect={(g) => (location.hash = groupHref(g.row))}
        />
      </div>
      <div className="book-detail">
        {g && (
          <GroupDetailEditor
            key={g.row}
            session={session}
            book={book}
            g={g}
            uses={uses.get(g.hash) ?? []}
            onEdit={onEdit}
          />
        )}
      </div>
    </div>
  );
}

function GroupDetailEditor({
  session,
  book,
  g,
  uses,
  onEdit,
}: {
  session: Session;
  book: MonsterBook;
  g: MonsterGroup;
  uses: GroupUse[];
  onEdit: () => void;
}): ReactNode {
  const { game } = session;
  const added = book.groupAdded(g.row);
  return (
    <>
      <div className="book-head">
        <h2>{`群れ #${g.row}`}</h2>
        <span className="muted">{`ハッシュ ${g.hash ? hex8(g.hash) : '(索引なし)'}${added ? '  (追加した行)' : ''}`}</span>
      </div>
      <p className="muted small book-desc">
        まず編成方式を重みに比例して選びます。「固定編成」では登録した全員が出ます。 通常候補では 1・3
        枠目を「先頭」、2・4 枠目を「仲間」から選び、各候補の数だけ出します。全体で最大 8 体です。
      </p>
      <div className="row">
        <CopyRemoveButtons
          copy={groupCopy(book)}
          from={g.row}
          onEdit={onEdit}
          remove={
            added
              ? {
                  used: uses.map((u) => mapTitle(u.map, game.code.maps, game.master)),
                  why: book.canRemoveGroup(g.row) ? undefined : '消せるのは最後に追加した群れだけです',
                  remove: () => book.removeGroup(g.row),
                  next: groupHref(g.row - 1),
                }
              : undefined
          }
        />
        {!added && book.groupChanged(g.row) && (
          <button
            onClick={() => {
              book.revertGroup(g.row);
              onEdit();
            }}
          >
            この群れの変更を元に戻す
          </button>
        )}
      </div>
      <FormationEditor book={book} g={g} onEdit={onEdit} />
      <FixedEditor session={session} book={book} g={g} onEdit={onEdit} />
      {g.extra[0]! > 0 && !g.extra.slice(1, 5).some(Boolean) && (
        <p className="muted small">
          現在は固定編成だけを使います。下の候補を使うには「通常候補のみ」に切り替えてください。
        </p>
      )}
      <div className="book-cols group-cols">
        <SlotEditor
          session={session}
          book={book}
          g={g}
          side="leads"
          title="先頭 (マップで見える敵)・3 体目"
          onEdit={onEdit}
        />
        <SlotEditor session={session} book={book} g={g} side="mates" title="仲間 (2・4 体目)" onEdit={onEdit} />
      </div>
      <h3>{`使うマップ (${uses.length})`}</h3>
      {uses.length ? (
        <table className="enc-table book-chests">
          <tbody>
            <tr>
              <th>マップ</th>
              <th>使い方</th>
            </tr>
            {uses.map((u, i) => (
              <tr key={i}>
                <td>
                  <a href={`#/map/${u.map.name}`}>{mapTitle(u.map, game.code.maps, game.master)}</a>
                </td>
                <td className="muted">
                  {u.cells === 'map' ? 'マップの群れ (区画 6 のヘッダー)' : `セル ${u.cells} 個`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">どのマップも使っていません (マップ編集の右ペイン「出現する敵」で選べます)</div>
      )}
    </>
  );
}

function FormationEditor({ book, g, onEdit }: { book: MonsterBook; g: MonsterGroup; onEdit: () => void }): ReactNode {
  const weights = g.extra.slice(0, 5);
  const total = weights.reduce((a, b) => a + b, 0);
  const set = (next: number[]): void => {
    book.setGroupFormation(g.row, next, g.extra[5] ?? 0);
    onEdit();
  };
  return (
    <section>
      <h3>編成方式</h3>
      <div className="row">
        <button onClick={() => set([1, 0, 0, 0, 0])}>固定編成のみ</button>
        <button onClick={() => set([0, 1, 0, 0, 0])}>通常候補のみ</button>
      </div>
      <table className="enc-table">
        <tbody>
          <tr>
            <th>方式</th>
            <th>重み</th>
            <th>割合</th>
          </tr>
          {GROUP_PATTERNS.map((label, i) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <NumberInput
                  value={weights[i] ?? 0}
                  min={0}
                  max={255}
                  title={`${label}の重み`}
                  onCommit={(v) => set(weights.map((w, j) => (j === i ? v : w)))}
                />
              </td>
              <td className="num">{total ? `${Math.round((weights[i]! / total) * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">重み 0 の方式は選ばれません。候補の枠数と、各モンスターの出る数は別に設定します。</p>
      {!total && <p className="error">編成方式がすべて 0 です。使う方式の重みを 1 以上にしてください。</p>}
      {!!weights[0] && !book.groupFix(g)?.slots.length && (
        <p className="error">固定編成を使う設定ですが、モンスターが登録されていません。</p>
      )}
      {weights.slice(1).some(Boolean) && !g.leads.length && (
        <p className="error">通常候補を使う設定ですが、先頭の候補が登録されていません。</p>
      )}
    </section>
  );
}

function FixedEditor({
  session,
  book,
  g,
  onEdit,
}: {
  session: Session;
  book: MonsterBook;
  g: MonsterGroup;
  onEdit: () => void;
}): ReactNode {
  const fixed = book.groupFix(g);
  const room = book.groupFixRoom(g);
  return (
    <section>
      <h3>固定編成</h3>
      <label>
        編成を選ぶ{' '}
        <select
          value={g.extra[5] ?? 0}
          onChange={(e) => {
            book.setGroupFormation(g.row, g.extra.slice(0, 5), Number(e.target.value));
            onEdit();
          }}
        >
          <option value={0}>なし</option>
          {book.groupFixChoices().map((f) => (
            <option
              key={f.row}
              value={f.row}
            >{`#${f.row}: ${f.slots.map((s) => `${book.monster(s.monster)?.name ?? `#${s.monster}`} ×${countLabel(s.count)}`).join(' / ') || '空の編成'}`}</option>
          ))}
        </select>
      </label>
      <p className="muted small">
        モンスターや数を変更すると、この群れ用の編成を複製します。元の編成を使う別の群れやボスは変わりません。
      </p>
      {!g.extra[0] && (
        <p className="muted small">
          現在、固定編成は選ばれません。使うには「固定編成のみ」を選ぶか、固定編成の重みを増やしてください。
        </p>
      )}
      {!room && <p className="error">固定編成の上限に達しているため、この群れ用の編成を複製できません。</p>}
      <fieldset disabled={!room}>
        <GroupSlotEditor
          title="固定編成のモンスター"
          slots={(fixed?.slots ?? []).map((s) => ({ ...s, weight: 1 }))}
          max={FIX_SLOTS}
          weighted={false}
          monster={rpg2Monster(session.game, book)}
          counts={groupCounts}
          set={(slots) => {
            book.setGroupFixSlots(
              g.row,
              slots.map(({ monster, count }) => ({ monster, count })),
            );
            onEdit();
          }}
          picker={(current, pick, close) => (
            <MonsterPicker session={session} book={book} current={current} onClose={close} onPick={pick} />
          )}
        />
      </fieldset>
    </section>
  );
}

const groupCounts = (current: number): [number, string][] => [
  ...Array.from({ length: 8 }, (_, c): [number, string] => [c, countLabel(c)]),
  ...(current >= 8 ? [[current, countLabel(current)] as [number, string]] : []),
];

/** One side's candidates of an RPG2 group. */
function SlotEditor({
  session,
  book,
  g,
  side,
  title,
  onEdit,
}: {
  session: Session;
  book: MonsterBook;
  g: MonsterGroup;
  side: 'leads' | 'mates';
  title: string;
  onEdit: () => void;
}): ReactNode {
  return (
    <GroupSlotEditor
      title={title}
      slots={g[side]}
      max={GROUP_SLOTS}
      monster={rpg2Monster(session.game, book)}
      counts={groupCounts}
      set={(next) => {
        book.setGroupSlots(g.row, side === 'leads' ? next : g.leads, side === 'mates' ? next : g.mates);
        onEdit();
      }}
      picker={(current, pick, close) => (
        <MonsterPicker session={session} book={book} current={current} onClose={close} onPick={pick} />
      )}
    />
  );
}
