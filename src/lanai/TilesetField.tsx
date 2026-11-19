// The tileset of a map (tilesets.ts), as RPG2's "見た目と音 (mapData)" block (editor/mapdata.tsx): a button with the
// floor's picture opens a grid of every tileset of the ROM, each shown by its floor. Picking one gives it to the maps
// of the MapData row (copying the tileset's table into the stage when it does not have it). Added stages only.
import { useState, type ReactNode } from 'react';
import type { ModelRef } from '../pages/modelview';
import { GridPicker, type GridEntry } from '../ui/GridPicker';
import { Photo } from '../ui/Photo';
import { hex8, u32 } from '../util/bytes';
import { lanaiTileModels } from './mapModels';
import type { LanaiMapInfo, LanaiMaps } from './maps';
import {
  lanaiTilesets,
  mapDataTileset,
  setLanaiTileset,
  tilesetGaps,
  tilesetTable,
  type LanaiTileset,
} from './tilesets';

/** The floor of a tileset with its texture, for ui/Photo. */
export function floorPhoto(maps: LanaiMaps, ts: LanaiTileset): ModelRef | null {
  const floor = ts.floor;
  if (!floor) return null;
  const textureArchive = u32(ts.resource, 0),
    textureEntry = u32(ts.resource, 4);
  return {
    key: `lanai-tileset/${hex8(ts.entry)}/${hex8(textureArchive)}/${hex8(textureEntry)}`,
    load: async () => {
      const set = await lanaiTileModels(
        maps.session,
        { mapData: -1, tileset: 0, partsName: '', resource: 0, textureArchive, textureEntry },
        [floor],
      );
      return set.models.has(floor.entry) ? { set, hash: floor.entry } : null;
    },
  };
}

export function LanaiTilesetField({ maps, info }: { maps: LanaiMaps; info: LanaiMapInfo }): ReactNode {
  const s = maps.session;
  const [list, setList] = useState<LanaiTileset[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doc = maps.doc(info);
  const row = maps.mapDataRow(info, doc);
  const cur = mapDataTileset(maps, row);
  const editable = s.createdFiles.has(maps.content.archive.toUpperCase());
  const shared = maps.maps.filter((m) => !m.world && maps.mapDataRow(m, maps.doc(m)) === row);
  const curTs = list?.find((t) => t.entry === cur);
  const src = maps.tileSource(info, doc);
  const name = src.partsName.replace(/^MapParts/u, '') || 'なし';

  const openPicker = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      setList(await lanaiTilesets(s));
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (ts: LanaiTileset): Promise<void> => {
    setOpen(false);
    if (ts.entry === cur) return;
    setBusy(true);
    try {
      const gaps = tilesetGaps(maps, row, await tilesetTable(s, maps, ts));
      if (
        gaps.length &&
        !confirm(
          `タイルセット ${ts.name} には、このマップが使っているタイルの種類 ${gaps.join(', ')} のモデルがありません (表示されなくなります)。変えますか？`,
        )
      )
        return;
      await setLanaiTileset(s, maps, row, ts);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entries: GridEntry[] = (list ?? []).map((ts, k) => ({
    id: k,
    name: ts.name,
    sub: `${ts.contents.length} ステージ`,
    title: `MapParts${ts.name} (${hex8(ts.entry)})・コンテンツ ${ts.contents.slice(0, 8).join(', ')}${ts.contents.length > 8 ? ' …' : ''}`,
    keywords: ts.contents.join(' '),
    icon: <Photo model={floorPhoto(maps, ts)} className="photo photo-lg" />,
  }));

  return (
    <div className="enc-box">
      <h3>見た目 (タイルセット)</h3>
      <div className="row">
        <button
          disabled={!editable || busy || row < 0}
          onClick={() => void openPicker()}
          title={editable ? 'タイルセットを選ぶ' : 'ROM のステージは写して (コンテンツを複製して追加) から変えられます'}
        >
          {curTs && <Photo model={floorPhoto(maps, curTs)} className="photo" />}
          {busy ? '読み込み中…' : `タイルセット ${name}`}
        </button>
      </div>
      <p className="muted small">
        {row < 0
          ? 'MapData が見つかりません'
          : `MapData #${row} を使う ${shared.length} マップ (${shared.map((m) => m.name).join('、')}) に効きます。タイルの種類はどのタイルセットでも同じ意味で、形はそのまま見た目だけ替わります。`}
        {!editable && ' ROM のステージは写して (コンテンツを複製して追加) から変えられます。'}
      </p>
      {error && <p className="error">{error}</p>}
      {open && list && (
        <GridPicker
          title="タイルセットを選ぶ"
          entries={entries}
          current={list.findIndex((t) => t.entry === cur)}
          placeholder="名前かコンテンツ番号で絞り込み"
          onPick={(k: number) => void pick(list[k]!)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
