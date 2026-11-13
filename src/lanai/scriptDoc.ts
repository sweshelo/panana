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
  w('statement', 'talk(行 ID)', '台詞。話しかけたときのイベントでは、話している間キャラの口が動く'),
  w('statement', 'say(行 ID)', '台詞 (口は動かさない)。話者が主人公の行は、先頭の電波人間の性格の行に替わる'),
  w('value', 'ask(行 ID)', '「はい / いいえ」を聞く。if (ask(…)) { はい } else { いいえ }'),
  w('statement', '名前 = 値', '変数に書く (数値は 0〜255、フラグは 0 / 1)'),
  w(
    'flow',
    'if (条件) { … } else { … }',
    '条件: 名前、!名前、名前 == 値 (!= < <= > >=)、ask(行 ID)、item(ID) >= 個数、state(イベント) >= 値、monsters() == 0',
  ),
  w('flow', 'switch (名前) { case 値: … default: … }', '値で分ける。case は下へ続かない (break は書かなくてよい)'),
  w('flow', 'return', 'イベントをそこで終える'),
  w('who', 'hero', '先頭の電波人間'),
  w('who', 'self', 'イベントの持ち主 (話しかけた相手・踏んだボタン)'),
  w('who', 'chara(イベント)', 'そのイベントを使うキャラ・物・扉'),
  w('statement', 'popup(だれに, アイコン)', '頭の上にアイコンを出す (11 = 汗)。popupEnd(だれに) で消す'),
  w('statement', 'popupEnd(だれに)', 'アイコンを消す'),
  w('statement', 'emotion(表情)', '先頭の電波人間の目の表情。emotionEnd() で戻す'),
  w('statement', 'emotionEnd()', '表情を戻す'),
  w('statement', 'anim(だれに, アニメ[, 種類])', 'モーションを始める。waitAnim(だれに) で終わるまで待つ'),
  w('statement', 'waitAnim(だれに)', 'モーションが終わるまで待つ'),
  w('statement', 'move(だれに, x, y, z)', 'その位置まで動かして、着くまで待つ (先頭の電波人間は歩くモーション付き)'),
  w('statement', 'turn(だれに, 角度)', '向きを変える (度)'),
  w('statement', 'face(だれに, 相手)', '相手のほうを向かせる'),
  w('statement', 'show(だれに)', '見えるようにする'),
  w('statement', 'hide(だれに)', '見えなくする'),
  w(
    'statement',
    'camera(だれに, 秒)',
    'カメラをそのキャラへ向ける。終わりに cameraBack(秒) で戻す (戻さなくてもイベントの終わりに戻る)',
  ),
  w('statement', 'cameraBack(秒)', 'カメラをパーティへ戻す'),
  w('statement', 'fadeOut(秒)', '画面を暗くする。暗いままイベントを終えないこと'),
  w('statement', 'fadeIn(秒)', '画面を明るくする'),
  w('statement', 'follow(0 / 1)', '仲間が先頭についてくるのを止める / 戻す'),
  w('statement', 'se(音)', '音を鳴らす (SoundData の行)'),
  w('statement', 'wait(秒)', '待つ'),
  w('statement', 'addItem(ID, 個数)', 'アイテムを増やす (負の数で減らす)'),
  w('statement', 'getItem(ID, 個数)', 'アイテムを増やし、「手に入れた」の文を出す'),
  w('statement', 'addGold(金額)', 'お金を増やす (負の数で減らす)'),
  w('statement', 'openDoor(イベント)', '「外から開ける扉」(動作の型 17) を開ける'),
  w('statement', 'closeDoor(イベント)', '扉を閉める'),
  w('statement', 'disable()', '範囲のイベントで: この範囲をもう働かなくする'),
  w('statement', 'collision(イベント, 0 / 1)', '範囲を働かなくする / 働くようにする'),
  w('statement', 'remove(イベント)', 'そのイベントのキャラ・物を消す'),
  w(
    'statement',
    'battle(群れ)',
    'モンスターの群れ (MonsterGroup の行) と戦う。イベントはここで終わり、勝つとマップの始まりからやり直しになる',
  ),
  w('statement', 'stageName()', 'ステージの名前を出す (マップが始まるときのイベント用)'),
  w('value', 'item(ID)', 'アイテムの個数'),
  w('value', 'state(イベント)', 'そのイベントが何回実行されたか (0〜3)'),
  w('value', 'monsters()', 'マップに残っているモンスターの数'),
  w(
    'statement',
    'クラス.関数(引数)',
    'ゲームの Script API を名前で呼ぶ (例: ScriptSound.Play(0x84, 0))。値としても使える',
  ),
  w(
    'statement',
    'だれに.関数(引数)',
    'キャラの Script API を呼ぶ (例: hero.SetVisible(0)、chara(3).MoveTo(vec(1, 2, 3), 0, 0, 0, 0, 0))',
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
    case 0: talk(0x60)
    case 1: talk(0x61)
    case 2: talk(0x62); return
  }
  if (ask(0x63)) {
    popup(11); se(0x84)
    talk(0x64)
    STATE_A = 2
  } else {
    STATE_A = 1
    talk(0x65)
  }
}
`;

export const SCRIPT_SAMPLES: ScriptSample[] = [
  {
    name: 'ボタンを押したら扉が開く',
    about:
      'ボタン (区画 5 の種類 4〜6) を踏むと、扉までカメラを向けて開けます。扉は「外から開ける扉」(動作の型 17) にして、イベント番号を 3 のところに書きます。',
    give: ['open_door → ボタンのレコード (ボタンを踏んだとき)'],
    source: `function open_door() {
  // 3 = 扉のイベント番号
  follow(0)
  camera(chara(3), 1.3)
  se(0x8D)
  openDoor(3)
  wait(1)
  cameraBack(1.1)
  follow(1)
}
`,
  },
  {
    name: 'モンスターと会話し、戦闘に移る',
    about:
      '話しかけると「戦うか」を聞き、はいなら戦闘に移ります。battle() でイベントは終わり、勝つとマップの始まりからやり直しになるので、勝ったあとの続きは「マップが始まるとき」の関数に書きます。負けて帰還すると BOSS は 0 に戻ります (reset)。台詞の行 ID・群れ・扉の番号は自分のステージのものに直してください。倒したあとに相手を消すには、相手のレコードの「消える条件」を「数値フラグ BOSS ≥ 2」にします。',
    give: [
      'boss_talk → 相手のキャラのレコード (話しかけたとき)',
      'after_battle → ステージのページの「マップが始まるとき」',
    ],
    source: `var BOSS: byte reset

function boss_talk() {
  talk(0x10)
  if (ask(0x11)) {
    popup(self, 11); se(0x84)
    BOSS = 2          // 2 = 戦いを始めた (勝てばそのまま、負ければ reset で 0)
    battle(5)         // 5 = モンスターの群れ。ここでイベントは終わる
  } else {
    talk(0x12)
  }
}

function after_battle() {
  if (BOSS == 2) {
    BOSS = 3          // 続きは 1 回だけ
    say(0x13)
    openDoor(3)       // 3 = 扉のイベント番号
  }
}
`,
  },
];

/** The line IDs a function's text names (talk / say / ask), each once, in the order they are written. */
export function scriptLineRefs(body: string): number[] {
  const out: number[] = [];
  const code = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, '');
  for (const m of code.matchAll(/\b(?:talk|say|ask)\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*\)/gu)) {
    const id = Number(m[1]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
