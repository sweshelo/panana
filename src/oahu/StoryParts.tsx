// Parts of the story pages (#87): the event list shared with the event page, where the code writes a value (with the
// immediates editable, exported in code.ips), a message slot of the navi, and the names of the save values.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { encodeImm } from '../game/asm';
import { fnLabel } from '../game/scriptasm';
import { BattleMessagePicker } from '../ui/BattleMessagePicker';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { MessageEditor } from '../ui/message';
import { oahuEventKey, type OahuEventEntry } from './events';
import { oahuDungeonLabel, useMaps } from './MapPage';
import type { OahuSession } from './session';
import { codeWordAt, editedImm, siteTargets, valueLabel, valueNameKey, WRITE_KIND_LABEL, type Imm, type OahuWriteSite, type Operand, type ValueKind } from './story';

/** Every EventObject row (session.eventEntries), rebuilt when the maps change; null while loading. */
export function useEventEntries(session: OahuSession): OahuEventEntry[] | null {
  const revision = useMaps(session.maps);
  const [entries, setEntries] = useState<OahuEventEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    session.eventEntries().then((e) => live && setEntries(e));
    return () => {
      live = false;
    };
  }, [session, revision]);
  return entries;
}

/** The EventObject rows whose script class runs each write site (the functions reached from the class, events.ts). */
export function useSiteOwners(entries: OahuEventEntry[] | null, sites: OahuWriteSite[]): Map<number, OahuEventEntry[]> {
  return useMemo(() => {
    const out = new Map<number, OahuEventEntry[]>();
    if (!entries) return out;
    const runs = entries.flatMap((e) => e.scripts.flatMap((s) => s.cls.ranges.map(([a, b]) => ({ a, b, e }))));
    for (const site of sites) {
      const owners = [...new Set(runs.filter((r) => site.at >= r.a && site.at < r.b).map((r) => r.e))];
      if (owners.length) out.set(site.at, owners);
    }
    return out;
  }, [entries, sites]);
}

/** Sets the immediate of the instruction at `at` (removes the edit when it is the game's value again). */
export function setImm(session: OahuSession, at: number, value: number): void {
  const code = session.code!.code;
  session.storyEdits = session.storyEdits.filter((e) => e.at !== at);
  const before = codeWordAt(code, at);
  if (editedImm(code, [], at) !== value) session.storyEdits.push({ at, kind: 'imm', value, before });
  session.scheduleSave();
}

/** Sets the literal word at `at` (a script's message ID). */
export function setWord(session: OahuSession, at: number, value: number): void {
  const code = session.code!.code;
  session.storyEdits = session.storyEdits.filter((e) => e.at !== at);
  const before = codeWordAt(code, at);
  if (before !== value) session.storyEdits.push({ at, kind: 'word', value, before });
  session.scheduleSave();
}

export const wordAt = (session: OahuSession, at: number): number => {
  const e = session.storyEdits.find((x) => x.at === at && x.kind === 'word');
  return e ? e.value : codeWordAt(session.code!.code, at);
};

/** "d20 悪のアジト 行 39" with a link to the event page. */
export function EventLink({ session, e }: { session: OahuSession; e: OahuEventEntry }): ReactNode {
  const where = e.places[0]?.map.name;
  return <a href={`#/events/${oahuEventKey(e)}`} title={where ? `${where} に置かれる` : 'どのマップにも置かれていない'}>{`${oahuDungeonLabel(session, e.dungeon)} 行 ${e.row}`}</a>;
}

/** Where a site is: the event rows that run it, or its function. */
export function SiteWhere({ session, site, owners }: { session: OahuSession; site: OahuWriteSite; owners: OahuEventEntry[] | undefined }): ReactNode {
  if (owners?.length) return <>{owners.slice(0, 4).map((e, i) => <span key={oahuEventKey(e)}>{i > 0 && '、'}<EventLink session={session} e={e} /></span>)}{owners.length > 4 && ` ほか ${owners.length - 4}`}</>;
  const note = site.kind === 'stepAction' ? 'マップに入ったときの判定 (FUN_0018D848 の先)' : '';
  return <span className="muted" title="どの EventObject の行のクラスからも辿れなかった関数 (戦闘のあと、カットシーンの続きなど)">{`${fnLabel(site.fn)}${note ? ` ・ ${note}` : ''}`}</span>;
}

const hex = (n: number): string => n.toString(16).toUpperCase().padStart(8, '0');

/** One immediate of an operand, editable (the guard `cmp` of a step goes with it). */
function ImmInput({ session, site, imm, onEdit }: { session: OahuSession; site: OahuWriteSite; imm: Imm; onEdit: () => void }): ReactNode {
  const code = session.code!.code;
  const [error, setError] = useState('');
  const now = editedImm(code, session.storyEdits, imm.at);
  const original = editedImm(code, [], imm.at);
  if (imm.mvn) return <span className="mono" title="mvn の値は変えられません">{now}</span>;
  const max = site.kind === 'step' || site.kind === 'stepAction' ? 0xffff : 0xff;
  return (
    <span className="nowrap">
      <NumberInput value={now} min={0} max={max} className={`num-input${now !== original ? ' edited' : ''}`} title={`0x${hex(imm.at)} の即値 (元の値 ${original})`}
        onCommit={(v) => {
          if (encodeImm(v) === null) {
            setError(`${v} は ARM の即値にできません (0〜255 と、それを偶数ビット回転した値だけ)`);
            return;
          }
          setError('');
          setImm(session, imm.at, v);
          if (site.guard && site.value.imms[0] === imm) setImm(session, site.guard.at, v);
          onEdit();
        }} />
      {error && <span className="error-text small"> {error}</span>}
    </span>
  );
}

/** An operand's values: the immediates (editable when the code.bin is here) and whether the code computes another. */
function OperandValues({ session, site, op, editable, onEdit }: { session: OahuSession; site: OahuWriteSite; op: Operand; editable: boolean; onEdit: () => void }): ReactNode {
  return (
    <>
      {op.imms.map((imm, i) => (
        <span key={imm.at}>{i > 0 && ' / '}{editable ? <ImmInput session={session} site={site} imm={imm} onEdit={onEdit} /> : <span className="mono">{imm.value}</span>}</span>
      ))}
      {op.open && <span className="muted small">{op.imms.length ? ' / ' : ''}(コードが計算する値)<InfoTip text="引数が即値でなくレジスタで渡されるので、数を変えるにはパッチを書きます (コードのページ)" /></span>}
    </>
  );
}

/** A table of write sites: where, what (value / step) and the value, with the immediates editable. */
export function WriteSiteTable({ session, sites, owners, valueOnly = false, onEdit }: {
  session: OahuSession;
  sites: OahuWriteSite[];
  owners: Map<number, OahuEventEntry[]>;
  /** Leave out the "what" column (the page is about one value). */
  valueOnly?: boolean;
  onEdit: () => void;
}): ReactNode {
  const { ranges } = session.story();
  if (!sites.length) return <div className="muted small">ありません</div>;
  return (
    <table className="book-table small">
      <thead><tr><th>書く所</th>{!valueOnly && <th>何を</th>}<th>値</th><th>アドレス</th></tr></thead>
      <tbody>
        {sites.map((s) => {
          const here = (owners.get(s.at) ?? []).map((e) => e.dungeon);
          const targets = siteTargets(s, ranges, here);
          return (
            <tr key={s.at}>
              <td><SiteWhere session={session} site={s} owners={owners.get(s.at)} /></td>
              {!valueOnly && (
                <td className="nowrap">
                  {WRITE_KIND_LABEL[s.kind]}
                  {targets.length > 0 && <> {targets.slice(0, 3).map((t, i) => <span key={i}>{i > 0 && ' '}<ValueLink session={session} kind={t.kind} index={t.index} /></span>)}</>}
                  {!targets.length && s.index && <span className="muted">{` [${s.index.imms.map((i) => i.value).join('/') || '?'}]`}</span>}
                </td>
              )}
              <td><OperandValues session={session} site={s} op={s.value} editable onEdit={onEdit} />{s.guard && <span className="muted small" title={`0x${hex(s.guard.at)} の cmp も同じ値に変わります`}> (段階が小さいときだけ)</span>}</td>
              <td className="mono muted">{hex(s.at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** "0xF9[4] ドローン撃破" linking to the flags page. */
export function ValueLink({ session, kind, index }: { session: OahuSession; kind: ValueKind; index: number }): ReactNode {
  const name = session.storyNames[valueNameKey(kind, index)];
  return <a href={`#/flags/${kind}.${index}`}>{valueLabel(kind, index)}{name ? ` ${name}` : ''}</a>;
}

/** A message slot of a row: the text (edited in place), another message, or a new one with the same text. */
export function MessageSlot({ session, id, users, onPick, onEdit }: {
  session: OahuSession;
  id: number;
  /** Who uses each message (for the picker's "free" filter). */
  users: Map<number, string[]>;
  onPick: (id: number) => void;
  onEdit: () => void;
}): ReactNode {
  const texts = session.messages.texts;
  const [picking, setPicking] = useState(false);
  const shared = (users.get(id)?.length ?? 0) > 1;
  return (
    <div className="msg-slot">
      {id ? <MessageEditor texts={texts} id={id} compact apply={(f) => { f(); onEdit(); }} /> : <span className="muted">(なし)</span>}
      <div className="row small">
        <button onClick={() => setPicking(true)}>別のメッセージ…</button>
        {texts.canAdd() && <button title="今の本文を写した新しいメッセージ (MessageSystemCommon の末尾) にして、ほかの行と別に書き換えられるようにします"
          onClick={() => onPick(texts.add(id ? (texts.units(id) ?? new Uint16Array([0])) : new Uint16Array([0])))}>新しいメッセージにする</button>}
        {id > 0 && <button onClick={() => onPick(0)}>なしにする</button>}
        {shared && <span className="muted">{`ほかにも ${users.get(id)!.length - 1} か所で使われています`}</span>}
      </div>
      {picking && (
        <BattleMessagePicker texts={texts} anchor={session.fieldRange()[0]} title="メッセージを選ぶ" current={id} users={users} freeLabel="ナビが使っていないものだけ"
          info="ナビの見出し・ヒントは MessageField_JP の末尾 (42359〜) にあります。"
          onPick={(v) => { setPicking(false); onPick(v); }} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

/** A name box for a save value, kept with the edits. */
export function ValueName({ session, kind, index, onEdit }: { session: OahuSession; kind: ValueKind; index: number; onEdit: () => void }): ReactNode {
  const key = valueNameKey(kind, index);
  return (
    <input type="text" size={24} placeholder="名前 (例: ドローン撃破)" defaultValue={session.storyNames[key] ?? ''} key={key}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v) session.storyNames[key] = v;
        else delete session.storyNames[key];
        session.scheduleSave();
        onEdit();
      }} />
  );
}

/** The step a site writes (single immediate), with the session's edit. */
export function siteStep(session: OahuSession, s: OahuWriteSite): number[] {
  if (!session.code) return s.value.imms.map((i) => i.value);
  return s.value.imms.map((i) => editedImm(session.code!.code, session.storyEdits, i.at));
}

