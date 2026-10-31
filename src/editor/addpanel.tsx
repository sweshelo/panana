// One searchable, categorized part picker reusing the item/monster grid dialog.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gimmickTemplates } from '../game/templates';
import { objectCategory } from '../game/objects';
import { useAsync } from '../ui/useAsync';
import { useEditorState } from '../ui/useEditorState';
import { GridPicker, type GridEntry } from '../ui/GridPicker';
import { InfoTip } from '../ui/InfoTip';
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
  const boss = selected?.type === 'boss' ? selected.monster : book?.monsters.find(m => m.boss)?.row ?? book?.monsters[0]?.row ?? 1;
  const events = st.currentEvents;
  const capacity = events ? `イベントの行: あと ${events.roomLeft()} 行 (${events.rows} / ${events.capacity})` : 'このダンジョンにはイベントの表がありません';
  const selectedLabel = selected?.type === 'boss' ? `ボス戦: ${book?.monster(selected.monster)?.name ?? '敵'}`
    : selected?.type === 'prop' ? `${objectCategory(selected.row)} #${selected.row}`
    : selected?.type === 'switchgate' ? selected.gate === undefined ? '柵を置く' : 'スイッチを置く'
    : selected ? stampLabel(selected) : 'パーツを選ぶ…';
  const previewRow = selected && st.current ? stampObjectRow(selected,st.current) : 0;
  return <div className="add-panel compact-add-panel">
    <div className="selected-part">
      <button className="selected-part-pick" onClick={() => setPicking('parts')} aria-haspopup="dialog"
        title={selected ? `${stampLabel(selected)}。クリックして選び直す` : '置き物・宝箱・床・ギミック・ボス戦を選ぶ'}>
        {previewRow ? <ObjectPhoto editor={editor} row={previewRow} /> : <span className="photo photo-lg stamp-badge" aria-hidden="true">{selected?.type === 'boss' ? '⚔' : selected ? '＋' : '◇'}</span>}
        <span className="selected-part-label">{selectedLabel}</span><span aria-hidden="true">▾</span>
      </button>
      <InfoTip text={`${capacity}\nパーツを選んだ後は、マップをクリックして配置。Esc で選択に戻ります。宝箱の中身やボス戦の敵・条件は配置後に右ペインで編集できます。ギミックは写し元の行き先などの設定を引き継ぎます。`} />
    </div>
    {selected?.type === 'prop' && <div className="part-directions" role="group" aria-label="置き物の向き">
      {['↑','→','↓','←'].map((arrow,i) => <button key={i} aria-label={`向き ${i*90}°`} aria-pressed={dir===i} className={dir===i?'active':''}
        title={`向き ${i*90}°`} onClick={() => pick({...selected,dir:i})}>{arrow}</button>)}
    </div>}
    {picking === 'parts' && <PartPicker editor={editor} dir={dir} onClose={() => setPicking(null)} onPick={pick} onBoss={() => setPicking('boss')} />}
    {picking === 'boss' && book && <MonsterPicker title="ボス戦の敵を選ぶ" session={editor.session} book={book} current={boss} onClose={() => setPicking(null)} onPick={monster => pick({type:'boss',monster})} />}
  </div>;
}

/** Only visible thumbnails are loaded; closing/filtering a picker cancels its pending UI updates. */
function ObjectPhoto({ editor, row }: { editor: MapEditor; row: number }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [url,setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!row) return;
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      editor.v3.objectThumb(row).then(image => { if (live) setUrl(image); }).catch(() => {});
    });
    if (ref.current) observer.observe(ref.current);
    return () => { live=false;observer.disconnect(); };
  },[editor,row]);
  return <span ref={ref} className="photo photo-lg object-photo">{url ? <img src={url} alt="" /> : <span aria-hidden="true">◇</span>}</span>;
}

function PartPicker({ editor, dir, onPick, onBoss, onClose }: { editor: MapEditor; dir: number; onPick: (stamp: Stamp) => void; onBoss: () => void; onClose: () => void }): ReactNode {
  const st = editor.st;
  useEditorState(st);
  const dungeon=st.current?.dungeon ?? -1;
  const templates=useAsync(() => gimmickTemplates(st.game,dungeon),[st.game,dungeon]);
  const room=st.currentEvents?.roomLeft() ?? 0;
  const stamps=new Map<number,Stamp>([[1,{type:'chest'}],[2,{type:'floor',kind:0}],[3,{type:'floor',kind:1}],[4,{type:'switchgate'}]]);
  const badge=(label:string):ReactNode => <span className="photo photo-lg stamp-badge" aria-hidden="true">{label}</span>;
  const categories: Record<number,string> = {1:'宝箱・床・スイッチ',30:'ボス戦',20:'ギミック',21:'出入口・扉・穴'};
  const entries: GridEntry[] = [
    {id:1,name:'宝箱',icon:<ObjectPhoto editor={editor} row={st.current ? stampObjectRow({type:'chest'},st.current) : 0} />,category:1,unavailable:room<1?'このダンジョンのイベントに空きがありません':null,title:'中身は配置後に右ペインで編集できます。'},
    {id:2,name:'ダメージ床',icon:<ObjectPhoto editor={editor} row={st.current ? stampObjectRow({type:'floor',kind:0},st.current) : 0} />,category:1},
    {id:3,name:'凍った床',icon:<ObjectPhoto editor={editor} row={st.current ? stampObjectRow({type:'floor',kind:1},st.current) : 0} />,category:1},
    {id:4,name:'スイッチと柵',icon:badge('⊞'),category:1,unavailable:!st.game.switchVersion?'汎用スイッチ入りの土台 MOD を読み込むと使えます':room<2?'イベントに2行の空きが必要です':null,title:'最初に柵、次にスイッチを配置します。'},
    {id:5,name:'ボス戦',icon:badge('⚔'),category:30,unavailable:!editor.session.book?'モンスターを読み込めませんでした':room<2?'イベントに2行の空きが必要です':null,title:'敵を選んで戦闘範囲を配置。敵や戦闘条件は右ペインで編集できます。'},
  ];
  const selected=st.stamp;
  let current = selected?.type==='chest'?1:selected?.type==='floor'?selected.kind===1?3:2:selected?.type==='switchgate'?4:selected?.type==='boss'?5:undefined;
  if (templates instanceof Error) entries.push({id:-1,name:'ギミックを読み込めませんでした',icon:badge('!'),unavailable:templates.message});
  else if (!templates) entries.push({id:-1,name:'ギミックを読み込み中…',icon:badge('…'),unavailable:'読み込み中'});
  else templates.forEach((template,index) => {
    const id=100+index;
    stamps.set(id,{type:'template',t:template});
    if (selected?.type==='template' && selected.t.key===template.key) current=id;
    entries.push({id,name:template.label,sub:template.source,category:template.section===5?20:21,
      title:`${template.label} — ${template.source} の設定を引き継ぎます`,icon:<ObjectPhoto editor={editor} row={template.objectRow} />,
      unavailable:template.event && room<1?'このダンジョンのイベントに空きがありません':null});
  });
  const categoryIds = new Map<string,number>();
  const master = st.game.master;
  for (let row=69;row<master.mapObject.rows;row++) {
    const category=objectCategory(row);
    if (['ワールドマップ','NPC','見えない','オブジェクト'].includes(category) || !master.objectModel(row)) continue;
    if (!categoryIds.has(category)) {
      const id=10+categoryIds.size;
      categoryIds.set(category,id);
      categories[id]=category;
    }
    const id=10000+row;
    stamps.set(id,{type:'prop',row,dir});
    if (selected?.type==='prop' && selected.row===row) current=id;
    entries.push({id,name:category+' #'+row,sub:editor.v3.objectName(row),category:categoryIds.get(category),icon:<ObjectPhoto editor={editor} row={row} />});
  }
  return <GridPicker title="パーツを選ぶ" entries={entries} current={current} categories={categories} groupByCategory placeholder="名前・種類・番号で絞り込み"
    onPick={id => { if(id===5) onBoss();else {const stamp=stamps.get(id);if(stamp) onPick(stamp);} }} onClose={onClose} />;
}
