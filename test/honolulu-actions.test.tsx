// 初代's action page (honolulu/actions.ts, ActionPage.tsx): the antennas' skills (skillData) and the monsters' skills
// (monsterAttackSkill) in one list (naauao honolulu/monsters.md §3・§4), their edits and the export. The tests with the
// ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { findByName, parseArchive } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { readField } from '../src/game/tabledef';
import {
  actionChanged, actionRows, antennaSkillName, attackUsers, honoluluActionHref, honoluluActions, parseActionKey, revertAction, rowsWithText,
} from '../src/honolulu/actions';
import { HonoluluActionPage } from '../src/honolulu/ActionPage';
import { HonoluluSession } from '../src/honolulu/session';
import { HONOLULU_MONSTER_ATTACK_SKILL, HONOLULU_SKILL_DATA } from '../src/honolulu/tables';
import { openImage } from '../src/rom/dump';
import { HONOLULU } from '../src/rom/titles';
import { equalBytes } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe('初代の action keys', () => {
  test('s<row> is skillData, w<row> monsterAttackSkill', () => {
    expect(parseActionKey('s12')).toEqual(['s', 12]);
    expect(parseActionKey('w1')).toEqual(['w', 1]);
    expect(parseActionKey('12')).toBeUndefined();
    expect(parseActionKey(undefined)).toBeUndefined();
    expect(honoluluActionHref('w', 3)).toBe('#/actions/w3');
  });

  test('the state fields: skillData +0x0C bit10-14, monsterAttackSkill +0x04 bit4-8', () => {
    const skill = HONOLULU_SKILL_DATA.fields.find((f) => f.key === 'status')!;
    const attack = HONOLULU_MONSTER_ATTACK_SKILL.fields.find((f) => f.key === 'status')!;
    const row = new Uint8Array(0x28);
    new DataView(row.buffer).setUint32(0x0c, 5 << 10, true);
    expect(readField(row, skill)).toBe(5);
    new DataView(row.buffer).setUint32(0x04, 3 << 4, true);
    expect(readField(row, attack)).toBe(3);
  });
});

describe.skipIf(!hasHonolulu)('初代の action page (ROM)', () => {
  let session: HonoluluSession;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
  });

  test('both tables but row 0: 151 antenna skills and 232 monster skills', () => {
    const actions = honoluluActions(session);
    expect(actions.filter((a) => a.kind === 's')).toHaveLength(151);
    expect(actions.filter((a) => a.kind === 'w')).toHaveLength(232);
    expect(actions.find((a) => a.kind === 'w' && a.row === 1)?.name).toBe('たいあたり');
  });

  test('the amounts of naauao monsters.md §4: ちょっとかいふく 30〜45, ぜんぶかいふく 999', () => {
    const actions = honoluluActions(session);
    expect(actions.find((a) => a.kind === 's' && a.name === 'ちょっとかいふく')).toMatchObject({ min: 30, max: 45 });
    expect(actions.find((a) => a.kind === 's' && a.name === 'ぜんぶかいふく')?.max).toBe(999);
    // skillData +0x08 is the name again
    const t = actionRows(session, 's');
    for (let r = 1; r < t.rows; r++) expect(t.get(r, 'name2')).toBe(t.get(r, 'name'));
    expect(antennaSkillName(session, 1)).toBeTruthy();
  });

  test('the users of a skill are the monsters with it in a slot', () => {
    const users = attackUsers(session);
    const used = honoluluActions(session).filter((a) => a.kind === 'w' && a.users.length);
    expect(used.length).toBeGreaterThan(0);
    for (const a of used) expect(users.get(a.row)).toEqual(a.users);
    expect(rowsWithText(session, 'w', 1, 'message')).not.toContain(1);
  });

  test('the page: the list of both tables and the entry with its users', () => {
    const html = renderToString(<HonoluluActionPage session={session} arg="w1" />);
    expect(html).toContain('たいあたり');
    expect(html).toContain('monsterAttackSkill の行 1');
    expect(html).toContain('ワザとして持つモンスター');
    const skill = renderToString(<HonoluluActionPage session={session} arg="s1" />);
    expect(skill).toContain('skillData の行 1');
    expect(skill).toContain('未解析');
  });

  test('editing the amounts, then the export; an unedited export is byte for byte the archive', async () => {
    expect(session.modFiles().size).toBe(0);
    const t = actionRows(session, 'w');
    t.set(1, 'min', 77);
    t.set(1, 'max', 88);
    session.edited();
    expect(actionChanged(session, 'w', 1)).toBe(true);
    const master = parseArchive(session.modFiles().get(HONOLULU.master)!);
    const table = new GsTable(findByName(master, 'monsterAttackSkill.bin')!.body);
    expect([readField(table.row(1), t.field('min')), readField(table.row(1), t.field('max'))]).toEqual([77, 88]);
    revertAction(session, 'w', 1);
    expect(actionChanged(session, 'w', 1)).toBe(false);
    expect(session.modFiles().size).toBe(0);
    expect(equalBytes(session.master.export(), await session.dump.readRomfs(HONOLULU.master))).toBe(true);
  });
});
