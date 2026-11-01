// Shared part controls. Games supply labels, thumbnails and placement actions, never format offsets here.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GridPicker } from '../ui/GridPicker';
import { InfoTip } from '../ui/InfoTip';

export interface PartThumbnailSource<T> { partThumb(part: T): Promise<string | null> }
export function PartPhoto<T>({ source, part, partKey }: { source: PartThumbnailSource<T>; part: T; partKey: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [url,setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      source.partThumb(part).then(image => {if(live) setUrl(image);}).catch(() => {});
    });
    if(ref.current) observer.observe(ref.current);
    return () => {live=false;observer.disconnect();};
    // The part's stable key identifies it; object-valued adapters may recreate the descriptor.
  },[source,partKey]);
  return <span ref={ref} className="photo photo-lg object-photo">{url ? <img src={url} alt="" /> : <span aria-hidden="true">◇</span>}</span>;
}

export function PartSelection({ label, icon, help, onChoose, directions }: {
  label: string; icon?: ReactNode; help: string; onChoose: () => void;
  directions?: {labels: readonly string[]; value: number; onChange: (value: number) => void};
}): ReactNode {
  return <>
    <div className="selected-part">
      <button className="selected-part-pick" onClick={onChoose} aria-haspopup="dialog" title="クリックしてパーツを選ぶ・選び直す">
        {icon ?? <span className="photo photo-lg stamp-badge" aria-hidden="true">◇</span>}
        <span className="selected-part-label">{label}</span><span aria-hidden="true">▾</span>
      </button>
      <InfoTip text={help} />
    </div>
    {directions && <div className="part-directions" role="group" aria-label="置き物の向き">
      {directions.labels.map((label,index) => <button key={index} aria-label={`向き ${label}`} aria-pressed={directions.value===index}
        className={directions.value===index?'active':''} title={label} onClick={() => directions.onChange(index)}>{label.slice(0,1)}</button>)}
    </div>}
  </>;
}

export interface PartChoice {
  key: string; name: string; category: string; icon?: ReactNode; sub?: string; title?: string; unavailable?: string | null;
}
/** Stable string keys keep asynchronously added templates separate from object row numbers. */
export function PartPicker({ choices, current, onPick, onClose, controls }: {
  choices: readonly PartChoice[]; current?: string; onPick: (key: string) => void; onClose: () => void; controls?: ReactNode;
}): ReactNode {
  const categoryIds = new Map<string,number>();
  const categories: Record<number,string> = {};
  const entries = choices.map((choice,index) => {
    if(!categoryIds.has(choice.category)) {
      const id=categoryIds.size+1;categoryIds.set(choice.category,id);categories[id]=choice.category;
    }
    return {...choice,id:index+1,category:categoryIds.get(choice.category),icon:choice.icon ?? <span className="photo photo-lg stamp-badge" aria-hidden="true">◇</span>};
  });
  const selected=choices.findIndex(choice => choice.key===current);
  return <GridPicker title="パーツを選ぶ" entries={entries} categories={categories} groupByCategory current={selected<0?undefined:selected+1}
    placeholder="名前・種類・番号で絞り込み" controls={controls} onClose={onClose} onPick={id => {const choice=choices[id-1];if(choice) onPick(choice.key);}} />;
}

export function MapSettings({ title='表示設定', children }: {title?: string;children: ReactNode}): ReactNode {
  return <details className="map-display-settings"><summary>{title}</summary>{children}</details>;
}
