// The library of a stage's event script (eventScript.ts): functions written in the script's own language, which every
// script can call without writing them. A script's own function of the same name takes their place, so a library
// function is changed by copying it into the script (the editor's help shows their text and copies it).
// A function with arguments is written out where it is called (the arguments are numbers and characters known when
// the script is built), so nothing of the game's state is passed at run time.

export interface ScriptLibraryFunction {
  name: string;
  /** What it does, as the help says. */
  about: string;
  /** The whole `function name(…) { … }`. */
  source: string;
}

export const SCRIPT_LIBRARY: ScriptLibraryFunction[] = [
  {
    name: 'openDoor',
    about:
      '「外から開ける扉」(動作の型 17) を本家と同じ演出で開ける (CRO 117 D01BossWin のボス後の扉): カメラを扉へ → 解錠の音 → 開く音と扉のアニメ → ギミックの音 → カメラを戻す。扉はイベント番号 (openDoor(3)) か chara(3) で書く',
    source: `function openDoor(door: chara) {
  door.camera(1)
  wait(0.5)
  se(0x79)          // 解錠の音
  wait(1.5)
  se(0x7A)          // 開く音
  door.open()       // 扉のアニメ → 終わるまで待つ → 開いた状態
  jingle()          // BGM を止めてギミックの音
  wait(0.3)
  cameraBack(1)
}`,
  },
  {
    name: 'cameraLook',
    about:
      'カメラを、眼の位置 (ex, ey, ez) から注視点 (tx, ty, tz) を見る位置へ sec 秒で動かす。ey を ty より低くするとローアングル (見上げ) になる (本家 CRO 124: cameraLook(3500, 254, 4738, 3500, 323, 2896, 1.5))。フィールドのカメラは +Z 側から −Z を見ている。終わりに cameraNormal で戻す',
    source: `function cameraLook(ex: num, ey: num, ez: num, tx: num, ty: num, tz: num, sec: num) {
  ScriptCamera.PauseCameraUpdater()   // フィールドの自動追従を止める
  ScriptCamera.MoveEyeAndTarget(vec(ex, ey, ez), vec(tx, ty, tz), sec, 0)
  ScriptCamera.WaitAnimation()        // 動き終わるまで待つ
}`,
  },
  {
    name: 'cameraNormal',
    about:
      'カメラをフィールドの通常の視点へ sec 秒で戻し、自動追従を再開する (本家 CRO 1 D01BossWin: MoveFieldCamera(1.1, 2))。cameraLook や ScriptCamera を直接動かしたあとに呼ぶ (camera() のあとは cameraBack)',
    source: `function cameraNormal(sec: num) {
  ScriptCamera.MoveFieldCamera(sec, 2)
  ScriptCamera.WaitAnimation()
  ScriptCamera.ResumeCameraUpdater()  // フィールドの自動追従を再開する
}`,
  },
  {
    name: 'partyLineUp',
    about:
      '仲間の追従を止め、先頭の電波人間を (x, z) に置いて、残りを先頭の後ろに横へ広げて並べる (凸形)。dir は向き (1 = −Z、2 = −X、4 = +Z、8 = +X)。その場に一瞬で置かれるので fadeOut の間に呼ぶとよい。本家 CRO 18 D01BossWin: (3750, 4150, 4)、間隔 150。follow(1) で追従に戻す (推定を含む)',
    source: `function partyLineUp(x: num, z: num, dir: num) {
  follow(0)                                        // 仲間の追従を止める
  ScriptMap.SetPartyConvexPosition(vec(x, 0, z), dir, 150)
}`,
  },
  {
    name: 'partyColumn',
    about:
      '仲間の追従を止め、先頭の電波人間を (x, z) に置いて、残りを dir の向き (1 = −Z、2 = −X、4 = +Z、8 = +X) へ 100 ずつ一直線に並べる。カメラから見て横一列にするには dir を 2 か 8 にする。一瞬で置かれる (本家 CRO 2 は暗転中に (3750, 3030, 4))。follow(1) で追従に戻す',
    source: `function partyColumn(x: num, z: num, dir: num) {
  follow(0)                                        // 仲間の追従を止める
  ScriptMap.SetPartyPosition(vec(x, 0, z), dir, 1, 100)
}`,
  },
];

/** `name(params)` of a library function, from its text. */
export const libraryForm = (f: ScriptLibraryFunction): string =>
  /^function\s+(\w+\s*\([^)]*\))/u.exec(f.source)?.[1] ?? `${f.name}()`;
