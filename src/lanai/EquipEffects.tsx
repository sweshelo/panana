// The effects of an RPG FREE! equipment in the item book (equipment.ts): two effects of the EquipInfo row (kind, the
// state's number or an automatic action's condition, the value), and the face pattern of glasses.
import { useMemo, useState, type ReactNode } from 'react';
import { NumberInput } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import {
  isAutoEffect, lanaiCondition, lanaiEffectCondition, lanaiEffectKindLabel, lanaiEffectKinds, lanaiEffectNumberLabel, lanaiEffectRange,
  lanaiEffects, lanaiEffectText, LANAI_EFFECT_ELEMENTS, LANAI_EFFECT_NUMBERS, LANAI_EFFECT_OFFSETS, LANAI_EQUIP_DROP, LANAI_EQUIP_SLOTS,
  LANAI_GLASSES, lanaiSetEffect, type LanaiEffect, type LanaiEquipRef,
} from './equipment';
import { lanaiConditionLabel } from './monsterStats';
import { LanaiActionPicker } from './pickers';
import type { LanaiSession } from './session';

const hx = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
const CONDITIONS: [number, string][] = Array.from({ length: 0xc4 }, (_, v) => [v, lanaiConditionLabel(v)]);

/** Kinds that have a name but no equipment of the game uses (whether the battle reads them from equipment is not known). */
const unconfirmed = (k: number): boolean => k === 0x08 || k === 0x4b || k >= 0x4d;

const INFO = [
  '装備している間に付く効果です。1 つの装備に 2 つまで (EquipInfo +0x04〜+0x07 / +0x08〜+0x0B: 値 s16・種類 u8・番号 u8)。首・手などの欄による違いはありません。',
  '種類は code.bin の FUN_00165F60 で ConditionData の行 (状態) に当たり、名前は装備の画面の名前 (msg_equip)、値の範囲はその行の最小〜最大です。',
  '同じ状態の効果が複数の装備にあると、その行の合算のしかた (足し算・掛け算・大きいほう・上書き) で 1 つにまとまります。',
  '「〜倍」の値は 100 = 1 倍で、基準 100 の行は 140 なら「+0.4倍」と出ます。',
  '種類 0x40〜0x44 は自動のアクションで、値が ActionData の行、番号が発動の条件 (モンスターの自動行動と同じ) です。',
].join('\n');

export function LanaiEquipEffects({ session, equip, kind, onEdit }: { session: LanaiSession; equip: LanaiEquipRef; kind: number; onEdit: () => void }): ReactNode {
  const effects = lanaiEffects(equip);
  const original = equip.table.originalRow(equip.row);
  const kinds = useMemo(() => lanaiEffectKinds(session), [session]);
  const [picking, setPicking] = useState<number | null>(null);
  const changed = (offset: number, size: number): string => {
    if (!original) return '';
    const now = equip.table.row(equip.row);
    for (let i = offset; i < offset + size; i++) if (now[i] !== original[i]) return 'edited';
    return '';
  };
  const set = (e: LanaiEffect, patch: Partial<LanaiEffect>): void => {
    lanaiSetEffect(equip, { ...e, ...patch });
    onEdit();
  };
  /** A new kind: a number and a value that have a name. */
  const setKind = (e: LanaiEffect, k: number): void => {
    if (!k) return set(e, { kind: 0, number: 0, value: 0 });
    if (isAutoEffect(k)) return set(e, { kind: k, number: isAutoEffect(e.kind) ? e.number : 0, value: isAutoEffect(e.kind) ? e.value : 0 });
    const numbers = LANAI_EFFECT_NUMBERS[k];
    const number = numbers ? (numbers.includes(e.number) ? e.number : numbers[0]!) : 0;
    const c = lanaiCondition(session, lanaiEffectCondition(k, number, 0));
    const [min, max] = c ? [c.min, c.max] : [-32768, 32767];
    let value = k === 0x09 ? 1 : k === 0x0a ? 3 : Math.min(max, Math.max(min, e.kind ? e.value : c?.base || (max === 1 ? 1 : 0)));
    if (k === 0x09 && e.kind === 0x09) value = e.value;
    set(e, { kind: k, number, value });
  };
  const glasses = (kind & 0xff) === 0x82;
  const drop = equip.table.bits(equip.row, LANAI_EQUIP_DROP.offset, LANAI_EQUIP_DROP.shift, LANAI_EQUIP_DROP.count);
  return (
    <div className="model-line equip-effects">
      <div className="with-info">{`装備の効果 (${LANAI_EQUIP_SLOTS[kind & 0xf0]?.label ?? ''}、${equip.table.name} 行 ${equip.row})`}<InfoTip text={INFO} /></div>
      {effects.map((e) => {
        const o = LANAI_EFFECT_OFFSETS[e.slot]!;
        const numbers = LANAI_EFFECT_NUMBERS[e.kind];
        const [min, max] = lanaiEffectRange(session, e);
        const value = (): ReactNode => {
          if (e.kind === 0x09) return (
            <select className={changed(o, 2)} value={e.value} onChange={(x) => set(e, { value: Number(x.target.value) })}>
              {Object.entries(LANAI_EFFECT_ELEMENTS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              {!(e.value in LANAI_EFFECT_ELEMENTS) && <option value={e.value}>{`${e.value} (なし)`}</option>}
            </select>
          );
          if (e.kind === 0x0a) return (
            <select className={changed(o, 2)} value={e.value} onChange={(x) => set(e, { value: Number(x.target.value) })}>
              {[2, 3, 4].map((v) => <option key={v} value={v}>{lanaiCondition(session, lanaiEffectCondition(0x0a, 0, v))?.name || `${v} (1 人)`}</option>)}
              {![2, 3, 4].includes(e.value) && <option value={e.value}>{String(e.value)}</option>}
            </select>
          );
          if (isAutoEffect(e.kind)) return <button className={changed(o, 2)} onClick={() => setPicking(e.slot)} title="アクションを選び直す">{`アクション ${e.value}`}</button>;
          return <NumberInput value={e.value} min={Math.min(min, e.value)} max={Math.max(max, e.value)} className={`num-input ${changed(o, 2)}`} title={`${min}〜${max}`} onCommit={(v) => set(e, { value: v })} />;
        };
        return (
          <div key={e.slot} className="equip-effect">
            <span className="muted">{`${e.slot + 1}: `}</span>
            <select className={changed(o + 2, 1)} value={e.kind} onChange={(x) => setKind(e, Number(x.target.value))}>
              <option value={0}>なし</option>
              {kinds.map((k) => <option key={k} value={k}>{`${hx(k)} ${lanaiEffectKindLabel(session, k)}${unconfirmed(k) ? ' (未確認)' : ''}`}</option>)}
              {!!e.kind && !kinds.includes(e.kind) && <option value={e.kind}>{`${hx(e.kind)} (名前なし)`}</option>}
            </select>
            {!!e.kind && numbers && (
              <select className={changed(o + 3, 1)} value={e.number} onChange={(x) => set(e, { number: Number(x.target.value) })}>
                {numbers.map((n) => <option key={n} value={n}>{lanaiEffectNumberLabel(session, e.kind, n)}</option>)}
                {!numbers.includes(e.number) && <option value={e.number}>{`番号 ${e.number} (名前なし)`}</option>}
              </select>
            )}
            {!!e.kind && isAutoEffect(e.kind) && (
              <select className={changed(o + 3, 1)} value={e.number} onChange={(x) => set(e, { number: Number(x.target.value) })} title="発動の条件">
                {CONDITIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                {e.number >= CONDITIONS.length && <option value={e.number}>{hx(e.number)}</option>}
              </select>
            )}
            {!!e.kind && !numbers && !isAutoEffect(e.kind) && !!e.number && <span className="muted small">{`番号 ${e.number}`}</span>}
            {!!e.kind && value()}
            {!!e.kind && <span className="muted">{lanaiEffectText(session, e)}</span>}
          </div>
        );
      })}
      {glasses && (
        <div className="equip-effect">
          <span className="muted with-info">{'顔の模様'}<InfoTip text={'めがね (種類 0x82) を着けたときの顔の模様の番号 (EquipInfo +0x00 bit0-4、0 = なし)。'} /></span>
          <NumberInput value={equip.table.bits(equip.row, LANAI_GLASSES.offset, LANAI_GLASSES.shift, LANAI_GLASSES.count)} min={0} max={31}
            className={`num-input ${changed(0, 1)}`}
            onCommit={(v) => { equip.table.setBits(equip.row, LANAI_GLASSES.offset, LANAI_GLASSES.shift, LANAI_GLASSES.count, v); onEdit(); }} />
        </div>
      )}
      {drop > 0 && <div className="muted small">{`装備を落とす確率 (推定): ${drop} / 4096 (EquipInfo +0x00 bit5-16)`}</div>}
      {picking !== null && (
        <LanaiActionPicker session={session} title="自動のアクションを選ぶ" current={effects[picking]!.value} onClose={() => setPicking(null)}
          onPick={(row) => { const e = effects[picking]!; setPicking(null); set(e, { value: row }); }} />
      )}
    </div>
  );
}
