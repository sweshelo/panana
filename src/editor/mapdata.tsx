// Inspector block of a map: the mapData row it uses (tileset, models, BGM, footsteps) and what picks it. The row can be
// linked to another one (the dungeon's mapGroup +0x26 / +0x27, or an added map's own key) or copied into a new row of
// its own, so that the tileset and the sounds stop being shared with the other maps of the row.
import { useMemo, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import { TILESETS } from '../game/master';
import { mapShortTitle, mapTitle } from '../game/names';
import { mapDataUsers } from '../game/sound';
import type { Session } from '../session';
import { Field } from './fields';

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
  const tilesets = Array.from({ length: TILESETS }, (_, t) => t).filter((t) => t === tileset || master.tilesetRow(t) >= 0);

  const label = (r: number): string => {
    const n = users.get(r)?.length ?? 0;
    return `行 ${r}  タイルセット ${master.mapData.row(r)[0]}・マップ ${n} 個`;
  };
  const rows = Array.from({ length: master.mapData.rows }, (_, r) => r);
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
        <select value={tileset} onChange={(e) => edit(() => master.setTileset(row, Number(e.target.value)))}>
          {tilesets.map((t) => <option key={t} value={t}>{`${t}`}</option>)}
        </select>
      </Field>
      {added && (
        <Field label="このマップの行 (マップ自身のキー)">
          <select value={from === 'key' ? row : 0} onChange={(e) => setKey(Number(e.target.value))}>
            <option value={0}>{`ダンジョンの行に従う (行 ${master.dungeonMapDataRow(info.dungeon, ref.indoor)})`}</option>
            {rows.slice(1).map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </Field>
      )}
      {fromDungeon && (
        <Field label={`ダンジョンの行 (mapGroup ${indoor ? '+0x27' : '+0x26'})`}>
          <select value={row} onChange={(e) => edit(() => master.setDungeonMapDataRow(info.dungeon, indoor, Number(e.target.value)))}>
            {rows.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </Field>
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
