// The library of a stage's event script (eventScript.ts): functions written in the script's own language, which every
// script can call without writing them. Each is several calls of the game's Script API in the order the shipped CROs
// make them (a function of one call is not here: the script calls the Script API itself). A script's own function of
// the same name takes their place, so a library function is changed by copying it into the script (the editor's help
// shows their text and copies it). A function with arguments is written out where it is called (the arguments are
// numbers and objects known when the script is built), so nothing of the game's state is passed at run time. A
// function whose first argument is an object (obj) or an event's number (num) can also be written after the object:
// `obj(3).open()` is `open(3)`, `hero.move(250, 0, 750)` is `move(hero, 250, 0, 750)`.

export interface ScriptLibraryFunction {
  name: string;
  /** What it does, as the help says. */
  about: string;
  /** The whole `function name(…) { … }`. */
  source: string;
}

export const SCRIPT_LIBRARY: ScriptLibraryFunction[] = [
  {
    name: 'talk',
    about:
      '話しかけたときのイベントで、話している相手 (self) の口を動かしながら台詞を出す (行 ID は 0x800000NN)。ほかのイベントの台詞は ScriptMenu.StartMessageAuto(行 ID, 0, 0, 0.2) で出す。3 つ目の 0 は窓: 0 = 台詞の行の話者で決まる、1 = 会話の吹き出し、2 = システムのウィンドウ',
    source: `function talk(line: num) {
  self.StartAnimation(0x80000079, 0, 1, 0)   // 口を動かす
  ScriptMenu.StartMessage(line, 0, 0, 0.2)   // 台詞 (読み終わるまで待つ)
  self.StartAnimation(0x80000075, 0, 1, 0)   // 口を止める
}`,
  },
  {
    name: 'move',
    about:
      'その位置まで動かして、着くまで待つ (モーションは変えない。パーティを歩かせるのは walk)。x・z はマップの横・縦、y は高さ (床 = 0)。1 セル = 500 で、セル c の中心は 250 + 500 × c。マップのページの 2D・3D でドラッグして直せる',
    source: `function move(who: obj, x: num, y: num, z: num) {
  who.MoveTo(vec(x, y, z), 0, 0, 0, 0, 0)
  who.WaitNodeAnimation()                    // 着くまで待つ
}`,
  },
  {
    name: 'walk',
    about:
      'パーティの電波人間 (hero など) を、歩くモーションでその位置まで動かし、着いたら立つモーションに戻す。位置は move と同じで、マップのページでドラッグして直せる',
    source: `function walk(who: obj, x: num, y: num, z: num) {
  who.StartAnimation(0x80000003, 0, 1, 0)    // 歩くモーション
  move(who, x, y, z)
  who.StartAnimation(0x80000001, 0, 1, 0)    // 立つモーション
}`,
  },
  {
    name: 'turn',
    about: '向きを変える (度。0.25 秒で回り、回り終わるまで待つ)',
    source: `function turn(who: obj, degrees: num) {
  who.RotateTo(degrees * 3.14159265 / 180, 0.25, 0, 0, 0, 1)
  ScriptSystem.WaitTime(0.25)
}`,
  },
  {
    name: 'face',
    about: '相手のほうを向かせる (0.25 秒で回り、回り終わるまで待つ)',
    source: `function face(who: obj, to: obj) {
  who.RotateCharaTo(to, 0.25, 0, 0, 0)
  ScriptSystem.WaitTime(0.25)
}`,
  },
  {
    name: 'camera',
    about:
      'カメラを、フィールドの自動追従を止めてそのキャラ・物へ sec 秒で向ける (本家 CRO 18 のボタン)。cameraBack(秒) で戻す (戻さなくてもイベントの終わりに戻る)',
    source: `function camera(who: obj, sec: num) {
  ScriptCamera.PauseCameraUpdater()          // 自動追従を止める (イベントで 1 回だけ)
  ScriptCamera.MoveEyeAndTarget(who, sec, vec(0, 0, 0), vec(0, 0, 0), 2)
  ScriptCamera.WaitAnimation()               // 動き終わるまで待つ
}`,
  },
  {
    name: 'cameraBack',
    about:
      'カメラをフィールドの通常の視点へ sec 秒で戻し、自動追従を再開する (本家 CRO 1 D01BossWin: MoveFieldCamera(1.1, 2))。camera や cameraLook のあとに呼ぶ',
    source: `function cameraBack(sec: num) {
  ScriptCamera.MoveFieldCamera(sec, 2)
  ScriptCamera.WaitAnimation()
  ScriptCamera.ResumeCameraUpdater()         // 自動追従を再開する
}`,
  },
  {
    name: 'cameraLook',
    about:
      'カメラを、眼の位置 (ex, ey, ez) から注視点 (tx, ty, tz) を見る位置へ sec 秒で動かす。ey を ty より低くするとローアングル (見上げ) になる (本家 CRO 124: cameraLook(3500, 254, 4738, 3500, 323, 2896, 1.5))。フィールドのカメラは +Z 側から −Z を見ている。終わりに cameraBack で戻す',
    source: `function cameraLook(ex: num, ey: num, ez: num, tx: num, ty: num, tz: num, sec: num) {
  ScriptCamera.PauseCameraUpdater()          // 自動追従を止める
  ScriptCamera.MoveEyeAndTarget(vec(ex, ey, ez), vec(tx, ty, tz), sec, 0)
  ScriptCamera.WaitAnimation()               // 動き終わるまで待つ
}`,
  },
  {
    name: 'open',
    about:
      '扉の開くアニメを再生し、終わるまで待って開いた状態にする。カメラ・音・ギミックの音は付かない (前に ScriptSound.Play(音, 0) を書く)。obj(3).open() とも書ける。演出なしで開けるだけなら ScriptMap.SetDoorOpenFlag(イベント番号)',
    source: `function open(door: num) {
  obj(door).StartAnimation(0x80000073, 0, 1, 0)   // 扉の開くモーション
  obj(door).WaitAnimation(0x3E)                   // 終わるまで待つ
  ScriptMap.SetDoorOpenFlag(door)                 // 開いた状態にする
}`,
  },
  {
    name: 'jingle',
    about:
      'BGM を止めて (0.3 秒) ギミックの音を鳴らし、1 秒後に BGM を戻す (0.3 秒)。音は SoundData の行番号 (openDoor は 0x41)',
    source: `function jingle(sound: num) {
  ScriptSound.PauseBGM(0.3)
  ScriptSound.Play(sound, 0)
  ScriptSystem.WaitTime(1)
  ScriptSound.ReplayBGM(0.3)
}`,
  },
  {
    name: 'openDoor',
    about:
      '「外から開ける扉」(動作の型 17) を本家と同じ演出で開ける (CRO 117 D01BossWin のボス後の扉): カメラを扉へ → 解錠の音 → 開く音と扉のアニメ → ギミックの音 → カメラを戻す。扉はイベント番号 (openDoor(3)) か obj(3) で書く',
    source: `function openDoor(door: num) {
  camera(obj(door), 1)
  ScriptSystem.WaitTime(0.5)
  ScriptSound.Play(0x79, 0)        // 解錠の音
  ScriptSystem.WaitTime(1.5)
  ScriptSound.Play(0x7A, 0)        // 開く音
  obj(door).open()                 // 扉のアニメ → 終わるまで待つ → 開いた状態
  jingle(0x41)                     // BGM を止めてギミックの音
  ScriptSystem.WaitTime(0.3)
  cameraBack(1)
}`,
  },
  {
    name: 'vanish',
    about:
      'マップ上のモンスターを、本家のボス撃破後と同じ演出で消す (CRO 117 D01BossWin): 倒れるモーション → 透明にしながら消える音と光のエフェクト → イベントのキャラを消す。マップにいないときは何もしない',
    source: `function vanish(monster: num) {
  if (ScriptMap.GetMapChara(monster)) {               // マップにいるときだけ
    obj(monster).CancelAutoAnimation()
    obj(monster).StartAnimation(0x80000066, 0, 1, 0)  // 倒れるモーション
    obj(monster).SetBlendAnim(0)
    obj(monster).WaitAnimation(0x3E)
    obj(monster).AlphaTo(0, 1, 2, 0, 0, 0)            // 1 秒で透明に
    ScriptSound.Play(0xB8, 0)                         // 消える音
    vanishEffect(obj(monster))                        // 光のエフェクト (組み込み)
    obj(monster).WaitNodeAnimation()
    ScriptMap.DeleteEventObject(monster)
  }
}`,
  },
  {
    name: 'giveItem',
    about:
      'NPC などからアイテムを授かる: 本体の演出 (RareItemDirection) で、カメラを寄せて先頭の電波人間を正面に向け、仲間を消し、頭上にアイテムを光らせて出し、持ち物に加えて「手に入れた」と言い、カメラと仲間を戻す。アイテムは行 ID (0x800000D8 など)。持ち物に加えるのも演出がするので、ScriptFlag.AddItemNum は書かない',
    source: `function giveItem(item: num) {
  rareItem(item, 1, 1, 1, 1, 1)   // アイテム, 数, 前置き, 後片付け, 仲間を消す, 隊列に戻す
}`,
  },
  {
    name: 'chestItem',
    about:
      '宝箱からアイテムを取り出す: 本家の宝箱 (動作 0x10、code.bin 0x1F2750) と同じ順で、宝箱のほうを向いて開けるモーション → 開ける音 → 宝箱が開く → 光る音 → giveItem と同じ演出。本家にある、アイテムが箱からせり上がる動きと開く光 (EffectData 0x14 fx_bg_trebox_op) は付かない。宝箱はイベント番号',
    source: `function chestItem(chest: num, item: num) {
  face(hero, obj(chest))                          // 宝箱のほうを向く
  hero.StartAnimation(0x8000004A, 0, 1, 0)        // 開けるモーション
  ScriptSound.Play(0x7C, 0)                       // 開ける音
  obj(chest).StartAnimation(0x8000006F, 0, 1, 0)  // 宝箱が開く
  obj(chest).WaitAnimation(0x3E)
  ScriptSound.Play(0x80, 0)                       // 光る音
  rareItem(item, 1, 1, 1, 1, 1)
}`,
  },
  {
    name: 'partyLineUp',
    about:
      '仲間の追従を止め、先頭の電波人間を (x, z) に置いて、残りを先頭の後ろに横へ広げて並べる (凸形)。dir は向き (1 = −Z、2 = −X、4 = +Z、8 = +X)。その場に一瞬で置かれるので暗転中に呼ぶとよい。本家 CRO 18 D01BossWin: (3750, 4150, 4)、間隔 150。ScriptMap.SetUpdateFormation(1) で追従に戻す (推定を含む)',
    source: `function partyLineUp(x: num, z: num, dir: num) {
  ScriptMap.SetUpdateFormation(0)                  // 仲間の追従を止める
  ScriptMap.SetPartyConvexPosition(vec(x, 0, z), dir, 150)
}`,
  },
  {
    name: 'partyColumn',
    about:
      '仲間の追従を止め、先頭の電波人間を (x, z) に置いて、残りを dir の向き (1 = −Z、2 = −X、4 = +Z、8 = +X) へ 100 ずつ一直線に並べる。カメラから見て横一列にするには dir を 2 か 8 にする。一瞬で置かれる (本家 CRO 2 は暗転中に (3750, 3030, 4))。ScriptMap.SetUpdateFormation(1) で追従に戻す',
    source: `function partyColumn(x: num, z: num, dir: num) {
  ScriptMap.SetUpdateFormation(0)                  // 仲間の追従を止める
  ScriptMap.SetPartyPosition(vec(x, 0, z), dir, 1, 100)
}`,
  },
  {
    name: 'clearStage',
    about:
      'ステージをクリアにする。電波人間をみな正面に向けて 0.5 秒待ち、clearTelop() で「クリア」の演出・結果の画面を出して島へ戻る。イベントのあとで、このステージがクリア済みになる。本家 CRO 23 D0100XF01Npc0562・CRO 28 D01001B01Npc0712 が「はい」のあとにする形 (その前に台詞と SystemMessageYesNo で確かめる)',
    source: `function clearStage() {
  for p in party {
    p.RotateTo(0.0, ScriptMath.GetRotateTime(p.GetRotateY(), 0, 0.5), 0, 0, 0, 1)   // 正面を向く
  }
  ScriptSystem.WaitTime(0.5)
  clearTelop()                                     // クリアの演出・結果の画面・島へ戻る
}`,
  },
  {
    name: 'warp',
    about:
      '別のマップの地点へ移る (map はマップのハッシュ、point は行き先の地点 ID。マップのページの出入口の「到着地点 ID」)。暗転して移る。行き先を変えるには、出入口のレコードに「出入口に入ったとき」の関数を割り当て、ScriptMath.RandRange(100) の値などで warp を呼び分ける (本家 CRO 22 のランダムな落とし穴は 100 のうち 45 などで 2 地点を選ぶ)。本家 CRO 93 S01001F01Collision002 の形',
    source: `function warp(map: num, point: num) {
  ScriptMap.ChangeMap(map, point)
  ScriptSystem.FadeOutWait(0.3, 2)                 // 暗転して移る
}`,
  },
  {
    name: 'switchOff',
    about:
      'ボタン (区画 5 の種類 4〜6) をすぐ上げて、そのイベントの状態を 0 に戻す。もう一度乗れば押せる。本家 CRO 5 D01002B02GimmickCommon が、4 つのボタンを違う順で踏まれたときにみな戻す形 (状態は後処理で戻す)。押されたボタン自身のイベントで自分を戻すときは、state = 0 と書くとゲームが状態を進めない',
    source: `function switchOff(row: num) {
  buttonOff(row)                                   // ボタンを上げる
  ScriptFlag.SetScriptState(row, 0)                // 押されていない状態に戻す
}`,
  },
];

/** `name(params)` of a library function, from its text. */
export const libraryForm = (f: ScriptLibraryFunction): string =>
  /^function\s+(\w+\s*\([^)]*\))/u.exec(f.source)?.[1] ?? `${f.name}()`;
