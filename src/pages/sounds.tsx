// BGM and sound effects: every soundData row with its name (from the active sound archive) and the maps whose mapData picks it
// as their field BGM, battle BGM or footsteps (those are changed in the map editor, src/editor/sounds.tsx).
// SoundView is the list and the head of the detail, shared with RPG3's page (src/oahu/SoundPage.tsx).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import { mapShortTitle } from '../game/names';
import {
  mapDataUsers,
  SOUND_KIND,
  SOUND_SLOTS,
  soundUses,
  type SoundKind,
  type SoundNames,
  type SoundSource,
  type SoundUse,
} from '../game/sound';
import { Count, ListFilter, useActiveRow, useSticky, type PageProps } from '../ui/book';
import { PlayButton } from '../ui/SoundPicker';
import { hex8 } from '../util/bytes';
import { BGM_EXT_BASE, bgmValue } from '../game/bgmext';

export const soundHref = (row: number): string => `#/sounds/${row}`;

type Filter = SoundKind | 'all' | 'used' | 'silent';

const SLOT_LABEL = Object.fromEntries(SOUND_SLOTS.map(([slot, label]) => [slot, label]));

export function SoundPage({ session, arg, visit, sounds }: PageProps & { sounds: SoundNames }): ReactNode {
  const { game } = session;
  // Recomputed on every visit: the map editor may have changed the sounds or the maps.
  const { uses, users } = useMemo(
    () => ({ uses: soundUses(game), users: mapDataUsers(game, session.docOf) }),
    [game, session, visit],
  );
  const selected = useSticky(
    arg ? Number(arg) : undefined,
    (r) => r >= 1 && r < sounds.rows,
    () => 1,
  );
  const use = uses.get(selected) ?? [];
  return (
    <div className="book">
      <SoundView
        game={game}
        sounds={sounds}
        selected={selected}
        href={soundHref}
        uses={(r) => uses.get(r)?.length ?? 0}
        usedLabel="マップで使う"
      >
        <AddedRow row={selected} />
        <MapUses use={use} users={users} mapTitle={(m) => mapShortTitle(m, game.code.maps)} />
      </SoundView>
    </div>
  );
}

/** An added row (a BGM ported from another game, port/bgm.ts): the value the BGM fields name it by. */
function AddedRow({ row }: { row: number }): ReactNode {
  const v = bgmValue(row);
  if (row < BGM_EXT_BASE) return null;
  return (
    <p className="muted small">
      {v === null
        ? 'ほかの作品から移植した BGM の行ですが、BGM の欄には入りません。'
        : `ほかの作品から移植した BGM の行です。マップ・ボス戦の BGM の欄では 0x${v.toString(16).toUpperCase()} になります (コードのパッチ「BGM の追加枠」)。`}
    </p>
  );
}

export function MapUses({
  use,
  users,
  mapTitle,
}: {
  use: SoundUse[];
  users: Map<number, MapInfo[]>;
  mapTitle: (m: MapInfo) => string;
}): ReactNode {
  return (
    <>
      <h3>{`使っているマップの設定 (${use.length})`}</h3>
      {use.length ? (
        <table className="enc-table">
          <tbody>
            <tr>
              <th>mapData</th>
              <th>欄</th>
              <th>マップ</th>
            </tr>
            {use.map((u) => {
              const maps = users.get(u.mapDataRow) ?? [];
              return (
                <tr key={`${u.mapDataRow}.${u.slot}`}>
                  <td className="num">{u.mapDataRow}</td>
                  <td>{SLOT_LABEL[u.slot]}</td>
                  <td>
                    {maps.length ? (
                      maps.map((m, i) => (
                        <span key={m.hash}>
                          {i ? '、' : ''}
                          <a href={`#/map/${m.name}`} title={m.name}>
                            {mapTitle(m)}
                          </a>
                        </span>
                      ))
                    ) : (
                      <span className="muted">(読めるマップにはなし)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="muted">どのマップの設定 (mapData のフィールド・戦闘の BGM、足音) も使っていません。</div>
      )}
      <p className="muted small">
        マップの BGM・足音は、マップ編集の右ペイン「BGM・効果音」で変えられます (mapData は 1 バイトなので行 255 まで)。
      </p>
    </>
  );
}

/**
 * The list of the soundData rows (name, kind, number of uses) and the detail of the selected one: play button, item
 * ID, volume, then `children` (where the game uses it).
 */
export function SoundView({
  game,
  sounds,
  selected,
  href,
  uses,
  usedLabel,
  silent,
  listTop,
  children,
}: {
  game: SoundSource;
  sounds: SoundNames;
  selected: number;
  href: (row: number) => string;
  /** How many places use a row (for the "used" filter). */
  uses: (row: number) => number;
  usedLabel: string;
  /** A sound archive entry whose own volume is zero. */
  silent?: (row: number) => boolean;
  /** Controls placed above the list, inside the left column. */
  listTop?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  const q = query.trim().toUpperCase();
  const archiveQuery = /^BCSAR:(\d+)$/.exec(q);
  const rows: number[] = [];
  for (let r = 1; r < sounds.rows; r++) {
    if (
      archiveQuery ? sounds.index(r) !== Number(archiveQuery[1]) : q && String(r) !== q && !sounds.name(r).includes(q)
    )
      continue;
    if (
      filter === 'used' ? !uses(r) : filter === 'silent' ? !silent?.(r) : filter !== 'all' && sounds.kind(r) !== filter
    )
      continue;
    rows.push(r);
  }
  return (
    <>
      <div className="book-side">
        {listTop}
        <ListFilter
          query={query}
          setQuery={setQuery}
          placeholder="名前・行番号・BCSAR:188 で検索"
          filter={filter}
          setFilter={setFilter}
          options={[
            ['all', 'すべて'],
            ['bgm', 'BGM'],
            ['me', 'ME (短い曲)'],
            ['se', '効果音'],
            ['other', 'その他'],
            ['used', usedLabel],
            ...(silent ? ([['silent', '無音の音源']] as [Filter, string][]) : []),
          ]}
        />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={sounds.rows - 1} />
          <table className="book-table">
            <thead>
              <tr>
                <th />
                <th title="SoundData の行番号。SE の se() 引数はこの番号">#</th>
                <th title="サウンドアーカイブ内の番号。SE の se() 引数は左の #">BCSAR #</th>
                <th>名前</th>
                <th>種類</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r} className={r === selected ? 'active' : ''} onClick={() => (location.hash = href(r))}>
                  <td className="play-cell">
                    <PlayButton game={game} sounds={sounds} row={r} />
                  </td>
                  <td className="num muted">{r}</td>
                  <td className="num muted">{sounds.index(r) ?? ''}</td>
                  <td className="mono">{sounds.name(r) || <span className="muted">(名前なし)</span>}</td>
                  <td className="muted">{SOUND_KIND[sounds.kind(r)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail">
        <div className="book-head">
          <PlayButton game={game} sounds={sounds} row={selected} className="large" />
          <h2 className="mono">{sounds.name(selected) || `サウンド ${selected}`}</h2>
          <span className="muted">{`#${selected}  ${SOUND_KIND[sounds.kind(selected)]}  (SoundData 行)`}</span>
        </div>
        {!sounds.named && <p className="muted">サウンドアーカイブが読めなかったので、音の名前はわかりません。</p>}
        {silent?.(selected) && <p className="muted small">この BCSAR 音源は音量 0 です。試聴しても音は鳴りません。</p>}
        <p className="muted small">
          ▶ で試聴できます。BGM・ME は sound/stream/ の曲を、効果音はサウンドアーカイブの波形とシーケンスを鳴らします
          (効果音のシーケンスはこのエディタでの再現なので、ゲームと少し違って聞こえることがあります)。
        </p>
        <table className="enc-table">
          <tbody>
            <tr>
              <td>+0x00 アイテム ID</td>
              <td className="mono">{`0x${hex8(sounds.item(selected))}`}</td>
              <td className="muted">
                {sounds.item(selected) >>> 24 === 1 ? `BCSAR の音 ${sounds.item(selected) & 0xffffff}` : ''}
              </td>
            </tr>
            <tr>
              <td>+0x08 音量</td>
              <td>{sounds.volume(selected)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {children}
      </div>
    </>
  );
}
