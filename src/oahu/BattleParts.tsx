// Inspector blocks of an RPG3 map, in RPG2's sound box (ui/SoundSlots): its BGM and footsteps (the map's mapData row
// [4] / [6]) and what its battles play and show (the dungeon's mapData row [5] and the background of its mapResource
// row, battleField.ts). The rows are shared by the maps and dungeons that pick them, so are the edits.
import { useMemo, type ReactNode } from 'react';
import { equalBytes, u32 } from '../util/bytes';
import { MAX_MAP_SOUND, type SoundKind } from '../game/sound';
import { Field } from '../editor/fields';
import { SoundSlotsBox, type SoundSlot } from '../ui/SoundSlots';
import { useAsync } from '../ui/useAsync';
import { ModelPreviewButton } from '../ui/ModelPreview';
import { oahuBattleBackgroundRef, OAHU_BATTLE_BACKGROUNDS, OAHU_RESOURCE_BATTLE_BG, oahuBattleBackgroundName, oahuBattleRows, oahuResourceBackground, oahuResourceUsers, setOahuResourceBackground } from './battleField';
import type { OahuEditState } from './mapedit';
import type { OahuMapInfo } from './maps';
import type { OahuSession } from './session';
import { OAHU_SECTIONS } from './code';
import { oahuMapDataDungeons, oahuSoundUses } from './sound';

const BG_PREVIEW_NOTE = 'モデルだけを表示しています。戦闘のカメラの位置・地面のテクスチャ (mapResource +0x04 / +0x08 を戦闘で貼る) は再現していません。';
const TEXT_END = OAHU_SECTIONS.text[0] + OAHU_SECTIONS.text[1];

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
  const setSound = (row: number, slot: number) => (v: number): void => st.editTables(() => { md.row(row)[slot] = v; });
  const slot = (row: number, slot: number, label: string, kind: SoundKind): SoundSlot => ({
    key: `${row}.${slot}`, label, kind, max: MAX_MAP_SOUND, value: row < md.rows ? md.row(row)[slot]! : 0, onChange: setSound(row, slot),
  });
  const uses = useMemo(() => oahuSoundUses(master, session.battle, session.code, TEXT_END), [session, master]);
  const usage = (r: number): string => {
    const n = uses.get(r)?.length ?? 0;
    return n ? `${n} か所で使用` : '';
  };
  const sharedBg = (resourceUsers.get(battle.resource) ?? []).filter((r) => r !== battle.mapData);
  const bgChanged = battle.resource > 0 && oahuResourceBackground(master, battle.resource) !== u32(master.originalRow('mapResource.bin', battle.resource), OAHU_RESOURCE_BATTLE_BG);
  const bgOptions = OAHU_BATTLE_BACKGROUNDS.some(([h]) => h === battle.background) || !battle.background ? OAHU_BATTLE_BACKGROUNDS : [...OAHU_BATTLE_BACKGROUNDS, [battle.background, oahuBattleBackgroundName(battle.background)] as [number, string]];
  return (
    <>
      <SoundSlotsBox title="BGM・足音" game={session} sounds={names} usage={usage}
        slots={[slot(own, 4, 'フィールドの BGM', 'bgm'), slot(own, 6, '足音', 'se')]}
        note={`${rowNote(own)} の [4] / [6]。同じ行を使うマップの音がまとめて変わります。フィールドの BGM は、ワールドマップ (乗り物)・釣り・一部のイベントではゲームが差し替えます。`} />
      <SoundSlotsBox title="戦闘の BGM・背景" game={session} sounds={names} usage={usage}
        slots={[slot(battle.mapData, 5, '戦闘の BGM', 'bgm')]}
        note={
          <>
            {battle.fromDungeon
              ? `このマップの戦闘は、マップの行ではなくダンジョンの行 (mapGroup +0x2E = ${rowNote(battle.mapData)}) で決まります。BGM はその行の [5]、背景はその行の [1] = mapResource 行 ${battle.resource} の +0x10 (アーカイブ 52120000 のモデル) です。`
              : `${rowNote(battle.mapData)} の [5] と、[1] = mapResource 行 ${battle.resource} の +0x10 (推定: ダンジョンのないマップ)。`}
            {battle.resource <= 0 ? ' mapResource の行がないので背景は選べません。' : ''}
            {sharedBg.length ? ` 背景は mapResource の行ごとなので、同じ行を使う mapData ${sharedBg.length} 行 (${sharedBg.slice(0, 8).join('・')}${sharedBg.length > 8 ? ' …' : ''}) の戦闘も変わります。` : ''}
            {bgChanged ? ' 背景は変更済み。' : ''}
            {' ボス戦などの決まった戦闘も、背景はいるダンジョンのものです。BGM は呼び出し側の値か、群れの「ボスの曲」で決まります (群れのページ)。ワールドマップの戦闘は足元の地形 (worldmapParts +0x0A) の行を使います。'}
          </>
        }>
        <Field label="戦闘の背景">
          <select value={battle.background >>> 0} disabled={battle.resource <= 0}
            onChange={(e) => st.editTables(() => setOahuResourceBackground(master, battle.resource, Number(e.target.value)))}>
            <option value={0}>なし</option>
            {bgOptions.map(([h, n]) => <option key={h} value={h >>> 0}>{n}</option>)}
          </select>
          <ModelPreviewButton model={oahuBattleBackgroundRef(session.dump, battle.background)} name={oahuBattleBackgroundName(battle.background)} note={BG_PREVIEW_NOTE} />
        </Field>
      </SoundSlotsBox>
    </>
  );
}
