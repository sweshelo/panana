import { useState, type ReactNode } from 'react';
import type { SoundNames } from '../game/sound';
import type { ModelRef } from '../pages/modelview';
import { GridPicker, type GridEntry } from '../ui/GridPicker';
import { Photo } from '../ui/Photo';
import { SoundButton } from '../ui/SoundPicker';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import { DestinationFields } from './DestinationFields';
import { lanaiTileModels } from './mapModels';
import {
  addLanaiMapData,
  setLanaiGroupFirstMap,
  setLanaiGroupMapData,
  setLanaiMapData,
  setLanaiMapGroup,
} from './mapadd';
import { lanaiFloorLabel, type LanaiMaps } from './maps';
import { lanaiMapHref } from './MapPage';
import { useLanaiRevision } from './MonsterEditor';
import { floorPhoto } from './TilesetField';
import {
  lanaiTilesets,
  mapDataTileset,
  setLanaiTileset,
  tilesetGaps,
  tilesetTable,
  type LanaiTileset,
} from './tilesets';

/** A floor model with the MapData row's own texture, including rows no map uses yet. */
function mapDataPhoto(maps: LanaiMaps, row: number): ModelRef | null {
  const md = maps.contentTable('MapData');
  const mr = maps.contentTable('MapResource');
  if (!md || !mr) return null;
  const tileset = md.row(row)[0x0a]!;
  const resource = md.row(row)[0x0b]!;
  if (resource >= mr.rows) return null;
  const floor = maps.partRef({ tileset }, 5, 0) ?? maps.partRef({ tileset }, 1, 0);
  if (!floor) return null;
  const textureArchive = mr.u32(resource, 0);
  const textureEntry = mr.u32(resource, 4);
  return {
    key: `lanai-mapdata/${row}/${tileset}/${hex8(floor.archive)}/${hex8(floor.entry)}/${hex8(textureArchive)}/${hex8(textureEntry)}`,
    load: async () => {
      const set = await lanaiTileModels(
        maps.session,
        { mapData: row, tileset, partsName: '', resource, textureArchive, textureEntry },
        [floor],
      );
      return set.models.has(floor.entry) ? { set, hash: floor.entry } : null;
    },
  };
}

function MapDataRow({ maps, row, sounds }: { maps: LanaiMaps; row: number; sounds: SoundNames | null }): ReactNode {
  const md = maps.contentTable('MapData')!;
  const [list, setList] = useState<LanaiTileset[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editableTileset = maps.session.createdFiles.has(maps.content.archive.toUpperCase()) || row >= md.originalRows;
  const current = mapDataTileset(maps, row);
  const name = maps.partsTable(md.row(row)[0x0a]!)?.name.replace(/^MapParts/u, '') || 'なし';
  const users = maps.maps.filter((m) => !m.world && maps.mapDataRow(m, maps.doc(m)) === row);
  const pick = async (ts: LanaiTileset): Promise<void> => {
    setOpen(false);
    if (ts.entry === current) return;
    setBusy(true);
    try {
      const gaps = tilesetGaps(maps, row, await tilesetTable(maps.session, maps, ts));
      if (
        gaps.length &&
        !confirm(
          `タイルセット ${ts.name} に、使われているタイルの種類 ${gaps.join(', ')} のモデルがありません。変更しますか？`,
        )
      )
        return;
      await setLanaiTileset(maps.session, maps, row, ts);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const entries: GridEntry[] = (list ?? []).map((ts, index) => ({
    id: index,
    name: ts.name,
    sub: `${ts.contents.length} ステージ`,
    icon: <Photo model={floorPhoto(maps, ts)} className="photo photo-lg" />,
  }));
  return (
    <tr>
      <td className="mono">{`#${row} / ${hex8(md.rowId(row)).toUpperCase()}`}</td>
      <td>
        <button
          disabled={!editableTileset || busy}
          title={editableTileset ? `タイルセット ${name} を変更` : 'ROM の行は複製してからタイルセットを変更できます'}
          onClick={async () => {
            setBusy(true);
            try {
              setList(await lanaiTilesets(maps.session));
              setOpen(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '読み込み中…' : <Photo model={mapDataPhoto(maps, row)} />}
        </button>
        {error && <span className="error">{error}</span>}
        {open && list && (
          <GridPicker
            title={`MapData #${row} のタイルセットを選ぶ`}
            entries={entries}
            current={list.findIndex((t) => t.entry === current)}
            placeholder="タイルセット名で検索"
            onPick={(index) => void pick(list[index]!)}
            onClose={() => setOpen(false)}
          />
        )}
      </td>
      <td className="num">{md.row(row)[0x0b]}</td>
      {([0x04, 0x06, 0x08] as const).map((offset) => (
        <td key={offset}>
          {sounds && maps.session.canExport ? (
            <SoundButton
              game={maps.session}
              sounds={sounds}
              value={md.u16(row, offset)}
              kind={offset === 0x08 ? 'se' : 'bgm'}
              max={0xffff}
              onChange={(value) => {
                md.setU16(row, offset, value);
                maps.changed();
                maps.session.edited();
              }}
            />
          ) : (
            md.u16(row, offset)
          )}
        </td>
      ))}
      <td className="small">
        {users.length ? `${users.length} マップ: ${users.map((m) => m.name).join('、')}` : '未使用'}
      </td>
    </tr>
  );
}

/** The MapGroup settings and the MapData references of the maps in one content. */
export function MapDataManager({ maps }: { maps: LanaiMaps }): ReactNode {
  const md = maps.contentTable('MapData');
  const revision = useLanaiRevision(maps.session);
  const soundResult = useAsync(() => maps.session.sounds(), [maps.session, revision]);
  const sounds = soundResult && !(soundResult instanceof Error) ? soundResult : null;
  const [source, setSource] = useState(0);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<number | null>(null);
  if (!md) return <p className="muted">MapData の表がありません。</p>;
  const rows = Array.from({ length: md.rows }, (_, row) => row);
  const editable = maps.session.canExport;
  const run = (edit: () => void): void => {
    try {
      edit();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const option = (row: number): ReactNode => (
    <option key={row} value={row}>{`#${row} (${hex8(md.rowId(row)).toUpperCase()})`}</option>
  );
  return (
    <>
      <h4>MapData の行</h4>
      <p className="muted small">
        同じ行を選んだマップは見た目とフィールド音を共有します。新しい行は選んだ行の内容を複製します。
      </p>
      <div className="row">
        <label>
          複製元{' '}
          <select value={Math.min(source, md.rows - 1)} onChange={(e) => setSource(Number(e.target.value))}>
            {rows.map(option)}
          </select>
        </label>
        <button
          disabled={!editable || !rows.length}
          onClick={() => run(() => setCreated(addLanaiMapData(maps, source)))}
        >
          新しい MapData を作成
        </button>
        {created !== null && (
          <span className="muted small">{`行 #${created} を作成しました。下の選択欄から割り当てられます。`}</span>
        )}
      </div>
      <table className="book-table">
        <thead>
          <tr>
            <th>行 / ID</th>
            <th>タイルセット</th>
            <th>MapResource</th>
            <th>フィールド BGM</th>
            <th>戦闘前の曲</th>
            <th>足音</th>
            <th>使用マップ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MapDataRow key={row} maps={maps} row={row} sounds={sounds} />
          ))}
        </tbody>
      </table>
      <h4>MapGroup の設定</h4>
      <table className="book-table">
        <thead>
          <tr>
            <th>MapGroup</th>
            <th>屋外用 MapData</th>
            <th>屋内用 MapData</th>
            <th>最初のマップ / 地点</th>
            <th>イベント表</th>
            <th>会話表</th>
            <th>状態枠</th>
          </tr>
        </thead>
        <tbody>
          {maps.groups.map((g) => (
            <tr key={g.row}>
              <td>
                {`${g.row}: ${maps.groupName(g.row) || '名前なし'}`}
                <span className="mono muted small">{` (名前 ID ${hex8(g.nameId).toUpperCase()})`}</span>
              </td>
              <td>
                <select
                  aria-label={`MapGroup ${g.row} の屋外用 MapData`}
                  disabled={!editable}
                  value={md.find(g.mapData)}
                  onChange={(e) => run(() => setLanaiGroupMapData(maps, g.row, false, Number(e.target.value)))}
                >
                  {rows.map(option)}
                </select>
              </td>
              <td>
                <select
                  aria-label={`MapGroup ${g.row} の屋内用 MapData`}
                  disabled={!editable}
                  value={g.mapDataIndoor ? md.find(g.mapDataIndoor) : -1}
                  onChange={(e) =>
                    run(() =>
                      setLanaiGroupMapData(
                        maps,
                        g.row,
                        true,
                        Number(e.target.value) < 0 ? null : Number(e.target.value),
                      ),
                    )
                  }
                >
                  <option value={-1}>なし（屋外用を使う）</option>
                  {rows.map(option)}
                </select>
              </td>
              <td>
                {editable && g.row > 0 ? (
                  <DestinationFields
                    maps={maps}
                    map={g.firstMap}
                    point={g.firstPoint}
                    group={g.row}
                    labels={['最初のマップ', '入口の地点']}
                    onChange={(map, point) => run(() => setLanaiGroupFirstMap(maps, g.row, map, point))}
                  />
                ) : (
                  <span className="mono small">{`${maps.map(g.firstMap)?.name ?? hex8(g.firstMap).toUpperCase()} / ${hex8(g.firstPoint).toUpperCase()}`}</span>
                )}
              </td>
              <td className="mono small">{`${hex8(g.eventEntry).toUpperCase()} / ${maps.eventTable(g.row)?.name ?? 'なし'}`}</td>
              <td className="mono small">
                {g.talkEntry
                  ? `${hex8(g.talkEntry).toUpperCase()} / ${maps.talkTable(g.row)?.name ?? 'なし'}`
                  : 'MessageContents'}
              </td>
              <td className="num">{`先頭 ${g.stateFirst}・${g.stateCount} 枠`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>マップの割り当て</h4>
      <p className="muted small">
        MapData を「MapGroup に従う」にすると、屋内タイルの有無で上の屋外用・屋内用を選びます。MapGroup
        を変えるとイベント表と状態枠も切り替わります。イベント番号は変換されません。最初のマップを移す場合は、先に上の表で別の最初のマップを選んでください。
      </p>
      <table className="book-table">
        <thead>
          <tr>
            <th>マップ</th>
            <th>MapGroup</th>
            <th>MapData の指定</th>
            <th>現在使う行</th>
            <th>新しい行</th>
          </tr>
        </thead>
        <tbody>
          {maps.maps
            .filter((m) => !m.world)
            .map((m) => {
              const own = m.mapDataId !== 0 && m.mapDataId !== 0x80000000;
              const row = maps.mapDataRow(m, maps.doc(m));
              return (
                <tr key={m.hash}>
                  <td>
                    <a
                      href={lanaiMapHref(maps.content.index, m.name)}
                    >{`${m.name} (${lanaiFloorLabel(m.floor) || '地上'})`}</a>
                  </td>
                  <td>
                    <select
                      aria-label={`${m.name} の MapGroup`}
                      disabled={!editable}
                      value={m.dungeon}
                      onChange={(e) => run(() => setLanaiMapGroup(maps, m, Number(e.target.value)))}
                    >
                      {maps.groups.slice(1).map((g) => (
                        <option key={g.row} value={g.row}>{`${g.row}: ${maps.groupName(g.row) || '名前なし'}`}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${m.name} の MapData`}
                      disabled={!editable}
                      value={own ? md.find(m.mapDataId) : -1}
                      onChange={(e) =>
                        run(() => setLanaiMapData(maps, m, Number(e.target.value) < 0 ? null : Number(e.target.value)))
                      }
                    >
                      <option value={-1}>MapGroup に従う</option>
                      {rows.filter((r) => md.rowId(r) !== 0x80000000 && md.rowId(r) !== 0).map(option)}
                    </select>
                  </td>
                  <td className="num">{row < 0 ? 'なし' : `#${row}`}</td>
                  <td>
                    <button
                      disabled={!editable || row < 0}
                      onClick={() =>
                        run(() => {
                          const next = addLanaiMapData(maps, row);
                          setLanaiMapData(maps, m, next);
                          setCreated(next);
                        })
                      }
                    >
                      複製して割り当て
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
