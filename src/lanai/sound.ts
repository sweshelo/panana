// BGM and sound effects of 電波人間のRPG FREE!: the SoundData rows (named from sound/sound.bcsar, as the other games':
// session.ts sounds()) and the places of the data known to name one (naauao lanai/battle-field.md §5, map.md §7.3):
// - the master's BattleField +0x08 and the contents' BattleFieldContents +0x08: the BGM of a battle field;
// - the contents' MapData +0x04 / +0x06 / +0x08: a map's field BGM, the tune before a battle, the encounter sound;
// - the opening sound of a door: an argument of the door actions of the contents' EventObject rows (actions.ts).
// The sounds played from the code and from the contents' scripts (CRO) are not listed.
import { contentTitle, lanaiContents, type LanaiContent } from './contents';
import { LANAI_BF, LANAI_MAP_SOUNDS } from './battleField';
import { lanaiActionName } from './actions';
import { lanaiMapHref } from './hrefs';
import { LANAI_EVENT_ACTIONS } from './maps';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

export type LanaiSoundUseKind = 'battle' | 'map' | 'door';

export const LANAI_SOUND_USE_KIND: Record<LanaiSoundUseKind, string> = {
  battle: '戦闘の背景',
  map: 'マップ',
  door: '扉',
};

/** One place that names a SoundData row. */
export interface LanaiSoundUse {
  kind: LanaiSoundUseKind;
  /** What uses it ("フィールドの BGM"). */
  what: string;
  /** Where ("MapData 行 1"). */
  where: string;
  /** The content it is in (none: the master). */
  content?: { label: string; href: string };
}

/** The argument (0〜4) of a door action that is its opening sound, by action type (actions.ts). */
export const LANAI_DOOR_SOUND_ARG: Record<number, number> = {
  0x80000015: 2,
  0x80000016: 4,
  0x80000019: 4,
  0x8000001c: 4,
  0x80000039: 4,
  0x8000003b: 2,
};

/** MapGroup +0x1C: the entry of the group's EventObject table in the content's archive. */
const MAP_GROUP_EVENTS = 0x1c;

type Uses = Map<number, LanaiSoundUse[]>;

const add = (out: Uses, row: number, use: LanaiSoundUse): void => {
  if (row) out.set(row, [...(out.get(row) ?? []), use]);
};

function battleFieldUses(out: Uses, t: LanaiTable | undefined, content?: LanaiSoundUse['content']): void {
  for (let r = 0; t && r < t.rows; r++)
    add(out, t.u32(r, LANAI_BF.bgm), { kind: 'battle', what: '戦闘の BGM', where: `${t.name} 行 ${r}`, content });
}

/** The uses in the master: the battle fields (BattleField +0x08). */
export function lanaiMasterSoundUses(session: LanaiSession): Uses {
  const out: Uses = new Map();
  battleFieldUses(out, session.table('BattleField'));
  return out;
}

/** The uses in one content's tables (its archive is read when first asked for). */
export async function lanaiContentSoundUses(session: LanaiSession, c: LanaiContent, out: Uses): Promise<void> {
  const tables = await session.tablesIn(c.archive);
  const named = (name: string): LanaiTable | undefined => tables.find((t) => t.table.name === name)?.table;
  const content = { label: `${c.index}: ${contentTitle(c)}`, href: lanaiMapHref(c.index) };
  battleFieldUses(out, named('BattleFieldContents'), content);
  const md = named('MapData');
  for (let r = 0; md && r < md.rows; r++)
    for (const s of LANAI_MAP_SOUNDS)
      add(out, md.u16(r, s.offset), { kind: 'map', what: s.label, where: `MapData 行 ${r}`, content });
  const groups = named('MapGroup');
  for (let g = 0; groups && g < groups.rows; g++) {
    const entry = groups.u32(g, MAP_GROUP_EVENTS);
    const events = entry ? tables.find((t) => t.entry === entry)?.table : undefined;
    for (let r = 1; events && r < events.rows; r++)
      for (const o of LANAI_EVENT_ACTIONS) {
        const type = events.u32(r, o);
        const arg = LANAI_DOOR_SOUND_ARG[type];
        if (arg === undefined) continue;
        add(out, events.u32(r, o + 4 + arg * 4), {
          kind: 'door',
          what: `開く音 (${lanaiActionName(type)})`,
          where: `MapGroup ${g} イベント #${r}`,
          content,
        });
      }
  }
}

/**
 * SoundData row -> the places that name it, in the master and in every content (their archives are read: the first
 * time takes a while). A content that cannot be read is left out. `progress` is called with the contents done.
 */
export async function lanaiSoundUses(
  session: LanaiSession,
  progress?: (done: number, total: number) => void,
): Promise<Uses> {
  const out = lanaiMasterSoundUses(session);
  const contents = lanaiContents(session);
  for (const [i, c] of contents.entries()) {
    await lanaiContentSoundUses(session, c, out).catch(() => {});
    progress?.(i + 1, contents.length);
  }
  return out;
}
