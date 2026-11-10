// One searchable, categorized part picker reusing the item/monster grid dialog.
import { useState, type ReactNode } from 'react';
import { gimmickTemplates } from '../game/templates';
import { objectCategory } from '../game/objects';
import { useAsync } from '../ui/useAsync';
import { useEditorState } from '../ui/useEditorState';
import type { GridEntry } from '../ui/GridPicker';
import { PartPhoto, PartSelection, PartPicker as CategorizedPartPicker } from './partpalette';
import { MonsterPicker } from '../ui/MonsterPicker';
import type { MapEditor } from './mapeditor';
import { stampLabel, stampObjectRow, type Stamp } from './place';

export function AddPanel({ editor }: { editor: MapEditor }): ReactNode {
  const st = editor.st;
  useEditorState(st);
  const [picking, setPicking] = useState<'parts' | 'boss' | null>(null);
  const selected = st.stamp;
  const dir = selected?.type === 'prop' ? selected.dir : 0;
  const pick = (stamp: Stamp): void => {
    st.stamp = stamp;
    st.setTool('place');
    setPicking(null);
  };
  const book = editor.session.book;
  const boss =
    selected?.type === 'boss'
      ? selected.monster
      : (book?.monsters.find((m) => m.boss)?.row ?? book?.monsters[0]?.row ?? 1);
  const events = st.currentEvents;
  const spare = events?.freeRows().length ?? 0;
  const capacity = events
    ? `イベント番号: あと ${events.roomLeft()} 個 (${events.rows} / ${events.capacity}${spare ? `、削除で空いた番号 ${spare} 個を含む` : ''})`
    : 'このダンジョンにはイベントの表がありません';
  const selectedLabel =
    selected?.type === 'boss'
      ? `ボス戦: ${book?.monster(selected.monster)?.name ?? '敵'}`
      : selected?.type === 'prop'
        ? `${objectCategory(selected.row)} #${selected.row}`
        : selected?.type === 'switchgate'
          ? selected.gate === undefined
            ? '柵を置く'
            : 'スイッチを置く'
          : selected
            ? stampLabel(selected)
            : 'パーツを選ぶ…';
  const previewRow = selected && st.current ? stampObjectRow(selected, st.current) : 0;
  return (
    <div className="add-panel compact-add-panel">
      <PartSelection
        label={selectedLabel}
        onChoose={() => setPicking('parts')}
        icon={
          previewRow ? (
            <ObjectPhoto editor={editor} row={previewRow} />
          ) : selected?.type === 'boss' ? (
            <span className="photo photo-lg stamp-badge" aria-hidden="true">
              ⚔
            </span>
          ) : undefined
        }
        help={
          capacity +
          '\nマップをクリックして配置、Esc で選択に戻ります。宝箱の中身やボス戦の敵・条件は右ペインで編集できます。ギミックは写し元の設定を引き継ぎます。'
        }
        directions={
          selected?.type === 'prop'
            ? { labels: ['↑ 北', '→ 東', '↓ 南', '← 西'], value: dir, onChange: (dir) => pick({ ...selected, dir }) }
            : undefined
        }
      />
      {picking === 'parts' && (
        <PartPicker
          editor={editor}
          dir={dir}
          onClose={() => setPicking(null)}
          onPick={pick}
          onBoss={() => setPicking('boss')}
        />
      )}
      {picking === 'boss' && book && (
        <MonsterPicker
          title="ボス戦の敵を選ぶ"
          session={editor.session}
          book={book}
          current={boss}
          onClose={() => setPicking(null)}
          onPick={(monster) => pick({ type: 'boss', monster })}
        />
      )}
    </div>
  );
}

/** Only visible thumbnails are loaded; closing/filtering a picker cancels its pending UI updates. */
function ObjectPhoto({ editor, row }: { editor: MapEditor; row: number }): ReactNode {
  return <PartPhoto source={editor.v3} part={row} partKey={String(row)} />;
}

function PartPicker({
  editor,
  dir,
  onPick,
  onBoss,
  onClose,
}: {
  editor: MapEditor;
  dir: number;
  onPick: (stamp: Stamp) => void;
  onBoss: () => void;
  onClose: () => void;
}): ReactNode {
  const st = editor.st;
  useEditorState(st);
  const dungeon = st.current?.dungeon ?? -1;
  const templates = useAsync(() => gimmickTemplates(st.game, dungeon), [st.game, dungeon]);
  const room = st.currentEvents?.roomLeft() ?? 0;
  const stamps = new Map<number, Stamp>([
    [1, { type: 'chest' }],
    [2, { type: 'floor', kind: 0 }],
    [3, { type: 'floor', kind: 1 }],
    [4, { type: 'switchgate' }],
    [6, { type: 'scene' }],
  ]);
  const badge = (label: string): ReactNode => (
    <span className="photo photo-lg stamp-badge" aria-hidden="true">
      {label}
    </span>
  );
  const categories: Record<number, string> = { 1: '基本パーツ', 20: 'ギミック', 21: '出入口・扉・穴' };
  const entries: GridEntry[] = [
    {
      id: 1,
      name: '宝箱',
      icon: <ObjectPhoto editor={editor} row={st.current ? stampObjectRow({ type: 'chest' }, st.current) : 0} />,
      category: 1,
      unavailable: room < 1 ? 'このダンジョンのイベントに空きがありません' : null,
      title: '中身は配置後に右ペインで編集できます。',
    },
    {
      id: 2,
      name: 'ダメージ床',
      icon: (
        <ObjectPhoto editor={editor} row={st.current ? stampObjectRow({ type: 'floor', kind: 0 }, st.current) : 0} />
      ),
      category: 1,
    },
    {
      id: 3,
      name: '凍った床',
      icon: (
        <ObjectPhoto editor={editor} row={st.current ? stampObjectRow({ type: 'floor', kind: 1 }, st.current) : 0} />
      ),
      category: 1,
    },
    {
      id: 4,
      name: 'スイッチと柵',
      icon: badge('⊞'),
      category: 1,
      unavailable: !st.game.switchVersion
        ? '汎用スイッチ入りの土台 MOD を読み込むと使えます'
        : room < 2
          ? 'イベントに2行の空きが必要です'
          : null,
      title: '最初に柵、次にスイッチを配置します。',
    },
    {
      id: 5,
      name: 'ボス戦',
      icon: badge('⚔'),
      category: 1,
      unavailable: !editor.session.book
        ? 'モンスターを読み込めませんでした'
        : room < 2
          ? 'イベントに2行の空きが必要です'
          : null,
      title: '敵を選んで戦闘範囲を配置。敵や戦闘条件は右ペインで編集できます。',
    },
    {
      id: 6,
      name: 'イベントを置く',
      icon: badge('▷'),
      category: 20,
      unavailable: room < 2 ? 'イベントに2行の空きが必要です' : null,
      title: '範囲に入ると演出。セリフ・話者・歩く動き・カメラなどを右ペインで設定できます。',
    },
  ];
  const selected = st.stamp;
  let current =
    selected?.type === 'chest'
      ? 1
      : selected?.type === 'floor'
        ? selected.kind === 1
          ? 3
          : 2
        : selected?.type === 'switchgate'
          ? 4
          : selected?.type === 'boss'
            ? 5
            : selected?.type === 'scene'
              ? 6
              : undefined;
  if (templates instanceof Error)
    entries.push({ id: -1, name: 'ギミックを読み込めませんでした', icon: badge('!'), unavailable: templates.message });
  else if (!templates)
    entries.push({ id: -1, name: 'ギミックを読み込み中…', icon: badge('…'), unavailable: '読み込み中' });
  else
    templates.forEach((template, index) => {
      const id = 100 + index;
      stamps.set(id, { type: 'template', t: template });
      if (selected?.type === 'template' && selected.t.key === template.key) current = id;
      entries.push({
        id,
        name: template.label,
        sub: template.source,
        category: template.section === 5 ? 20 : 21,
        title: `${template.label} — ${template.source} の設定を引き継ぎます`,
        icon: <ObjectPhoto editor={editor} row={template.objectRow} />,
        unavailable: template.event && room < 1 ? 'このダンジョンのイベントに空きがありません' : null,
      });
    });
  const categoryIds = new Map<string, number>();
  const master = st.game.master;
  for (let row = 69; row < master.mapObject.rows; row++) {
    const category = objectCategory(row);
    if (['ワールドマップ', 'NPC', '見えない', 'オブジェクト'].includes(category) || !master.objectModel(row)) continue;
    if (category === '置物') categoryIds.set(category, 20);
    if (!categoryIds.has(category)) {
      const id = 10 + categoryIds.size;
      categoryIds.set(category, id);
      categories[id] = category;
    }
    const id = 10000 + row;
    stamps.set(id, { type: 'prop', row, dir });
    if (selected?.type === 'prop' && selected.row === row) current = id;
    entries.push({
      id,
      name: category + ' #' + row,
      sub: editor.v3.objectName(row),
      category: categoryIds.get(category),
      icon: <ObjectPhoto editor={editor} row={row} />,
    });
  }
  return (
    <CategorizedPartPicker
      choices={entries.map((entry) => ({
        ...entry,
        key: String(entry.id),
        category: categories[entry.category ?? 0] ?? '読み込み状況',
      }))}
      current={current === undefined ? undefined : String(current)}
      onClose={onClose}
      onPick={(key) => {
        const id = Number(key);
        if (id === 5) onBoss();
        else {
          const stamp = stamps.get(id);
          if (stamp) onPick(stamp);
        }
      }}
    />
  );
}
