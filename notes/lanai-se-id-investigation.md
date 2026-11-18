# RPG FREE! の SE 番号と再生経路（STATE #5）

対象はローカルの Base / Update ROM。コードのアドレスは Update `code.bin` を `0x00100000` に配置した値。以下の「番号」は混同しやすいので区別する。

| 値              | 意味                             | 例           |
| --------------- | -------------------------------- | ------------ |
| SoundData 行    | MapData や `se()` が指定する番号 | `110`        |
| SoundData +0x00 | BCSAR のアイテム ID              | `0x010000BF` |
| BCSAR 音番号    | アイテム ID の下位 24 bit        | `191`        |

## 原因: Update の表を Base の音源に当てていた

Update v1.17.0 の `patchList.bin` は master `2135000A` を含む。Panana はそこにある **Update SoundData** を読んでいたが、名前と試聴には Base の `sound/sound.bcsar` を使っていた。ゲームは Update の `sound/patch.bcsar` を使う。Update `code.bin` 内には `patch:/sound/patch.bcsar` の参照文字列がある（`0x004A346F` 付近）。Update の `patch.bcsar` は 875 音、Base の `sound.bcsar` は 686 音。SoundData も Update は 896 行、Base は 676 行で、同じ行番号の BCSAR 音番号が多数変わっている。

| 行           | Base 表 → Base 音源      | Update 表 → **Update 音源（正）** | 以前の Panana: Update 表 → Base 音源（誤） |
| ------------ | ------------------------ | --------------------------------- | ------------------------------------------ |
| 107          | #171 `SE_FLD_STEPS1`     | #188 `SE_FLD_STEPS1`              | #188 `SE_ILD_CHANGE`（無音）               |
| 110          | #174 `SE_FLD_STEPS4`     | #191 `SE_FLD_STEPS4`              | #191 `SE_FLD_ENCOUNT1`（無音）             |
| 122 (`0x7A`) | #685 `SE_FLD_DOOR4`      | #197 `SE_FLD_DOOR4`               | #197 `SE_BTL_ASSAULT`                      |
| 132 (`0x84`) | #96 `SE_FLD_SURPRISE`    | #54 `SE_FLD_SURPRISE`             | #54 `ME_DEFEAT`                            |
| 450          | #498 `SE_BTL_WING_ICE_A` | #578 `SE_BTL_WING_ICE_A`          | #578 `SE_BTL_WING_ICE_A2`                  |

ユーザー提供の Azahar v1.17.0 録画 `sound.webm` は、カスタムステージの `se(450)` を実行したもの。音は約 2.02 秒から始まり、Base `sound.bcsar` #498 の PCM との正規化波形相関が 0.606、誤照合していた Base #578 とは 0.316。**Update `patch.bcsar` #578 と Base #498 の描画 PCM は両チャンネルとも差分 0**。録画・ROM の両方が同じ原因を支持する。

Update の `patch.bcsar` #188〜#192 は音量を持ち、`SE_FLD_STEPS1〜5` を再生する。MapData +0x08 の 107〜111 が適切な足音名になるため、「エンカウント SE」という推定も誤りだった。無音だったのは Base アーカイブの同じ番号を試聴したため。Base の名前付き `SE_*` には音量 0 の行が 54 件あるが、これを Update の音源の無音判定に流用してはいけない。

## コード経路

Update コード `0x003E67BC` は MapData +0x08 を読んで `0x001A0AC4` に渡す。同関数は 0 を `0x6B`（107）に置き換え、オブジェクト +0x08 に格納する。`0x001A19B0` と `0x001A19C8` はその値を読み、再生状態の照会 `0x002D76FC` と SE 再生関数 `0x002E94A8` に渡す。`0x001A1894` はその前に状態、移動距離、時間を判定する。`se()` も SoundData 行を再生関数へ渡す。行から BCSAR 番号への対応は Update の SoundData +0x00、実音源は `patch.bcsar` で決まる。
