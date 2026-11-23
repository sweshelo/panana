// Adapter-driven prop/template picker used by RPG3 and FREE!, reusable by future map formats.
import { useState, type ReactNode } from 'react';
import type { MapEditState } from './model';
import { NumberInput } from '../ui/book';
import { useEditorState } from '../ui/useEditorState';
import {
  PartPhoto,
  PartPicker,
  PartSelection,
  type PartChoice,
  type PartPlace,
  type PartThumbnailSource,
} from './partpalette';
const PLACES_HINT = '右クリックで使用例のマップを開けます。';
export interface PartTemplate {
  section: number;
  raw: Uint8Array;
  label: string;
  /** The name shown in the picker in place of `label` ('' shows the picture alone). */
  pickerName?: string;
  source: string;
  /** The picker's category in place of the section's (templateCategory). */
  category?: string;
  /** Symbol for a runtime effect that has no renderable model thumbnail. */
  iconLabel?: string;
  /** Explanation kept out of the short name; visible in the picker tooltip. */
  description?: string;
  keywords?: string;
  subtitle?: string;
  choiceKey?: string;
  /** Maps that use a record like it (the picker's right-click menu) and how many there are. */
  places?: readonly PartPlace[];
  placesTotal?: number;
}
export type RecordPartStamp<T> = { type: 'prop'; row: number; dir: number } | { type: 'template'; t: T };
export const partTemplateKey = (t: PartTemplate): string =>
  `template/${t.section}/${t.choiceKey ?? `${t.source}/${t.raw.join('.')}`}`;
export function templateCategory(section: number): string {
  return (
    (
      { 1: '床のギミック', 3: '出入口・扉', 4: '宝箱', 5: 'ギミック', 8: 'ギミック', 9: '地点' } as Record<
        number,
        string
      >
    )[section] ?? 'その他'
  );
}
export function RecordPartPanel<T extends PartTemplate, M>({
  st,
  source,
  templates,
  rows,
  usedRows,
  directions,
  modelForProp,
  modelForTemplate,
  maxRow,
  validRow,
  help,
  status,
  prepareTemplate,
  propPlaces,
  propInfo,
  modelLink,
}: {
  st: MapEditState<RecordPartStamp<T>>;
  source: PartThumbnailSource<M | null>;
  templates: readonly T[];
  rows: readonly number[];
  usedRows: readonly number[];
  directions: readonly string[];
  modelForProp: (row: number) => M | null;
  modelForTemplate: (template: T) => M | null;
  maxRow: number;
  validRow: (row: number) => boolean;
  help: string;
  status?: string;
  prepareTemplate?: (template: T, choose: (ready: T) => void) => void;
  /** The maps that place a prop row (the picker's right-click menu); undefined when not known. */
  propPlaces?: (row: number) => readonly PartPlace[] | undefined;
  /** A prop row's category in place of 装飾, what its picture does not show (半透明, a flame) and its file name. */
  propInfo?: (row: number) => { category: string; marks: readonly string[]; file: string } | undefined;
  /** A page that shows the model and its animations (the right-click menu's first link). */
  modelLink?: (model: M | null) => PartPlace | undefined;
}): ReactNode {
  useEditorState(st);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState(() => usedRows[0] ?? rows[0] ?? 0);
  const selected = st.stamp;
  const dir = selected?.type === 'prop' ? selected.dir : 0;
  const choose = (stamp: RecordPartStamp<T>): void => {
    st.stamp = stamp;
    st.setTool('place');
    setOpen(false);
  };
  const model =
    selected?.type === 'prop'
      ? modelForProp(selected.row)
      : selected?.type === 'template'
        ? modelForTemplate(selected.t)
        : null;
  const current =
    selected?.type === 'prop' ? `prop/${selected.row}` : selected ? partTemplateKey(selected.t) : undefined;
  const photo = (model: M | null): ReactNode => (
    <PartPhoto source={source} part={model} partKey={JSON.stringify(model)} />
  );
  const templateIcon = (template: T): ReactNode =>
    template.iconLabel ? (
      <span className="photo photo-lg stamp-badge" aria-hidden="true">
        {template.iconLabel}
      </span>
    ) : (
      photo(modelForTemplate(template))
    );
  const linkOf = (model: M | null): { links?: PartPlace[] } => {
    const link = modelLink?.(model);
    return link ? { links: [link] } : {};
  };
  const choices: PartChoice[] = [];
  const stamps = new Map<string, RecordPartStamp<T>>();
  if (open) {
    const used = new Set(usedRows);
    for (const prop of [...new Set([...usedRows, ...rows])]) {
      if (!validRow(prop)) continue;
      const key = `prop/${prop}`;
      stamps.set(key, { type: 'prop', row: prop, dir });
      const places = propPlaces?.(prop);
      const info = propInfo?.(prop);
      const marks = info?.marks.join('・') ?? '';
      choices.push({
        key,
        name: `置物 #${prop}${marks ? ` (${marks})` : ''}`,
        category: info?.category ?? '装飾',
        sub:
          [used.has(prop) ? '使用中' : '', info?.file.replace(/\.bch$/u, '') ?? ''].filter(Boolean).join(' · ') ||
          '動作なし',
        tooltip: [
          `置物 #${prop}${marks ? ` (${marks})` : ''}`,
          info?.file ? `モデル: ${info.file}` : '',
          'ゲーム中の動作はありません。',
          used.has(prop) ? 'このステージで使用中。' : '',
          places ? PLACES_HINT : '',
        ]
          .filter(Boolean)
          .join('\n'),
        ...(places ? { places } : {}),
        ...linkOf(modelForProp(prop)),
        keywords: `装飾 MapObject ${prop} ${info?.file ?? ''} ${marks}`,
        icon: (
          <span className="part-decorative-photo">
            {photo(modelForProp(prop))}
            <span>装飾・動作なし</span>
          </span>
        ),
      });
    }
    for (const template of templates) {
      const key = partTemplateKey(template);
      stamps.set(key, { type: 'template', t: template });
      choices.push({
        key,
        name: template.pickerName ?? template.label,
        category: template.category ?? templateCategory(template.section),
        sub: template.subtitle ?? template.description?.split('。')[0] ?? template.source,
        tooltip: [
          template.label,
          template.description,
          `出典: ${template.source}`,
          template.iconLabel ? 'エフェクトの図示です。' : modelForTemplate(template) ? '' : '見た目は未設定です。',
          template.places ? PLACES_HINT : '',
        ]
          .filter(Boolean)
          .join('\n'),
        keywords: `${template.source} ${template.description ?? ''} ${template.keywords ?? ''}`,
        icon: templateIcon(template),
        ...(template.places ? { places: template.places, placesTotal: template.placesTotal } : {}),
        ...linkOf(modelForTemplate(template)),
      });
    }
    const order = [
      '出入口・移動',
      '扉・移動',
      '扉',
      '建物',
      'スイッチ',
      '宝箱・ゴール',
      '回復',
      '装置・その他',
      '人物・敵',
      'メッセージ・店',
      '範囲イベント',
      '床のギミック',
      '地点',
      '既存ギミック',
      '装飾',
      // the props by what they are for (an adapter's propInfo)
      '置物・移動',
      '置物・ドア',
      '置物・インテリア',
      '置物・エクステリア',
      '置物・人物',
      '置物・妖精',
      '置物・スイッチ',
      '置物・宝箱',
      '置物・植物',
      '置物・ギミック',
      '置物・ワールドマップ',
      '置物・その他',
      '宝箱',
      '出入口・扉',
      'ギミック',
      '地点',
      'その他',
    ];
    // a category not in the list (an adapter's own) goes first
    choices.sort(
      (a, b) =>
        (order.indexOf(a.category) < 0 ? order.length : order.indexOf(a.category)) -
        (order.indexOf(b.category) < 0 ? order.length : order.indexOf(b.category)),
    );
    if (status) choices.push({ key: 'status', name: status, category: '読み込み状況', unavailable: status });
  }
  return (
    <div className="add-panel compact-add-panel">
      <PartSelection
        label={
          selected?.type === 'prop'
            ? `置物 #${selected.row}`
            : selected?.type === 'template'
              ? selected.t.label
              : 'パーツを選ぶ…'
        }
        description={
          selected?.type === 'template'
            ? selected.t.description
            : selected?.type === 'prop'
              ? 'ゲーム中の動作はありません。'
              : undefined
        }
        icon={selected?.type === 'template' ? templateIcon(selected.t) : model ? photo(model) : undefined}
        help={help}
        onChoose={() => setOpen(true)}
        directions={
          selected?.type === 'prop'
            ? { labels: directions, value: dir, onChange: (dir) => choose({ ...selected, dir }) }
            : undefined
        }
      />
      {open && (
        <PartPicker
          choices={choices}
          current={current}
          onClose={() => setOpen(false)}
          onPick={(key) => {
            const stamp = stamps.get(key);
            if (stamp?.type === 'template' && prepareTemplate) {
              setOpen(false);
              prepareTemplate(stamp.t, (ready) => choose({ type: 'template', t: ready }));
            } else if (stamp) choose(stamp);
          }}
          controls={
            <details className="part-number-picker">
              <summary>番号を直接指定</summary>
              <div className="row">
                <label>
                  置物の番号 <NumberInput value={row} min={0} max={maxRow} onCommit={setRow} />
                </label>
                <button disabled={!validRow(row)} onClick={() => choose({ type: 'prop', row, dir })}>
                  このパーツを選ぶ
                </button>
              </div>
            </details>
          }
        />
      )}
    </div>
  );
}
