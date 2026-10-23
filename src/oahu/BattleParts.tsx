// Inspector block of an RPG3 map: its BGM and footsteps (the map's mapData row [4] / [6]) and what its battles play and
// show (the dungeon's mapData row [5] and the background of its mapResource row, battleField.ts), as RPG2's
// MapSoundPanel. The rows are shared by the maps and dungeons that pick them, so are the edits.
import { useMemo, type ReactNode } from 'react';
import { equalBytes, u32 } from '../util/bytes';
import { MAX_MAP_SOUND, type SoundKind, type SoundNames } from '../game/sound';
import { Field } from '../editor/fields';
import { SoundButton } from '../ui/SoundPicker';
import { useAsync } from '../ui/useAsync';
import { OAHU_BATTLE_BACKGROUNDS, OAHU_RESOURCE_BATTLE_BG, oahuBattleBackgroundName, oahuBattleRows, oahuResourceBackground, oahuResourceUsers, setOahuResourceBackground } from './battleField';
import type { OahuEditState } from './mapedit';
import type { OahuMapInfo } from './maps';
import type { OahuSession } from './session';
import { oahuMapDataDungeons } from './sound';
import { oahuSoundHref } from './SoundPage';

const SLOTS: { slot: number; label: string; kind: SoundKind }[] = [
  { slot: 4, label: 'フィールドの BGM', kind: 'bgm' },
  { slot: 6, label: '足音', kind: 'se' },
];

export function OahuMapBattlePanel({ session, st, info }: { session: OahuSession; st: OahuEditState; info: OahuMapInfo }): ReactNode {
  const sounds = useAsync(() => session.sounds(), [session]);
  const { maps, master } = session;
  const doc = st.current!;
  const md = master.table('mapData.bin');
  const own = maps.mapDataRow(info, doc);
  const battle = oahuBattleRows(maps, info, doc);
  const dungeons = useMemo(() => oahuMapDataDungeons(master, (id) => session.battle.message(id)), [session, master]);
  const resourceUsers = oahuResourceUsers(master);
  const names = sounds instanceof Error || !sounds ? null : sounds;
  const dungeonsOf = (row: number): string => {
    const d = dungeons.get(row);
    return d ? [...d.main, ...d.second].map((x) => x.name).join('、') : '';
  };
  const rowNote = (row: number): ReactNode => {
    const ds = dungeonsOf(row);
    const changed = row < md.rows && !equalBytes(master.originalRow('mapData.bin', row), md.row(row));
    return `mapData 行 ${row}${ds ? ` (${ds})` : ''}${changed ? '・変更済み' : ''}`;
  };
  const setSound = (row: number, slot: number, v: number): void => st.editTables(() => { md.row(row)[slot] = v; });
  const sound = (row: number, slot: number, label: string, kind: SoundKind): ReactNode => {
    const v = row < md.rows ? md.row(row)[slot]! : 0;
    return (
      <div className="field">
        <span>{label}</span>
        {names
          ? <SoundButton game={session} sounds={names} value={v} kind={kind} max={MAX_MAP_SOUND} title={`${label} を選ぶ`} onChange={(n) => setSound(row, slot, n)} />
          : <a href={oahuSoundHref(v)}>{`サウンド ${v}`}</a>}
      </div>
    );
  };
  const sharedBg = (resourceUsers.get(battle.resource) ?? []).filter((r) => r !== battle.mapData);
  const bgChanged = battle.resource > 0 && oahuResourceBackground(master, battle.resource) !== u32(master.originalRow('mapResource.bin', battle.resource), OAHU_RESOURCE_BATTLE_BG);
  const bgOptions = OAHU_BATTLE_BACKGROUNDS.some(([h]) => h === battle.background) || !battle.background ? OAHU_BATTLE_BACKGROUNDS : [...OAHU_BATTLE_BACKGROUNDS, [battle.background, oahuBattleBackgroundName(battle.background)] as [number, string]];
  return (
    <>
      <div className="enc-box">
        <h3>BGM・足音</h3>
        {SLOTS.map((s) => <div key={s.slot}>{sound(own, s.slot, s.label, s.kind)}</div>)}
        <div className="muted small">{`${rowNote(own)} の [4] / [6]。同じ行を使うマップの音がまとめて変わります。フィールドの BGM は、ワールドマップ (乗り物)・釣り・一部のイベントではゲームが差し替えます。`}</div>
      </div>
      <div className="enc-box">
        <h3>戦闘の BGM・背景</h3>
        {sound(battle.mapData, 5, '戦闘の BGM', 'bgm')}
        <Field label="戦闘の背景">
          <select value={battle.background >>> 0} disabled={battle.resource <= 0}
            onChange={(e) => st.editTables(() => setOahuResourceBackground(master, battle.resource, Number(e.target.value)))}>
            <option value={0}>なし</option>
            {bgOptions.map(([h, n]) => <option key={h} value={h >>> 0}>{n}</option>)}
          </select>
        </Field>
        <div className="muted small">
          {battle.fromDungeon
            ? `このマップの戦闘は、マップの行ではなくダンジョンの行 (mapGroup +0x2E = ${rowNote(battle.mapData)}) で決まります。BGM はその行の [5]、背景はその行の [1] = mapResource 行 ${battle.resource} の +0x10 (アーカイブ 52120000 のモデル) です。`
            : `${rowNote(battle.mapData)} の [5] と、[1] = mapResource 行 ${battle.resource} の +0x10 (推定: ダンジョンのないマップ)。`}
          {battle.resource <= 0 ? ' mapResource の行がないので背景は選べません。' : ''}
          {sharedBg.length ? ` 背景は mapResource の行ごとなので、同じ行を使う mapData ${sharedBg.length} 行 (${sharedBg.slice(0, 8).join('・')}${sharedBg.length > 8 ? ' …' : ''}) の戦闘も変わります。` : ''}
          {bgChanged ? ' 背景は変更済み。' : ''}
          {' ボス戦などの決まった戦闘も、背景はいるダンジョンのものです。BGM は呼び出し側の値か、群れの「ボスの曲」で決まります (群れのページ)。ワールドマップの戦闘は足元の地形 (worldmapParts +0x0A) の行を使います。'}
        </div>
      </div>
    </>
  );
}
