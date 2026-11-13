import type { ReactNode } from 'react';
import { romfsHref } from '../romfs/RomfsPage';
import { LANAI_ACTION_GOAL_CHEST } from './actions';
import { lanaiMapHref } from './MapPage';
import { lanaiGroupHref, MonsterGroupLine } from './MapParts';
import { LANAI_EVENT_SECTIONS, type LanaiMaps } from './maps';
import { EmptyGroupIcon } from '../ui/GroupDetail';
import { Photo } from '../ui/Photo';
import { lanaiItemEntry } from './pickers';
import { lanaiEventChoices } from './EventSelect';
import {
  LANAI_TREASURE_ITEM,
  LANAI_TREASURE_GOLD,
  LANAI_TREASURE_BATTLE,
  LANAI_CHEST_ACTIONS,
  type LanaiTreasureSlot,
} from './treasure';
import { lanaiChestFields, lanaiTreasureSlots } from './treasure';
import { u32 } from '../util/bytes';

/** Read-only stage overview; edits stay on the group and map pages. */
export function LanaiStageContents({ maps }: { maps: LanaiMaps }): ReactNode {
  const groups = maps.monsterGroups();
  const chests = maps.groups.flatMap((group, dungeon) => {
    const table = maps.eventTable(dungeon);
    if (!table) return [];
    const choices = lanaiEventChoices(maps, dungeon);
    return Array.from({ length: table.rows }, (_, event) => {
      const stages = lanaiChestFields(table, event);
      return {
        group,
        dungeon,
        table,
        event,
        stages,
        model: choices.find((choice) => choice.value === event)?.model ?? null,
      };
    }).filter((chest) => chest.stages.length);
  });
  return (
    <div className="stage-overview">
      <section className="stage-overview-panel" aria-label="モンスターの群れ一覧">
        <h3>モンスターの群れ一覧</h3>
        {!groups.length ? (
          <p className="muted">モンスターの群れはありません。</p>
        ) : (
          <table className="book-table">
            <thead>
              <tr>
                <th>群れ</th>
                <th>モンスター</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.row}>
                  <td>
                    <a href={lanaiGroupHref(maps.content.index, group.row)}>群れ #{group.row}</a>
                  </td>
                  <td>
                    <MonsterGroupLine maps={maps} value={group.id} showRow={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="stage-overview-panel" aria-label="宝箱イベント一覧">
        <h3>宝箱イベント一覧</h3>
        <p className="small muted">
          中身は重みに応じて1つ選ばれます。ゴールの宝箱は初回と2回目以降を分けて表示します。
        </p>
        {!chests.length ? (
          <p className="muted">宝箱イベントはありません。</p>
        ) : (
          <table className="book-table">
            <thead>
              <tr>
                <th>イベント・編集</th>
                <th>場所</th>
                <th>中身</th>
              </tr>
            </thead>
            <tbody>
              {chests.map((chest) => {
                const first = chest.stages[0]!;
                const goal = chest.table.u32(chest.event, first.field - 4) === LANAI_ACTION_GOAL_CHEST;
                const clears = goal ? chest.table.u32(chest.event, first.field + 4) : 0;
                const locations = maps.maps
                  .filter((map) => !map.world && map.dungeon === chest.dungeon)
                  .flatMap((map) =>
                    LANAI_EVENT_SECTIONS.flatMap((section) =>
                      (maps.doc(map).recs[section] ?? []).flatMap((rec, index) =>
                        u32(rec.raw, 4) === chest.event ? [{ map, section, index }] : [],
                      ),
                    ),
                  );
                return (
                  <tr key={`${chest.dungeon}:${chest.event}`}>
                    <td>
                      <a
                        href={
                          locations[0]
                            ? lanaiMapHref(maps.content.index, locations[0].map.name, locations[0])
                            : romfsHref(maps.content.archive, chest.group.eventEntry)
                        }
                      >
                        <span
                          className="stage-chest-kind"
                          title={LANAI_CHEST_ACTIONS[chest.table.u32(chest.event, first.field - 4)]}
                        >
                          {chest.model ? (
                            <Photo model={chest.model} title={goal ? 'ゴールの宝箱' : '宝箱'} />
                          ) : (
                            <ChestKindIcon goal={goal} kind={chest.table.u32(chest.event, first.field - 4)} />
                          )}
                          <span>#{chest.event}</span>
                        </span>
                      </a>
                      {goal && (
                        <div className="small">{clears ? `コンテンツ ${clears} をクリア` : 'クリア判定なし'}</div>
                      )}
                    </td>
                    <td>
                      {locations.length ? (
                        locations.map((location) => (
                          <div key={`${location.map.index}:${location.section}:${location.index}`}>
                            <a
                              href={lanaiMapHref(maps.content.index, location.map.name, location)}
                            >{`${location.map.name} · ${location.section === 4 ? '宝箱' : `区画 ${location.section}`} #${location.index}`}</a>
                          </div>
                        ))
                      ) : (
                        <span className="muted">配置なし</span>
                      )}
                    </td>
                    <td>
                      {chest.stages.map((stage, index) => {
                        const row = chest.table.u32(chest.event, stage.field);
                        const treasure = maps.treasureGroup;
                        const valid = treasure && row < treasure.rows;
                        const slots = valid ? lanaiTreasureSlots(treasure, row) : [];
                        return (
                          <div key={stage.field}>
                            {index > 0 && <hr />}
                            {goal && (
                              <strong>
                                {['1度目（状態0）', '2回目以降（状態1）', '2回目以降（状態2〜3）'][stage.stage]}
                              </strong>
                            )}
                            {!valid ? (
                              <div className="error">{`TreasureGroup #${row} がありません`}</div>
                            ) : !slots.length ? (
                              <EmptyGroupIcon label="中身なし" />
                            ) : (
                              <span className="group-photos">
                                {slots.map((slot, i) => (
                                  <TreasureIcon key={i} maps={maps} slot={slot} />
                                ))}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ChestKindIcon({ goal, kind }: { goal: boolean; kind: number }): ReactNode {
  const label = LANAI_CHEST_ACTIONS[kind] ?? '宝箱';
  return (
    <svg className="photo chest-kind-icon" viewBox="0 0 36 36" role="img" aria-label={label}>
      <title>{label}</title>
      <path
        d="M5 17V12Q5 6 11 6H25Q31 6 31 12V17ZM5 19H31V30H5Z"
        fill={goal ? '#c84949' : kind === 0x80000010 ? '#aab4c4' : '#ae793f'}
        stroke="#e2bc63"
        strokeWidth="2"
      />
      <path d="M16 15H20V23H16Z" fill="#f6d77c" />
      {goal && <path d="M18 3L20 7L18 11L16 7Z" fill="#fff0a0" />}
    </svg>
  );
}

function TreasureIcon({ maps, slot }: { maps: LanaiMaps; slot: LanaiTreasureSlot }): ReactNode {
  if (slot.kind === LANAI_TREASURE_ITEM) {
    const item = lanaiItemEntry(maps.session, slot.value);
    return (
      <a href={item.href} title={item.name} aria-label={item.name}>
        {item.icon}
      </a>
    );
  }
  if (slot.kind === LANAI_TREASURE_BATTLE) {
    const row = maps.monsterGroupRow(slot.value);
    return (
      <a href={row >= 0 ? lanaiGroupHref(maps.content.index, row) : undefined} title="戦闘（群れ・推定）">
        <MonsterGroupLine maps={maps} value={slot.value} showRow={false} />
      </a>
    );
  }
  const label =
    slot.kind === LANAI_TREASURE_GOLD
      ? slot.value + ' G'
      : slot.kind === 3
        ? '種類3（ジュエル?）: ' + slot.value
        : '種類' + slot.kind + ': ' + slot.value;
  return (
    <span className="photo treasure-value-icon" role="img" aria-label={label} title={label}>
      <span aria-hidden="true">{slot.kind === LANAI_TREASURE_GOLD ? 'G' : slot.kind === 3 ? '◆' : '?'}</span>
      <small aria-hidden="true">{slot.value}</small>
    </span>
  );
}
