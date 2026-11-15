import type { ReactNode } from 'react';
import { PlacedPickButton, type PlacedChoice } from '../editor/objectpick';
import { recCellPos } from '../game/sections';
import { MapPickerButton, type MapPickerGroups } from '../ui/MapPicker';
import { hex8, u32 } from '../util/bytes';
import { lanaiMapHref } from './hrefs';
import { lanaiDestinationPlace } from './mapLinks';
import { LANAI_LAYOUTS, lanaiExitLabel, lanaiFloorLabel, type LanaiMaps } from './maps';

export function lanaiDestinationPoints(maps: LanaiMaps, hash: number): PlacedChoice[] {
  const info = maps.map(hash);
  if (!info || info.world) return [];
  const doc = maps.doc(info);
  return (doc.recs[3] ?? []).flatMap((rec, i) => {
    // Wall doors have no point ID (map.md §5.1).
    if (rec.raw[0x15] === 100) return [];
    const [x, y] = recCellPos(rec, LANAI_LAYOUTS[3]!);
    const id = u32(rec.raw, 0);
    return [
      {
        value: id,
        name: `出入口 #${i}: ${lanaiExitLabel(rec.raw[0x15]!)}`,
        sub: `${hex8(id).toUpperCase()}・セル (${x.toFixed(1)}, ${y.toFixed(1)})`,
        where: { doc, x, y },
        model: null,
        badge: '▷',
        keywords: hex8(id).toUpperCase(),
      },
    ];
  });
}

/** Destinations belong to the current content's map database, including newly added maps. */
export function DestinationFields({
  maps,
  map,
  point,
  onChange,
  labels = ['行き先のマップ', '行き先の地点 ID'],
  link = false,
}: {
  maps: LanaiMaps;
  map: number;
  point: number;
  onChange: (map: number, point: number) => void;
  /** The labels of the map and the point fields. */
  labels?: [map: string, point: string];
  /** Show a link to the destination's record on the map page (the inspector; not the dialogs shown before placing). */
  link?: boolean;
}): ReactNode {
  const dest = maps.map(map);
  const groups: MapPickerGroups = maps.groups.flatMap((g) => {
    const rows = maps.maps
      .filter((m) => !m.world && m.dungeon === g.row)
      .map((m) => ({
        hash: m.hash,
        title: lanaiFloorLabel(m.floor) || '地上',
        code: m.name,
      }));
    return rows.length ? [[maps.groupName(g.row) || `ダンジョン ${g.row}`, rows]] : [];
  });
  const points = lanaiDestinationPoints(maps, map);
  const place = link ? lanaiDestinationPlace(maps, map, point) : null;
  return (
    <>
      <label className="field">
        <span>{labels[0]}</span>
        <MapPickerButton
          groups={groups}
          value={map}
          label={
            dest?.name ??
            (map === 0 ? '未設定（行き先のマップを選ぶ）' : `${hex8(map).toUpperCase()} (このステージにない)`)
          }
          title="行き先のマップを選ぶ"
          onChange={(hash) => {
            const next = lanaiDestinationPoints(maps, hash);
            onChange(hash, next.some((p) => p.value === point) ? point : (next[0]?.value ?? 0));
          }}
        />
      </label>
      <label className="field">
        <span>{labels[1]}</span>
        <PlacedPickButton
          title={`行き先の地点を選ぶ (${dest?.name ?? hex8(map)})`}
          value={point}
          choices={points}
          missing={(v) =>
            map === 0 && v === 0 ? '未設定（マップを先に選ぶ）' : `${hex8(v).toUpperCase()} (行き先にない)`
          }
          onChange={(v) => onChange(map, v)}
        />
      </label>
      {dest && !dest.world && points.length === 0 && <p className="muted small">行き先に出入口がありません。</p>}
      {place && (
        <p className="small">
          <a
            href={lanaiMapHref(maps.content.index, place.map, place)}
            title="行き先の出入口を選んだ状態でマップを開く"
          >{`→ 行き先へ移動 (${place.map} の出入口 #${place.index})`}</a>
        </p>
      )}
      {link && dest?.world && (
        <p className="small">
          <a href={`#/world/${maps.content.index}.${dest.name}`}>{`→ 行き先のワールドマップ ${dest.name} を開く`}</a>
        </p>
      )}
    </>
  );
}
