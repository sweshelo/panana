// 初代's world map (#/world/<row>): the pier's screen (naauao honolulu/worldmap.md) with the 10 islands of PierData
// (worldmap.ts) on the shared screen view (ui/ScreenMap), at one ship stage at a time: the sea, the telescope's frame of
// that stage and the icons where that stage puts them. An island is dragged (or moved with the arrow keys) on the
// screen, and its destination, icon, ship stage and the three positions are edited under it. The rows are fixed: none
// is added or taken out.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { BookList, EditedMark, NumberInput, useActiveRow, useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { RowFields } from '../ui/RowFields';
import { imageUrl, ScreenMap, type ScreenLayer, type ScreenMarker } from '../ui/ScreenMap';
import { useAsync } from '../ui/useAsync';
import { useHonoluluRevision } from './ItemPage';
import type { HonoluluSession } from './session';
import { HONOLULU_PIER_ICONS, HONOLULU_SHIP_STAGES } from './tables';
import {
  HONOLULU_PIER_ARCHIVE, HONOLULU_PIER_ROWS, HonoluluWorldmap, PIER_HOME_DUNGEON, PIER_SCREEN, PIER_STAGES, PIER_STAR_PROGRESS, PierImages,
  pierIconSize, type PierIsland,
} from './worldmap';

export const honoluluWorldmapHref = (row: number): string => `#/world/${row}`;

const ICON_LABEL: Record<string, string> = { cave: '洞窟', plain: '平原', tower: '塔', dark: '闇', ice: '氷', volcano: '火山', last: '最後' };
const iconName = (icon: number): string => {
  const n = HONOLULU_PIER_ICONS[icon];
  return n ? `${icon} ${n} (${ICON_LABEL[n]})` : String(icon);
};

const SCREEN_HELP = '船着場の下画面 (320 × 240)。位置は画面の中央が原点、右が +x、上が +y (ピクセル) で、アイコンの中心です。コードとレイアウトから確定していますが、実機・エミュレータでの目視はまだです。';
const SCOPE_HELP = '望遠鏡の枠: 船 0〜1 は半径 約 81、船 2 は半径 約 108 の円 (中心 ほぼ (0, 4)) だけが見え、船 3 は枠がなく画面全体が見えます。半径は枠の絵 (telescope_02 / telescope_01) から測った値で、円の外の島が枠に隠れるかはゲームで確かめていません。';
const FIXED_HELP = `島の数 (${HONOLULU_PIER_ROWS}) とアイコンの種類 (7、menuList 58〜64) はコードとメニューの表に固定なので、増やせません。`;
const BASE_3D_HELP = '拠点の島から見える 3D の島 (物体 11〜20) は、モデルが行の番号でコードに固定されていて、PierData の位置・行き先を見ません。行 2 (元は魔王の塔) の 3D の島は、要る船の段階によらず常に表示されます。ここでの編集は船着場の画面だけに効きます。';
const STAR_HELP = 'クリアの星: ダンジョンの進み具合 (セーブ変数 0x40) がダンジョンごとにコードに固定された値 (1〜5・7〜9 は 5、6 は 4、10 は 7、11 は 15) と等しいとき、アイコンに星が付きます。行き先を替えると、そのダンジョンの値で判定されます。';

const images = new WeakMap<HonoluluSession, Promise<PierImages>>();
const pierImages = (session: HonoluluSession): Promise<PierImages> => {
  let p = images.get(session);
  if (!p) images.set(session, (p = Promise.resolve().then(() => PierImages.read(session.worldmap.pier))));
  return p;
};

/** From the layout's coordinates (middle, +y up) to the screen's (top left, +y down) and back. */
const toScreen = (x: number, y: number): [number, number] => [PIER_SCREEN.width / 2 + x, PIER_SCREEN.height / 2 - y];
const fromScreen = (x: number, y: number): [number, number] => [x - PIER_SCREEN.width / 2, PIER_SCREEN.height / 2 - y];

export function HonoluluWorldmapPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const revision = useHonoluluRevision(session);
  const { worldmap: wm, master } = session;
  const list = useRef<HTMLDivElement>(null);
  // the stage shown (PIER_STAGES' index): the cruiser's, where every island is on the screen
  const [stage, setStage] = useState(2);
  const [frame, setFrame] = useState(true);
  const [hidden, setHidden] = useState(true);
  const islands = useMemo(() => wm.islands(), [wm, revision]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => r < islands.length, () => 0);
  useActiveRow(list, selected);
  const pics = useAsync(() => pierImages(session), [session]);
  const im = pics instanceof PierImages ? pics : undefined;
  const dungeons = master.rows('dungeonData.bin');
  const dungeonName = (d: number): string => (d < dungeons.rows ? master.message(dungeons.get(d, 'name')) ?? `#${d}` : `#${d}`);
  const s = PIER_STAGES[stage]!;
  const ship = Math.max(...s.stages);
  const problems = (it: PierIsland): string[] => HonoluluWorldmap.problems(it, dungeons.rows);
  const edited = (): void => session.edited();

  const markers: ScreenMarker[] = islands
    .filter((it) => hidden || HonoluluWorldmap.shows(it, ship))
    .map((it) => {
      const [x, y] = toScreen(...it.at[stage]!);
      return {
        id: it.row, x, y, ...pierIconSize(it.icon), image: im?.icon(it.icon), label: `${it.row}`,
        title: `行 ${it.row}: ${dungeonName(it.dungeon)} (${it.at[stage]!.join(', ')})${HonoluluWorldmap.shows(it, ship) ? '' : ` — ${HONOLULU_SHIP_STAGES[it.ship] ?? it.ship} から`}`,
        dim: !HonoluluWorldmap.shows(it, ship), warn: problems(it).length > 0,
      };
    });
  const under: ScreenLayer[] = [{ key: 'sea', image: im?.get('pier_btm_bg') }];
  const main = im?.get('island_main');
  if (main) under.push({ key: 'main', image: main, x: PIER_SCREEN.width / 2 - main.width / 2, y: PIER_SCREEN.height / 2 - main.height / 2 });
  const over: ScreenLayer[] = frame && s.telescope ? [{ key: 'frame', image: im?.get(s.telescope), opacity: 0.8 }] : [];
  const scope = s.scope;
  const it = islands[selected];

  return (
    <div className="book">
      <div className="book-side">
        <div className="muted small">{`PierData (${HONOLULU_PIER_ARCHIVE})`}<InfoTip text={FIXED_HELP} /></div>
        <BookList rows={islands} total={islands.length} id={(x) => x.row} selected={selected} href={honoluluWorldmapHref} listRef={list}
          changed={(x) => wm.changed(x.row)}
          photo={(x) => <PierIcon im={im} icon={x.icon} />}
          columns={[
            { head: '行き先', cell: (x) => dungeonName(x.dungeon) },
            { head: '船', className: 'muted nowrap', cell: (x) => HONOLULU_SHIP_STAGES[x.ship] ?? x.ship },
            { head: '', className: 'warn-mark', cell: (x) => (problems(x).length ? '!' : '') },
          ]} />
      </div>
      <div className="book-detail">
        <div className="book-head">
          <h2>ワールドマップ</h2>
          <span className="muted">船着場の島選び (下画面)<InfoTip text={SCREEN_HELP} /></span>
        </div>
        <div className="row">
          <span>船の段階:</span>
          {PIER_STAGES.map((p, i) => (
            <label key={p.stage}><input type="radio" name="pier-stage" checked={stage === i} onChange={() => setStage(i)} />{p.label}</label>
          ))}
          <label title={SCOPE_HELP}><input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} />望遠鏡の枠</label>
          <label><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />この段階で出ない島も薄く表示</label>
          <InfoTip text={SCOPE_HELP} />
        </div>
        {pics instanceof Error && <div className="error">{`船着場の絵 (${HONOLULU_PIER_ARCHIVE} のエントリ 0) を読めませんでした: ${pics.message}`}</div>}
        <div className="screen-map-box-wrap">
          <ScreenMap width={PIER_SCREEN.width} height={PIER_SCREEN.height} under={under} over={over} markers={markers} selected={selected}
            circles={scope ? [{ x: toScreen(scope.x, scope.y)[0], y: toScreen(scope.x, scope.y)[1], r: scope.r }] : []}
            onSelect={(row) => (location.hash = honoluluWorldmapHref(row))}
            onMove={(row, x, y) => {
              const [lx, ly] = fromScreen(x, y);
              const was = wm.island(row).at;
              // an island with the same place at every stage (as all of the ROM's) moves at every stage
              wm.move(row, was.every(([a, b]) => a === was[0]![0] && b === was[0]![1]) ? 'all' : stage, lx, ly);
              edited();
            }} />
        </div>
        <div className="muted small">島をドラッグ (選んで矢印キー、Shift で 10 ずつ) で動かせます。3 段階の位置が同じ島は 3 つまとめて動きます。中央はデンパ島 (行き先 {PIER_HOME_DUNGEON}、PierData にない)。</div>
        {it && <IslandDetail key={it.row} session={session} it={it} im={im} stage={stage} dungeonName={dungeonName} problems={problems(it)} edited={edited} />}
        <div className="warn-box">{BASE_3D_HELP}</div>
      </div>
    </div>
  );
}

function PierIcon({ im, icon }: { im: PierImages | undefined; icon: number }): ReactNode {
  const pic = im?.icon(icon);
  const href = pic && imageUrl(pic);
  return href ? <img className="photo pier-icon" src={href} alt={iconName(icon)} title={iconName(icon)} /> : <span className="photo pier-icon" title={iconName(icon)} />;
}

function IslandDetail({ session, it, im, stage, dungeonName, problems, edited }: {
  session: HonoluluSession;
  it: PierIsland;
  im: PierImages | undefined;
  stage: number;
  dungeonName: (d: number) => string;
  problems: string[];
  edited: () => void;
}): ReactNode {
  const wm = session.worldmap;
  const was = wm.island(it.row, true);
  const rows = session.master.rows('dungeonData.bin').rows;
  const same = it.at.every(([x, y]) => x === it.at[0]![0] && y === it.at[0]![1]);
  const mark = (changed: boolean, original: string): ReactNode => changed && <EditedMark title={`元の値 ${original}`} />;
  const star = PIER_STAR_PROGRESS[it.dungeon];
  return (
    <>
      <h3>
        {`行 ${it.row}: ${dungeonName(it.dungeon)}`}
        {wm.changed(it.row) && <button className="small" onClick={() => { wm.revert(it.row); edited(); }}>この島の変更を元に戻す</button>}
      </h3>
      <table className="enc-table">
        <tbody>
          <tr>
            <th>行き先<InfoTip text="dungeonData の行。上画面にその名前・説明 (+0x10 / +0x12) を出し、「ここにいく」でそのダンジョンへ移ります。" /></th>
            <td>
              <select value={it.dungeon} onChange={(e) => { wm.set(it.row, 'dungeon', Number(e.target.value)); edited(); }}>
                {Array.from({ length: rows }, (_, d) => <option key={d} value={d}>{`${d}. ${dungeonName(d)}`}</option>)}
              </select>
              {mark(it.dungeon !== was.dungeon, `${was.dungeon}. ${dungeonName(was.dungeon)}`)}
            </td>
          </tr>
          <tr>
            <th>アイコン<InfoTip text={`menuList の行 (島のレイアウト island_*)。星のアニメーションもこれで選びます。${FIXED_HELP}`} /></th>
            <td>
              <div className="pier-icons">
                {Object.keys(HONOLULU_PIER_ICONS).map(Number).map((icon) => (
                  <button key={icon} className={`pier-icon-button${icon === it.icon ? ' active' : ''}`} title={iconName(icon)} onClick={() => { wm.set(it.row, 'icon', icon); edited(); }}>
                    <PierIcon im={im} icon={icon} />
                    <span className="small">{ICON_LABEL[HONOLULU_PIER_ICONS[icon]!]}</span>
                  </button>
                ))}
              </div>
              {mark(it.icon !== was.icon, iconName(was.icon))}
            </td>
          </tr>
          <tr>
            <th>要る船の段階<InfoTip text="船の段階 (セーブ変数 0x26) がこの値以上のとき島が出ます。船の段階は、船のもとを持って拠点に戻ると上がります。" /></th>
            <td>
              <select value={it.ship} onChange={(e) => { wm.set(it.row, 'ship', Number(e.target.value)); edited(); }}>
                {Object.entries(HONOLULU_SHIP_STAGES).map(([v, l]) => <option key={v} value={v}>{`${v}. ${l}`}</option>)}
              </select>
              {mark(it.ship !== was.ship, `${was.ship}. ${HONOLULU_SHIP_STAGES[was.ship] ?? ''}`)}
            </td>
          </tr>
          <tr>
            <th>クリアの星<InfoTip text={STAR_HELP} /></th>
            <td className="muted">{star === undefined ? '付かない (この行き先には条件がない)' : `ダンジョンの進み具合 = ${star} のとき`}</td>
          </tr>
        </tbody>
      </table>
      <h3>位置</h3>
      <table className="enc-table">
        <tbody>
          <tr><th>船の段階</th><th>x</th><th>y (上が +)</th><th></th></tr>
          {PIER_STAGES.map((p, i) => {
            const [x, y] = it.at[i]!;
            const [ox, oy] = was.at[i]!;
            const set = (nx: number, ny: number): void => { wm.move(it.row, i, nx, ny); edited(); };
            return (
              <tr key={p.stage} className={i === stage ? 'active' : ''}>
                <td>{p.label}{Math.max(...p.stages) < it.ship && <span className="muted small"> (出ない)</span>}</td>
                <td><NumberInput value={x} min={-160} max={160} className={`num-input${x !== ox ? ' edited' : ''}`} title={x !== ox ? `元の値 ${ox}` : ''} onCommit={(v) => set(v, y)} /></td>
                <td><NumberInput value={y} min={-120} max={120} className={`num-input${y !== oy ? ' edited' : ''}`} title={y !== oy ? `元の値 ${oy}` : ''} onCommit={(v) => set(x, v)} /></td>
                <td>{!same && <button className="small" onClick={() => { wm.move(it.row, 'all', x, y); edited(); }}>ほかの段階もこの位置に</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {problems.length > 0 && <div className="warn-box">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
      <details className="row-fields-box">
        <summary>{`PierData の行 ${it.row} のすべての欄`}</summary>
        <RowFields def={wm.rows.def} row={wm.rows.row(it.row)} original={wm.rows.originalRow(it.row)} context={session.master.context()} />
      </details>
    </>
  );
}
