// React pages, rendered to a string (no DOM needed).
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { decodeAction, type Action, type ActionRefs } from '../src/game/actions';
import { EditorState } from '../src/editor/state';
import type { Game } from '../src/game/game';
import { ActionView } from '../src/pages/actions';
import { Radar } from '../src/ui/Radar';
import { MessageEditor, MessagePreview } from '../src/ui/message';
import type { MessageStore } from '../src/game/gmsg';
import { KAHARA_SYNTAX, textToUnits } from '../src/game/msgtext';
import { w32 } from '../src/util/bytes';
import { WorldPage } from '../src/pages/world';
import { PAGES } from '../src/ui/Shell';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../src/session';
import { MapPicker } from '../src/ui/MapPicker';
import { ItemPicker } from '../src/ui/ItemPicker';
import type { ItemBook, Item } from '../src/game/items';
import { TreasureEditor } from '../src/editor/treasure';
import type { MapInfo } from '../src/game/codebin';
import type { EventTable } from '../src/game/events';
import type { MonsterBook, MonsterGroup } from '../src/game/monsters';
import { GroupDetail, GroupList, GroupPicker } from '../src/ui/GroupDetail';
import { SoundNames, soundUses } from '../src/game/sound';
import { SoundPicker } from '../src/ui/SoundPicker';
import { MapUses, SoundView } from '../src/pages/sounds';

function action(row: number, w0: number, name: string): Action {
  const raw = new Uint8Array(0x3c);
  w32(raw, 0, w0);
  raw.set([40, 0, 30, 0], 0x18);
  return { ...decodeAction(raw), row, name, raw };
}

describe('action page', () => {
  const actions = [action(0, 1 << 1, 'たいあたり'), action(1, ((2 << 1) | (1 << 29)) >>> 0, 'やくそう')];
  const refs: Record<number, ActionRefs> = { 1: { items: [{ id: 7, name: 'やくそう' }], monsters: [] } };
  const book = { actions, action: (r: number) => actions[r], refsOf: (r: number) => refs[r] ?? { items: [], monsters: [] } };

  test('list shows item actions by default, detail shows fields, refs and all the fields of the row', () => {
    const html = renderToString(<ActionView book={book} selected={1} />);
    expect(html).toContain('1 / 2 件');
    expect(html).toContain('<tr class="active">');
    expect(html).toContain('効果: HP 回復 30〜40 (戦闘)');
    expect(html).toContain('href="#/items/7"');
    expect(html).toContain('量 (最小)');
    expect(html).toContain('actionData の行 1 のすべての欄');
    expect(html).not.toContain('たいあたり');
  });

  test('the page puts the editor under the effect', () => {
    const html = renderToString(<ActionView book={book} selected={1} editor={(a) => <div className="x-edit">{`edit ${a.row}`}</div>} />);
    expect(html).toContain('<div class="x-edit">edit 1</div>');
  });
});

describe('editor state', () => {
  test('on() returns an unsubscribe, emit() bumps the revision', () => {
    const st = new EditorState({} as Game);
    const seen: string[] = [];
    const off = st.on((w) => seen.push(w));
    st.emit('doc');
    off();
    st.emit('tool');
    expect(seen).toEqual(['doc']);
    expect(st.revision).toBe(2);
  });
});

describe('shared pieces', () => {
  test('message preview: ruby, page break (eats its line break), referenced message', () => {
    const texts = { syntax: KAHARA_SYNTAX, units: (id: number) => (id === 0x66 ? textToUnits({ kind: 1, text: 'デンパタウン', tail: new Uint16Array([0]) }) : undefined) } as unknown as MessageStore;
    const units = textToUnits({ kind: 1, text: 'ここ、{msg:0066}。{page}\n{ruby:祠|ほこら}', tail: new Uint16Array([0]) });
    const html = renderToString(<MessagePreview texts={texts} units={units} />);
    expect(html).toContain('<ruby>祠<rp>(</rp><rt>ほこら</rt><rp>)</rp></ruby>');
    expect(html).toContain('href="#/messages/0x0066"');
    expect(html).toContain('デンパタウン');
    expect(html).toContain('▼');
    expect(html).not.toContain('<br/>');
  });

  test('message editor: the preview until clicked, no text box (#48)', () => {
    const units = textToUnits({ kind: 1, text: '{ruby:祠|ほこら}へ', tail: new Uint16Array([0]) });
    const texts = {
      syntax: KAHARA_SYNTAX, units: () => units, file: () => ({ name: 'MessageField_JP.gsmb', editable: true }),
      text: () => ({ kind: 1, text: '{ruby:祠|ほこら}へ', tail: new Uint16Array([0]) }), isEdited: () => false,
    } as unknown as MessageStore;
    const html = renderToString(<MessageEditor texts={texts} id={0x40} apply={() => {}} />);
    expect(html).toContain('msg-preview-closed');
    expect(html).toContain('<rt>ほこら</rt>');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('{ruby:');
  });

  test('radar: one handle per axis, edited ones marked, original outline only when changed', () => {
    const props = { min: -9, max: 10, rings: [-9, 0, 10], format: String, onChange: () => {} };
    const same = renderToString(<Radar {...props} axes={[{ label: 'A', value: 0, original: 0 }, { label: 'B', value: 1, original: 1 }, { label: 'C', value: 2, original: 2 }]} />);
    expect(same.match(/class="handle"/g)?.length).toBe(3);
    expect(same).not.toContain('shape original');
    const edited = renderToString(<Radar {...props} axes={[{ label: 'A', value: 5, original: 0 }, { label: 'B', value: 1, original: 1 }, { label: 'C', value: 2, original: 2 }]} />);
    expect(edited).toContain('handle edited');
    expect(edited).toContain('shape original');
  });
});

describe('world map page', () => {
  test('entrance list, fields and the lead-back note', () => {
    const W = 0xa8654391;
    const D = 0x98ec3fef;
    const ent = new Uint8Array(0x24);
    w32(ent, 4, 0x11);
    w32(ent, 8, D);
    w32(ent, 0x0c, 0x22);
    ent[0x1c] = 10;
    ent[0x1e] = 20;
    const p3 = new Uint8Array(28);
    w32(p3, 0, 0x22);
    w32(p3, 4, W);
    w32(p3, 8, 0x11);
    const info = { hash: D, name: 'D01B02001', dungeon: 1, dungeonCode: 'D01', floor: -2, mapDataKey: 0, sections: [D] };
    const world = { index: 0, hash: W, code: 'W01', dungeon: 0x34, sections: [0, 0, 2, 3, 0, 0, 0, 0], groundFile: 'W01_ground.bin', groundEntry: 0 };
    const game = {
      worldMaps: () => [world],
      editableMaps: () => [info],
      ground: () => null,
      code: { maps: [info], byHash: (h: number) => (h === D ? info : undefined), world: (h: number) => (h === W ? world : undefined) },
      db: { get: () => new Uint8Array(0) },
      master: { dungeonName: () => '山のどうくつ', mapObject: { rows: 300 }, message: () => undefined, mapGroup: { rows: 60 } },
    } as unknown as Game;
    const doc = { hash: D, recs: { 3: [{ raw: p3, x: 3, y: 4 }] } };
    const session = {
      game,
      st: { docs: new Map() },
      docOf: () => doc,
      entrancesOf: () => [ent],
      originalEntrances: () => [ent],
      changedWorlds: () => [],
    } as unknown as Session;
    const html = renderToString(<WorldPage session={session} arg="W01" visit={1} />);
    expect(html).toContain('1 / 1 入口');
    expect(html).toContain('入口 00000011');
    expect(html).toContain('10, 20');
    expect(html).toContain('ワールドマップ W01');
    expect(html).toContain('この入口に戻ります');
    expect(html).toContain('<canvas');
  });
});

describe('shell', () => {
  test('every page has a CSS rule that shows it', () => {
    const css = readFileSync(join(import.meta.dir, '..', 'src', 'style.css'), 'utf8');
    for (const [id] of PAGES) expect(css).toContain(`.shell[data-page='${id}'] .page-${id}`);
  });
});

describe('map editor pickers', () => {
  const D1 = { hash: 0x10, name: 'D01B01001', dungeon: 1, dungeonCode: 'D01', floor: -1, mapDataKey: 0, sections: [] };
  const D2 = { hash: 0x20, name: 'D01B02001', dungeon: 1, dungeonCode: 'D01', floor: -2, mapDataKey: 0, sections: [] };
  const world = { index: 0, hash: 0xa8654391, code: 'W01', dungeon: 0x34, sections: [], groundFile: '', groundEntry: 0 };
  const game = {
    editableMaps: () => [D1, D2],
    worldMaps: () => [world],
    code: { maps: [D1, D2], byHash: (h: number) => [D1, D2].find((m) => m.hash === h), world: (h: number) => (h === world.hash ? world : undefined) },
    master: { dungeonName: () => '山のどうくつ', itemName: (id: number) => ['', 'やくそう', 'ポーション'][id] ?? '' },
  } as unknown as Game;

  test('map picker: maps grouped by dungeon, the current one and edited ones marked, none and world maps on request', () => {
    const html = renderToString(<MapPicker game={game} current={0x20} withNone worlds modified={new Set([0x10])} onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain('山のどうくつ  (D01)');
    expect(html).toContain('D01B01001');
    expect(html).toContain('class="pick current"');
    expect(html.match(/edited-mark/g)?.length).toBe(1);
    expect(html).toContain('(なし)');
    expect(html).toContain('ワールドマップ W01');
    const plain = renderToString(<MapPicker game={game} current={0x10} onPick={() => {}} onClose={() => {}} />);
    expect(plain).not.toContain('(なし)');
    expect(plain).not.toContain('ワールドマップ');
  });

  const item = (id: number, name: string, price: number): Item => ({ id, name, price, categoryByte: 1, category: '道具', model: 0 }) as unknown as Item;
  const items = { items: [item(1, 'やくそう', 8), item(2, 'ポーション', 20)], item: (id: number) => [item(1, 'やくそう', 8), item(2, 'ポーション', 20)][id - 1] } as unknown as ItemBook;

  test('item picker: photos of every item, unavailable ones disabled with the reason', () => {
    const html = renderToString(<ItemPicker game={game} items={items} current={2} unavailable={(it) => (it.id === 1 ? 'この店で売っています' : null)} onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain('やくそう');
    expect(html).toContain('title="この店で売っています"');
    expect(html).toContain('monster-cell current');
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  test('chest contents: filled slots with their share, the row and how many chests share it', () => {
    const slots = [{ item: 1, weight: 3 }, { item: 2, weight: 1 }, ...Array.from({ length: 8 }, () => ({ item: 0, weight: 1 }))];
    const master = { ...(game.master as object), treasureGroup: { rows: 5 }, treasureSlots: () => slots, treasureRowChanged: () => false };
    const ev = { rows: 3, kind: (i: number) => (i < 2 ? 0x0c : 0), treasureRow: () => 4 } as unknown as EventTable;
    const session = {
      game: { ...game, master },
      st: { game: { master }, events: new Map([[1, ev]]) },
      items: () => new Promise(() => {}),
    } as unknown as Session;
    const html = renderToString(<TreasureEditor session={session} ev={ev} evRow={0} apply={(f) => f()} />);
    expect(html).toContain('中身の表 #4');
    expect(html).toContain('2 個の宝箱で共有');
    expect(html).toContain('やくそう');
    expect(html).toContain('75%');
    expect(html).toContain('25%');
    expect(html).toContain('＋ 追加');
  });
});

describe('monster editors', () => {
  const { SkillEditor, BossEditor } = require('../src/pages/monsteredit') as typeof import('../src/pages/monsteredit');
  const { ActionPicker } = require('../src/ui/ActionPicker') as typeof import('../src/ui/ActionPicker');
  // 1 = attack, 2 = a line turning the user into row 3
  const actions = [action(0, 0, ''), action(1, 1 << 1, 'かみつき'), action(2, ((3 << 1) | (5 << 3)) >>> 0, 'ビームモード')];
  actions[2]!.formChange = 3;
  const monster = (row: number, name: string, skills: number[], extra: object = {}) =>
    ({ row, name, skills: skills.map((a) => ({ action: a, name: actions[a]!.name })), aiMode: 0, boss: 0, nextForm: 0, line: '', ...extra }) as never;
  const ms = [monster(1, 'ポーン', [1, 1, 1, 2], { boss: 7, nextForm: 2 }), monster(2, 'ポーン', [1]), monster(3, 'ポーン', [])];
  const fields: Record<string, number> = { boss: 7, nextForm: 2 };
  const book = {
    monsters: ms,
    monster: (r: number) => ms[r - 1],
    conditions: ['', 'どく'],
    get: (_r: number, k: string) => fields[k] ?? 0,
    original: (_r: number, k: string) => (k === 'nextForm' ? 0 : fields[k] ?? 0),
    originalSkills: () => [1, 1, 1, 2],
    modelOf: () => null,
    lineSharers: () => [],
  } as never;
  const lineSession = { game: { master: { texts: { text: () => undefined, canAdd: () => true } } } } as unknown as Session;
  const actionBook = {
    actions,
    action: (r: number) => actions[r],
    motion: (r: number) => (r === 1 ? 0x45 : 0),
    refsOf: (r: number) => ({ items: [], monsters: r === 1 ? [{ row: 1, name: 'ポーン' }] : [] }),
  } as never;

  test('skills: duplicate slots add up under AI mode 0, a form-changing skill says where it goes', () => {
    const html = renderToString(<SkillEditor session={{} as Session} book={book} m={ms[0]!} edited={() => {}} actions={actionBook} />);
    expect(html.match(/75%/g)?.length).toBe(3);
    expect(html).toContain('25%');
    expect(html).toContain('→ #3 に変身');
    expect(html).toContain('ワザ A (005_)');
    // every skill is a name board with its "#ID" link, and the add button is a board in the same column
    expect(html.match(/class="board-id" href="#\/actions\/1"/g)?.length).toBe(3);
    expect(html).toContain('＋ ワザを追加');
    expect(html).toContain('draggable="true"');
    expect(html.match(/このワザを編集/g)?.length).toBe(4);
  });

  test('boss: condition, next form marked as edited, and the forms turning into this one', () => {
    const html = renderToString(<BossEditor session={lineSession} book={book} m={ms[1]!} edited={() => {}} actions={actionBook} />);
    expect(html).toContain('ポーン #1');
    expect(html).toContain('水の攻撃が当たったとき');
    const first = renderToString(<BossEditor session={lineSession} book={book} m={ms[0]!} edited={() => {}} actions={actionBook} />);
    // no line (+0x38): a button makes one
    expect(first).toContain('セリフを作る');
    expect(first).toContain('class="board edited"');
    expect(first).toContain('href="#/monsters/2"');
    expect(first).toContain('ワザ「ビームモード」で ');
  });

  test('action picker: monster skills by default', () => {
    const html = renderToString(<ActionPicker actions={actionBook} current={1} onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain('かみつき');
    expect(html).not.toContain('ビームモード');
  });
});

describe('encounter groups', () => {
  const monsters = [{ row: 0, name: 'スライム', level: 1 }, { row: 1, name: 'ドラキー', level: 3 }];
  const g = (row: number, hash: number, leads: number[], mates: number[]): MonsterGroup =>
    ({ row, hash, leads: leads.map((m) => ({ monster: m, weight: 1, count: 0 })), mates: mates.map((m) => ({ monster: m, weight: 1, count: 1 })), extra: [] }) as unknown as MonsterGroup;
  const groups = [g(0, 0, [0], []), g(1, 0x11, [0, 1], [1]), g(2, 0x22, [], [])];
  const book = {
    groups,
    group: (h: number) => groups.find((x) => x.hash === h),
    groupMonsters: (x: MonsterGroup) => [...new Set([...x.leads, ...x.mates].map((s) => s.monster))],
    groupChanged: (r: number) => r === 2,
    monster: (r: number) => monsters[r],
    modelOf: () => null,
  } as unknown as MonsterBook;
  const game = { editableMaps: () => [] } as unknown as Game;

  test('detail: a tile per candidate with its photo, share and count', () => {
    const html = renderToString(<GroupDetail game={game} book={book} group={groups[1]!} />);
    expect(html.match(/class="group-tile"/g)?.length).toBe(3);
    expect(html.match(/class="photo"/g)?.length).toBe(3);
    expect(html).toContain('href="#/monsters/1"');
    expect(html).toContain('50% ×');
    expect(html).toContain('群れ #1 を開く');
  });

  test('picker: the group list with photos, only groups with a hash, and none', () => {
    const session = { game, docOf: () => null } as unknown as Session;
    const html = renderToString(<GroupPicker session={session} book={book} current={0x11} onPick={() => {}} onClose={() => {}} />);
    expect(html).toContain('群れを選ぶ');
    expect(html).toContain('(なし: 敵が出ない)');
    expect(html).toContain('2 / 2 件');
    expect(html).toContain('<tr class="active"><td class="num muted">1</td>');
    expect(html).toContain('(敵なし)');
    expect(html.match(/edited-mark/g)?.length).toBe(1);
    const list = renderToString(<GroupList game={game} book={book} uses={new Map()} selected={0} onSelect={() => {}} />);
    expect(list).toContain('3 / 3 件');
    expect(list).not.toContain('(なし: 敵が出ない)');
  });
});

describe('sounds', () => {
  // soundData rows 0-3 and 300 (past what a mapData byte holds); sound indices 0 BGM_TITLE, 1 BGM_CAVE, 2 SE_FLD_STEPS1.
  const items = Array.from({ length: 301 }, (_, i) => (i === 1 ? 0x01000000 : i === 2 ? 0x01000001 : i === 3 || i === 300 ? 0x01000002 : 0));
  const sounds = new SoundNames(items, ['BGM_TITLE', 'BGM_CAVE', 'SE_FLD_STEPS1'], items.map(() => 100));
  const mapData = [new Uint8Array([0, 0, 0, 0, 2, 1, 3]), new Uint8Array([1, 0, 0, 0, 2, 0, 3])];
  const game = { master: { mapData: { rows: mapData.length, row: (r: number) => mapData[r] } } } as unknown as Game;

  test('names, kinds and labels of soundData rows', () => {
    expect(sounds.name(2)).toBe('BGM_CAVE');
    expect(sounds.kind(2)).toBe('bgm');
    expect(sounds.kind(3)).toBe('se');
    expect(sounds.label(3)).toBe('SE_FLD_STEPS1 (3)');
    expect(sounds.label(0)).toBe('なし');
    expect(sounds.index(2)).toBe(1);
    expect(sounds.index(0)).toBeNull();
    expect(sounds.index(4)).toBeNull();
    // Without sound.bcsar: rows 1-34 are BGM.
    const bare = new SoundNames(items, null);
    expect(bare.kind(5)).toBe('bgm');
    expect(bare.kind(40)).toBe('other');
  });

  test('uses: the mapData rows and slots that pick each sound', () => {
    const uses = soundUses(game);
    expect(uses.get(2)).toEqual([{ mapDataRow: 0, slot: 'bgm' }, { mapDataRow: 1, slot: 'bgm' }]);
    expect(uses.get(1)).toEqual([{ mapDataRow: 0, slot: 'battle' }]);
    expect(uses.get(3)?.map((u) => u.slot)).toEqual(['steps', 'steps']);
  });

  test('picker: filtered by kind, the current row marked, rows past the byte greyed out', () => {
    const bgm = renderToString(<SoundPicker game={game} sounds={sounds} current={2} kind="bgm" max={255} onPick={() => {}} onClose={() => {}} />);
    expect(bgm).toContain('BGM_CAVE');
    expect(bgm).not.toContain('SE_FLD_STEPS1');
    expect(bgm).toContain('sound-cell current');
    expect(bgm).toContain('(なし)');
    // Each sound has a play button (row 0 = none has not).
    expect(bgm.match(/class="play-button"/g)?.length).toBe(2);
    const se = renderToString(<SoundPicker game={game} sounds={sounds} current={3} kind="se" max={255} usage={(r) => (r === 3 ? 'マップ 2 個' : '')} onPick={() => {}} onClose={() => {}} />);
    expect(se).toContain('マップ 2 個');
    expect(se).toContain('マップの設定には行 255 までしか入りません');
  });

  test('list page: every row, the detail with the maps that use it', () => {
    const map = { hash: 0x10, name: 'D01B01001', dungeon: 1, dungeonCode: 'D01', floor: -1, mapDataKey: 0, sections: [] } as unknown as MapInfo;
    const html = renderToString(
      <SoundView game={game} sounds={sounds} selected={2} href={(r) => `#/sounds/${r}`} uses={(r) => soundUses(game).get(r)?.length ?? 0} usesTitle="" usedLabel="マップで使う">
        <MapUses use={soundUses(game).get(2) ?? []} users={new Map([[0, [map]]])} mapTitle={() => '山のどうくつ B1'} />
      </SoundView>,
    );
    expect(html).toContain('300 / 300 件');
    expect(html).toContain('0x01000001');
    expect(html).toContain('play-button large');
    expect(html).toContain('sound.bcsar の音 1');
    expect(html).toContain('使っているマップの設定 (2)');
    expect(html).toContain('href="#/map/D01B01001"');
    expect(html).toContain('(読めるマップにはなし)');
  });
});
