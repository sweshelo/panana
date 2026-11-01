import { describe, expect, test } from 'bun:test';
import { MapEditState } from '../src/editor/model';
import { Controller, editorKey } from '../src/editor/controller';
import { LAYOUTS, type MapDoc, type Rec } from '../src/game/sections';
class ToolboxState extends MapEditState<{type:'prop';row:number;dir:number},null> {
  readonly layouts=LAYOUTS;
  readonly pointSections=[];
  protected saveTables(){return null;}
  protected restoreTables(){}
  placeStamp():[number,number]{throw new Error('unused');}
  duplicateRecord(_doc:MapDoc,_section:number,rec:Rec){return rec;}
}
const key=(value:string,ctl:Controller)=>editorKey({key:value,target:null,ctrlKey:false,metaKey:false,shiftKey:false} as unknown as KeyboardEvent,ctl,()=>[0]);
describe('map toolbox placement workflow',()=>{
  test('switching between chips and parts retains both selections and the prop facing',()=>{
    const st=new ToolboxState();
    st.brush={kind:7,letter:0x62,rot:2,auto:false};
    st.stamp={type:'prop',row:69,dir:1};
    st.setPlacementMode('parts');expect(st.tool).toBe('place');
    st.setPlacementMode('tiles');expect(st.tool).toBe('paint');
    expect(st.brush).toEqual({kind:7,letter:0x62,rot:2,auto:false});
    st.setPlacementMode('parts');expect(st.tool).toBe('place');
    expect(st.stamp).toEqual({type:'prop',row:69,dir:1});
  });
  test('an empty parts selection stays in selection mode until a part is chosen',()=>{
    const st=new ToolboxState();st.setPlacementMode('parts');
    expect(st.placementMode).toBe('parts');expect(st.tool).toBe('select');
    st.stamp={type:'prop',row:69,dir:0};st.setTool('place');
    expect(st.placementMode).toBe('parts');expect(st.tool).toBe('place');
  });
  test('keyboard shortcuts keep the active toolbox consistent, while select and escape retain its context',()=>{
    const st=new ToolboxState();const ctl=new Controller(st);
    st.stamp={type:'prop',row:69,dir:1};st.setTool('place');
    key('Escape',ctl);expect(st.placementMode).toBe('parts');expect(st.tool).toBe('select');
    key('b',ctl);expect(st.placementMode).toBe('tiles');expect(st.tool).toBe('paint');
    key('e',ctl);expect(st.tool).toBe('erase');expect(st.placementMode).toBe('tiles');
    st.setTool('place');key('v',ctl);expect(st.placementMode).toBe('parts');
    key('m',ctl);expect(st.tool).toBe('rect');expect(st.placementMode).toBe('parts');
    key('g',ctl);expect(st.placementMode).toBe('tiles');
    expect(st.stamp.dir).toBe(1);
  });
});
