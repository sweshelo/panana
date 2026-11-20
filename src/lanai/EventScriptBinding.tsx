// A record's event on the map's page, given to a function of the stage's event script (eventScript.ts): the author
// picks the function at the record instead of naming the row in the script. What can start the event comes from the
// record's section and kind (stageScript.ts recordTrigger); giving a function makes the row's first action "a script".
import { useState, type ReactNode } from 'react';
import { LANAI_ACTION_SCRIPT } from './actions';
import { SCRIPT_TRIGGER_LABEL, ScriptDocError, type ScriptTrigger } from './eventScript';
import type { LanaiEditState } from './mapedit';
import { LANAI_EVENT_ACTIONS } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import { docBound, docUnbound, rowBinding } from './scriptDoc';
import { recordTrigger } from './stageScript';

const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The triggers a record's event can have: a range also keeps the event of "all monsters beaten". */
export function recordTriggers(section: number, raw: Uint8Array): ScriptTrigger[] {
  const kind = u32(raw, 0);
  if (section === 8 && kind >= 100) return [];
  const t = recordTrigger({ section, kind: section === 5 ? kind : 0 });
  return t === 'area' ? ['area', 'defeat'] : t === 'button' ? ['button', 'switch'] : t ? [t] : [];
}

export function EventScriptBinding({
  st,
  section,
  index,
  row,
}: {
  st: LanaiEditState;
  section: number;
  index: number;
  row: number;
}): ReactNode {
  const session = st.maps.session;
  useLanaiRevision(session);
  const [error, setError] = useState('');
  const archive = st.maps.content.archive.toUpperCase();
  const raw = st.current?.recs[section]?.[index]?.raw;
  const group = st.info?.dungeon;
  if (!raw || group === undefined || !session.createdFiles.has(archive)) return null;
  const triggers = recordTriggers(section, raw);
  if (!triggers.length) return null;
  const stored = session.stageScripts.get(archive);
  const functions = (stored?.doc.functions ?? []).filter((f) => !f.params);
  if (!stored || !functions.length)
    return (
      <p className="muted small">
        スクリプトの関数:
        まだありません。ステージのページの「スクリプトを編集」で関数を書いて保存すると、ここでこのレコードに割り当てられます。
      </p>
    );
  const bound = rowBinding(stored.doc, group, row);
  const trigger = bound && triggers.includes(bound.trigger) ? bound.trigger : triggers[0]!;
  const t = st.maps.eventTable(group);
  const scripted = !!t && t.u32(row, LANAI_EVENT_ACTIONS[0]) === LANAI_ACTION_SCRIPT;
  const give = (fn: string, as: ScriptTrigger): void => {
    try {
      session.setStageScriptDoc(
        archive,
        fn
          ? docBound(stored.doc, { trigger: as, group, row, fn })
          : docUnbound(stored.doc, { trigger: as, group, row }),
      );
      // the game asks the CRO for the event only when the row's action is "a script"
      if (fn && !scripted) st.setEventField(row, (x) => x.setU32(row, LANAI_EVENT_ACTIONS[0], LANAI_ACTION_SCRIPT));
      session.edited();
      setError('');
    } catch (e) {
      setError(e instanceof ScriptDocError ? e.message : (e as Error).message);
    }
  };
  return (
    <>
      <label className="field">
        <span>スクリプトの関数</span>
        <select aria-label="スクリプトの関数" value={bound?.fn ?? ''} onChange={(e) => give(e.target.value, trigger)}>
          <option value="">なし</option>
          {functions.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {triggers.length > 1 && (
        <label className="field">
          <span>きっかけ</span>
          <select
            aria-label="スクリプトのきっかけ"
            value={trigger}
            disabled={!bound}
            onChange={(e) => bound && give(bound.fn, e.target.value as ScriptTrigger)}
          >
            {triggers.map((x) => (
              <option key={x} value={x}>
                {SCRIPT_TRIGGER_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <p className="muted small">
        {bound
          ? `${SCRIPT_TRIGGER_LABEL[trigger]}に関数「${bound.fn}」を実行します${scripted ? '' : '。動作 1 の型が「スクリプト (CRO)」ではないので、このままでは呼ばれません'}。`
          : `${triggers.map((x) => SCRIPT_TRIGGER_LABEL[x]).join(' / ')}に実行する関数を選べます。選ぶと動作 1 の型が「2D: スクリプト (CRO)」になります。`}
        {bound?.trigger === 'defeat'
          ? ' この範囲はイベントの置き場です。プレイヤーが入れる場所に置くと、入ったときにも同じ関数が実行されます。'
          : ''}
      </p>
    </>
  );
}
