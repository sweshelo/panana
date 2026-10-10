// 電波人間のRPG FREE! (lanai) codes and deliveries (naauao lanai/codes.md, lanai/checkin.md §5). The code itself needs no
// ROM; the tables need the Base and Update CIAs (test/env.ts LANAI_BASE / LANAI_UPDATE) and are skipped without them.
import { beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  CHECKIN_ARCHIVE, CHECKIN_TABLES, CODE_TABLE, codeVerdict, decodeCode, encodeCode, OFFLINE_SWITCH, rewardLabel, rewardRows, rowCode, sha256,
} from '../src/lanai/codes';
import { LanaiCodePage } from '../src/lanai/CodePage';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const SERVICE_END = 'A4J8Y13ML7TAWWE1';

describe('lanai codes (no ROM)', () => {
  test('sha256 matches node:crypto', () => {
    for (const s of ['', 'abc', 'x'.repeat(119)]) {
      const hex = Buffer.from(sha256(new TextEncoder().encode(s))).toString('hex');
      expect(hex).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });

  test(`${SERVICE_END} is kind 0, version 1.17.0, row 49`, () => {
    const c = decodeCode(SERVICE_END.toLowerCase());
    expect(Buffer.from(c.bytes).toString('hex')).toBe('110000fd043100000000');
    expect(c.checkOk).toBe(true);
    expect(c.kind).toBe(0);
    expect(c.version).toEqual([1, 17, 0]);
    expect(c.payload).toBe(49);
    expect(c.extra).toBe(0);
    expect(codeVerdict(c, 50)).toMatchObject({ ok: true, row: 49 });
    expect(codeVerdict(c, 49).ok).toBe(false);
  });

  test('encode round trips (lanaicode.py enc gives the same codes)', () => {
    expect(encodeCode(0, 49, 0, [1, 17, 0])).toBe(SERVICE_END);
    expect(rowCode(50)).toBe('GBCMMRRFX5QTK46F');
    expect(encodeCode(2, 0x12345678, 0x9a, [3, 5, 77])).toBe('R2G72V9DXHT4A9JC');
    const c = decodeCode('R2G72V9DXHT4A9JC');
    expect(c).toMatchObject({ kind: 2, version: [3, 5, 77], payload: 0x12345678, extra: 0x9a, checkOk: true });
  });

  test('bad codes are told apart', () => {
    expect(() => decodeCode('A4J8Y13ML7TAWWE')).toThrow('16 文字');
    expect(() => decodeCode('A4J8Y13ML7TAWWE!')).toThrow('使えない文字');
    expect(() => decodeCode('A4J8Y13ML7TAWWEI')).toThrow('CampaignCharacter');
    // one character changed: the check no longer matches
    expect(decodeCode('A4J8Y13ML7TAWWE2').checkOk).toBe(false);
    expect(codeVerdict(decodeCode(encodeCode(0, 1, 0, [1, 18, 0])), 50).ok).toBe(false);
    expect(codeVerdict(decodeCode(encodeCode(1, 0)), 50).text).toContain('有効期限');
  });
});

describe.skipIf(!hasLanai)('lanai codes (ROM)', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as { name?: string }).name ?? '');
    session = await LanaiSession.open(dump);
  });

  test('CampaignCodeLocal row 49 turns the service-end switch on', () => {
    const t = session.need(CODE_TABLE);
    expect(t.rows).toBe(50);
    expect(t.rowSize).toBe(0x58);
    const rows = rewardRows(session, t);
    const r = rows[49]!;
    expect(r).toMatchObject({ reward: 0x08, value: OFFLINE_SWITCH, count: 1, group: 0xffff, failMessage: '' });
    expect(r.message).toContain('ジュエル販売所は終了しました。');
    expect(rewardLabel(session, r)).toContain('サービス終了モード');
    // an item reward names the item
    expect(rows[2]).toMatchObject({ reward: 0x02, value: 0x80000234, count: 1 });
    expect(rewardLabel(session, rows[2]!)).toContain('ノビノビタケノコ');
  });

  test('the checkin tables of A9DF0000 have the same row shape', async () => {
    const tables = await session.tablesIn(CHECKIN_ARCHIVE);
    const rowsOf = Object.fromEntries(tables.map((r) => [r.table.name, r.table.rows]));
    expect(CHECKIN_TABLES.map((n) => rowsOf[n])).toEqual([89, 241, 64, 122, 122, 19, 19]);
    const rom = tables.find((r) => r.table.name === 'Checkin_Rom')!.table;
    const r = rewardRows(session, rom)[0]!;
    expect(r).toMatchObject({ kind: 0x80000008, reward: 0x1b, group: 0xffff });
    expect(r.conditions[0]).toEqual({ a: 0, b: 3, kind: 0x39 });
    expect(r.message).toContain('水曜日');
    expect(r.failMessage).toBeUndefined();
  });

  test('the page renders the code, its row and the list', () => {
    const html = renderToString(createElement(LanaiCodePage, { session, arg: SERVICE_END }));
    expect(html).toContain('コード・配信');
    expect(html).toContain('ジュエル販売所は終了しました。');
    expect(html).toContain('0x2A4');
    expect(html).toContain('CampaignCodeLocal 行 49');
    expect(html).toContain(SERVICE_END);
    const list = renderToString(createElement(LanaiCodePage, { session, arg: `${CODE_TABLE}.2` }));
    expect(list).toContain('ノビノビタケノコ');
  });
});
