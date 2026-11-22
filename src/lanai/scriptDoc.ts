// The editor's side of a stage's event script (eventScript.ts ScriptDoc): giving functions to the rows of a map and
// taking them back, the words of the language as the editor lists them (help now, completion later), and the samples.
import { triggerHasRow, type ScriptBinding, type ScriptDoc, type ScriptTrigger } from './eventScript';

/** What a binding is of: a row of a map group's EventObject table, or the group's start. */
export interface BindingTarget {
  trigger: ScriptTrigger;
  group: number;
  row: number;
}
/** Whether two bindings are of the same thing: a row has one event whatever starts it, a group has one start. */
export const sameTarget = (a: BindingTarget, b: BindingTarget): boolean =>
  a.group === b.group &&
  (triggerHasRow(a.trigger) ? triggerHasRow(b.trigger) && a.row === b.row : a.trigger === b.trigger);

/** The function given to a row (whatever starts it), if any. */
export const rowBinding = (doc: ScriptDoc, group: number, row: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => triggerHasRow(b.trigger) && b.group === group && b.row === row);
/** The function given to a group's start, if any. */
export const startBinding = (doc: ScriptDoc, group: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => b.trigger === 'start' && b.group === group);
/** A group's opening (intro), if it has one: its function, or '' for the game's part alone. */
export const introBinding = (doc: ScriptDoc, group: number): ScriptBinding | undefined =>
  doc.bindings.find((b) => b.trigger === 'intro' && b.group === group);

/** The document with a function given to a target (in place of what the target had). */
export function docBound(doc: ScriptDoc, b: ScriptBinding): ScriptDoc {
  const row = triggerHasRow(b.trigger) ? b.row : 0;
  return { ...doc, bindings: [...doc.bindings.filter((x) => !sameTarget(x, b)), { ...b, row }] };
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
