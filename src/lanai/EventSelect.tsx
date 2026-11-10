import type { ReactNode } from 'react';
import { PlacedPickButton, type PlacedChoice } from '../editor/objectpick';
import { isIndoor } from '../game/objects';
import { recCellPos } from '../game/sections';
import type { ModelRef } from '../pages/modelview';
import { LANAI_EVENT_ACTIONS, LANAI_EVENT_SECTIONS, LANAI_LAYOUTS, type LanaiMaps } from './maps';
import { LANAI_ACTION_NONE, lanaiActionName } from './actions';
import { lanaiRecEventRow, type LanaiEditState } from './mapedit';
import { lanaiObjectRef, lanaiRecordLook } from './mapObjects';
import { lanaiObjectModels } from './mapModels';
import { lanaiMonsterDesign } from './monsters';
import { lanaiMonsterModel } from './monsterModels';
import { u32 } from '../util/bytes';

/** Every event in this MapGroup, with all its placements (including edited documents). */
export function lanaiEventChoices(maps: LanaiMaps, group: number): PlacedChoice[] {
  const events = maps.eventTable(group);
  if (!events) return [];
  const uses = new Map<number, PlacedChoice[]>();
  for (const info of maps.maps) {
    if (info.world || info.dungeon !== group) continue;
    const doc = maps.doc(info);
    for (const section of LANAI_EVENT_SECTIONS)
      (doc.recs[section] ?? []).forEach((rec, index) => {
        if (section === 8 && u32(rec.raw, 0) >= 100) return;
        const row = lanaiRecEventRow(section, rec.raw);
        if (!row) return;
        const [x, y] = recCellPos(rec, LANAI_LAYOUTS[section]!);
        const look = lanaiRecordLook(section, rec.raw, {
          mapObject: maps.session.table('MapObject'),
          mapChara: maps.contentTable('MapChara'),
          events,
          indoor: isIndoor(doc),
        });
        let model: ModelRef | null = null;
        if (look?.model?.type === 'object') {
          const ref = lanaiObjectRef(maps.session.table('MapObject'), look.model.row);
          if (ref)
            model = {
              key: `lanai/object/${ref.archive}/${ref.entry}`,
              load: async () => ({ set: await lanaiObjectModels(maps.session, ref), hash: ref.entry }),
            };
        } else if (look?.model?.type === 'monster') {
          const design = lanaiMonsterDesign(maps.session, look.model.design);
          if (design) model = lanaiMonsterModel(maps.session, design);
        }
        const sub = `${info.name}・${LANAI_LAYOUTS[section]!.label} #${index} (${x.toFixed(1)}, ${y.toFixed(1)})`;
        const choice: PlacedChoice = {
          value: row,
          name: '',
          sub,
          model,
          where: { doc, x, y },
          badge: section === 4 ? '宝' : section === 3 ? '▷' : section === 5 ? '☺' : '◇',
        };
        uses.set(row, [...(uses.get(row) ?? []), choice]);
      });
  }
  return Array.from({ length: events.rows - 1 }, (_, i) => {
    const row = i + 1;
    const placed = uses.get(row) ?? [];
    const active = LANAI_EVENT_ACTIONS.map((o) => events.u32(row, o)).filter(
      (type) => type && type !== LANAI_ACTION_NONE,
    );
    const actions = [...new Set((active.length ? active : [LANAI_ACTION_NONE]).map(lanaiActionName))];
    return {
      ...(placed[0] ?? { value: row, model: null, badge: '◇' }),
      name: `イベント #${row}: ${actions.join('・')}`,
      sub: placed.length ? placed.map((p) => p.sub).join('\n') : '置いてある物なし',
      category: placed.length ? '配置済み' : '未配置',
      keywords: actions.join(' '),
    };
  });
}

export function LanaiEventSelect({
  st,
  value,
  allowNone,
  references = false,
  onChange,
}: {
  st: LanaiEditState;
  value: number;
  allowNone: boolean;
  references?: boolean;
  onChange: (value: number) => void;
}): ReactNode {
  const choices = lanaiEventChoices(st.maps, st.info!.dungeon).map((c) => ({
    ...c,
    unavailable: !references && c.value !== value && c.where ? 'ほかの物が使っているイベントです' : null,
  }));
  return (
    <PlacedPickButton
      title="イベントを選ぶ"
      value={value}
      choices={choices}
      extra={allowNone ? [{ value: 0, label: 'なし' }] : []}
      missing={(v) => (v ? `イベント #${v} (表にない番号)` : 'なし')}
      onChange={onChange}
    />
  );
}
