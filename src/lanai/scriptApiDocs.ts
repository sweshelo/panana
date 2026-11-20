// What the Script API functions a stage script can call (scriptApiTable.ts) do, as read from the Update's code and the
// shipped CROs' calls. Kept apart from scriptApiTable.ts, which is generated. Keyed by the mangled symbol, since a
// name can have several overloads. `args`: the meaning of each argument the script writes (ScriptMessageParam left
// out), in order. `settled: false` = read from the code but not seen in the game (shown as 推定).
export interface ScriptApiDoc {
  about: string;
  args?: string[];
  example?: string;
  settled: boolean;
}

export const SCRIPT_API_DOCS: Record<string, ScriptApiDoc> = {
  // ScriptCamera::BlendCamera(const GSvec&, const GSvec&, const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera11BlendCameraERK5GSvecS2_S2_f10GSAnimMode: {
    about: '眼・注視点・上方向を指定時間で補間する。完了待ちは WaitAnimation を別に呼ぶ。',
    args: ['眼の座標', '注視点', '上方向ベクトル', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::GetFarZ()
  _ZN12ScriptCamera7GetFarZEv: {
    about: '遠クリップ面の距離を返す。',
    example: 'ScriptCamera.GetFarZ()',
    settled: false,
  },
  // ScriptCamera::GetLookEye()
  _ZN12ScriptCamera10GetLookEyeEv: {
    about: '現在の眼の座標へのポインタを返す。',
    example: 'ScriptCamera.GetLookEye()',
    settled: true,
  },
  // ScriptCamera::GetLookTarget()
  _ZN12ScriptCamera13GetLookTargetEv: {
    about: '現在の注視点へのポインタを返す。',
    example: 'ScriptCamera.GetLookTarget()',
    settled: true,
  },
  // ScriptCamera::GetNearZ()
  _ZN12ScriptCamera8GetNearZEv: {
    about: '近クリップ面の距離を返す。',
    example: 'ScriptCamera.GetNearZ()',
    settled: false,
  },
  // ScriptCamera::GetPersFovy()
  _ZN12ScriptCamera11GetPersFovyEv: {
    about: '現在の透視投影の垂直画角を返す。',
    example: 'ScriptCamera.GetPersFovy()',
    settled: true,
  },
  // ScriptCamera::GetSaveLookEye()
  _ZN12ScriptCamera14GetSaveLookEyeEv: {
    about: 'SaveCamera で保存した眼の座標への参照を返すと推定。',
    example: 'ScriptCamera.GetSaveLookEye()',
    settled: false,
  },
  // ScriptCamera::GetSaveLookTarget()
  _ZN12ScriptCamera17GetSaveLookTargetEv: {
    about: 'SaveCamera で保存した注視点への参照を返す。',
    example: 'ScriptCamera.GetSaveLookTarget()',
    settled: false,
  },
  // ScriptCamera::GetTargetDistance()
  _ZN12ScriptCamera17GetTargetDistanceEv: {
    about: '眼と注視点の距離を返す。',
    example: 'ScriptCamera.GetTargetDistance()',
    settled: true,
  },
  // ScriptCamera::GetULCDDepthLevel()
  _ZN12ScriptCamera17GetULCDDepthLevelEv: {
    about: '立体視の深さレベルを返す。',
    example: 'ScriptCamera.GetULCDDepthLevel()',
    settled: false,
  },
  // ScriptCamera::GetULCDFactor()
  _ZN12ScriptCamera13GetULCDFactorEv: {
    about: '立体視の係数を返す。',
    example: 'ScriptCamera.GetULCDFactor()',
    settled: false,
  },
  // ScriptCamera::GetUpVector()
  _ZN12ScriptCamera11GetUpVectorEv: {
    about: '現在のカメラ上方向ベクトルへの参照を返す。',
    example: 'ScriptCamera.GetUpVector()',
    settled: true,
  },
  // ScriptCamera::IsAnimation()
  _ZN12ScriptCamera11IsAnimationEv: {
    about: 'カメラの移動アニメーション中なら真を返す。',
    example: 'ScriptCamera.IsAnimation()',
    settled: true,
  },
  // ScriptCamera::MoveEye(const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera7MoveEyeERK5GSvecf10GSAnimMode: {
    about:
      '眼の位置を指定時間で動かす。数値版の第 1 引数は現在の注視点からの距離を表すと実装から推定し、完了待ちは別に行う。',
    args: ['眼の目標座標', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveEye(float, float, GSAnimMode)
  _ZN12ScriptCamera7MoveEyeEff10GSAnimMode: {
    about:
      '眼の位置を指定時間で動かす。数値版の第 1 引数は現在の注視点からの距離を表すと実装から推定し、完了待ちは別に行う。',
    args: ['現在の注視点からの目標距離 (推定)', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveEyeAndTarget(const ChrObject*, float, const GSvec&, const GSvec&, GSAnimMode)
  _ZN12ScriptCamera16MoveEyeAndTargetEPK9ChrObjectfRK5GSvecS5_10GSAnimMode: {
    about:
      '眼と注視点を指定時間で動かす。キャラ版はキャラの座標を基準とし、GSvec 版は両座標を直接指定する。完了待ちは別に行う。',
    args: ['基準キャラ', '秒数', '眼の相対位置', '注視点の相対位置', '補間モード'],
    example: 'ScriptCamera.MoveEyeAndTarget(chara(4), 1.3, vec(0, 0, 0), vec(0, 0, 0), 2)',
    settled: false,
  },
  // ScriptCamera::MoveEyeAndTarget(const ScriptChara&, float, const GSvec&, const GSvec&, GSAnimMode)
  _ZN12ScriptCamera16MoveEyeAndTargetERK11ScriptCharafRK5GSvecS5_10GSAnimMode: {
    about:
      '眼と注視点を指定時間で動かす。キャラ版はキャラの座標を基準とし、GSvec 版は両座標を直接指定する。完了待ちは別に行う。',
    args: ['基準キャラ', '秒数', '眼の相対位置', '注視点の相対位置', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveEyeAndTarget(const GSvec&, const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera16MoveEyeAndTargetERK5GSvecS2_f10GSAnimMode: {
    about:
      '眼と注視点を指定時間で動かす。キャラ版はキャラの座標を基準とし、GSvec 版は両座標を直接指定する。完了待ちは別に行う。',
    args: ['眼の目標座標', '注視点の目標座標', '秒数', '補間モード'],
    example: 'ScriptCamera.MoveEyeAndTarget(vec(0, 400, -600), vec(0, 100, 0), 1.3, 2)',
    settled: true,
  },
  // ScriptCamera::MoveEyeAndTarget(float, const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera16MoveEyeAndTargetEfRK5GSvecf10GSAnimMode: {
    about:
      '眼と注視点を指定時間で動かす。キャラ版はキャラの座標を基準とし、GSvec 版は両座標を直接指定する。完了待ちは別に行う。',
    args: ['現在の注視点からの目標距離 (推定)', '注視点の目標座標', '秒数', '補間モード'],
    example: 'ScriptCamera.MoveEyeAndTarget(900, vec(0, 0, 0), 1.1, 2)',
    settled: false,
  },
  // ScriptCamera::MoveEyeAndTargetOffset(float, const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera22MoveEyeAndTargetOffsetEfRK5GSvecf10GSAnimMode: {
    about: '現在のカメラ基準で眼と注視点をずらして移動する。詳細な数値解釈は未確定。',
    args: ['距離または倍率 (推定)', '位置のずれ', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveFieldCamera(float, GSAnimMode)
  _ZN12ScriptCamera15MoveFieldCameraEf10GSAnimMode: {
    about:
      'フィールド通常視点へ指定時間で動かす。完了待ちは WaitAnimation、更新を止めていた場合は ResumeCameraUpdater を別に呼ぶ。',
    args: ['秒数 (0 は即時)', '補間モード'],
    example: 'ScriptCamera.MoveFieldCamera(1.1, 2)',
    settled: true,
  },
  // ScriptCamera::MoveNearZ(float, float, GSAnimMode)
  _ZN12ScriptCamera9MoveNearZEff10GSAnimMode: {
    about: '近クリップ面の距離を指定時間で補間する。',
    args: ['近クリップ面の目標値', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveRestore(float, GSAnimMode, bool)
  _ZN12ScriptCamera11MoveRestoreEf10GSAnimModeb: {
    about: 'SaveCamera で保存した眼と注視点へ指定時間で動かす。第 3 引数の分岐の細部は未確定。',
    args: ['秒数 (0 は即時)', '補間モード', '保存値の復元方法を選ぶフラグ (0 が本家の使用値、詳細未解明)'],
    example: 'ScriptCamera.MoveRestore(0.7, 2, 0)',
    settled: false,
  },
  // ScriptCamera::MoveShadeOffLevel(s32, float, GSAnimMode)
  _ZN12ScriptCamera17MoveShadeOffLevelEif10GSAnimMode: {
    about: 'シェード除去レベルを指定時間で変える。',
    args: ['シェード除去レベル', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::MoveShopCamera(const ScriptChara&)
  _ZN12ScriptCamera14MoveShopCameraERK11ScriptChara: {
    about: 'キャラを基準に店用カメラへ切り替えると推定。',
    args: ['店員キャラ'],
    settled: false,
  },
  // ScriptCamera::MoveTarget(const GSvec&, float, GSAnimMode)
  _ZN12ScriptCamera10MoveTargetERK5GSvecf10GSAnimMode: {
    about: '注視点を指定時間で移動する。完了待ちは別に行う。',
    args: ['注視点の目標座標', '秒数', '補間モード'],
    settled: false,
  },
  // ScriptCamera::PauseCameraUpdater()
  _ZN12ScriptCamera18PauseCameraUpdaterEv: {
    about: '通常のカメラ追従更新を一時停止する。演出用カメラ移動の前に本家が呼ぶ。',
    example: 'ScriptCamera.PauseCameraUpdater()',
    settled: true,
  },
  // ScriptCamera::RestoreCamera(float)
  _ZN12ScriptCamera13RestoreCameraEf: {
    about: 'SaveCamera で保存した眼と注視点を戻し、保存領域を解放する。秒数 0 では即時設定。',
    args: ['秒数 (本家は 0)'],
    example: 'ScriptCamera.RestoreCamera(0)',
    settled: true,
  },
  // ScriptCamera::ResumeCameraUpdater()
  _ZN12ScriptCamera19ResumeCameraUpdaterEv: {
    about: '通常のカメラ追従更新を再開する。',
    example: 'ScriptCamera.ResumeCameraUpdater()',
    settled: true,
  },
  // ScriptCamera::SaveCamera()
  _ZN12ScriptCamera10SaveCameraEv: {
    about: '現在の眼・注視点・上方向を保存領域へコピーする。',
    example: 'ScriptCamera.SaveCamera()',
    settled: true,
  },
  // ScriptCamera::SetCameraTargetMode(bool)
  _ZN12ScriptCamera19SetCameraTargetModeEb: {
    about: 'ターゲット更新方式を切り替える。詳細は未確定。',
    args: ['ターゲット更新モード'],
    settled: false,
  },
  // ScriptCamera::SetDepthOfFieldMaskSize(u8)
  _ZN12ScriptCamera23SetDepthOfFieldMaskSizeEh: {
    about: '被写界深度マスクのサイズを設定する。',
    args: ['被写界深度マスクの大きさ'],
    settled: false,
  },
  // ScriptCamera::SetEnableDepthOfField(bool, bool)
  _ZN12ScriptCamera21SetEnableDepthOfFieldEbb: {
    about: '被写界深度を有効または無効にする。本家は第 2 引数に 0 を渡す。',
    args: ['有効/無効', '第 2 フラグ (本家は常に 0)'],
    settled: true,
  },
  // ScriptCamera::SetFarMakeMaskImage(bool)
  _ZN12ScriptCamera19SetFarMakeMaskImageEb: {
    about: '遠景のマスク画像生成を切り替える。',
    args: ['遠景マスク生成の有効/無効'],
    settled: false,
  },
  // ScriptCamera::SetFarZ(float)
  _ZN12ScriptCamera7SetFarZEf: {
    about: '遠クリップ面の距離を即時設定する。',
    args: ['遠クリップ面の距離'],
    settled: false,
  },
  // ScriptCamera::SetLookAt(const GSvec&, const GSvec&, const GSvec&)
  _ZN12ScriptCamera9SetLookAtERK5GSvecS2_S2_: {
    about: '眼・注視点・上方向を即時設定する。本家の上方向は GSVEC_AXIS_Y。',
    args: ['眼の座標', '注視点', '上方向ベクトル'],
    settled: true,
  },
  // ScriptCamera::SetLookEye(const GSvec&)
  _ZN12ScriptCamera10SetLookEyeERK5GSvec: { about: '眼の座標を即時設定する。', args: ['眼の座標'], settled: true },
  // ScriptCamera::SetLookTarget(const GSvec&)
  _ZN12ScriptCamera13SetLookTargetERK5GSvec: { about: '注視点を即時設定する。', args: ['注視点'], settled: true },
  // ScriptCamera::SetNearZ(float)
  _ZN12ScriptCamera8SetNearZEf: {
    about: '近クリップ面の距離を即時設定する。',
    args: ['近クリップ面の距離'],
    settled: true,
  },
  // ScriptCamera::SetPersFovy(float)
  _ZN12ScriptCamera11SetPersFovyEf: {
    about: '透視投影の垂直画角を即時設定する。',
    args: ['垂直画角 (ラジアン、推定)'],
    example: 'ScriptCamera.SetPersFovy(0.8)',
    settled: false,
  },
  // ScriptCamera::SetShadeOffLevel(s32)
  _ZN12ScriptCamera16SetShadeOffLevelEi: {
    about: 'シェード除去レベルを即時設定する。',
    args: ['シェード除去レベル'],
    settled: false,
  },
  // ScriptCamera::SetULCDDepthLevel(float)
  _ZN12ScriptCamera17SetULCDDepthLevelEf: {
    about: '立体視の深さレベルを設定する。',
    args: ['立体視の深さレベル'],
    settled: false,
  },
  // ScriptCamera::SetULCDFactor(float)
  _ZN12ScriptCamera13SetULCDFactorEf: { about: '立体視の係数を設定する。', args: ['立体視の係数'], settled: false },
  // ScriptCamera::SetUpVector(const GSvec&)
  _ZN12ScriptCamera11SetUpVectorERK5GSvec: {
    about: 'カメラの上方向を即時設定する。',
    args: ['上方向ベクトル'],
    settled: false,
  },
  // ScriptCamera::ShakeDistance(float, float, s32, bool)
  _ZN12ScriptCamera13ShakeDistanceEffib: {
    about: '眼と注視点の距離方向を揺らす。4 引数の詳細な単位は未確定。',
    args: ['揺れの強さ/距離 (推定)', '周期または減衰 (推定)', '反復数またはフレーム数 (推定)', 'フラグ (詳細未解明)'],
    settled: false,
  },
  // ScriptCamera::ShakeH(float, float, s32, bool)
  _ZN12ScriptCamera6ShakeHEffib: {
    about: 'カメラを横方向に揺らす。4 引数の詳細な単位は未確定。',
    args: ['横揺れの強さ (推定)', '周期または減衰 (推定)', '反復数またはフレーム数 (推定)', 'フラグ (詳細未解明)'],
    settled: false,
  },
  // ScriptCamera::ShakeV(float, float, s32, bool)
  _ZN12ScriptCamera6ShakeVEffib: {
    about: 'カメラを縦方向に揺らす。4 引数の詳細な単位は未確定。',
    args: ['縦揺れの強さ (推定)', '周期または減衰 (推定)', '反復数またはフレーム数 (推定)', 'フラグ (詳細未解明)'],
    example: 'ScriptCamera.ShakeV(10, 0.1, 10, 0)',
    settled: false,
  },
  // ScriptCamera::StopAnimation()
  _ZN12ScriptCamera13StopAnimationEv: {
    about: '進行中のカメラアニメーションを停止する。',
    example: 'ScriptCamera.StopAnimation()',
    settled: true,
  },
  // ScriptCamera::WaitAnimation()
  _ZN12ScriptCamera13WaitAnimationEv: {
    about: '進行中のカメラアニメーションが終わるまで待つ。',
    example: 'ScriptCamera.WaitAnimation()',
    settled: true,
  },
  // ScriptChara::AlphaTo(float, float, GSAnimMode, bool, bool, float)
  _ZN11ScriptChara7AlphaToEff10GSAnimModebbf: {
    about: 'キャラの透明度を時間をかけて変化させる。',
    args: ['目標透明度', '変化時間 (秒)', 'GSAnimMode', '補間フラグ 1', '補間フラグ 2', '追加 float'],
    example: 'chara(3).AlphaTo(0, 1, 2, 0, 0, 0)',
    settled: false,
  },
  // ScriptChara::CancelAutoAnimation()
  _ZN11ScriptChara19CancelAutoAnimationEv: {
    about: 'キャラの自動アニメ更新を止める。',
    example: 'chara(3).CancelAutoAnimation()',
    settled: true,
  },
  // ScriptChara::FinishPopupIcon()
  _ZN11ScriptChara15FinishPopupIconEv: {
    about: 'キャラ頭上のアイコンを終了する。',
    example: 'self.FinishPopupIcon()',
    settled: true,
  },
  // ScriptChara::MoveTo(const GSvec&, float, GSAnimMode, bool, bool, float)
  _ZN11ScriptChara6MoveToERK5GSvecf10GSAnimModebbf: {
    about: 'キャラを目標 GSvec へ移動開始する。移動完了には WaitNodeAnimation を続ける。',
    args: [
      '目標位置 (x,y,z)',
      '移動速度または時間 (0 は標準歩行、推定)',
      'GSAnimMode',
      '動作フラグ 1',
      '動作フラグ 2',
      '追加の float 値',
    ],
    example: 'chara(3).MoveTo(vec(250, 0, 750), 0, 0, 0, 0, 0)',
    settled: false,
  },
  // ScriptChara::RotateCharaTo(ChrObject*, float, GSAnimMode, bool, bool)
  _ZN11ScriptChara13RotateCharaToEP9ChrObjectf10GSAnimModebb: {
    about: '対象キャラへ向けて回転を開始する。ポインタ版と ScriptChara& 版があり、直呼び構文はポインタ版を優先する。',
    args: ['向く相手 (hero/self/chara)', '回転時間 (秒)', 'GSAnimMode', '回転フラグ 1', '回転フラグ 2'],
    example: 'self.RotateCharaTo(hero, 0.25, 0, 0, 0)',
    settled: false,
  },
  // ScriptChara::RotateCharaTo(ScriptChara&, float, GSAnimMode, bool, bool)
  _ZN11ScriptChara13RotateCharaToERS_f10GSAnimModebb: {
    about: '対象キャラへ向けて回転を開始する。ポインタ版と ScriptChara& 版があり、直呼び構文はポインタ版を優先する。',
    args: ['向く相手 (hero/self/chara)', '回転時間 (秒)', 'GSAnimMode', '回転フラグ 1', '回転フラグ 2'],
    settled: false,
  },
  // ScriptChara::RotateTo(const GSvec&, float, GSAnimMode, bool, bool, bool)
  _ZN11ScriptChara8RotateToERK5GSvecf10GSAnimModebbb: {
    about: 'キャラの向きを指定ラジアンへ変える。開始後すぐ戻るので必要なら WaitTime で待つ。',
    args: ['向く位置 (GSvec)', '回転時間 (秒)', 'GSAnimMode', '回転フラグ 1', '回転フラグ 2', '回転フラグ 3'],
    example: 'chara(3).RotateTo(vec(250, 0, 750), 0.25, 0, 0, 0, 1)',
    settled: false,
  },
  // ScriptChara::RotateTo(float, float, GSAnimMode, bool, bool, bool)
  _ZN11ScriptChara8RotateToEff10GSAnimModebbb: {
    about: 'キャラの向きを指定ラジアンへ変える。開始後すぐ戻るので必要なら WaitTime で待つ。',
    args: ['角度 (ラジアン)', '回転時間 (秒)', 'GSAnimMode', '回転フラグ 1', '回転フラグ 2', '回転フラグ 3'],
    example: 'hero.RotateTo(1.5707963268, 0.25, 0, 0, 0, 1)',
    settled: false,
  },
  // ScriptChara::SetBlendAnim(bool)
  _ZN11ScriptChara12SetBlendAnimEb: {
    about: 'キャラのアニメブレンドを有効化・無効化する。',
    args: ['有効 1 / 無効 0'],
    example: 'chara(3).SetBlendAnim(0)',
    settled: false,
  },
  // ScriptChara::SetPopup(u8, u8, bool, s8, bool, const GSvec&)
  _ZN11ScriptChara8SetPopupEhhbabRK5GSvec: {
    about: 'キャラ頭上のアイコンを表示する。API 単体は非同期で、一時 ScriptChara なら破棄時に消えることがある。',
    args: [
      'ポップアップ種別 (本家の定型は 2)',
      'アイコン番号',
      '表示フラグ (定型 1)',
      '配置等の s8 (定型 1)',
      '追加フラグ (定型 0)',
      '位置オフセット (通常ゼロ)',
    ],
    example: 'self.SetPopup(2, 11, 1, 1, 0, vec(0, 0, 0))',
    settled: false,
  },
  // ScriptChara::SetPos(const GSvec&)
  _ZN11ScriptChara6SetPosERK5GSvec: {
    about: 'キャラ位置を直接設定する。',
    args: ['新しい位置 (GSvec)'],
    example: 'chara(3).SetPos(vec(250, 0, 750))',
    settled: true,
  },
  // ScriptChara::SetVisible(bool)
  _ZN11ScriptChara10SetVisibleEb: {
    about: 'キャラの表示フラグを変更する。',
    args: ['表示 1 / 非表示 0'],
    example: 'chara(3).SetVisible(1)',
    settled: true,
  },
  // ScriptChara::StartAnimation(u32, GSAnimType, float, float)
  _ZN11ScriptChara14StartAnimationEj10GSAnimTypeff: {
    about: '指定 AnimData 行のモーションを開始する。開始後すぐ戻る。',
    args: ['AnimData の行 ID (上位 bit 付き)', 'GSAnimType (0 は既定)', '再生倍率 1.0', '開始オフセット 0.0'],
    example: 'chara(3).StartAnimation(0x80000073, 0, 1, 0)',
    settled: true,
  },
  // ScriptChara::WaitAnimation(u32)
  _ZN11ScriptChara13WaitAnimationEj: {
    about: '指定対象のアニメーション終了を待つ。CRO は引数 0x3E を定型で用いる。',
    args: ['待機対象コード (定型 0x3E、内部意味は未確定)'],
    example: 'chara(3).WaitAnimation(0x3E)',
    settled: false,
  },
  // ScriptChara::WaitNodeAnimation()
  _ZN11ScriptChara17WaitNodeAnimationEv: {
    about: 'キャラのノード移動・補間が終わるまで待つ。',
    example: 'chara(3).WaitNodeAnimation()',
    settled: true,
  },
  // ScriptFlag::AddGold(s32)
  _ZN10ScriptFlag7AddGoldEi: {
    about: '所持金を増減する。負値で減らす。',
    args: ['増減額 (s32)'],
    example: 'ScriptFlag.AddGold(100)',
    settled: true,
  },
  // ScriptFlag::AddItemNum(u32, s32)
  _ZN10ScriptFlag10AddItemNumEji: {
    about: '所持アイテム数を増減する。負値で減らす。',
    args: ['アイテム行 ID (上位 bit 付き)', '増減数 (s32)'],
    example: 'ScriptFlag.AddItemNum(0x800000D8, 1)',
    settled: true,
  },
  // ScriptFlag::GetItemNum(u32, bool)
  _ZN10ScriptFlag10GetItemNumEjb: {
    about: '所持アイテム数を返す。',
    args: ['アイテム行 ID (上位 bit 付き)', '所持数の取得フラグ (組み込みは 1)'],
    example: 'ScriptFlag.GetItemNum(0x800000D8, 1)',
    settled: false,
  },
  // ScriptFlag::GetScriptState(u32)
  _ZN10ScriptFlag14GetScriptStateEj: {
    about: 'イベントの実行状態 (u8) を返す。1 引数版は現在 MapGroup を使う。',
    args: ['EventObject 行番号'],
    example: 'ScriptFlag.GetScriptState(3)',
    settled: true,
  },
  // ScriptFlag::GetScriptState(u16, u32)
  _ZN10ScriptFlag14GetScriptStateEtj: {
    about: 'イベントの実行状態 (u8) を返す。1 引数版は現在 MapGroup を使う。',
    args: ['MapGroup ID', 'EventObject 行番号'],
    example: 'ScriptFlag.GetScriptState(1, 3)',
    settled: true,
  },
  // ScriptMap::DeleteEventObject(u32)
  _ZN9ScriptMap17DeleteEventObjectEj: {
    about: '指定 EventObject を現在のマップから削除する。',
    args: ['EventObject 行番号'],
    example: 'ScriptMap.DeleteEventObject(3)',
    settled: true,
  },
  // ScriptMap::EnableEventCollision(u32, bool)
  _ZN9ScriptMap20EnableEventCollisionEjb: {
    about: '指定イベントの当たり判定を有効または無効にする。マップ再読込では復元される。',
    args: ['EventObject 行番号', '有効 1 / 無効 0'],
    example: 'ScriptMap.EnableEventCollision(3, 0)',
    settled: true,
  },
  // ScriptMap::EnablePartyCollision(bool)
  _ZN9ScriptMap20EnablePartyCollisionEb: {
    about: 'パーティとオブジェクトの当たり判定を切り替える。',
    args: ['パーティの当たり判定を有効にするか (0/1)'],
    example: 'ScriptMap.EnablePartyCollision(0)',
    settled: true,
  },
  // ScriptMap::EncountBoss(u32, u32)
  _ZN9ScriptMap11EncountBossEjj: {
    about: '指定 MonsterGroup とボス戦に移行する。Panana の組み込みはこの直後にイベントを終える。',
    args: ['MonsterGroup 行番号 (または上位 bit 付き行 ID)', '追加値 (組み込みは 0)'],
    example: 'ScriptMap.EncountBoss(5, 0)',
    settled: false,
  },
  // ScriptMap::EncountBoss(u32, u16, u8, u8, u32, u32)
  _ZN9ScriptMap11EncountBossEjthhjj: {
    about: '指定 MonsterGroup とボス戦に移行する。Panana の組み込みはこの直後にイベントを終える。',
    args: [
      'MonsterGroup 行番号または ID',
      'マップなどの u16 値',
      'u8 フラグ 1',
      'u8 フラグ 2',
      'u32 値 1',
      'u32 値 2 (詳細未確定)',
    ],
    settled: false,
  },
  // ScriptMap::GetMapChara(u32)
  _ZN9ScriptMap11GetMapCharaEj: {
    about: 'EventObject 行番号に対応する ChrObject* を取得する。',
    args: ['EventObject 行番号'],
    example: 'ScriptMap.GetMapChara(3)',
    settled: false,
  },
  // ScriptMap::GetMonsterLimitCount(u32)
  _ZN9ScriptMap20GetMonsterLimitCountEj: {
    about: 'マップに残る対象モンスターの数を返す。',
    args: ['引数付き版では対象コード'],
    example: 'ScriptMap.GetMonsterLimitCount(0x80000004)',
    settled: false,
  },
  // ScriptMap::GetMonsterLimitCount()
  _ZN9ScriptMap20GetMonsterLimitCountEv: {
    about: 'マップに残る対象モンスターの数を返す。',
    example: 'ScriptMap.GetMonsterLimitCount()',
    settled: false,
  },
  // ScriptMap::GetUpdateFormation()
  _ZN9ScriptMap18GetUpdateFormationEv: {
    about: '通常の隊列追従が有効かを返す。',
    example: 'if (ScriptMap.GetUpdateFormation()) { wait(0.1) }',
    settled: true,
  },
  // ScriptMap::MoveToPartyConvexPosition(const GSvec&, float, GSAnimMode, u8, float, float)
  _ZN9ScriptMap25MoveToPartyConvexPositionERK5GSvecf10GSAnimModehff: {
    about: 'パーティを凸形の隊形へ時間をかけて動かす。本家 CRO で使用例がなく、末尾 2 引数の意味は未確定。',
    args: [
      '先頭の基準位置',
      '移動時間 (秒)',
      '補間モード',
      '向き (1/2/4/8)',
      '仲間の間隔',
      '追加の時間またはずれ (未解明)',
    ],
    settled: false,
  },
  // ScriptMap::MoveToPartyHorizontalPosition(const GSvec&, float, GSAnimMode, u8)
  _ZN9ScriptMap29MoveToPartyHorizontalPositionERK5GSvecf10GSAnimModeh: {
    about: 'Update では bx lr だけの空実装で、呼んでも移動しない。',
    args: ['基準位置', '移動時間 (秒)', '補間モード', '向き (空実装で未使用)'],
    settled: true,
  },
  // ScriptMap::RestorePartyPosition()
  _ZN9ScriptMap20RestorePartyPositionEv: {
    about: 'SavePartyPosition が退避した各メンバーの位置・向きに復帰する。',
    example: 'ScriptMap.RestorePartyPosition()',
    settled: false,
  },
  // ScriptMap::SavePartyPosition()
  _ZN9ScriptMap17SavePartyPositionEv: {
    about: '各メンバーの位置・向きを退避する。',
    example: 'ScriptMap.SavePartyPosition()',
    settled: true,
  },
  // ScriptMap::SetDoorCloseFlag(u32)
  _ZN9ScriptMap16SetDoorCloseFlagEj: {
    about: '指定扉を閉状態にする。',
    args: ['扉 EventObject 行番号'],
    example: 'ScriptMap.SetDoorCloseFlag(3)',
    settled: false,
  },
  // ScriptMap::SetDoorOpenFlag(u32)
  _ZN9ScriptMap15SetDoorOpenFlagEj: {
    about: '指定扉の開状態・当たり判定・イベント状態を更新する。見た目のアニメは再生しない。',
    args: ['扉 EventObject 行番号'],
    example: 'ScriptMap.SetDoorOpenFlag(3)',
    settled: true,
  },
  // ScriptMap::SetPartyAnimation(u32, GSAnimType, u16, float, float, bool)
  _ZN9ScriptMap17SetPartyAnimationEj10GSAnimTypetffb: {
    about: 'パーティ全員のアニメーションを設定する。通常追従を停止する処理も含まれる。',
    args: [
      'アニメーション ID',
      'アニメーション種別',
      '対象/フレーム値 (推定)',
      '速度',
      '開始位置',
      'フラグ (本家は 1)',
    ],
    example: 'ScriptMap.SetPartyAnimation(0x80000001, 0, 0, 1, 0, 1)',
    settled: false,
  },
  // ScriptMap::SetPartyConvexPosition(const GSvec&, u8, float)
  _ZN9ScriptMap22SetPartyConvexPositionERK5GSvechf: {
    about: '先頭を基準に後続メンバーを凸形に並べる。本家は向き 4、間隔 150 を多用する。',
    args: ['先頭の基準位置', '向き (1/2/4/8)', '間隔 (本家は 150)'],
    example: 'ScriptMap.SetPartyConvexPosition(vec(0, 0, 0), 4, 150)',
    settled: false,
  },
  // ScriptMap::SetPartyConvexPositionMainChara(const GSvec&, u8, u8, float)
  _ZN9ScriptMap31SetPartyConvexPositionMainCharaERK5GSvechhf: {
    about: 'Update では bx lr だけの空実装で、呼んでも配置しない。',
    args: ['基準位置', '向き', '追加の u8', '間隔 (空実装)'],
    settled: true,
  },
  // ScriptMap::SetPartyPosition(const GSvec&, u8, bool, float)
  _ZN9ScriptMap16SetPartyPositionERK5GSvechbf: {
    about:
      '先頭を指定座標に置き、後続メンバーを指定方向へ一定間隔で一直線に並べる。bool が真なら各キャラをその方向へ回す。',
    args: ['先頭の基準位置', '並ぶ方向 (1/2/4/8)', 'キャラをその方向へ回すか (本家は 1)', '間隔 (本家は 100)'],
    example: 'ScriptMap.SetPartyPosition(vec(0, 0, 0), 4, 1, 100)',
    settled: true,
  },
  // ScriptMap::SetUpdateFormation(bool)
  _ZN9ScriptMap18SetUpdateFormationEb: {
    about: '通常の隊列追従を切り替える。演出中は 0、終了時は 1 を使う。',
    args: ['通常の隊列追従を有効にするか (0/1)'],
    example: 'ScriptMap.SetUpdateFormation(0)',
    settled: true,
  },
  // ScriptMenu::ClearMessageType()
  _ZN10ScriptMenu16ClearMessageTypeEv: {
    about: 'メッセージ表の選択を既定に戻す。',
    example: 'ScriptMenu.ClearMessageType()',
    settled: true,
  },
  // ScriptMenu::CloseMessage()
  _ZN10ScriptMenu12CloseMessageEv: {
    about: '開いたメッセージ窓を閉じ、閉鎖処理を待つ。',
    example: 'ScriptMenu.CloseMessage()',
    settled: true,
  },
  // ScriptMenu::GetMessage(u32)
  _ZN10ScriptMenu10GetMessageEj: {
    about: '指定行のメッセージを取得する内部用処理。戻り値と直接利用方法は未確認。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.GetMessage(0x80000001)',
    settled: false,
  },
  // ScriptMenu::GetMessageType()
  _ZN10ScriptMenu14GetMessageTypeEv: {
    about: '現在選択中のメッセージ表の種別を返す。',
    example: 'ScriptMenu.GetMessageType()',
    settled: true,
  },
  // ScriptMenu::ItemGet(u32, s32, bool)
  _ZN10ScriptMenu7ItemGetEjib: {
    about: 'アイテム数を加減算した後、取得・喪失メッセージを出す。文を閉じるまで待つ。',
    args: ['アイテム行 ID (上位 bit 付き)', '増減数', '演出表示フラグ (組み込みは 1)'],
    example: 'ScriptMenu.ItemGet(0x800000D8, 1, 1)',
    settled: true,
  },
  // ScriptMenu::NormalWaiting(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu13NormalWaitingEjRK18ScriptMessageParamS2_: {
    about: '指定行を用いて通常の待機処理を実行する。画面上の具体的な動きは未確認。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.NormalWaiting(0x80000001)',
    settled: false,
  },
  // ScriptMenu::OpenMessage(AppDialogType)
  _ZN10ScriptMenu11OpenMessageE13AppDialogType: {
    about:
      'メッセージ窓を開く。AppDialogType 版は 2 がシステム窓、その他は会話の吹き出し。u32 版は行の話者種別で窓を選ぶ。',
    args: ['窓の種類 (0 自動、1 吹き出し、2 システム窓)'],
    settled: true,
  },
  // ScriptMenu::OpenMessage(u32)
  _ZN10ScriptMenu11OpenMessageEj: {
    about:
      'メッセージ窓を開く。AppDialogType 版は 2 がシステム窓、その他は会話の吹き出し。u32 版は行の話者種別で窓を選ぶ。',
    args: ['表示するメッセージ行 ID'],
    settled: true,
  },
  // ScriptMenu::OpenWindow(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu10OpenWindowEjRK18ScriptMessageParamS2_: {
    about: '指定したメッセージ行の窓を開く。文字送りは行わない。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.OpenWindow(0x80000001)',
    settled: true,
  },
  // ScriptMenu::PlayMessage(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu11PlayMessageEjRK18ScriptMessageParamS2_bf: {
    about: '指定行の文字送りを行う。窓は閉じない。ScriptMessageParam 2 個は差し込み値、bool と float の細部は未確認。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessage(0x80000001, 0, 0.2)',
    settled: false,
  },
  // ScriptMenu::PlayMessageAndClose(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu19PlayMessageAndCloseEjRK18ScriptMessageParamS2_bf: {
    about: '指定行を文字送りし、終わったら窓を閉じる。閉じるまで待つ。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageAndClose(0x80000001, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::PlayMessageAndCloseAuto(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu23PlayMessageAndCloseAutoEjRK18ScriptMessageParamS2_bf: {
    about: '話者種別 1 の行を先頭メンバーの性格に応じた行に置き換え、文字送り後に閉じる。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageAndCloseAuto(0x80000001, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::PlayMessageAndCloseHero(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu23PlayMessageAndCloseHeroEjRK18ScriptMessageParamS2_bf: {
    about: '先頭メンバーに合う口調の行を選んで文字送りし、窓を閉じる。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageAndCloseHero(0x80000001, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::PlayMessageAsync(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu16PlayMessageAsyncEjRK18ScriptMessageParamS2_: {
    about: '指定行の非同期の文字送りを開始する。後続処理まで待たない可能性がある。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.PlayMessageAsync(0x80000001)',
    settled: false,
  },
  // ScriptMenu::PlayMessageAsyncAuto(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu20PlayMessageAsyncAutoEjRK18ScriptMessageParamS2_: {
    about: '話者種別 1 の行を先頭メンバーの性格に合わせてから、非同期の文字送りを開始する。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.PlayMessageAsyncAuto(0x80000001)',
    settled: false,
  },
  // ScriptMenu::PlayMessageAsyncHero(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu20PlayMessageAsyncHeroEjRK18ScriptMessageParamS2_: {
    about: '先頭メンバーに合う行で非同期の文字送りを開始する。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.PlayMessageAsyncHero(0x80000001)',
    settled: false,
  },
  // ScriptMenu::PlayMessageAuto(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu15PlayMessageAutoEjRK18ScriptMessageParamS2_bf: {
    about: '話者種別 1 の行を先頭メンバーの性格に合わせ、文字送りする。窓は閉じない。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageAuto(0x80000001, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::PlayMessageHero(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu15PlayMessageHeroEjRK18ScriptMessageParamS2_bf: {
    about: '先頭メンバーに合う行を選んで文字送りする。窓は閉じない。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageHero(0x80000001, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::PlayMessageWithNoIcon(u32, const ScriptMessageParam&, const ScriptMessageParam&, bool, float)
  _ZN10ScriptMenu21PlayMessageWithNoIconEjRK18ScriptMessageParamS2_bf: {
    about: '指定行をアイコンなしで文字送りする。窓は閉じない。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.PlayMessageWithNoIcon(0x80000001, 0, 0.2)',
    settled: false,
  },
  // ScriptMenu::SetMessageType(ScriptMenu::MessageType)
  _ZN10ScriptMenu14SetMessageTypeENS_11MessageTypeE: {
    about:
      'メッセージ表を選ぶ。0 はマップグループ、1 は Contents、2 は Action、3 は Talk、4 は MapName、5 は Menu、6 は Common。',
    args: ['メッセージ表の種類 (0～6)'],
    example: 'ScriptMenu.SetMessageType(0)',
    settled: true,
  },
  // ScriptMenu::ShowMapName(u32)
  _ZN10ScriptMenu11ShowMapNameEj: {
    about: '指定マップ名の表示演出を行う。',
    args: ['マップ ID'],
    example: 'ScriptMenu.ShowMapName(0x80000001)',
    settled: false,
  },
  // ScriptMenu::ShowStageName()
  _ZN10ScriptMenu13ShowStageNameEv: {
    about: '現在のステージ名を表示する。',
    example: 'ScriptMenu.ShowStageName()',
    settled: true,
  },
  // ScriptMenu::StartMessage(u32, const ScriptMessageParam&, const ScriptMessageParam&, AppDialogType, bool, float)
  _ZN10ScriptMenu12StartMessageEjRK18ScriptMessageParamS2_13AppDialogTypebf: {
    about:
      '行の話者種別から窓の形を選んで開き、文字送り後に閉じるまで待つ。AppDialogType が 0 以外なら窓の形を強制する。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '窓の種類 (0 自動、1 吹き出し、2 システム窓)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.StartMessage(0x80000001, 0, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::StartMessageAuto(u32, const ScriptMessageParam&, const ScriptMessageParam&, AppDialogType, bool, float)
  _ZN10ScriptMenu16StartMessageAutoEjRK18ScriptMessageParamS2_13AppDialogTypebf: {
    about: '話者種別 1 の行を先頭メンバーの性格に合わせ、窓を開いて文字送りし、閉じるまで待つ。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '窓の種類 (0 自動、1 吹き出し、2 システム窓)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.StartMessageAuto(0x80000001, 0, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::StartMessageHero(u32, const ScriptMessageParam&, const ScriptMessageParam&, AppDialogType, bool, float)
  _ZN10ScriptMenu16StartMessageHeroEjRK18ScriptMessageParamS2_13AppDialogTypebf: {
    about: '先頭メンバーに合う口調の行を選び、窓を開いて文字送りし、閉じるまで待つ。',
    args: [
      'メッセージ行 ID (通常 0x80000000 | 行 ID)',
      '窓の種類 (0 自動、1 吹き出し、2 システム窓)',
      '表示オプション (詳しい効果は未確認)',
      '表示速度または待機時間に関わる値 (CRO の定型は 0.2)',
    ],
    example: 'ScriptMenu.StartMessageHero(0x80000001, 0, 0, 0.2)',
    settled: true,
  },
  // ScriptMenu::SystemMessageNoYes(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu18SystemMessageNoYesEjRK18ScriptMessageParamS2_: {
    about: '「いいえ／はい」の選択肢を出し、選択を待って結果を返す。第 2 の u32 引数の意味は未確認。',
    args: ['質問文の行 ID'],
    example: 'ScriptMenu.SystemMessageNoYes(0x80000001)',
    settled: false,
  },
  // ScriptMenu::SystemMessageNoYes(u32, u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu18SystemMessageNoYesEjjRK18ScriptMessageParamS2_: {
    about: '「いいえ／はい」の選択肢を出し、選択を待って結果を返す。第 2 の u32 引数の意味は未確認。',
    args: ['質問文の行 ID', '追加の選択肢または設定値 (未確認)'],
    example: 'ScriptMenu.SystemMessageNoYes(0x80000001, 0)',
    settled: false,
  },
  // ScriptMenu::SystemMessageOK(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu15SystemMessageOKEjRK18ScriptMessageParamS2_: {
    about: 'OK ボタン付きのメッセージを出し、閉じるまで待つ。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.SystemMessageOK(0x80000001)',
    settled: true,
  },
  // ScriptMenu::SystemMessageOKAlert(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu20SystemMessageOKAlertEjRK18ScriptMessageParamS2_: {
    about: '警告用の OK メッセージを出し、閉じるまで待つ。',
    args: ['メッセージ行 ID (通常 0x80000000 | 行 ID)'],
    example: 'ScriptMenu.SystemMessageOKAlert(0x80000001)',
    settled: false,
  },
  // ScriptMenu::SystemMessageYesNo(u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu18SystemMessageYesNoEjRK18ScriptMessageParamS2_: {
    about: '「はい／いいえ」の選択肢を出し、選択を待つ。戻り値が非 0 なら「はい」。第 2 の u32 引数の意味は未確認。',
    args: ['質問文の行 ID'],
    example: 'ScriptMenu.SystemMessageYesNo(0x80000001)',
    settled: true,
  },
  // ScriptMenu::SystemMessageYesNo(u32, u32, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu18SystemMessageYesNoEjjRK18ScriptMessageParamS2_: {
    about: '「はい／いいえ」の選択肢を出し、選択を待つ。戻り値が非 0 なら「はい」。第 2 の u32 引数の意味は未確認。',
    args: ['質問文の行 ID', '追加の選択肢または設定値 (未確認)'],
    example: 'ScriptMenu.SystemMessageYesNo(0x80000001, 0)',
    settled: false,
  },
  // ScriptMenu::UpdateMessage()
  _ZN10ScriptMenu13UpdateMessageEv: {
    about: 'メッセージ表示状態を更新する内部用処理。直接呼び出しの意義は未確認。',
    example: 'ScriptMenu.UpdateMessage()',
    settled: false,
  },
  // ScriptMenu::UseStaminaYesNo(u32, u16, const ScriptMessageParam&, const ScriptMessageParam&)
  _ZN10ScriptMenu15UseStaminaYesNoEjtRK18ScriptMessageParamS2_: {
    about: '指定したスタミナ消費を確認する選択肢を表示し、結果を返す。',
    args: ['確認文の行 ID', '消費スタミナ量'],
    example: 'ScriptMenu.UseStaminaYesNo(0x80000001, 0)',
    settled: false,
  },
  // ScriptPlayer::RestoreEmotion()
  _ZN12ScriptPlayer14RestoreEmotionEv: {
    about: '先頭の電波人間の目の表情を元に戻す。',
    example: 'hero.RestoreEmotion()',
    settled: true,
  },
  // ScriptPlayer::SetEmotion(ChrPlayer::EyeEmotion, float)
  _ZN12ScriptPlayer10SetEmotionEN9ChrPlayer10EyeEmotionEf: {
    about: '先頭の電波人間の目の表情を指定する。',
    args: ['目の表情番号', '遷移時間 (秒、本組み込みは 0)'],
    example: 'hero.SetEmotion(1, 0)',
    settled: false,
  },
  // ScriptPlayer::StartAnimation(u32, GSAnimType, float, float)
  _ZN12ScriptPlayer14StartAnimationEj10GSAnimTypeff: {
    about: '先頭の電波人間のモーションを開始する。開始後すぐ戻る。',
    args: ['AnimData の行 ID (上位 bit 付き)', 'GSAnimType (0 は既定)', '再生倍率 1.0', '開始オフセット 0.0'],
    settled: true,
  },
  // ScriptSound::PauseBGM(float)
  _ZN11ScriptSound8PauseBGMEf: {
    about: 'BGM を指定秒数でフェードアウトして停止する。',
    args: ['フェード秒数'],
    example: 'ScriptSound.PauseBGM(0.3)',
    settled: true,
  },
  // ScriptSound::Play(u16, float)
  _ZN11ScriptSound4PlayEtf: {
    about: 'SoundData 行番号の音を再生開始する。引数 0 は本家 CRO の定型。',
    args: ['SoundData 行番号', '追加 float (定型 0、内部意味未確定)'],
    example: 'ScriptSound.Play(0x7A, 0)',
    settled: false,
  },
  // ScriptSound::ReplayBGM(float)
  _ZN11ScriptSound9ReplayBGMEf: {
    about: '停止した BGM を指定秒数で再開する。',
    args: ['フェード秒数'],
    example: 'ScriptSound.ReplayBGM(0.3)',
    settled: true,
  },
  // ScriptSystem::FadeInWait(float, GSDisplay)
  _ZN12ScriptSystem10FadeInWaitEf9GSDisplay: {
    about: '指定画面を明転し、完了まで待つ。',
    args: ['フェード秒数', 'GSDisplay (2 は両画面)'],
    example: 'ScriptSystem.FadeInWait(0.5, 2)',
    settled: true,
  },
  // ScriptSystem::FadeOutWait(float, GSDisplay)
  _ZN12ScriptSystem11FadeOutWaitEf9GSDisplay: {
    about: '指定画面を暗転し、完了まで待つ。',
    args: ['フェード秒数', 'GSDisplay (2 は両画面)'],
    example: 'ScriptSystem.FadeOutWait(0.5, 2)',
    settled: true,
  },
  // ScriptSystem::WaitTime(float)
  _ZN12ScriptSystem8WaitTimeEf: {
    about: '指定秒数だけイベントを待機させる。',
    args: ['待つ秒数'],
    example: 'ScriptSystem.WaitTime(0.5)',
    settled: true,
  },
};
