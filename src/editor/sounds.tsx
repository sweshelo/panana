// Inspector block of a map: its BGM and footsteps (mapData [4] / [5] / [6] -> soundData rows), picked in a
// <dialog> (src/ui/SoundPicker.tsx). The mapData row is shared by the maps that pick it, so is the edit.
import { useMemo, type ReactNode } from 'react';
import { equalBytes } from '../util/bytes';
import { mapShortTitle } from '../game/names';
import { MAX_MAP_SOUND, SOUND_SLOTS, soundUses, mapDataUsers, type SoundKind, type SoundNames } from '../game/sound';
import type { Session } from '../session';
import { SoundButton } from '../ui/SoundPicker';
import { Field } from './fields';

const SLOT_KIND: Record<string, SoundKind> = { bgm: 'bgm', battle: 'bgm', steps: 'se' };

export function MapSoundPanel({ session, sounds }: { session: Session; sounds: SoundNames | null }): ReactNode {
  const { game, st } = session;
  const master = game.master;
  const row = master.mapDataRow(st.ref!);
  const s = master.sounds(st.ref!);
  // The maps of each mapData row (by the documents as they are now; rebuilt when another map is opened).
  const users = useMemo(() => mapDataUsers(game, session.docOf), [game, session, st.ref]);
  const shared = users.get(row) ?? [];
  const uses = soundUses(game);
  const usage = (r: number): string => {
    const u = uses.get(r) ?? [];
    const maps = new Set(u.flatMap((x) => users.get(x.mapDataRow) ?? []));
    return u.length ? `mapData ${u.length} 箇所・マップ ${maps.size} 個` : '';
  };
  const changed = !equalBytes(master.originalRow('mapData.bin', row), master.mapData.row(row));
  return (
    <div className="enc-box">
      <h3>
        BGM・効果音
        {shared.length > 1 && (
          <span className="badge" title={shared.map((m) => mapShortTitle(m, game.code.maps)).join('、')}>{`${shared.length} マップで共有`}</span>
        )}
      </h3>
      {SOUND_SLOTS.map(([slot, label]) => (
        <Field key={slot} label={label}>
          {sounds
            ? <SoundButton sounds={sounds} value={s[slot]} kind={SLOT_KIND[slot]} max={MAX_MAP_SOUND} usage={usage}
                title={`${label} を選ぶ`} onChange={(v) => st.editTables(() => master.setSound(row, slot, v))} />
            : <span>{`サウンド ${s[slot]}`}</span>}
        </Field>
      ))}
      <div className="muted small">
        {`mapData 行 ${row} の [4] / [5] / [6]。`}
        {shared.length > 1 ? `同じ行を使う ${shared.length} 個のマップの音がまとめて変わります。` : ''}
        {row === 0 ? '行 0 は自分の行を持たないマップ (町など) のもので、BGM の決まり方は未解析です。変えても鳴る音が変わらないかもしれません。' : ''}
        {changed ? ' 変更済み。' : ''}
      </div>
    </div>
  );
}
