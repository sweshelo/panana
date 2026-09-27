// "追加" panel: pick what the place tool adds (chest, prop, floor gimmick, copy of an existing gimmick).
import { useEffect, useState, type ReactNode } from 'react';
import { gimmickTemplates } from '../game/templates';
import { objectCategory } from '../game/objects';
import { useAsync } from '../ui/useAsync';
import { useEditorState } from '../ui/useEditorState';
import type { MapEditor } from './mapeditor';
import { stampLabel, type Stamp } from './place';
import { MonsterPicker } from '../pages/groups';

interface GroupItem {
  row: number;
  label: string;
  title: string;
  active: boolean;
  pick: () => void;
}

export function AddPanel({ editor }: { editor: MapEditor }): ReactNode {
  const st = editor.st;
  useEditorState(st);
  /** Direction of new props. */
  const [dir, setDir] = useState(0);
  const dungeon = st.current?.dungeon ?? -1;
  const templates = useAsync(() => gimmickTemplates(st.game, dungeon), [st.game, dungeon]);
  const use = (stamp: Stamp): void => {
    st.stamp = stamp;
    st.setTool('place');
  };
  const ev = st.currentEvents;
  const room = ev ? ev.roomLeft() : 0;
  const active = st.tool === 'place' && st.stamp ? st.stamp : null;

  // props: mapObject rows of placeable objects, grouped by category
  const master = st.game.master;
  const cats = new Map<string, number[]>();
  for (let row = 69; row < master.mapObject.rows; row++) {
    const cat = objectCategory(row);
    if (['ワールドマップ', 'NPC', '見えない', 'オブジェクト'].includes(cat) || !master.objectModel(row)) continue;
    cats.set(cat, [...(cats.get(cat) ?? []), row]);
  }
  const name = (row: number): string => editor.v3.objectName(row);
  const list = templates && !(templates instanceof Error) ? templates : null;
  return (
    <div className="add-panel">
      <h3>追加</h3>
      <div className="muted small">{ev ? `イベントの行: あと ${room} 行 (${ev.rows} / ${ev.capacity})` : 'このダンジョンにはイベントの表がありません'}</div>
      <div className="row">
        <button className={active?.type === 'chest' ? 'active' : ''} disabled={room < 1} onClick={() => use({ type: 'chest' })}>宝箱</button>
        <button className={active?.type === 'floor' && active.kind === 0 ? 'active' : ''} onClick={() => use({ type: 'floor', kind: 0 })}>ダメージ床</button>
        <button className={active?.type === 'floor' && active.kind === 1 ? 'active' : ''} onClick={() => use({ type: 'floor', kind: 1 })}>凍った床</button>
      </div>
      <h4>置物</h4>
      <div className="row">
        <span className="muted small">向き</span>
        {['↑', '→', '↓', '←'].map((l, i) => (
          <button key={i} className={dir === i ? 'active' : ''} title={`${i * 90}°`} onClick={() => {
            setDir(i);
            if (active?.type === 'prop') use({ ...active, dir: i });
          }}>{l}</button>
        ))}
      </div>
      {[...cats].map(([cat, rows]) => (
        <ObjectGroup key={`prop/${cat}`} editor={editor} label={`${cat} (${rows.length})`} rows={rows}
          items={rows.map((row) => ({
            row,
            label: `#${row}`,
            title: `mapObject #${row} ${name(row)}`,
            active: active?.type === 'prop' && active.row === row,
            pick: () => use({ type: 'prop', row, dir }),
          }))} />
      ))}
      <h4>ギミック (ゲーム中のものの写し)</h4>
      {list
        ? ([[5, 'ギミック (区画 5)'], [3, '出入口・扉・穴 (区画 3)']] as const).map(([section, label]) => {
            const ts = list.filter((t) => t.section === section);
            return (
              <ObjectGroup key={`tmpl/${dungeon}/${section}`} editor={editor} label={`${label} (${ts.length})`} rows={ts.map((t) => t.objectRow).filter((r) => r)}
                items={ts.map((t) => ({
                  row: t.objectRow,
                  label: t.label,
                  title: `${t.label} — ${t.source}`,
                  active: active?.type === 'template' && active.t === t,
                  pick: () => use({ type: 'template', t }),
                }))} />
            );
          })
        : <div className="muted small">ギミックを読み込み中…</div>}
      {st.game.switchVersion
        ? (
          <div className="row">
            <button className={active?.type === 'switchgate' ? 'active' : ''} disabled={room < 2} onClick={() => use({ type: 'switchgate' })}>スイッチと柵</button>
            <span className="muted small">踏むと柵が開く (汎用スイッチ)</span>
          </div>
        )
        : <div className="muted small">スイッチと柵: ヘッダーの「土台の MOD」で汎用スイッチ入りの MOD (elpulse の mod/out) を読み込むと使えます。</div>}
      <h4>ボス戦</h4>
      <BossStamp editor={editor} active={active?.type === 'boss'} disabled={room < 1} use={use} />
      {active && <div className="place-hint">{`置くもの: ${stampLabel(active)}。マップをクリックして置く (Esc で終わる)`}</div>}
      <p className="muted small">
        宝箱とギミックには新しいイベントの行 (状態を保存する枠つき) を作ります。宝箱の中身は新しい行 (最初は同じダンジョンの宝箱の中身の写し) で、右ペインで編集できます。ギミックはゲーム中の同じ種類のものを写すので、動き (つながる扉・行き先など) は写し元の設定のままです。
      </p>
    </div>
  );
}

/** The boss battle stamp: the monster to fight (it can be changed and more added in the inspector). */
function BossStamp({ editor, active, disabled, use }: { editor: MapEditor; active: boolean; disabled: boolean; use: (s: Stamp) => void }): ReactNode {
  const book = editor.session.book;
  const [monster, setMonster] = useState(() => book?.monsters.find((m) => m.boss)?.row ?? book?.monsters[0]?.row ?? 1);
  const [picking, setPicking] = useState(false);
  const current = book?.monster(monster);
  return (
    <>
      <div className="row">
        <button disabled={!book} title="戦う敵を選ぶ" onClick={() => setPicking(true)}>
          {current ? `${current.name} Lv${current.level}` : `#${monster}`}
        </button>
        <button className={active ? 'active' : ''} disabled={disabled} onClick={() => use({ type: 'boss', monster })}>ボス戦を置く</button>
      </div>
      <div className="muted small">
        イベントの範囲 (区画 8) に入ると、メッセージのあと決まった敵と戦います。一度きり・何度でも・勝つたびに強くなる (段階) を右ペインで選べます。
        書き出すと、そのためのコードのパッチ「ボス戦」も code.ips に入ります。
      </div>
      {picking && book && (
        <MonsterPicker session={editor.session} book={book} current={monster} onClose={() => setPicking(false)} onPick={(m) => {
          setPicking(false);
          setMonster(m);
          if (active) use({ type: 'boss', monster: m });
        }} />
      )}
    </>
  );
}

/** A collapsible grid of thumbnails; the models are loaded and the thumbnails rendered when it is first opened. */
function ObjectGroup({ editor, label, rows, items }: { editor: MapEditor; label: string; rows: number[]; items: GroupItem[] }): ReactNode {
  const [open, setOpen] = useState(() => items.some((i) => i.active));
  const [thumbs, setThumbs] = useState(new Map<number, string | null>());
  /** Bumped when the models are loaded (the titles name them). */
  const [, setLoaded] = useState(false);
  const isActive = items.some((i) => i.active);
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const v3 = editor.v3;
    v3.loadObjects(rows).then(() => {
      if (!live) return;
      setLoaded(true);
      for (const row of new Set(rows))
        v3.objectThumb(row).then((url) => live && setThumbs((m) => new Map(m).set(row, url)));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per opening; the rows of a group do not change
  }, [open, editor]);
  return (
    <details className="obj-group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      {open && (
        <div className="pal-items obj-items">
          {items.map((it, i) => {
            const url = it.row ? thumbs.get(it.row) : null;
            return (
              <button key={i} className={'pal-item obj-item' + (it.active ? ' active' : '')} title={it.title} onClick={it.pick}>
                {url ? <img src={url} alt="" /> : <div className="pal-swatch" />}
                <span className="pal-label">{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </details>
  );
}
