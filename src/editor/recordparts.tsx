// Adapter-driven prop/template picker used by RPG3 and FREE!, reusable by future map formats.
import { useState, type ReactNode } from 'react';
import type { MapEditState } from './model';
import { NumberInput } from '../ui/book';
import { useEditorState } from '../ui/useEditorState';
import { PartPhoto, PartPicker, PartSelection, type PartChoice, type PartThumbnailSource } from './partpalette';
export interface PartTemplate { section: number; raw: Uint8Array; label: string; source: string }
export type RecordPartStamp<T> = {type:'prop';row:number;dir:number} | {type:'template';t:T};
export const partTemplateKey=(t:PartTemplate):string=>`template/${t.section}/${t.source}/${t.raw.join('.')}`;
export function templateCategory(section:number):string {
  return ({1:'床のギミック',3:'出入口・扉',4:'宝箱',5:'ギミック',8:'ギミック',9:'地点'} as Record<number,string>)[section] ?? 'その他';
}
export function RecordPartPanel<T extends PartTemplate,M>({ st, source, templates, rows, usedRows, directions, modelForProp, modelForTemplate, maxRow, validRow, help, status }: {
  st: MapEditState<RecordPartStamp<T>>; source: PartThumbnailSource<M | null>; templates: readonly T[];
  rows: readonly number[]; usedRows: readonly number[]; directions: readonly string[];
  modelForProp: (row:number)=>M | null; modelForTemplate:(template:T)=>M | null;
  maxRow:number; validRow:(row:number)=>boolean; help:string; status?:string;
}):ReactNode {
  useEditorState(st);
  const [open,setOpen]=useState(false);
  const [row,setRow]=useState(()=>usedRows[0] ?? rows[0] ?? 0);
  const selected=st.stamp;
  const dir=selected?.type==='prop'?selected.dir:0;
  const choose=(stamp:RecordPartStamp<T>):void=>{st.stamp=stamp;st.setTool('place');setOpen(false);};
  const model=selected?.type==='prop'?modelForProp(selected.row):selected?.type==='template'?modelForTemplate(selected.t):null;
  const current=selected?.type==='prop'?`prop/${selected.row}`:selected?partTemplateKey(selected.t):undefined;
  const photo=(model:M|null):ReactNode=><PartPhoto source={source} part={model} partKey={JSON.stringify(model)} />;
  const choices:PartChoice[]=[];
  const stamps=new Map<string,RecordPartStamp<T>>();
  if(open) {
    const used=new Set(usedRows);
    for(const prop of [...new Set([...usedRows,...rows])]) {
      if(!validRow(prop)) continue;
      const key=`prop/${prop}`;
      stamps.set(key,{type:'prop',row:prop,dir});
      choices.push({key,name:`置物 #${prop}`,category:'ギミック',sub:used.has(prop)?'使用中':undefined,icon:photo(modelForProp(prop))});
    }
    for(const template of templates) {
      const key=partTemplateKey(template);
      stamps.set(key,{type:'template',t:template});
      choices.push({key,name:template.label,category:templateCategory(template.section),sub:template.source,title:`${template.source} の設定を引き継ぎます`,icon:photo(modelForTemplate(template))});
    }
    const order=['宝箱','床のギミック','出入口・扉','ギミック','地点','その他'];
    choices.sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category));
    if(status) choices.push({key:'status',name:status,category:'読み込み状況',unavailable:status});
  }
  return <div className="add-panel compact-add-panel">
    <PartSelection label={selected?.type==='prop'?`置物 #${selected.row}`:selected?.type==='template'?selected.t.label:'パーツを選ぶ…'}
      icon={model?photo(model):undefined} help={help} onChoose={()=>setOpen(true)}
      directions={selected?.type==='prop'?{labels:directions,value:dir,onChange:dir=>choose({...selected,dir})}:undefined} />
    {open && <PartPicker choices={choices} current={current} onClose={()=>setOpen(false)} onPick={key=>{const stamp=stamps.get(key);if(stamp) choose(stamp);}}
      controls={<details className="part-number-picker"><summary>番号を直接指定</summary><div className="row">
        <label>置物の番号 <NumberInput value={row} min={0} max={maxRow} onCommit={setRow} /></label>
        <button disabled={!validRow(row)} onClick={()=>choose({type:'prop',row,dir})}>このパーツを選ぶ</button>
      </div></details>} />}
  </div>;
}
