// Monster book: every MonsterParameter row with its stats, drops, skills, resistances, and the maps
// whose encounter groups (section 6) contain it.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/game';
import type { MapInfo } from '../game/codebin';
import { mapEncounters, RESIST_GROUPS, RESIST_MAX, RESIST_MIN, type Monster, type MonsterBook, type MonsterGroup, type ResistKind } from '../game/monsters';
import type { ModelRef } from './modelview';
import { loadComposite } from '../cgfx/loader';
import { MONSTER_MODEL_ARCHIVE, MONSTER_MOTIONS } from '../game/monsters';
import { hex8 } from '../util/bytes';
import { mapTitle } from '../game/names';
import type { MapDoc } from '../game/sections';
import type { Session } from '../session';
import { Count, ListFilter, useActiveRow, useEdits, useSticky, type PageProps } from '../ui/book';
import { GroupDetail } from '../ui/GroupDetail';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { Radar } from '../ui/Radar';

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

const range = (r: { min: number; max: number }): string => (r.min === r.max || !r.min ? String(r.max) : `${r.min}〜${r.max}`);

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
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・ワザ・ドロップで検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['seen', 'マップに出る'], ['boss', 'ボス・変身'], ...dungeons.map((d): [string, string] => [`d${d}`, game.master.dungeonName(d) || `ダンジョン ${d}`])]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={book.monsters.length} />
          <table className="book-table">
            <thead><tr><th></th><th>#</th><th>名前</th><th>Lv</th><th>HP</th><th>出現</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const n = where.get(m.row)?.length ?? 0;
                return (
                  <tr key={m.row} className={m.row === selected ? 'active' : ''} onClick={() => (location.hash = `#/monsters/${m.row}`)}>
                    <td className="photo-cell"><Photo model={monsterRef(game, book, m)} /></td>
                    <td className="num muted">{m.row}</td>
                    <td>{m.name}</td>
                    <td className="num">{m.level}</td>
                    <td className="num">{m.hp.max}</td>
                    <td className="num muted">{n || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        {m && <MonsterDetail session={session} book={book} m={m} where={where.get(m.row) ?? []} edited={() => { session.scheduleSave(); edited(); }} />}
      </div>
    </div>
  );
}

function MonsterDetail({ session, book, m, where, edited }: { session: Session; book: MonsterBook; m: Monster; where: Appearance[]; edited: () => void }): ReactNode {
  const { game } = session;
  const link = (row: number): ReactNode => <a key={row} href={`#/monsters/${row}`}>{`${book.monster(row)?.name ?? '?'} (#${row})`}</a>;
  const prev = book.monsters.filter((o) => o.nextForm === m.row);
  const stat = (label: string, v: string): ReactNode => <div className="stat"><span className="muted">{label}</span><b>{v}</b></div>;
  return (
    <>
      <div className="book-head">
        <h2>{m.name}</h2>
        <span className="muted">{`#${m.row}  種族 ${m.species}  図鑑 ${m.museum}  デザイン ${m.design}`}</span>
      </div>
      <div className="book-top">
        <div>
          {m.description && <p className="book-desc">{m.description}</p>}
          <div className="stats">
            {stat('Lv', String(m.level))}{stat('HP', range(m.hp))}{stat('こうげき', range(m.attack))}{stat('ぼうぎょ', range(m.defense))}
            {stat('すばやさ', range(m.speed))}{stat('回避', `${m.evasion}%`)}{stat('経験値', String(m.exp))}{stat('ゴールド', String(m.gold))}
          </div>
        </div>
        <ModelView model={monsterRef(game, book, m)} name={m.name} motionHints={MONSTER_MOTIONS} />
      </div>
      <div className="book-cols">
        <section>
          <h3>ドロップ (率の値)</h3>
          {m.drops.length
            ? <ul>{m.drops.map((d, i) => <li key={i}><a href={`#/items/${d.item}`}>{d.name}</a> <span className="muted">{`(${d.rate})`}</span></li>)}</ul>
            : <div className="muted">なし</div>}
        </section>
        <section>
          <h3>ワザ</h3>
          <ul>{m.skills.map((s, i) => <li key={i}>{`${s.name} `}<a className="muted" href={`#/actions/${s.action}`}>{`#${s.action}`}</a></li>)}</ul>
        </section>
        <section>
          <h3>行動</h3>
          <div>{`AI: ${m.ai} / 狙い ${m.target}`}</div>
          <div>{`行動回数 ${m.actions}${m.focus ? '、集中攻撃' : ''}`}</div>
          {!!m.boss && <div>{`ボス特殊 ${m.boss}`}</div>}
          {!!m.nextForm && <div>次の形態: {link(m.nextForm)}</div>}
          {prev.length > 0 && <div>前の形態: {prev.map((p) => link(p.row))}</div>}
          {m.line && <div className="muted">{`「${m.line.replace(/[Ąą]+/g, m.name)}」`}</div>}
        </section>
      </div>
      <div className="row">
        <h3>耐性</h3>
        {book.changed(m.row) && <button onClick={() => { book.revert(m.row); edited(); }}>このモンスターの変更を元に戻す</button>}
      </div>
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

const fmt = (v: number): string => `${v > 0 ? '+' : ''}${v}`;

/**
 * Resistances by group, each with its effect. Elements and ailments are radar charts whose handles can
 * be dragged; every value can also be picked in the tables (-9..+10).
 */
function ResistEditor({ book, m, edited }: { book: MonsterBook; m: Monster; edited: () => void }): ReactNode {
  const bp = book.battle;
  const set = (k: number, v: number): void => {
    book.setResist(m.row, k, v);
    edited();
  };
  const effect = (kind: ResistKind, v: number): string => {
    if (kind === 'element') {
      const mul = bp.multiplier(v);
      return mul === 0 ? '無効 (×0)' : `×${mul}${mul > 1 ? ' (弱点)' : mul < 1 ? ' (効きにくい)' : ''}`;
    }
    return `係数 ${bp.coefficient(v)}%`;
  };
  const values = Array.from({ length: RESIST_MAX - RESIST_MIN + 1 }, (_, i) => i + RESIST_MIN);
  return (
    <div className="resists">
      <p className="muted small">
        値は −9〜+10 (正ほど強い)。属性はダメージの倍率 (BattleParameter +0x08 の表: −9 = ×4 … +9 = ×0.1)。
        属性の +10 はその属性のダメージを無効にします (モンスターを作るとき、値が 9 より大きい属性に無効のフラグが立ち、倍率が 0 になる)。
        状態異常・能力ダウン・突然死は付与率に掛かる係数 (BattleParameter [0x67 + 値 + 9]: −9 = 200% … +9 = 0%)。値は −9〜+9 に丸められるので、+10 は +9 と同じ (0%、効かない)。
        ワザの付与率 = 基本の率 (ワザごとに 100 / 75 / 50 / 34 / 25 / 12 / 6%) × 係数 (上限 100%)。
      </p>
      <div className="radars">
        {RESIST_GROUPS.filter(([, kind]) => kind === 'element' || kind === 'ailment').map(([label, kind, a, b]) => (
          <figure key={label} className="radar-box">
            <Radar
              axes={m.resist.slice(a, b).map((r, j) => ({ label: r.name, value: r.value, original: book.originalResist(m.row, a + j) }))}
              min={RESIST_MIN}
              max={RESIST_MAX}
              rings={[-9, -5, 0, 5, 10]}
              format={(v) => `${fmt(v)} ${effect(kind, v)}`}
              onChange={(j, v) => set(a + j, v)}
            />
            <figcaption>{`${label} (ドラッグで変更。点線 = 元の値)`}</figcaption>
          </figure>
        ))}
      </div>
      {RESIST_GROUPS.map(([label, kind, a, b]) => (
        <table key={label} className="res-table">
          <tbody>
            <tr>
              <th>{label}</th><th>値</th>
              {kind === 'element' ? <th>ダメージ</th> : <><th>係数</th><th>100% のワザ</th><th>50%</th><th>25%</th></>}
            </tr>
            {m.resist.slice(a, b).map((r, j) => {
              const k = a + j;
              const orig = book.originalResist(m.row, k);
              const cls = r.value > 0 ? 'plus' : r.value < 0 ? 'minus' : '';
              return (
                <tr key={k}>
                  <td>{r.name}</td>
                  <td>
                    <select
                      className={r.value !== orig ? 'edited' : ''}
                      title={r.value !== orig ? `元の値 ${fmt(orig)}` : `状態 ${r.id} (0x${r.id.toString(16).toUpperCase()})`}
                      value={r.value}
                      onChange={(e) => set(k, Number(e.target.value))}
                    >
                      {[...new Set([...values, r.value])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{fmt(v)}</option>)}
                    </select>
                  </td>
                  {kind === 'element'
                    ? <td className={`num ${cls}`}>{effect(kind, r.value)}</td>
                    : <>
                        <td className={`num ${cls}`}>{`${bp.coefficient(r.value)}%`}</td>
                        {[0, 2, 4].map((lv) => <td key={lv} className="num muted">{`${bp.chance(lv, r.value)}%`}</td>)}
                      </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}
