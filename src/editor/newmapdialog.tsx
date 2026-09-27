// "マップを追加": a new floor in an existing dungeon (issue #19, docs/new-map.md).
import { useState, type ReactNode } from 'react';
import type { MapInfo } from '../game/codebin';
import { mapTitle } from '../game/names';
import { AUTOMAP_LIMIT, addableDungeons, hasAutomap, suggestName } from '../game/newmap';
import type { Session } from '../session';
import { Dialog } from '../ui/Dialog';
import { Field } from './fields';

/** The dialog; `onCreated` gets the new map. */
export function NewMapDialog({ session, currentDungeon, onCreated, onClose }: {
  session: Session; currentDungeon: number | null; onCreated: (m: MapInfo) => void; onClose: () => void;
}): ReactNode {
  const game = session.game;
  const [dungeons] = useState(() => addableDungeons(game));
  const [dungeon, setDungeon] = useState(() => (dungeons.some((d) => d.dungeon === currentDungeon) ? currentDungeon! : dungeons[0]?.dungeon ?? -1));
  const [floor, setFloor] = useState('-1');
  const [name, setName] = useState<string | null>(null); // null = the suggested name
  const [template, setTemplate] = useState(0);
  const [copyTiles, setCopyTiles] = useState(true);
  const [error, setError] = useState('');
  const d = dungeons.find((x) => x.dungeon === dungeon);
  if (!d) return <Dialog title="マップを追加" wide={false} onClose={onClose}><div className="error">マップを足せるダンジョンがありません。</div></Dialog>;
  const code = name ?? suggestName(game, d.code, Number(floor) || 0);
  const tmpl = d.maps.find((m) => m.hash === template) ?? d.maps[0]!;
  const n = d.maps.length + 1;
  const create = (): void => {
    setError('');
    try {
      const m = session.addMap({ dungeon: d.dungeon, floor: Number(floor) || 0, name: code, template: tmpl, templateDoc: session.docOf(tmpl), copyTiles });
      onCreated(m);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title="マップを追加" wide={false} onClose={onClose}>
      <Field label="ダンジョン">
        <select value={dungeon} onChange={(e) => setDungeon(Number(e.target.value))}>
          {dungeons.map((x) => <option key={x.dungeon} value={x.dungeon}>{`${game.master.dungeonName(x.dungeon) || x.code}  (${x.code})`}</option>)}
        </select>
      </Field>
      <Field label="階 (地下は負の数)">
        <input type="number" min={-99} max={99} value={floor} style={{ width: '6em' }} onChange={(e) => setFloor(e.target.value)} />
      </Field>
      <Field label="マップのコード">
        <input type="text" maxLength={15} value={code} style={{ width: '10em' }} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="写す元のマップ">
        <select value={tmpl.hash} onChange={(e) => setTemplate(Number(e.target.value))}>
          {d.maps.map((m) => <option key={m.hash} value={m.hash}>{`${mapTitle(m, game.code.maps, game.master)}  ${m.name}`}</option>)}
        </select>
      </Field>
      <label className="layer"><input type="checkbox" checked={copyTiles} onChange={(e) => setCopyTiles(e.target.checked)} /> タイルも写す</label>
      <p className="muted small" style={{ whiteSpace: 'pre-line' }}>
        {[
          '見た目 (タイルセット・BGM・敵) はこのダンジョンのものです。写す元のマップから、敵の出現の見出し (区画 6) と mapData の指定を写します。',
          hasAutomap(d.dungeon)
            ? n > AUTOMAP_LIMIT
              ? `このダンジョンは ${n} 枚になり、オートマップの枠 (${AUTOMAP_LIMIT}) を超えます。あとから入ったマップにはオートマップが付きません。`
              : `オートマップ: ${n} / ${AUTOMAP_LIMIT} 枚。`
            : 'このダンジョンにはもともとオートマップがありません。',
          '作ったあと、ほかのマップの出入口 (区画 3) の行き先をこのマップにし、このマップにも出入口を置いてください。書き出すと code.ips (マップの表) とマップ DB に入ります。',
        ].join('\n')}
      </p>
      {error && <div className="error">{error}</div>}
      <p><button className="primary" onClick={create}>追加する</button></p>
    </Dialog>
  );
}
