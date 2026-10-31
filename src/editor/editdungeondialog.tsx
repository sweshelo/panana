// "ダンジョンの設定": the name and the code of a dungeon added in the editor (game/newdungeon.ts renameDungeon).
import { useState, type ReactNode } from 'react';
import { codeProblem, recodeMapName } from '../game/newdungeon';
import type { Session } from '../session';
import { Dialog } from '../ui/Dialog';
import { Field } from './fields';

export function EditDungeonDialog({ session, currentDungeon, onClose }: {
  session: Session; currentDungeon: number | null; onClose: () => void;
}): ReactNode {
  const game = session.game;
  const added = game.code.dungeons;
  const [dungeon, setDungeon] = useState(() => (added.some((d) => d.dungeon === currentDungeon) ? currentDungeon! : added[0]?.dungeon ?? -1));
  const d = added.find((x) => x.dungeon === dungeon);
  const [code, setCode] = useState(d?.code ?? '');
  const [name, setName] = useState(() => (d ? game.master.dungeonName(d.dungeon) : ''));
  const [error, setError] = useState('');
  if (!d)
    return (
      <Dialog title="ダンジョンの設定" wide={false} onClose={onClose}>
        <div className="error">エディタで追加したダンジョンがありません。「＋ ダンジョンを追加」で作ってください。</div>
      </Dialog>
    );
  const pick = (n: number): void => {
    const x = added.find((y) => y.dungeon === n)!;
    setDungeon(n);
    setCode(x.code);
    setName(game.master.dungeonName(n));
    setError('');
  };
  const c = code.trim().toUpperCase();
  const problem = c === d.code ? '' : codeProblem(game, c, d.dungeon);
  const maps = game.code.maps.filter((m) => m.dungeon === d.dungeon);
  const oldName = game.master.dungeonName(d.dungeon);
  const changed = c !== d.code || name.trim() !== oldName;
  const apply = (): void => {
    setError('');
    try {
      session.renameDungeon(d.dungeon, { name, code: c });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title="ダンジョンの設定" wide={false} onClose={onClose}>
      {added.length > 1 && (
        <Field label="ダンジョン">
          <select value={dungeon} onChange={(e) => pick(Number(e.target.value))}>
            {added.map((x) => <option key={x.dungeon} value={x.dungeon}>{`${game.master.dungeonName(x.dungeon) || x.code}  (${x.code})`}</option>)}
          </select>
        </Field>
      )}
      <Field label="名前 (ゲームに出る)">
        <input type="text" value={name} style={{ width: '12em' }} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ダンジョンのコード">
        <input type="text" maxLength={3} value={code} style={{ width: '5em' }} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </Field>
      {problem && <div className="error">{problem}</div>}
      <table className="sections">
        <tbody>
          <tr><th>マップ</th><th>{c !== d.code ? '変更後' : ''}</th></tr>
          {maps.map((m) => <tr key={m.hash}><td>{m.name}</td><td>{c !== d.code ? recodeMapName(m.name, d.code, c) : ''}</td></tr>)}
        </tbody>
      </table>
      <p className="muted small" style={{ whiteSpace: 'pre-line' }}>
        {[
          `ダンジョンの番号 (mapGroup の行) は ${d.dungeon} です。ゲームの多くの処理が 58 (0x3A) 未満の番号を決め打ちしていて、空いている行はこれだけなので、番号は変えられません。`,
          'コードはマップのコードの先頭にも使われるので、このダンジョンのマップのコードもまとめて変わります。マップのハッシュは変わらないので、入口・出口の行き先はそのままです。',
        ].join('\n')}
      </p>
      {error && <div className="error">{error}</div>}
      <p>
        <button className="primary" disabled={!changed || !!problem || !name.trim()} onClick={apply}>変更する</button>{' '}
        <button onClick={onClose}>閉じる</button>
      </p>
    </Dialog>
  );
}
