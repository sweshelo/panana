import { useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { GridPicker } from '../ui/GridPicker';
import { MapPickerDialog, type MapPickerGroups, type MapPickerRow } from '../ui/MapPicker';
import { useAsync } from '../ui/useAsync';
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { lanaiFloorLabel, lanaiMaps, type LanaiMaps } from './maps';
import { useLanaiRevision } from './MonsterEditor';
import { LanaiStageThumbnail } from './StageThumbnail';
import type { LanaiSession } from './session';

/** The selected stage's maps, grouped by MapGroup, including world maps. */
export function lanaiMapPickerGroups(maps: LanaiMaps): MapPickerGroups {
  const groups = new Map<number, MapPickerRow[]>();
  for (const map of maps.maps) {
    const rows = groups.get(map.dungeon) ?? [];
    rows.push({
      hash: map.index,
      code: map.name,
      title: map.world
        ? 'ワールドマップ (表示のみ)'
        : `${lanaiFloorLabel(map.floor) || '地上'}・${maps.doc(map).tiles.length} マス`,
    });
    groups.set(map.dungeon, rows);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([group, rows]) => [`${maps.groupName(group) || `MapGroup ${group}`} (MapGroup ${group})`, rows]);
}

/** Select a stage by its picture, then pick a map without leaving the current map until confirmed. */
export function LanaiMapPicker({
  session,
  currentContent,
  currentMap,
  onPick,
  onClose,
}: {
  session: LanaiSession;
  currentContent: number;
  currentMap?: string;
  onPick: (content: number, name: string) => void;
  onClose: () => void;
}): ReactNode {
  const revision = useLanaiRevision(session);
  const contents = useMemo(() => lanaiContents(session), [session, revision]);
  const [selected, setSelected] = useState<LanaiContent | undefined>(() =>
    contents.find((content) => content.index === currentContent),
  );
  if (selected)
    return (
      <StageMaps
        key={selected.index}
        session={session}
        content={selected}
        currentMap={selected.index === currentContent ? currentMap : undefined}
        onBack={() => setSelected(undefined)}
        onPick={(name) => onPick(selected.index, name)}
        onClose={onClose}
      />
    );
  return (
    <GridPicker
      title="ステージを選ぶ"
      wide
      placeholder="ステージ名・コンテンツ番号で絞り込み"
      entries={contents.map((content) => ({
        id: content.index,
        name: contentTitle(content),
        sub: `コンテンツ ${content.index}`,
        keywords: content.stages.map((stage) => `${stage.name} ${stage.mission}`).join(' ') + ' ' + content.archive,
        icon: (
          <span className="stage-thumbnail-choice">
            {content.stages[0] ? (
              <LanaiStageThumbnail
                session={session}
                archive={content.archive}
                hash={content.stages[0].thumbnail}
                name={contentTitle(content)}
              />
            ) : (
              <span className="muted">画像なし</span>
            )}
          </span>
        ),
      }))}
      current={currentContent}
      onPick={(id) => setSelected(contents.find((content) => content.index === id))}
      onClose={onClose}
    />
  );
}

function StageMaps({
  session,
  content,
  currentMap,
  onBack,
  onPick,
  onClose,
}: {
  session: LanaiSession;
  content: LanaiContent;
  currentMap?: string;
  onBack: () => void;
  onPick: (name: string) => void;
  onClose: () => void;
}): ReactNode {
  const maps = useAsync(() => lanaiMaps(session, content), [session, content]);
  const back = (
    <div className="row">
      <button onClick={onBack}>← ステージを選び直す</button>
      <span>{contentTitle(content)}</span>
    </div>
  );
  if (!maps || maps instanceof Error || !maps.maps.length)
    return (
      <Dialog title="マップを選ぶ" onClose={onClose}>
        {back}
        {!maps ? (
          <p role="status">マップを読み込み中…</p>
        ) : maps instanceof Error ? (
          <p className="error" role="alert">
            {maps.message}
          </p>
        ) : (
          <p className="muted">このステージにはマップがありません。</p>
        )}
      </Dialog>
    );
  return (
    <MapPickerDialog
      title="マップを選ぶ"
      controls={back}
      groups={lanaiMapPickerGroups(maps)}
      current={maps.mapByName(currentMap ?? '')?.index ?? maps.maps[0]!.index}
      modified={new Set(maps.maps.filter((map) => map.added || maps.isChanged(map)).map((map) => map.index))}
      onPick={(row) => {
        const map = maps.maps.find((map) => map.index === row);
        if (map) onPick(map.name);
      }}
      onClose={onClose}
    />
  );
}
