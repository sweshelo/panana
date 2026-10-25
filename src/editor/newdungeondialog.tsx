// "ダンジョンを追加": a new dungeon in a vacant mapGroup row, with its first map (game/newdungeon.ts).
import { useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import { mapTitle } from '../game/names';
import { addableDungeons, suggestName } from '../game/newmap';
import { codeProblem, dungeonRoom, suggestCode, vacantDungeons } from '../game/newdungeon';
import type { Session } from '../session';
import { Dialog } from '../ui/Dialog';
import { Field } from './fields';

/** The dialog; `onCreated` gets the dungeon's first map. */
export function NewDungeonDialog({ session, currentDungeon, onCreated, onClose }: {
  session: Session; currentDungeon: number | null; onCreated: (m: MapInfo) => void; onClose: () => void;
}): ReactNode {
  const game = session.game;
  const [dungeons] = useState(() => addableDungeons(game).filter((d) => !game.code.dungeons.some((x) => x.dungeon === d.dungeon)));
  const [slot] = useState(() => (dungeonRoom(game) > 0 ? vacantDungeons(game)[0] ?? -1 : -1));
  const [template, setTemplate] = useState(() => (dungeons.some((d) => d.dungeon === currentDungeon) ? currentDungeon! : dungeons[0]?.dungeon ?? -1));
  const [code, setCode] = useState<string | null>(null); // null = the suggested code
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('-1');
  const [mapName, setMapName] = useState<string | null>(null);
  const [tmplMap, setTmplMap] = useState(0);
  const [copyTiles, setCopyTiles] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const d = dungeons.find((x) => x.dungeon === template);
  if (slot < 0 || !d)
    return (
      <Dialog title="ダンジョンを追加" wide={false} onClose={onClose}>
        <div className="error">
          {slot < 0
            ? '新しいダンジョンに使える枠がもうありません。ダンジョンの番号はゲームの多くの処理で 58 (0x3A) 未満に決め打ちされているので、空いている行 (v1.1.0 では 1 つ) だけを使います。'
            : '写す元にできるダンジョンがありません。'}
        </div>
      </Dialog>
    );
  const kind = d.code[0] ?? 'D';
  const dcode = (code ?? suggestCode(game, kind, slot)).toUpperCase();
  const problem = codeProblem(game, dcode, slot);
  const f = Number(floor) || 0;
  const mcode = mapName ?? (problem ? '' : suggestName(game, dcode, f));
  const tmpl = d.maps.find((m) => m.hash === tmplMap) ?? d.maps[0]!;
  const create = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const m = await session.addDungeon(
        { dungeon: slot, code: dcode, name, template: d.dungeon },
        { floor: f, name: mcode, template: tmpl, templateDoc: session.docOf(tmpl), copyTiles },
      );
      onCreated(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="ダンジョンを追加" wide={false} onClose={onClose}>
      <Field label="ダンジョンのコード">
        <input type="text" maxLength={3} value={dcode} style={{ width: '5em' }} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      {problem && <div className="error">{problem}</div>}
      <Field label="名前 (ゲームに出る)">
        <input type="text" value={name} placeholder="例: 風のどうくつ" style={{ width: '12em' }} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="設定を写す元">
        <select value={template} onChange={(e) => { setTemplate(Number(e.target.value)); setTmplMap(0); setCode(null); }}>
          {dungeons.map((x) => <option key={x.dungeon} value={x.dungeon}>{`${game.master.dungeonName(x.dungeon) || x.code}  (${x.code})`}</option>)}
        </select>
      </Field>
      <Field label="最初のマップの階 (地下は負の数)">
        <input type="number" min={-99} max={99} value={floor} style={{ width: '6em' }} onChange={(e) => setFloor(e.target.value)} />
      </Field>
      <Field label="最初のマップのコード">
        <input type="text" maxLength={15} value={mcode} style={{ width: '10em' }} onChange={(e) => setMapName(e.target.value)} />
      </Field>
      <Field label="タイルを写す元のマップ">
        <select value={tmpl.hash} onChange={(e) => setTmplMap(Number(e.target.value))}>
          {d.maps.map((m) => <option key={m.hash} value={m.hash}>{`${mapTitle(m, game.code.maps, game.master)}  ${m.name}`}</option>)}
        </select>
      </Field>
      <label className="layer"><input type="checkbox" checked={copyTiles} onChange={(e) => setCopyTiles(e.target.checked)} /> タイルも写す</label>
      <p className="muted small" style={{ whiteSpace: 'pre-line' }}>
        {[
          `ダンジョンの番号は ${slot} (mapGroup の空いている行) を使います。見た目 (タイルセット・BGM)・フラグ・状態の枠の数は写す元のダンジョンと同じにし、セーブの状態・値・フラグの枠は、ほかのダンジョンと重ならないところを割り当てます。`,
          'イベントの表 (EventObject) は空のアーカイブを新しく作ります。宝箱やギミックはあとから足してください。',
          'マップのコードはダンジョンのコードで始まります (例: D11B01001)。ほかのダンジョン・マップのコードと重ならないようにしてください。',
          '作ったあと、ワールドマップのページで入口の行き先をこのダンジョンのマップにし、このマップにも出口を置いてください。',
        ].join('\n')}
      </p>
      {error && <div className="error">{error}</div>}
      <p><button className="primary" disabled={busy || !!problem || !name.trim()} onClick={() => void create()}>追加する</button></p>
    </Dialog>
  );
}
