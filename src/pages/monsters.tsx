// Monster book: every MonsterParameter row with its stats, drops, skills, resistances, and the maps
// whose encounter groups (section 6) contain it.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/game';
import type { MapInfo } from '../game/codebin';
import { ELEMENT_AILMENTS, mapEncounters, PLAIN_AILMENTS, RESIST_ELEMENTS as ELEMENTS, RESIST_MAX, RESIST_MIN, type Monster, type MonsterBook, type MonsterGroup } from '../game/monsters';
import type { ModelRef } from './modelview';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, MONSTER_MOTIONS } from '../game/monsters';
import { hex8 } from '../util/bytes';
import { mapTitle } from '../game/names';
import type { MapDoc } from '../game/sections';
import type { Session } from '../session';
import { useActiveRow, useEdits, useSticky, type PageProps } from '../ui/book';
import { MonsterList } from '../ui/MonsterList';
import { MonsterPicker } from '../ui/MonsterPicker';
import { CopyRemoveButtons, NewRecordButton, type CopySpec, type RemoveSpec } from '../ui/RecordButtons';
import { GroupDetail } from '../ui/GroupDetail';
import { ModelTextures } from '../ui/ModelTextures';
import { ModelView } from '../ui/ModelView';
import { PortLookButton } from '../ui/PortLook';
import { replaceMonsterTexture } from '../port/textures';
import { Photo } from '../ui/Photo';
import { InfoTip } from '../ui/InfoTip';
import { ResistCharts } from '../ui/MonsterSlots';
import { ActionBook } from '../game/actions';
import { BossEditor, DropEditor, NameEditor, SkillEditor, StatEditor } from './monsteredit';

export interface Appearance {
  map: MapInfo;
  group: MonsterGroup;
  /** 'map' = the map's group, else the number of cells with this group. */
  cells: number | 'map';
  lead: boolean;
}

/** Monster row -> where it appears (current map documents, so edits show up). */
export function appearances(game: Game, book: MonsterBook, docOf: (m: MapInfo) => MapDoc): Map<number, Appearance[]> {
  const out = new Map<number, Appearance[]>();
  const add = (map: MapInfo, g: MonsterGroup, cells: number | 'map'): void => {
    for (const s of [...g.leads, ...g.mates]) {
      const list = out.get(s.monster) ?? [];
      const lead = g.leads.some((l) => l.monster === s.monster);
      if (!list.some((a) => a.map === map && a.group === g)) list.push({ map, group: g, cells, lead });
      out.set(s.monster, list);
    }
  };
  for (const m of game.editableMaps()) {
    const enc = mapEncounters(docOf(m));
    const g = book.group(enc.group);
    if (g) add(m, g, 'map');
    for (const [hash, cells] of enc.cells) {
      const cg = hash ? book.group(hash) : undefined;
      if (cg) add(m, cg, cells.length);
    }
  }
  return out;
}

/** Model of a monster (MonsterDesign +0x10 / +0x14 in 470D2848); its photo is shared by every page. */
export function monsterRef(game: Game, book: MonsterBook, m: Monster): ModelRef | null {
  const x = book.modelOf(m);
  if (!x) return null;
  return {
    key: `monster/${hex8(x.model)}/${hex8(x.texture)}`,
    load: async () => ({ set: await loadComposite(game, MONSTER_MODEL_ARCHIVE, x.model, x.texture), hash: x.model }),
  };
}


type Filter = string; // 'all' | 'seen' | 'boss' | 'd<dungeon>'

export function MonsterPage({ session, arg, visit, book }: PageProps & { book: MonsterBook }): ReactNode {
  const { game } = session;
  const [edits, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Recomputed on every visit: the maps may have been edited.
  const where = useMemo(() => appearances(game, book, session.docOf), [game, book, session, visit, edits]);
  const selected = useSticky(Number(arg) || undefined, (r) => !!book.monster(r), () => 1);
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const dungeons = useMemo(() => [...new Set(game.editableMaps().map((m) => m.dungeon))], [game]);

  const matches = (m: Monster): boolean => {
    const q = query.trim();
    if (q && ![m.name, ...m.skills.map((s) => s.name), ...m.drops.map((d) => d.name)].some((t) => t.includes(q))) return false;
    if (filter === 'seen') return where.has(m.row);
    if (filter === 'boss') return !!(m.boss || m.nextForm || book.monsters.some((o) => o.nextForm === m.row));
    if (filter.startsWith('d')) return (where.get(m.row) ?? []).some((a) => a.map.dungeon === Number(filter.slice(1)));
    return true;
  };
  const rows = book.monsters.filter(matches);
  const m = book.monster(selected);
  const onEdit = (): void => {
    session.scheduleSave();
    edited();
  };
  return (
    <div className="book">
      <MonsterList query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}
        options={[['all', 'すべて'], ['seen', 'マップに出る'], ['boss', 'ボス・変身'], ...dungeons.map((d): [string, string] => [`d${d}`, game.master.dungeonName(d) || `ダンジョン ${d}`])]}
        rows={rows.map((m) => ({ row: m.row, icon: <Photo model={monsterRef(game, book, m)} />, name: m.name, level: m.level, hp: m.hp.max, count: where.get(m.row)?.length ?? 0 }))}
        total={book.monsters.length} selected={selected} href={(r) => `#/monsters/${r}`} countHead="出現" listRef={list}
        top={<NewRecordButton copy={monsterCopy(book)} current={selected} onEdit={onEdit}
          picker={(p) => <MonsterPicker session={session} book={book} {...p} />} />} />
      <div className="book-detail">
        {m && <MonsterDetail session={session} book={book} m={m} where={where.get(m.row) ?? []} edited={onEdit} />}
      </div>
    </div>
  );
}

function MonsterDetail({ session, book, m, where, edited }: { session: Session; book: MonsterBook; m: Monster; where: Appearance[]; edited: () => void }): ReactNode {
  const { game } = session;
  // Rebuilt after each edit: the monsters using each skill change with the skill slots.
  const actions = useMemo(() => new ActionBook(game.master, (row) => book.monster(row)?.name ?? '', book.directData), [game, book, m]);
  const p = { book, m, edited };
  return (
    <>
      <div className="book-head">
        <h2 className="with-info">{m.name}<InfoTip text={'変更はマスター (56562135) の monsterParameter.bin として書き出されます。\n同じモンスターの別の形態 (ボスなど) は別の行です。'} /></h2>
        <span className="muted">{`#${m.row}  種族 ${m.species}  図鑑 ${m.museum}  デザイン ${m.design}${book.added(m.row) ? '  (追加した行)' : ''}`}</span>
        <CopyRemoveButtons copy={monsterCopy(book)} from={m.row} remove={monsterRemove(book, m)} onEdit={edited} />
        {book.changed(m.row) && <button onClick={() => { book.revert(m.row); edited(); }}>このモンスターの変更を元に戻す</button>}
        <PortLookButton target="kahara" row={m.row} onDone={edited} />
      </div>
      <div className="book-top">
        <div>
          <NameEditor session={session} {...p} />
          {m.description && <p className="book-desc">{m.description}</p>}
          <StatEditor {...p} />
        </div>
        <div>
          <ModelView model={monsterRef(game, book, m)} name={m.name} motionHints={MONSTER_MOTIONS} />
          <ModelTextures model={monsterRef(game, book, m)} replaceInfo={REPLACE_INFO}
            replace={async (name, image) => { await replaceMonsterTexture(session, m.row, name, image); edited(); }} />
        </div>
      </div>
      <div className="book-cols monster-cols">
        <DropEditor session={session} {...p} />
        <SkillEditor session={session} actions={actions} {...p} />
        <BossEditor session={session} actions={actions} {...p} />
      </div>
      <h3 className="with-info">耐性<InfoTip text={RESIST_INFO} /></h3>
      <ResistEditor book={book} m={m} edited={edited} />
      <h3>{`出現する場所 (${where.length})`}</h3>
      <div className="book-where">
        {!where.length && <div className="muted">どのマップの群れにもいません (ボス・イベント戦、エサ場など)</div>}
        {where.map((a, i) => (
          <details key={i}>
            <summary>
              <a href={`#/map/${a.map.name}`}>{mapTitle(a.map, game.code.maps, game.master)}</a>
              <span className="muted">{` 群れ #${a.group.row}${a.cells === 'map' ? '' : ` (セル ${a.cells} 個)`}${a.lead ? '' : ' 仲間としてのみ'}`}</span>
            </summary>
            <GroupDetail game={game} book={book} group={a.group} />
          </details>
        ))}
      </div>
    </>
  );
}

const REPLACE_INFO = [
  '画像 (PNG など) をこのテクスチャの大きさ・形式 (ETC1 など)・ミップマップで書き直して、このモンスターの見た目にします。大きさが違う画像は引き伸ばします。',
  '色のテクスチャ (デザイン +0x14) にその名前があればそれを、なければモデル (+0x10) を書き直し、470D2848 に新しいエントリとして足します。',
  'ほかのモンスターと同じデザインの行を使っているときは、このモンスターに新しいデザインの行を作ります (元に戻すと元の見た目に戻ります)。',
].join('\n');

const COPY_INFO = [
  'この行を写した新しいモンスターを表の最後に作ります。見た目と種族 (図鑑やドロップの記録) は元と同じで、名前・能力・ワザ・耐性などは別に変えられます。',
  '見た目は「見た目を選ぶ…」で、この作品やほかの作品のモンスターから選び直せます。',
  '群れ・ボス戦の敵・次の形態で選べます。',
  'ゲームは行 185 以降を弾くので、追加した行があると書き出しに code.ips のパッチ「追加したモンスター」が入ります。行は 255 まで。',
].join('\n');

/** Copying a row as a new monster (the buttons of an entry and the list's "＋ 新しいモンスター"). */
export function monsterCopy(book: MonsterBook): CopySpec {
  return { noun: 'モンスター', can: book.canCopy(), why: 'モンスターは行 255 までです', info: COPY_INFO, copy: (row) => book.copyMonster(row), href: (r) => `#/monsters/${r}` };
}

/** Removing the last added monster when nothing refers to it. */
function monsterRemove(book: MonsterBook, m: Monster): RemoveSpec | undefined {
  if (!book.added(m.row)) return undefined;
  if (!book.canRemove(m.row)) return { used: [], why: '消せるのは最後に追加したモンスターだけです', remove: () => {}, next: '' };
  const users = book.users(m.row);
  return {
    used: [...users.groups.map((r) => `群れ #${r}`), ...users.fixes.map((r) => `ボス戦の敵 #${r}`), ...users.forms.map((r) => `#${r} の次の形態`)],
    remove: () => book.removeMonster(m.row),
    next: `#/monsters/${m.row - 1}`,
  };
}

const RESIST_INFO = [
  '値は −9〜+10 (正ほど強い)。',
  '属性はダメージの倍率 (BattleParameter +0x08 の表: −9 = ×4 … +9 = ×0.1)。+10 はその属性のダメージを無効にします。',
  '状態異常・能力ダウン・突然死は付与率に掛かる係数 (BattleParameter [0x67 + 値 + 9]: −9 = 200% … +9 = 0%)。+10 は +9 と同じ (効かない)。',
  'ワザの付与率 = 基本の率 (ワザごとに 100 / 75 / 50 / 34 / 25 / 12 / 6%) × 係数 (上限 100%)。',
].join('\n');

/** The resistance charts: a label and the indices in Monster.resist of its axes. */
function resistCharts(n: number): [string, number[]][] {
  const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);
  return [
    ['属性', range(0, ELEMENTS)],
    ['属性の状態異常', ELEMENT_AILMENTS],
    ['状態異常・能力ダウン・突然死', [...PLAIN_AILMENTS, ...range(20, n)]],
  ];
}

/**
 * Resistances by chart, each with its effect: elements, the ailments of the elements, and the other ailments with the
 * stat downs and instant death.
 */
function ResistEditor({ book, m, edited }: { book: MonsterBook; m: Monster; edited: () => void }): ReactNode {
  const bp = book.battle;
  const effect = (k: number, v: number): string => {
    if (k < ELEMENTS) {
      const mul = bp.multiplier(v);
      return mul === 0 ? '無効 (×0)' : `×${mul}${mul > 1 ? ' (弱点)' : mul < 1 ? ' (効きにくい)' : ''}`;
    }
    return `係数 ${bp.coefficient(v)}%`;
  };
  const charts = resistCharts(m.resist.length);
  return (
    <ResistCharts
      charts={charts.map(([label, ks]) => ({
        label,
        effectHead: ks[0]! < ELEMENTS ? 'ダメージ' : '係数',
        axes: ks.map((k) => {
          const r = m.resist[k]!;
          return { name: r.name, value: r.value, original: book.originalResist(m.row, k), title: `状態 ${r.id} (0x${r.id.toString(16).toUpperCase()})` };
        }),
      }))}
      min={RESIST_MIN}
      max={RESIST_MAX}
      rings={[-9, -5, 0, 5, 10]}
      effect={(c, j, v) => effect(charts[c]![1][j]!, v)}
      cell={(c, j, v) => { const k = charts[c]![1][j]!; return k < ELEMENTS ? effect(k, v) : `${bp.coefficient(v)}%`; }}
      onChange={(c, j, v) => { book.setResist(m.row, charts[c]![1][j]!, v); edited(); }}
    />
  );
}
