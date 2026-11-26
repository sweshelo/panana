// The editor's side of a stage's event script (eventScript.ts ScriptDoc): giving functions to the rows of a map and
// taking them back, the words of the language as the editor lists them (help now, completion later), and the samples.
import { triggerHasRow, type ScriptBinding, type ScriptDoc, type ScriptTrigger } from './eventScript';

/** What a binding is of: a row of a map group's EventObject table, or the group's start (`map`: of one floor). */
export interface BindingTarget {
  trigger: ScriptTrigger;
  group: number;
  row: number;
  map?: number;
}
/**
 * Whether two bindings are of the same thing: a row has one event whatever starts it, a group has one start and one
 * of each floor.
 */
export const sameTarget = (a: BindingTarget, b: BindingTarget): boolean =>
  a.group === b.group &&
  (triggerHasRow(a.trigger)
    ? triggerHasRow(b.trigger) && a.row === b.row
    : a.trigger === b.trigger && (a.trigger !== 'start' || a.map === b.map));

/** The function given to a row (whatever starts it), if any. */
export const rowBinding = (doc: ScriptDoc, group: number, row: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => triggerHasRow(b.trigger) && b.group === group && b.row === row);
/** The function given to a group's start (`map`: to the start of that floor alone), if any. */
export const startBinding = (doc: ScriptDoc, group: number, map?: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => b.trigger === 'start' && b.group === group && b.map === map);
/** A group's opening (intro), if it has one: its function, or '' for the game's part alone. */
export const introBinding = (doc: ScriptDoc, group: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => b.trigger === 'intro' && b.group === group);

/** The document with a function given to a target (in place of what the target had). */
export function docBound(doc: ScriptDoc, b: ScriptBinding): ScriptDoc {
  const row = triggerHasRow(b.trigger) ? b.row : 0;
  const { map, ...rest } = b;
  const kept = b.trigger === 'start' && map !== undefined ? { ...rest, row, map } : { ...rest, row };
  return { ...doc, bindings: [...doc.bindings.filter((x) => !sameTarget(x, b)), kept] };
}
/** The document with nothing given to a target. */
export const docUnbound = (doc: ScriptDoc, t: BindingTarget): ScriptDoc => ({
  ...doc,
  bindings: doc.bindings.filter((x) => !sameTarget(x, t)),
});

export interface ScriptWord {
  /** The form as written. */
  form: string;
  /** The word a completion would insert (the form's first word). */
  word: string;
  about: string;
  kind: 'value' | 'statement' | 'who' | 'flow';
}
const w = (kind: ScriptWord['kind'], form: string, about: string): ScriptWord => ({
  kind,
  form,
  word: /^[A-Za-z_]\w*/u.exec(form)?.[0] ?? form,
  about,
});

/** What can be written in a function, in the order the help shows it. */
export const SCRIPT_WORDS: ScriptWord[] = [
  w(
    'statement',
    'クラス.関数(引数)',
    'ゲームの Script API を名前で呼ぶ (例: ScriptSound.Play(0x7A, 0)、ScriptSystem.WaitTime(0.5))。引数は数・計算式・vec(x, y, z)・hero / self / obj(イベント)・selfRow。値を返す関数は条件にも書ける。何を呼べるかは下の「Script API」',
  ),
  w(
    'statement',
    'だれに.関数(引数)',
    'キャラ・物の Script API を呼ぶ (例: hero.SetVisible(0)、obj(3).StartAnimation(0x80000073, 0, 1, 0))。hero はパーティの電波人間の関数 (ScriptPlayer) を先に探す',
  ),
  w(
    'statement',
    'だれに.関数(引数) (小文字)',
    '1 つ目の引数が obj (または num) のライブラリ・自分の関数を、その物を先頭にして呼ぶ: obj(3).open() は open(3)、hero.move(250, 0, 750) は move(hero, 250, 0, 750)',
  ),
  w('statement', '名前 = 値', '変数に書く (byte は 0〜255 の数、bit は true / false)'),
  w(
    'statement',
    '名前 = 式 / 名前 += 式 / 名前++',
    'byte の変数は数として計算に使える (+ - * / と括弧、- -= -- も): N = M * 2 + 1。イベントの実行時に読み、0〜255 で回り込む (255 + 1 は 0、小数は切り捨て)。bit の変数は true / false で、計算には使えない: B = C、B = !C (切り替え)',
  ),
  w(
    'statement',
    '引数に変数 (Script API・関数)',
    'byte の変数・let の変数・値を返す Script API は数の引数 (整数・小数) に式ごと書ける: obj(3).RotateTo(N * 90 * 3.14159265 / 180, 0.5, 0, 0, 0, 1)、関数の num 引数にも。bit の変数は bool の引数にだけ: hero.SetVisible(B)。obj(…)・case には使えない (作るときに決まる数)',
  ),
  w(
    'statement',
    'let 名前 = 値',
    'イベントの中だけの変数 (保存されない)。数 (小数) か位置 (vec) を入れる: let p = obj(2).GetPos()、let a = ScriptMath.GetDirectionRotY(hero.GetPos() - p)。2 回目からは 名前 = 値 (数は += ++ も、位置は += -= も)。関数の中の let はその関数だけのもの',
  ),
  w(
    'value',
    '位置の計算',
    '位置は足し引き (p + vec(0, 100, 0)、hero.GetPos() - p) と、数との掛け算・割り算 (d * 0.5) ができる。p.x / p.y / p.z で 1 つの数を取り出す。位置を返す Script API: GetPos、GetShadowPos',
  ),
  w(
    'flow',
    'if (条件) { … } else { … }',
    '条件: 名前、!名前、名前 == 値 (!= < <= > >=)、値を返す Script API (例: ScriptMenu.SystemMessageYesNo(0x80000063)、ScriptFlag.GetItemNum(0x80000005, 1) >= 2)。let の変数・小数を返す関数・計算は比べて書く (小数で比べる): d.x * d.x + d.z * d.z < 300 * 300。&& / || / ( ) で組み合わせます (&& を先に評価)',
  ),
  w('flow', 'switch (値) { case 値: … default: … }', '値で分ける。case は下へ続かない (break は書かなくてよい)'),
  w('flow', 'return', 'イベントをそこで終える (関数の中に書いても、呼んだイベントごと終わる)'),
  w(
    'flow',
    'for 名前 in party { … }',
    'パーティの電波人間 1 人ずつに同じことをする (先頭から、ScriptMap.GetPlayerNum() 人まで)。名前は hero と同じように使える: for p in party { p.StartAnimation(0x80000001, 0, 1, 0) }。break でループを抜ける',
  ),
  w(
    'statement',
    'event.関数()',
    '話しかけたときのイベント自身の関数 (NpcCommon): event.TurnNpcRecover() (相手の向きを元に戻す)、event.ZoomHeroCamera() / event.RecoverHeroCamera() (主人公へのカメラ寄り・戻し)、event.TurnNpc() / event.TurnHero() (向かい合う。イベントの始めに自動で呼ぶ)',
  ),
  w(
    'statement',
    'effect 名前',
    'イベントが持つエフェクト (ScriptEffect)。イベントと一緒に作られ、マップを出るまで残る (同じイベントをもう一度実行しても同じもの)。名前.CreateEffect(番号, 3) で作り、名前.SetPos(位置)、名前.StartEffect(1)、名前.StartAnimation(…)、名前.StopEmission() で動かす。そのイベントの中でだけ使える',
  ),
  w('who', 'hero', '先頭の電波人間'),
  w('who', 'self', 'イベントの持ち主 (話しかけた相手・踏んだボタン)'),
  w(
    'who',
    'obj(イベント)',
    'そのイベントの物 (キャラ・扉・宝箱・モンスター・ボタンなど)。モンスターには ScriptMonster の関数も呼べる: obj(9).SetMapLabel(3)、obj(9).SetForceFollowRotate(true)',
  ),
  w(
    'value',
    'selfRow',
    'このイベントの番号 (ゲームが実行時に渡す)。Script API の引数にそのまま書く: ScriptMap.EnableEventCollision(selfRow, 0) で自分の範囲を無効にする',
  ),
  w(
    'value',
    'state',
    'このイベントの状態 (0〜255、byte の変数と同じに読み書きする: state = 2、state += 1、if (state == 0) { … })。ゲームのセーブに残る (配布用のパッチでは、ステージが持つ状態の枠としてステージごとに分けて保存する)。行の動作 1〜3 は状態で選ばれ (0 → 動作 1、1 → 2、2・3 → 3)、出る・消える条件の「イベントの状態」で比べられる。state に書くイベントは、実行のあとにゲームが状態を進めない (書かないイベントは 0 → 1 → …と進む)。マップの始まり・入場の演出には自分の行がないので state(イベント番号) で書く',
  ),
  w(
    'value',
    'state(イベント)',
    'そのイベント (主人公がいる MapGroup の行) の状態。state と同じに読み書きする: state(12) = 1。番号は数で書く',
  ),
  w('value', 'vec(x, y, z)', 'Script API の位置の引数 (GSvec)。x・y・z には変数や計算も書ける'),
  w(
    'value',
    '計算式',
    '数の引数には + - * / と ( ) が書ける (スクリプトを作るときに計算する): 例 deg * 3.14159265 / 180、z + 500',
  ),
  w(
    'statement',
    'vanishEffect(だれに)',
    'モンスターの大きさに合った、本家のボス撃破後の光のエフェクトをその足元に出す (ライブラリの vanish が使う)。エフェクトはイベントが持ち、イベントの終わりに消える。マップにいなければ何もしない。中身: ScriptMap::GetMapChara / ScriptMonsterCtrl::GetMonsterSize / ScriptEffect::CreateEffect / ScriptChara::GetShadowPos / SetPos / ScriptEffect::StartEffect',
  ),
  w(
    'statement',
    'rareItem(アイテム, 数, 前置き, 後片付け, 仲間を消す, 隊列に戻す)',
    '本体のレアアイテムの演出 (RareItemDirection::StartItem / StartItemNum): 先頭の電波人間の頭上にアイテムを光らせて出し、持ち物に加えて「手に入れた」と言い、しまうまで待つ。数は 1〜9999。あとの 4 つは 0 / 1: 前置き = カメラを保存して寄せ、先頭を正面に向ける。後片付け = カメラ・表情・モーション・カメラの追従を戻す。仲間を消す = ほかの電波人間を消し、後片付けで戻す。隊列に戻す = 後片付けの最後に隊列の追従を再開する。演出はイベントが持ち、イベントの終わりに消える。ライブラリの giveItem / chestItem が使う。本家の CRO 3・12 は自分で先頭を構えさせてから (0, 0, 1, 1) で呼ぶ',
  ),
  w(
    'statement',
    'clearTelop()',
    'ステージをクリアにする: 本体の「クリア」の演出 (ClearTelop::ShowClearTelop)、ステージの結果の画面 (ScriptMenu::CallMenu(0x3E))、島へ戻る (ScriptMap::ChangeMapIsland(0))。イベントが終わったあと、このステージがクリア済みになる (ScriptFlag::ClearMapGroup。本家 CRO 23・28 の NPC と同じく、イベントの後処理で書く)。演出はイベントが持つ。入場の演出のイベントでは使えない。ライブラリの clearStage が、電波人間を正面に向けてから呼ぶ',
  ),
  w(
    'statement',
    'buttonOff(イベント)',
    'そのイベントのボタン (区画 5 の種類 4〜6) をすぐ上げる (ChrGimmick::ButtonOff と、押されている印を 0 に)。もう一度乗れば押せる。イベントの状態は変えない (ライブラリの switchOff が ScriptFlag.SetScriptState(イベント, 0) も書く)。マップにいなければ何もしない。本家 CRO 5 が違う順で踏まれたボタンを戻すのに使う。押す (オンにする) 関数はゲームが外に出していないので書けない',
  ),
];

export interface ScriptSample {
  name: string;
  about: string;
  /** The script's text: its variables and functions are put into the editor; the author gives the functions to rows. */
  source: string;
  /** What to give each function to, as told to the author. */
  give: string[];
}

/** The example the editor had before functions: an event written in place (still read). */
export const STAGE_SCRIPT_EXAMPLE = `// 変数: byte = 数値 (0〜255)、bit = フラグ (0 / 1)。reset を付けると、ステージを離れるたびに 0 に戻る
var STATE_A: byte

// MapGroup 1 のイベント 5 のキャラに話しかけたとき
on talk(1, 5) {
  switch (STATE_A) {
    case 0: talk(0x80000060)
    case 1: talk(0x80000061)
    case 2: talk(0x80000062); return
  }
  if (ScriptMenu.SystemMessageYesNo(0x80000063)) {
    hero.SetPopup(2, 11, 1, 1, 0, vec(0, 0, 0))   // 頭の上に「！」
    ScriptSound.Play(0x7A, 0)
    talk(0x80000064)
    STATE_A = 2
  } else {
    STATE_A = 1
    talk(0x80000065)
  }
}
`;

export const SCRIPT_SAMPLES: ScriptSample[] = [
  {
    name: 'モンスターとの会話',
    about:
      '話しかけたモンスターと主人公が、カメラを切り替えながら話します。暗転中に、主人公をモンスターの手前 (+Z 側) に置いて仲間を凸形に並べ (ライブラリの partyLineUp)、モンスターを主人公へ向けます。カメラは眼と注視点の高さをそろえて水平にし、話す人を正面から写します (shoot)。台詞のたびに、口を動かす相手を say で選びます。終わりにもう一度暗転して、カメラと仲間の追従を戻します。台詞の行 ID は自分のステージのものに、主人公とモンスターの距離 (800)・カメラの距離 (500) と高さ (120) は相手の大きさに合わせて直してください。主人公と仲間はモンスターの南 (+Z 側) に並ぶので、そこが歩ける床になるようにモンスターを置いてください。',
    give: ['monster_talk → モンスターのレコード (話しかけたとき)'],
    source: `// 話しかけたモンスター (self) と主人公 (hero) が、カメラを切り替えながら話す
function monster_talk() {
  let m = self.GetPos()                      // モンスターの位置
  ScriptSystem.FadeOutWait(0.3, 2)           // 暗転
  // 主人公をモンスターの 800 手前 (+Z 側) に置き、仲間をその後ろに凸形に並べる (1 = −Z を向く)
  partyLineUp(m.x, m.z + 800, 1)
  self.RotateCharaTo(hero, 0, 0, 0, 0)       // モンスターを主人公へ向ける (暗転中なので一瞬で)
  ScriptCamera.PauseCameraUpdater()          // フィールドの自動追従を止める
  shoot(self, 500, 0)                        // モンスターを正面 (+Z 側) から
  ScriptSystem.FadeInWait(0.3, 2)

  say(self, 0x80000030)                      // モンスター
  shoot(hero, -500, 0.5)                     // 主人公を正面 (−Z 側) から
  say(hero, 0x80000031)                      // 主人公
  shoot(self, 500, 0.5)
  say(self, 0x80000032)                      // モンスター

  ScriptSystem.FadeOutWait(0.3, 2)           // 暗転してから戻す
  ScriptCamera.MoveFieldCamera(0, 2)         // カメラをフィールドの視点へ
  ScriptCamera.WaitAnimation()
  ScriptCamera.ResumeCameraUpdater()         // 自動追従を再開する
  ScriptMap.SetUpdateFormation(1)            // 仲間の追従を再開する (隊列に戻る)
  ScriptSystem.FadeInWait(0.3, 2)
}

// カメラを水平にして who を正面から写す: who から z 方向に dz 離れた、高さ 120 の眼から、同じ高さの who を見る
// (眼と注視点の高さがそろうと水平)。sec 秒で動かす
function shoot(who: obj, dz: num, sec: num) {
  let p = who.GetPos()
  ScriptCamera.MoveEyeAndTarget(vec(p.x, 120, p.z + dz), vec(p.x, 120, p.z), sec, 2)
  ScriptCamera.WaitAnimation()
}

// who の口を動かしながら台詞を出す (ライブラリの talk の、話す人を選べる形)
function say(who: obj, line: num) {
  who.StartAnimation(0x80000079, 0, 1, 0)    // 口を動かす
  ScriptMenu.StartMessage(line, 0, 0, 0.2)   // 台詞 (読み終わるまで待つ)
  who.StartAnimation(0x80000075, 0, 1, 0)    // 口を止める
}
`,
  },
  {
    name: 'ボタンを押すと隠れていたワープが開く',
    about:
      '区画 3 の出入口 (ワープ) は、見えなくしても大きさを 0 にしても踏めてしまうので、本家 (content 107 のボタン) と同じく、まだ開いていない間は位置ごとマップの外 (20000, 0, 20000) へ移して隠します。隠すのは「マップが始まるとき」の関数で、マップを読み直すたびに WARP_OPEN を見て置き直します (移した位置は保存されないため)。下画面のミニマップのワープのアイコンは、マップを読んだときの位置に 1 度だけ作られ、ワープを動かしてもついて来ません。代わりに、ワープが見える (SetVisible) か動いている (SetViewActive) 間だけ表示されるので、隠す間は両方を 0 にします。ボタンを踏むと、両方を 1 に戻し、大きさ 0 にして本来の位置へ戻し、カメラを向けて 0.5 秒で広げます。17 はワープのイベント番号、(3750, 0, 2750) はマップのページで見たワープの位置に直してください。戦闘の後など、マップが作り直されるのを待ってよいときは、スクリプトを使わずにワープの「出る条件」にフラグを書くほうが簡単です。',
    give: ['hide_warp → ステージのページの「マップが始まるとき」', 'open_warp → ボタンのレコード (ボタンを踏んだとき)'],
    source: `var WARP_OPEN: bit   // ワープが開いたか (セーブに残る)

// マップが始まるとき: まだ開いていなければ、ワープを遠くへ移して隠す。
// 区画 3 の出入口は、見えなくしても大きさを 0 にしても踏めるので、位置ごと外へ出す (本家 content 107 の準備と同じ)
function hide_warp() {
  if (WARP_OPEN == 0) {
    obj(17).SetVisible(0)                  // 17 = ワープのイベント番号
    obj(17).SetViewActive(0)               // 見えず動かない間は、ミニマップのアイコンも出ない
    obj(17).SetPos(vec(20000, 0, 20000))   // 踏めないように遠くへ
    obj(17).RecoverCollision()             // 移した位置で当たりを置き直す
  }
}

// ボタンを踏んだとき: ワープを元の位置に戻し、大きさ 0 から広げて出す
function open_warp() {
  if (WARP_OPEN == 1) { return }           // もう開いている
  WARP_OPEN = 1
  obj(17).SetScaleA(0)                     // 大きさ 0 にしてから
  obj(17).SetPos(vec(3750, 0, 2750))       // 本来の位置 (マップのページのワープの位置) に戻す
  obj(17).RecoverCollision()
  obj(17).SetViewActive(1)                 // 見えて動くように戻す (ミニマップのアイコンも出る)
  obj(17).SetVisible(1)
  camera(obj(17), 1)                       // カメラをワープへ
  ScriptSound.Play(717, 0)                 // ワープが出る音
  obj(17).ScaleTo(vec(1, 1, 1), 0.5, 0, 0, 0)   // 0.5 秒で元の大きさへ
  obj(17).WaitNodeAnimation()              // 広がり終わるまで待つ
  ScriptSystem.WaitTime(0.5)
  cameraBack(1)
}
`,
  },
  {
    name: '領域に立ち入ると主人公が話し、イベントが無効になる',
    about:
      '範囲 (区画 7) に入ると主人公が台詞を言い、その範囲を無効にします。EnableEventCollision(selfRow, 0) はすぐ効きますが、マップを読み直すと元に戻ります。そこで SPOKE を立てておき、範囲のレコードの「消える条件」を「フラグが立っている: SPOKE」にすると、次からは範囲そのものが出ません。台詞の行 ID は自分のステージのものに直してください。',
    give: ['hero_speaks → 範囲のレコード (範囲に入ったとき)'],
    source: `var SPOKE: bit   // もう話したか (セーブに残る)

// 範囲に入ったとき: 主人公が話し、この範囲を無効にする
function hero_speaks() {
  ScriptMap.EnableEventCollision(selfRow, 0)   // この範囲をすぐ無効に (マップを読み直すと戻る)
  SPOKE = 1                                    // 戻ったあとは、範囲の「消える条件」で消す
  hero.StartAnimation(0x80000079, 0, 1, 0)     // 口を動かす
  ScriptMenu.StartMessage(0x80000040, 0, 0, 0.2)
  hero.StartAnimation(0x80000075, 0, 1, 0)     // 口を止める
}
`,
  },
  {
    name: 'ボタンを押したら扉が開く',
    about:
      'ボタン (区画 5 の種類 4〜6) を踏むと、扉を開けます (カメラ・解錠の音・扉のアニメはライブラリの openDoor がする。音を替えたいときはライブラリから追加して改造)。扉は「外から開ける扉」(動作の型 17) にして、イベント番号を 3 のところに書きます。2 つ以上の扉は openDoor を続けて書くと 1 つずつ (毎回ギミックの音とカメラの戻りつきで) 開きます。',
    give: ['open_door → ボタンのレコード (ボタンを踏んだとき (押したままになる))'],
    source: `function open_door() {
  // 3 = 扉のイベント番号
  ScriptMap.SetUpdateFormation(0)   // 仲間の追従を止める
  openDoor(3)
  ScriptMap.SetUpdateFormation(1)
}
`,
  },
  {
    name: 'モンスターと会話し、戦闘に移る',
    about:
      '話しかけると「戦うか」を聞き、はいなら戦闘に移ります。EncountBoss でイベントは終わり、勝つとマップの始まりからやり直しになるので、勝ったあとの続きは「マップが始まるとき」の関数に書きます。負けて帰還すると BOSS は 0 に戻ります (reset)。台詞の行 ID・群れ・モンスターと扉のイベント番号は自分のステージのものに直してください。相手のレコードの「消える条件」は「数値フラグ BOSS ≥ 3」にします。',
    give: [
      'boss_talk → 相手のキャラのレコード (話しかけたとき)',
      'after_battle → ステージのページの「マップが始まるとき」',
    ],
    source: `var BOSS: byte reset

function boss_talk() {
  talk(0x80000010)
  if (ScriptMenu.SystemMessageYesNo(0x80000011)) {
    self.SetPopup(2, 11, 1, 1, 0, vec(0, 0, 0)); ScriptSound.Play(0x7A, 0)
    BOSS = 2                      // 2 = 戦いを始めた (勝てばそのまま、負ければ reset で 0)
    ScriptMap.EncountBoss(5, 0)   // 5 = MonsterGroup の行番号 (行 ID ではない)。ここでイベントは終わる
  } else {
    talk(0x80000012)
  }
}

function after_battle() {
  if (BOSS == 2) {
    vanish(9)          // 9 = マップ上のモンスターのイベント番号
    BOSS = 3           // 消滅後はこの続きが 1 回だけになる
    ScriptMenu.StartMessageAuto(0x80000013, 0, 0, 0.2)
    openDoor(3)        // 3 = 扉のイベント番号
  }
}
`,
  },
  {
    name: 'カメラを物・キャラへ向ける',
    about:
      'カメラを、指定した物・キャラのほうへ 1.5 秒かけて動かし、少し見せてからフィールドの視点へ戻します。5 のところに、向けたい物のイベント番号を書きます (自分なら self、先頭の電波人間なら hero)。中の 3 行はライブラリの camera(obj(5), 1.5) と同じなので、1 行で書いてもかまいません。',
    give: ['look_at → 好きなレコード (話しかけたとき・ボタンを踏んだときなど)'],
    source: `function look_at() {
  ScriptCamera.PauseCameraUpdater()   // ① フィールドの自動追従を止める (イベントで 1 回)
  // ② obj(5) へ 1.5 秒で向ける。vec(0, 0, 0) 2 つと最後の 2 は本家と同じ値のままでよい
  ScriptCamera.MoveEyeAndTarget(obj(5), 1.5, vec(0, 0, 0), vec(0, 0, 0), 2)
  ScriptCamera.WaitAnimation()        // ③ カメラが動き終わるまで待つ
  ScriptSystem.WaitTime(1)            // 1 秒見せる
  cameraBack(1)                       // ④ 1 秒でフィールドの視点へ戻し、自動追従を再開する
}
`,
  },
  {
    name: 'カメラを水平にする',
    about:
      '眼 (カメラの位置) と注視点 (見る場所) の高さ y を同じにすると、カメラは水平になります (眼を低くすると見上げ、高くすると見下ろし)。ライブラリの cameraLook(眼 x, 眼 y, 眼 z, 注視点 x, 注視点 y, 注視点 z, 秒) で 1.5 秒かけて動かします。例はセル (7, 5) の中心 (x = 250 + 500 × 7、z = 250 + 500 × 5) を高さ 300 で、+Z 側に 1800 離れて見ます (距離と高さは本家 CRO 124 の値に近い)。フィールドのカメラは +Z 側から −Z を見ているので、眼の z を注視点より大きくすると、いつもと同じ向きのまま水平になります。',
    give: ['look_level → 好きなレコード (話しかけたとき・ボタンを踏んだときなど)'],
    source: `function look_level() {
  // 注視点: (3750, 300, 2750)  眼: (3750, 300, 4550) … 高さ 300 がそろっているので水平
  cameraLook(3750, 300, 4550, 3750, 300, 2750, 1.5)
  ScriptSystem.WaitTime(1)   // 1 秒見せる
  cameraBack(1)              // フィールドの視点へ戻す
}
`,
  },
];

/** The Script API functions (and the library's talk) whose first argument is a line of talk. */
export const SCRIPT_LINE_CALLS = ['talk', 'StartMessage', 'StartMessageAuto', 'SystemMessageYesNo'];
const LINE_RE = new RegExp(
  String.raw`\b(?:${SCRIPT_LINE_CALLS.join('|')})\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*[,)]`,
  'gu',
);
/** The line IDs a function's text names, with the place just after each call (comments not read). */
export function scriptLineMarks(body: string): { id: number; at: number }[] {
  const code = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => ' '.repeat(c.length));
  return [...code.matchAll(LINE_RE)].map((m) => ({ id: Number(m[1]), at: callEnd(code, m.index + m[0].length - 1) }));
}
/** The place just after the parenthesis that closes a call, from inside its arguments (the line's end if none). */
export function callEnd(code: string, from: number): number {
  let at = from;
  for (let depth = 0; at < code.length && code[at] !== '\n'; at++)
    if (code[at] === '(') depth++;
    else if (code[at] === ')' && depth-- === 0) return at + 1;
  return at;
}
/** The line IDs a function's text names, each once, in the order they are written. */
export function scriptLineRefs(body: string): number[] {
  return [...new Set(scriptLineMarks(body).map((m) => m.id))];
}
