// BGM and sound effects: every soundData row with its name (sound/sound.bcsar) and the maps whose mapData picks it
// as their field BGM, battle BGM or footsteps (those are changed in the map editor, src/editor/sounds.tsx).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import { mapShortTitle } from '../game/names';
import { mapDataUsers, SOUND_KIND, SOUND_SLOTS, soundUses, type SoundKind, type SoundNames, type SoundUse } from '../game/sound';
import { hex8 } from '../util/bytes';
import { Count, ListFilter, useActiveRow, useSticky, type PageProps } from '../ui/book';

export const soundHref = (row: number): string => `#/sounds/${row}`;

type Filter = SoundKind | 'all' | 'used';

const SLOT_LABEL = Object.fromEntries(SOUND_SLOTS.map(([slot, label]) => [slot, label]));

export function SoundPage({ session, arg, visit, sounds }: PageProps & { sounds: SoundNames }): ReactNode {
  const { game } = session;
  // Recomputed on every visit: the map editor may have changed the sounds or the maps.
  const { uses, users } = useMemo(() => ({ uses: soundUses(game), users: mapDataUsers(game, session.docOf) }), [game, session, visit]);
  const selected = useSticky(arg ? Number(arg) : undefined, (r) => r >= 1 && r < sounds.rows, () => 1);
  return (
    <div className="book">
      <SoundView sounds={sounds} uses={uses} users={users} selected={selected} mapTitle={(m) => mapShortTitle(m, game.code.maps)} />
    </div>
  );
}

export function SoundView({ sounds, uses, users, selected, mapTitle }: {
  sounds: SoundNames;
  uses: Map<number, SoundUse[]>;
  users: Map<number, MapInfo[]>;
  selected: number;
  mapTitle: (m: MapInfo) => string;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const q = query.trim().toUpperCase();
  const rows: number[] = [];
  for (let r = 1; r < sounds.rows; r++) {
    if (q && String(r) !== q && !sounds.name(r).includes(q)) continue;
    if (filter === 'used' ? !uses.has(r) : filter !== 'all' && sounds.kind(r) !== filter) continue;
    rows.push(r);
  }
  const use = uses.get(selected) ?? [];
  return (
    <>
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前 (BGM_CAVE など) か行番号で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['bgm', 'BGM'], ['se', '効果音'], ['other', 'その他'], ['used', 'マップで使う']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={sounds.rows - 1} />
          <table className="book-table">
            <thead><tr><th>#</th><th>名前</th><th>種類</th><th title="この音を使う mapData の欄の数">マップ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r} className={r === selected ? 'active' : ''} onClick={() => (location.hash = soundHref(r))}>
                  <td className="num muted">{r}</td>
                  <td className="mono">{sounds.name(r) || <span className="muted">(名前なし)</span>}</td>
                  <td className="muted">{SOUND_KIND[sounds.kind(r)]}</td>
                  <td className="num muted">{uses.get(r)?.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        <div className="book-head">
          <h2 className="mono">{sounds.name(selected) || `サウンド ${selected}`}</h2>
          <span className="muted">{`#${selected}  ${SOUND_KIND[sounds.kind(selected)]}  (soundData.bin)`}</span>
        </div>
        {!sounds.named && <p className="muted">sound/sound.bcsar が読めなかったので、音の名前はわかりません。</p>}
        <table className="enc-table">
          <tbody>
            <tr><td>+0x00 アイテム ID</td><td className="mono">{`0x${hex8(sounds.item(selected))}`}</td>
              <td className="muted">{sounds.item(selected) >>> 24 === 1 ? `sound.bcsar の音 ${sounds.item(selected) & 0xffffff}` : ''}</td></tr>
            <tr><td>+0x08 音量</td><td>{sounds.volume(selected)}</td><td /></tr>
          </tbody>
        </table>
        <h3>{`使っているマップの設定 (${use.length})`}</h3>
        {use.length ? (
          <table className="enc-table">
            <tbody>
              <tr><th>mapData</th><th>欄</th><th>マップ</th></tr>
              {use.map((u) => {
                const maps = users.get(u.mapDataRow) ?? [];
                return (
                  <tr key={`${u.mapDataRow}.${u.slot}`}>
                    <td className="num">{u.mapDataRow}</td>
                    <td>{SLOT_LABEL[u.slot]}</td>
                    <td>
                      {maps.length
                        ? maps.map((m, i) => <span key={m.hash}>{i ? '、' : ''}<a href={`#/map/${m.name}`} title={m.name}>{mapTitle(m)}</a></span>)
                        : <span className="muted">(読めるマップにはなし)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="muted">どのマップの設定 (mapData のフィールド・戦闘の BGM、足音) も使っていません。</div>
        )}
        <p className="muted small">マップの BGM・足音は、マップ編集の右ペイン「BGM・効果音」で変えられます (mapData は 1 バイトなので行 255 まで)。</p>
      </div>
    </>
  );
}
