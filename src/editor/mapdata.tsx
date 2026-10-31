// Inspector block of a map: the mapData row it uses (tileset, models, BGM, footsteps) and what picks it. The row can be
// linked to another one (the dungeon's mapGroup +0x26 / +0x27, or an added map's own key) or copied into a new row of
// its own, so that the tileset and the sounds stop being shared with the other maps of the row.
import { useMemo, useState, type ReactNode } from 'react';
import { loadTileset } from '../cgfx/loader';
import type { MapInfo } from '../game/codebin';
import type { Game } from '../game/game';
import { TILESETS } from '../game/master';
import { mapShortTitle, mapTitle } from '../game/names';
import { mapDataUsers } from '../game/sound';
import type { ModelRef } from '../pages/modelview';
import type { Session } from '../session';
import { GridPicker, type GridEntry, type PickerChoice } from '../ui/GridPicker';
import { Photo } from '../ui/Photo';
import { hex8 } from '../util/bytes';
import { Field } from './fields';

/** Tile kinds tried for the picture of a tileset: the room floor, then a straight corridor. */
const FLOOR_KINDS = [5, 1];

/** The floor tile of a tileset, with the models of a mapResource row (null when the row has no model archive). */
export function floorRef(game: Game, resource: number, tileset: number): ModelRef | null {
  const master = game.master;
  if (resource < 0 || resource >= master.mapResource.rows || !master.modelArchive(resource)) return null;
  const hash = FLOOR_KINDS.map((k) => master.partModel(k, tileset, 0)).find((h) => h) ?? 0;
  if (!hash) return null;
  const a = master.resourceArchives(resource);
  const src = { modelArchive: hex8(a[0]!), textureArchive: hex8(a[1]!), textureEntry: a[2]! };
  return {
    key: `floor/${src.modelArchive}/${src.textureArchive}/${hex8(src.textureEntry)}/${hex8(hash)}`,
    load: async () => {
      const set = await loadTileset(game, src);
      return set.models.has(hash) ? { set, hash } : null;
    },
  };
}

/**
 * The maps of a mapData row, by dungeon: "D01 name: B1、B2" lines (the count past 3 maps or 4 dungeons), then every
 * map's title (for the tooltip and the search).
 */
function usersText(game: Game, ms: MapInfo[]): { lines: string; all: string } {
  const by = new Map<string, MapInfo[]>();
  for (const m of ms) {
    const d = `${m.dungeonCode} ${game.master.dungeonName(m.dungeon)}`.trim();
    by.set(d, [...(by.get(d) ?? []), m]);
  }
  const lines = [...by].map(([d, list]) => `${d}: ${list.length > 3 ? `${list.length} マップ` : list.map((m) => mapShortTitle(m, game.code.maps)).join('、')}`);
  return {
    lines: lines.length ? (lines.length > 4 ? [...lines.slice(0, 3), `ほか ${lines.length - 3} ダンジョン`] : lines).join('\n') : '使うマップなし',
    all: ms.map((m) => `${mapTitle(m, game.code.maps, game.master)} (${m.name})`).join('\n'),
  };
}

/** Picking a tileset by the picture of its floor (only tilesets that some mapData row gives models to). */
function TilesetPicker({ game, current, users, onPick, onClose }: {
  game: Game;
  current: number;
  users: Map<number, MapInfo[]>;
  onPick: (t: number) => void;
  onClose: () => void;
}): ReactNode {
  const master = game.master;
  const entries: GridEntry[] = [];
  for (let t = 0; t < TILESETS; t++) {
    const from = master.tilesetRow(t);
    if (from < 0 && t !== current) continue;
    const ms: MapInfo[] = [];
    for (let r = 0; r < master.mapData.rows; r++) if (master.mapData.row(r)[0] === t) ms.push(...(users.get(r) ?? []));
    const u = usersText(game, ms);
    entries.push({
      id: t,
      name: `タイルセット ${t}`,
      icon: <Photo model={from >= 0 ? floorRef(game, master.mapData.row(from)[1]!, t) : null} className="photo photo-lg" />,
      sub: u.lines,
      title: u.all,
      keywords: u.all,
      unavailable: from < 0 ? 'モデルを持つ mapData の行がありません' : null,
    });
  }
  return <GridPicker title="タイルセットを選ぶ" entries={entries} current={current} wide placeholder="番号・ダンジョン名・マップ名で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** Picking a mapData row; each shows its floor and the dungeons / maps that use it. `none` comes first (value 0). */
function RowPicker({ game, title, current, users, from = 0, none, onPick, onClose }: {
  game: Game;
  title: string;
  current: number;
  users: Map<number, MapInfo[]>;
  /** The first row offered. */
  from?: number;
  none?: PickerChoice;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const master = game.master;
  const entries: GridEntry[] = [];
  for (let r = from; r < master.mapData.rows; r++) {
    const row = master.mapData.row(r);
    const u = usersText(game, users.get(r) ?? []);
    entries.push({
      id: r,
      name: `行 ${r}・タイルセット ${row[0]}`,
      icon: <Photo model={floorRef(game, row[1]!, row[0]!)} className="photo photo-lg" />,
      sub: u.lines,
      title: u.all || '使うマップなし',
      keywords: u.all,
    });
  }
  return <GridPicker title={title} entries={entries} current={current} choices={none ? [none] : []} wide placeholder="行の番号・ダンジョン名・マップ名で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** A button showing a choice with its floor picture; clicking it opens a picker. */
function PickButton({ photo, label, sub, onOpen }: { photo: ModelRef | null; label: string; sub?: string; onOpen: () => void }): ReactNode {
  return (
    <button type="button" className="tileset-button" title={sub} onClick={onOpen}>
      <Photo model={photo} />
      <span>{label}<span className="muted"> ▾</span></span>
    </button>
  );
}

const FROM: Record<string, string> = {
  key: 'マップ自身のキー',
  designed: 'designedMap',
  dungeon: 'ダンジョンの mapGroup +0x26',
  indoor: 'ダンジョンの mapGroup +0x27 (屋内のマップ)',
};

/** What changes which map picks which mapData row (the dungeons' rows, the added maps' keys and the table's size). */
export function linkSignature(session: Session): string {
  const { game } = session;
  const mg = game.master.mapGroup;
  const parts: number[] = [game.master.mapData.rows];
  for (let r = 0; r < mg.rows; r++) parts.push(mg.row(r)[0x26]!, mg.row(r)[0x27]!);
  for (const m of game.code.addedMaps()) parts.push(m.mapDataKey);
  return parts.join(',');
}

export function MapDataPanel({ session }: { session: Session }): ReactNode {
  const { game, st } = session;
  const master = game.master;
  const info = st.info!;
  const ref = st.ref!;
  const { row, from } = master.mapDataSource(ref);
  const sig = linkSignature(session);
  // The maps of each mapData row (by the documents as they are now).
  const users = useMemo(() => mapDataUsers(game, session.docOf), [game, session, st.ref, sig]);
  const shared = users.get(row) ?? [];
  const others = shared.filter((m) => m.hash !== info.hash);
  const added = !!info.added;
  const fromDungeon = from === 'dungeon' || from === 'indoor';
  const indoor = from === 'indoor';
  const newDungeon = game.code.dungeons.some((d) => d.dungeon === info.dungeon);
  const tileset = master.mapData.row(row)[0]!;
  const [open, setOpen] = useState<'' | 'tileset' | 'key' | 'dungeon'>('');
  const rowPhoto = (r: number): ModelRef | null => floorRef(game, master.mapData.row(r)[1]!, master.mapData.row(r)[0]!);
  const rowLabel = (r: number): string => `行 ${r}・タイルセット ${master.mapData.row(r)[0]}`;
  const rowSub = (r: number): string => usersText(game, users.get(r) ?? []).all;
  const dungeonRow = master.dungeonMapDataRow(info.dungeon, ref.indoor);
  const listOf = (ms: MapInfo[]): string => ms.map((m) => mapTitle(m, game.code.maps, master)).join('、');

  const edit = (f: () => void): void => {
    try {
      st.editTables(f);
    } catch (e) {
      st.error = (e as Error).message;
      st.emit('doc');
    }
  };
  const setKey = (r: number): void => edit(() => {
    info.mapDataKey = r > 0 ? master.mapDataKey(r) : 0;
    if (r > 0 && !info.mapDataKey) throw new Error(`mapData の行 ${r} にはキーがありません`);
  });
  const ownDungeonRow = (): void => edit(() => master.setDungeonMapDataRow(info.dungeon, indoor, master.addMapData(row)));
  const ownMapRow = (): void => edit(() => {
    info.mapDataKey = master.mapDataKey(master.addMapData(row));
  });

  // Does the row reach outside this dungeon? (Only then is a row for the dungeon worth making.)
  const outside = others.some((m) => m.dungeon !== info.dungeon);
  return (
    <div className="enc-box">
      <h3>
        見た目と音 (mapData)
        {shared.length > 1 && <span className="badge" title={listOf(shared)}>{`${shared.length} マップで共有`}</span>}
      </h3>
      <div className="muted small">{`mapData 行 ${row} を使います (決まり方: ${FROM[from]})。`}</div>
      <Field label="タイルセット">
        <PickButton photo={rowPhoto(row)} label={`タイルセット ${tileset}`} onOpen={() => setOpen('tileset')} />
      </Field>
      {added && (
        <Field label="このマップの行 (マップ自身のキー)">
          <PickButton photo={rowPhoto(row)} label={from === 'key' ? rowLabel(row) : `ダンジョンの行に従う (行 ${dungeonRow})`} sub={rowSub(row)} onOpen={() => setOpen('key')} />
        </Field>
      )}
      {fromDungeon && (
        <Field label={`ダンジョンの行 (mapGroup ${indoor ? '+0x27' : '+0x26'})`}>
          <PickButton photo={rowPhoto(row)} label={rowLabel(row)} sub={rowSub(row)} onOpen={() => setOpen('dungeon')} />
        </Field>
      )}
      {open === 'tileset' && (
        <TilesetPicker game={game} current={tileset} users={users} onClose={() => setOpen('')}
          onPick={(t) => { setOpen(''); edit(() => master.setTileset(row, t)); }} />
      )}
      {open === 'key' && (
        <RowPicker game={game} title="このマップの mapData 行を選ぶ" current={from === 'key' ? row : 0} users={users} from={1}
          none={{ value: 0, label: 'ダンジョンの行に従う', sub: `行 ${dungeonRow}`, icon: <Photo model={rowPhoto(dungeonRow)} className="photo photo-lg" /> }}
          onClose={() => setOpen('')} onPick={(r) => { setOpen(''); setKey(r); }} />
      )}
      {open === 'dungeon' && (
        <RowPicker game={game} title={`ダンジョンの mapData 行を選ぶ (${indoor ? '屋内' : '屋外'})`} current={row} users={users}
          onClose={() => setOpen('')} onPick={(r) => { setOpen(''); edit(() => master.setDungeonMapDataRow(info.dungeon, indoor, r)); }} />
      )}
      <p>
        {fromDungeon && outside && (
          <button disabled={master.mapData.rows > 0xff} title="この行を写した新しい行を作り、ダンジョンの行にします" onClick={ownDungeonRow}>このダンジョン専用の行を作る</button>
        )}
        {added && shared.length > 1 && (
          <button disabled={master.mapData.rows > 0xff} title="この行を写した新しい行を作り、このマップのキーにします" onClick={ownMapRow}>このマップ専用の行を作る</button>
        )}
      </p>
      <div className="muted small" style={{ whiteSpace: 'pre-line' }}>
        {[
          others.length ? `同じ行を使うマップ: ${others.map((m) => mapShortTitle(m, game.code.maps) + (m.dungeon !== info.dungeon ? ` (${master.dungeonName(m.dungeon) || m.dungeonCode})` : '')).join('、')}。タイルセットや音を変えると、これらもまとめて変わります。` : 'この行を使うのはこのマップだけです。',
          '「専用の行を作る」は、今の行を写した行を mapData の末尾に足して付け替えます (BGM・タイルセットを別々にできます)。',
          from === 'key' && !added ? 'このマップはゲームのコードにある自分のキーで行が決まるので、行の付け替えはできません (タイルセット・音の編集は、同じ行のマップにまとめて効きます)。' : '',
          from === 'designed' ? 'このマップは designedMap.bin で行が決まるので、行の付け替えはできません。' : '',
          fromDungeon && !newDungeon ? '元からあるダンジョンの行を付け替えると、そのダンジョンのマップ (自分のキーを持つものを除く) がすべて変わります。' : '',
          'mapData の行を足すこと自体は、ゲームの中ではまだ確かめていません。',
        ].filter(Boolean).join('\n')}
      </div>
    </div>
  );
}
