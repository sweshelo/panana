// The map page's dialogs for the maps and dungeons of a RPG FREE! stage (mapadd.ts), like RPG2's "マップを追加" /
// "ダンジョンを追加" / "ダンジョンの設定" (editor/newmapdialog.tsx, newdungeondialog.tsx, editdungeondialog.tsx):
// adding or copying a map in a dungeon (MapGroup), adding or copying a dungeon, and the names and codes.
import { useState, type ReactNode } from 'react';
import { Field } from '../editor/fields';
import { Dialog } from '../ui/Dialog';
import {
  addLanaiGroup,
  addLanaiMap,
  canRemoveGroup,
  groupCode,
  groupCodeProblem,
  groupMaps,
  mapNameProblem,
  nextStateSlot,
  ownsName,
  recodeLanaiGroup,
  recodeMapName,
  removeLanaiGroup,
  removeLanaiMap,
  renameLanaiGroup,
  renameLanaiMap,
  romStateEnd,
  scriptRows,
  suggestGroupCode,
  suggestMapName,
  type LanaiNewMapSpec,
} from './mapadd';
import { lanaiFloorLabel, type LanaiMapInfo, type LanaiMaps } from './maps';

const groupLabel = (maps: LanaiMaps, g: number): string => `${maps.groupName(g) || `MapGroup ${g}`}  (MapGroup ${g}${groupCode(maps, g) ? `・${groupCode(maps, g)}` : ''})`;
const mapLabel = (m: LanaiMapInfo): string => `${m.name}  ${lanaiFloorLabel(m.floor) || '地上'}`;

/** The groups that have maps (the world map's left out): what a map or a dungeon can be made from. */
const groupsWithMaps = (maps: LanaiMaps): number[] => maps.groups.filter((g) => g.row > 0 && groupMaps(maps, g.row).length).map((g) => g.row);

const COPY_LABELS: [LanaiNewMapSpec['copy'], string][] = [
  ['all', 'まるごと複製 (タイル・置物・宝箱・出入口・敵)'],
  ['tiles', 'タイルだけ写す'],
  ['none', '空のマップ'],
];

const help = (lines: string[]): ReactNode => <p className="muted small" style={{ whiteSpace: 'pre-line' }}>{lines.join('\n')}</p>;

/** "マップを追加・複製": a new map in a group, from a map of the group (the open one first). */
export function LanaiNewMapDialog({ maps, current, onCreated, onClose }: {
  maps: LanaiMaps; current: LanaiMapInfo | null; onCreated: (m: LanaiMapInfo) => void; onClose: () => void;
}): ReactNode {
  const [groups] = useState(() => groupsWithMaps(maps));
  const [group, setGroup] = useState(() => (current && groups.includes(current.dungeon) ? current.dungeon : groups[0] ?? -1));
  const list = groupMaps(maps, group);
  const [template, setTemplate] = useState(() => (current && !current.world ? current.hash : 0));
  const tmpl = list.find((m) => m.hash === template) ?? list[0];
  const [floor, setFloor] = useState(() => String(tmpl?.floor ?? -1));
  const [copy, setCopy] = useState<LanaiNewMapSpec['copy']>('all');
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!tmpl) return <Dialog title="マップを追加・複製" wide={false} onClose={onClose}><div className="error">マップを足せるダンジョンがこのステージにありません。</div></Dialog>;
  const f = Number(floor) || 0;
  const code = groupCode(maps, group) || tmpl.name.slice(0, 3);
  const n = (name ?? suggestMapName(maps, code, f)).toUpperCase();
  const problem = mapNameProblem(maps, n);
  const scripts = copy === 'all' ? scriptRows(maps, group) : 0;
  const create = (): void => {
    setError('');
    try {
      onCreated(addLanaiMap(maps, { template: tmpl, floor: f, name: n, copy }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title="マップを追加・複製" wide={false} onClose={onClose}>
      <Field label="ダンジョン">
        <select value={group} onChange={(e) => { setGroup(Number(e.target.value)); setTemplate(0); setName(null); }}>
          {groups.map((g) => <option key={g} value={g}>{groupLabel(maps, g)}</option>)}
        </select>
      </Field>
      <Field label="写す元のマップ">
        <select value={tmpl.hash} onChange={(e) => { const m = list.find((x) => x.hash === Number(e.target.value)); setTemplate(Number(e.target.value)); if (m) setFloor(String(m.floor)); setName(null); }}>
          {list.map((m) => <option key={m.hash} value={m.hash}>{mapLabel(m)}</option>)}
        </select>
      </Field>
      <Field label="写し方">
        <select value={copy} onChange={(e) => setCopy(e.target.value as LanaiNewMapSpec['copy'])}>
          {COPY_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="階 (地下は負の数)">
        <input type="number" min={-99} max={99} value={floor} style={{ width: '6em' }} onChange={(e) => { setFloor(e.target.value); setName(null); }} />
      </Field>
      <Field label="マップのコード">
        <input type="text" maxLength={11} value={n} style={{ width: '10em' }} onChange={(e) => setName(e.target.value.toUpperCase())} />
      </Field>
      {problem && <div className="error">{problem}</div>}
      {help([
        '見た目 (MapData・タイルセット)・敵の出方・敵の群れ (区画 6 の見出し) は写す元のマップと同じです。',
        copy === 'all'
          ? '複製では、宝箱・扉・キャラなどのイベントの行 (EventObject) も写して、状態の枠を別にします (宝箱を開けたかどうかは写しと元で別々)。宝箱の中身の行 (TreasureGroup) と行き先は同じものを指します。'
          : '置物・宝箱・出入口はあとから足してください。',
        ...(scripts ? [`このダンジョンにはスクリプト (CRO) の動作の行が ${scripts} 件あります。CRO はイベントのクラスをマップ名で持つ (D01001B01Npc0201) ので、写しのマップではそれらは動かない見込みです (ゲームでは未確認)。`] : []),
        '作ったあと、ほかのマップの出入口の行き先をこのマップにし、このマップにも出入口を置いてください。書き出すと、このステージのアーカイブのマップ表とマップ DB に入ります。',
      ])}
      {error && <div className="error">{error}</div>}
      <p><button className="primary" disabled={!!problem} onClick={create}>追加する</button></p>
    </Dialog>
  );
}

/** "ダンジョンを追加・複製": a new MapGroup row (a copy of a group's settings, with its maps or with one new map). */
export function LanaiNewGroupDialog({ maps, current, onCreated, onClose }: {
  maps: LanaiMaps; current: LanaiMapInfo | null; onCreated: (m: LanaiMapInfo) => void; onClose: () => void;
}): ReactNode {
  const [groups] = useState(() => groupsWithMaps(maps));
  const [template, setTemplate] = useState(() => (current && groups.includes(current.dungeon) ? current.dungeon : groups[0] ?? -1));
  const [copyMaps, setCopyMaps] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [floor, setFloor] = useState('-1');
  const [mapName, setMapName] = useState<string | null>(null);
  const [tmplMap, setTmplMap] = useState(0);
  const [copyTiles, setCopyTiles] = useState(true);
  const [error, setError] = useState('');
  const list = groupMaps(maps, template);
  const g = maps.groups[template];
  if (!g || !list.length || !maps.mapGroup)
    return <Dialog title="ダンジョンを追加・複製" wide={false} onClose={onClose}><div className="error">写す元にできるダンジョンがこのステージにありません。</div></Dialog>;
  const from = groupCode(maps, template);
  const c = (code ?? suggestGroupCode(maps, from[0] ?? 'D')).toUpperCase();
  const codeProblem = groupCodeProblem(maps, c);
  const f = Number(floor) || 0;
  const tmpl = list.find((m) => m.hash === tmplMap) ?? list[0]!;
  const first = (mapName ?? (codeProblem ? '' : suggestMapName(maps, c, f))).toUpperCase();
  const names = copyMaps ? list.map((m) => (from ? recodeMapName(m.name, from, c) : c + m.name.slice(3))) : [first];
  const nameProblem = codeProblem ? '' : names.map((n) => mapNameProblem(maps, n)).find((p) => p) ?? '';
  const slot = nextStateSlot(maps);
  const end = romStateEnd(maps);
  const scripts = copyMaps ? scriptRows(maps, template) : 0;
  const create = (): void => {
    setError('');
    try {
      const r = addLanaiGroup(maps, { template, name, code: c, copyMaps, first: copyMaps ? undefined : { template: tmpl, floor: f, name: first, copyTiles } });
      onCreated(r.first);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title="ダンジョンを追加・複製" wide={false} onClose={onClose}>
      <Field label="写す元のダンジョン">
        <select value={template} onChange={(e) => { setTemplate(Number(e.target.value)); setTmplMap(0); setCode(null); setMapName(null); }}>
          {groups.map((x) => <option key={x} value={x}>{groupLabel(maps, x)}</option>)}
        </select>
      </Field>
      <label className="layer"><input type="checkbox" checked={copyMaps} onChange={(e) => setCopyMaps(e.target.checked)} />{` マップごと複製する (${list.length} 枚)`}</label>
      <Field label="名前 (ゲームに出る)">
        <input type="text" value={name} placeholder={maps.groupName(template) || '例: 風のどうくつ'} style={{ width: '12em' }} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ダンジョンのコード (マップのコードの先頭)">
        <input type="text" maxLength={3} value={c} style={{ width: '5em' }} onChange={(e) => { setCode(e.target.value.toUpperCase()); setMapName(null); }} />
      </Field>
      {codeProblem && <div className="error">{codeProblem}</div>}
      {copyMaps ? (
        <table className="sections">
          <tbody>
            <tr><th>写す元</th><th>写し</th></tr>
            {list.map((m, i) => <tr key={m.hash}><td>{m.name}</td><td>{names[i]}</td></tr>)}
          </tbody>
        </table>
      ) : (
        <>
          <Field label="最初のマップのタイルを写す元">
            <select value={tmpl.hash} onChange={(e) => setTmplMap(Number(e.target.value))}>
              {list.map((m) => <option key={m.hash} value={m.hash}>{mapLabel(m)}</option>)}
            </select>
          </Field>
          <label className="layer"><input type="checkbox" checked={copyTiles} onChange={(e) => setCopyTiles(e.target.checked)} /> タイルも写す</label>
          <Field label="最初のマップの階 (地下は負の数)">
            <input type="number" min={-99} max={99} value={floor} style={{ width: '6em' }} onChange={(e) => { setFloor(e.target.value); setMapName(null); }} />
          </Field>
          <Field label="最初のマップのコード">
            <input type="text" maxLength={11} value={first} style={{ width: '10em' }} onChange={(e) => setMapName(e.target.value.toUpperCase())} />
          </Field>
        </>
      )}
      {nameProblem && <div className="error">{nameProblem}</div>}
      {help([
        `ダンジョンの番号は MapGroup ${maps.mapGroup.rows} (表の末尾に足す行) です。見た目 (MapData)・BGM・会話の表は写す元と同じにし、名前の行 (MessageMapName) は新しく足します。`,
        copyMaps
          ? 'イベントの表 (EventObject) は写す元のものを丸ごと写した新しいエントリにします。写したマップどうしをつなぐ階段・出入口の行き先は写しのマップに付け替えるので、写しの中を行き来できます。ダンジョンの外へ出る出口はそのままです。'
          : 'イベントの表 (EventObject) は空の行 0 だけの新しいエントリにします。宝箱や出入口はあとから足してください。',
        `状態の枠 (宝箱を開けたか、など): ${slot}〜${slot + g.stateCount - 1} (${g.stateCount} 個) を使います。このステージの ROM の枠は ${end} 個目までで、その先の枠をセーブがいくつ持つかはまだ確かめていません。`,
        ...(scripts ? [`写す元にはスクリプト (CRO) の動作の行が ${scripts} 件あります。CRO はイベントのクラスをマップ名で持つ (D01001B01Npc0201) ので、名前の違う写しではそれらは動かない見込みです (ゲームでは未確認)。`] : []),
        '作ったあと、ほかのマップの出入口の行き先を、このダンジョンのマップにしてください。',
      ])}
      {error && <div className="error">{error}</div>}
      <p><button className="primary" disabled={!!codeProblem || !!nameProblem || !name.trim()} onClick={create}>{copyMaps ? '複製する' : '追加する'}</button></p>
    </Dialog>
  );
}

/** "名前・コードの変更": the open map's code, its dungeon's name and code; taking out what was added. */
export function LanaiNamesDialog({ maps, current, onRenamed, onRemoved, onClose }: {
  maps: LanaiMaps; current: LanaiMapInfo; onRenamed: (name: string) => void; onRemoved: () => void; onClose: () => void;
}): ReactNode {
  const group = current.dungeon;
  const [mapName, setMapName] = useState(current.name);
  const [name, setName] = useState(() => maps.groupName(group));
  const oldCode = groupCode(maps, group);
  const [code, setCode] = useState(oldCode);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const mn = mapName.trim().toUpperCase();
  const mapProblem = mn === current.name ? '' : mapNameProblem(maps, mn, current);
  const c = code.trim().toUpperCase();
  const codeProblem = c === oldCode ? '' : groupCodeProblem(maps, c, group);
  const scripts = scriptRows(maps, group);
  const list = groupMaps(maps, group);
  const run = (f: () => void, msg: string): void => {
    setError('');
    setDone('');
    try {
      f();
      setDone(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title="名前・コードの変更" wide={false} onClose={onClose}>
      <h3>マップ</h3>
      <Field label="マップのコード">
        <input type="text" maxLength={11} value={mapName} style={{ width: '10em' }} onChange={(e) => setMapName(e.target.value.toUpperCase())} />
      </Field>
      {mapProblem && <div className="error">{mapProblem}</div>}
      <p>
        <button disabled={mn === current.name || !!mapProblem} onClick={() => run(() => { renameLanaiMap(maps, current, mn); onRenamed(mn); }, `マップのコードを ${mn} にしました`)}>マップのコードを変える</button>{' '}
        {current.added && <button onClick={() => { if (confirm(`追加したマップ ${current.name} を消しますか?`)) run(() => { removeLanaiMap(maps, current); onRemoved(); }, '消しました'); }}>このマップを消す</button>}
      </p>
      {!current.world && group > 0 && (
        <>
          <h3>{`ダンジョン (MapGroup ${group})`}</h3>
          <Field label="名前 (ゲームに出る)">
            <input type="text" value={name} style={{ width: '12em' }} onChange={(e) => setName(e.target.value)} />
          </Field>
          <p>
            <button disabled={!name.trim() || name.trim() === maps.groupName(group)} onClick={() => run(() => renameLanaiGroup(maps, group, name), '名前を変えました')}>名前を変える</button>
          </p>
          <Field label="ダンジョンのコード (マップのコードの先頭)">
            <input type="text" maxLength={3} value={code} style={{ width: '5em' }} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          {codeProblem && <div className="error">{codeProblem}</div>}
          {c !== oldCode && !codeProblem && (
            <table className="sections">
              <tbody>
                <tr><th>マップ</th><th>変更後</th></tr>
                {list.map((m) => <tr key={m.hash}><td>{m.name}</td><td>{recodeMapName(m.name, oldCode, c)}</td></tr>)}
              </tbody>
            </table>
          )}
          <p>
            <button disabled={c === oldCode || !!codeProblem} onClick={() => run(() => { recodeLanaiGroup(maps, group, c); setMapName(recodeMapName(current.name, oldCode, c)); onRenamed(recodeMapName(current.name, oldCode, c)); }, `コードを ${c} にしました`)}>コードを変える</button>{' '}
            {canRemoveGroup(maps, group) && <button onClick={() => { if (confirm(`追加したダンジョン「${maps.groupName(group)}」とそのマップ ${list.length} 枚を消しますか?`)) run(() => { removeLanaiGroup(maps, group); onRemoved(); }, '消しました'); }}>このダンジョンを消す</button>}
          </p>
        </>
      )}
      {help([
        'マップのハッシュは変わらないので、出入口の行き先はそのままつながります。',
        ownsName(maps, group)
          ? '名前は、このダンジョンのために足した名前の行を書き換えます。'
          : '名前の行 (MessageMapName) は同じダンジョンを使うほかのステージと共有なので、名前を変えると、このダンジョン用の行を新しく足して付け替えます (ほかのステージの名前は変わりません)。',
        ...(scripts && !current.added ? [`このダンジョンにはスクリプト (CRO) の動作の行が ${scripts} 件あります。CRO はイベントのクラスをマップ名で持つ (D01001B01Npc0201) ので、ROM のマップのコードを変えると、それらのイベントが動かなくなる見込みです (ゲームでは未確認)。`] : []),
      ])}
      {done && <p className="small">{done}</p>}
      {error && <div className="error">{error}</div>}
      <p><button onClick={onClose}>閉じる</button></p>
    </Dialog>
  );
}
