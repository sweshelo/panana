# 作業ログ

## 2026-11-17

- `TASK.md` の8項目を `STATE.md` に手順と完了条件付きで分割。最初の作業をワープ先選択に設定した。
- ワープ先のマップ欄と地点 ID 欄からマップ→地点の順に選べるよう変更。地点 ID 欄は候補マップが1つなら最初のダイアログを省略する。地点確定前のキャンセルでは保存値を変更しない。
- 関連テスト `bun test test/lanai-eventeditor.test.tsx` は8件通過。`bun run typecheck` とコミット時の Lefthook（整形、lint、型チェック、全テスト）が通過した。画面上の手動操作は未確認。
- 実装コミット: `0975fb7 Add staged destination picker flow and task state`。
- 次の作業はエディタの定義済み関数 hover、保存時のスクロール、条件式の論理演算子。補完情報は `src/lanai/scriptAssist.ts`、エディタ本体は `src/lanai/scriptCodeMirror.ts` にあることを確認済み。

## STATE No.2

- 定義済み関数の hover に、引数の個数・既存の説明・API の引数型と戻り値を表示するようにした。
- 関数本文の条件式に `&&` / `||` と括弧を追加した。`&&` を優先し、CRO では短絡評価する。独立した条件スクリプトは元から対応済み。
- `/stages` の詳細を保存後の再読込中もマウントしたままにし、スクロール位置がリセットされる経路を修正した。画面操作はブラウザ接続先が利用できず未確認。
- 関連テスト33件、型チェック、lint が通過。コミット時の Lefthook（整形、lint、型チェック、全テスト）も通過。
- 署名付き実装コミット: `891ebfa Improve script editor help, conditions and scroll stability`。`git verify-commit HEAD` で Good signature を確認。
- 次の作業は STATE No.3 の `/stages` 専用編集画面と新規ステージの初期値。

## STATE No.3

- 追加ステージのスクリプト全文を編集する専用画面を作成。`/stages` から ↗ で別タブに開き、編集中のセッションを共有する。左にコード、右に文法・Script API・台詞などの資料を配置した。別画面の変更が先に反映された場合は上書きを止める。
- 元画面の「反映済みのスクリプト」以降の折りたたみ式資料を専用画面へ移した。新しい空ステージではミッション・説明・スタミナ・推奨レベル・表示条件・サムネイル画像を初期化する。コンテンツを明示的に複製する操作は従来どおり元の設定を写す。
- ローカル ROM の対象テスト 27 件が通過。新規ステージの保存・復元、スクリプトの表示と既存の MOD 書出しを確認した。コミット時の Lefthook（整形、lint、型チェック、全テスト）が通過。ブラウザでの別タブ操作は未確認。
- 実装コミット: `be670bd Add stage script workspace and reset new stage defaults`。依頼どおり `STATE.md` は同コミットで削除した。
- 次は `TASK.md` のアニメーションプレビューを実装し、専用画面右側の 3D ビューに接続する。

## 全文編集のインデント

- スクリプト全文の再生成時、`function` 本文へ 2 スペースを付け直すようにした。入れ子の相対的なインデントは保持する。
- 対象テスト 17 件と型チェックが通過し、コミット時の Lefthook（整形、lint、型チェック、全テスト）も通過。
- 実装コミット: `8b3e1c0 Indent full stage script source`。

## MapGroup と MapData の管理 (未コミット)

- `/stages/<ステージ>` のマップ欄を、MapData 行・MapGroup の設定・マップの割り当ての表に変更。MapData の複製、MapGroup の屋外・屋内用 MapData と最初のマップ・入口、各マップの MapGroup と MapData の参照先を編集できる。最初のマップと入口は既存の地点選択ダイアログを使用。
- MapData 行に床モデルのプレビュー、タイルセットの選択、BGM・効果音の再生と変更、使用マップの一覧を追加。ROM ステージでは新しく複製した MapData 行のタイルセットも変更可能にした。
- ローカル ROM を用いたマップ追加テスト 14 件、入口選択関連 8 件、空ステージとタイルセットのテスト 11 件が通過。既存の MapGroup への適用、参照先の変更、保存・復元を確認。lint・型チェックと本番ビルドも通過。ユーザーの確認待ちのためコミットしていない。

## STATE No.4

- マップエディタの右欄とステージのスクリプト全文編集ページ右上に演出プレビューを追加。後者はマップを選んで 3D 表示できる。anim / waitAnim / move / turn / face / show / hide / camera / fade / wait / return を、マップとセッションを書き換えずに順番に再生する。停止時はプレビューのモデルとカメラ位置を戻す。
- `se()` の番号と音の表の対応は No.5 で未確認なので、その命令で停止する。台詞・分岐・任意の Script API など、ゲーム中の状態や未実装の演出が必要な命令も停止理由を示す。移動・カメラの時間はプレビュー上の概算で、実機相当のタイミングは未検証。
- 命令順・未対応命令での停止・中断・return のテスト、型チェック、lint、本番ビルドが通過。コミット時の Lefthook（整形、lint、型チェック、全テスト）も通過。内蔵ブラウザはローカルサーバーに接続できず、画面上の手動確認は未実施。
- 実装コミット: `963ca1b403abd16d17b62cd6395a4e004d172f3a Add reversible stage script animation preview`。次は STATE No.5 の SE ID 対応を調べる。

## STATE No.4 追加修正

- 未対応命令でプレビュー全体を止めず、その命令を省略して後続を続けるよう変更した。`<code>` のログに命令順と省略理由を表示し、省略行を黄色で示す。分岐はゲーム中の状態を推測せず、分岐全体を省略する。SE も対応 ID が確定するまで音を鳴らさない。
- 命令順、SE・分岐・モデルの実行失敗の省略、中断、return の対象テストと型チェック・lint が通過。コミット時の Lefthook（整形、lint、型チェック、全テスト）も通過。画面操作は未確認。
- 実装コミット: `e49a04c14c1f77b18b1cb15e8d5379fb97c5f00d Continue script preview after unsupported commands`。

## STATE No.4 FPS とアニメーション照合の修正

- `anim(chara(9), 0x3, 0)` のコンパイル時は行 ID の上位ビットが付いて `0x80000003` になるが、プレビューだけ `0x3` のまま AnimData と比較していた。プレビューもコンパイラと同じ変換を使うよう修正した。イベント番号に複数の配置が対応する場合はキャラの配置を優先し、骨格・マテリアル両方のモーションを検索する。
- ローカル ROM の #1191「じしょう・まおう」は MonsterDesign 196 のモデルで、`0x80000003 → 003_ → 003_E63_walk` を確認した。対象 ROM テスト 3 件が通過した。
- CPU でのモーション更新が再生処理と描画ループの二重で走り、ループするモーションが再生後も無期限で更新されていた。二重更新を除き、20 FPS 相当の上限と再生時間の上限を付けた。型チェックと lint、コミット時の Lefthook（整形、lint、型チェック、全テスト）が通過。画面上の FPS はユーザーによる再確認待ち。
- 実装コミット: `6fb824e03627e311efcf55182df21d6af0308f1a Fix stage preview animation lookup and frame load`。

## STATE No.4 別ウィンドウの描画と操作

- スクリプト全文編集ページは `about:blank` の別ウィンドウで動くため、元タブの `requestAnimationFrame` と `performance` を使うと、元タブが背面のとき描画・停止後の表示が遅れる。3D キャンバス、描画・演出タイマー、ResizeObserver を別ウィンドウに結び直した。
- 停止・リセット時のマップ全体の再構築をやめ、演出中に隠した元のモデルを再表示するようにした。プレビューの高さと描画解像度を抑え、横幅は資料欄いっぱいに保つ。左ドラッグは回転、中央ボタンドラッグは平行移動、ホイールは拡大・縮小とし、キャンバス上での資料欄スクロールと中央ボタンの自動スクロールを抑えた。
- 型チェック、本番ビルド、lint、コミット時の Lefthook（整形、lint、型チェック、全テスト）が通過。ブラウザ接続を利用できず、Firefox の画面上での FPS と操作感は未確認。
- 実装コミット: `c37a95c73881b5ac878d4d4d777c29ca80dae5e5 Fix popup preview input and rendering`。

## STATE No.6 パーツ選択

- ローカル ROM の出入口レコードと EventObject を照合。ワープホール (種類 2) は既定外観 #105 が 87 件、見た目 #107 が 2 件。ワープゲート (種類 4) は既定 #44 が 59 件、見た目 #735 が 16 件。以前の新規パーツは両方 #104 を使っていたため、ROM の既定値へ修正した。色と外観の対応は未確認。
- 「ROM の全種類」の候補を用途別カテゴリに配し、出入口は見た目の違いも選択可能にした。新規・設定付きパーツ、ステージ内の複製、スイッチ・宝箱は維持。長い括弧書きと重複する名称を短くし、動作、種類、出典、配置後の説明を Tooltip に移した。選択済み表示も省略時に全文を確認できる。
- ROM からのカタログ構築、新規ゲート・ホールの既定モデル、#735 の配置・保存・Undo をローカル ROM テストで確認。コミット時の Lefthook（整形、lint、型チェック、全テスト）が通過。実機での橙・緑の表示、転送動作、MOD 再読込は未確認。`agy` は利用枠上限で実行できず、既存の ROM 読込コードで集計した。
- 実装コミット: `2391c1f Improve Lanai part picker labels and ROM appearances`、保存検証コミット: `2563384 Verify alternate warp gate appearance is saved`。次は STATE No.6 の実機確認と未解析種類の対応付け。

## STATE No.6 出入口の種類の解析 (Issue #219)

- Codex で ROM の出入口 2,258 件（通常マップ 553 枚）と Update code.bin を解析。結果は `roms/tmpmap/issue219-analysis.md`（コミットしない）。
- 名称を付けた種類: 0 マップの門 / 1 ワールドへの門 / 8 落下の到着点 / 10 見えない出入口 / 11 到着点 / 13 鍵つき扉 / 14 移動扉 / 15 像をはめる扉 / 19 裏口 / 28〜69 建物の入口 / 68 崖の降下点。種類 9 は ROM に 0 件、17/18 は動作なしで開閉条件が未確認なので番号のまま。種類 13 は鍵扉で、回復ポイントではない（回復ポイントは区画 5 の種類 13）。
- 区画 8 の種類 2 は帯状の矩形範囲 51 件で、39 件がワールドマップへの移動 0x0D、12 件が CRO。0x0D はカタログ対象外のまま。
- 下画面のアイコンは種類だけで決まる（2/3 は obj_escape、0/4/10/12〜18 は obj_door、1/8/9/11 はなし）。3D 外観・行き先は関係しない。橙・緑と画像の対応は実画面で未確認。
- パーツ一覧で区画 3 を「出入口・移動」「扉」「到着点」に分け、各種類の解析結果を Tooltip に表示。対象テスト 22 件・型チェック・コミット時の Lefthook が通過。画面操作と実機は未確認。
- 実装コミット: `c486206 Name Lanai exit kinds from the ROM survey and group doors and arrival points`。
- 追加修正: 建物の入口（種類 28〜69、68 を除く）を「建物」カテゴリに集約し、到着点は「出入口・移動」に戻した。Tooltip の説明文から、解析の経緯を知らないと読めない記述（船説の否定、件数、動作番号など）を除いた。対象テスト 22 件と Lefthook が通過。コミット: `a3c090b Group Lanai building exits and keep part notes self-contained`。

## STATE No.10 Panana 組み込み関数の分割 (Issue #223)

- `openDoor(N)` を部品から組めるようにした。新しい文は `chara(N).open()`（扉のアニメ → 終了待ち → 開フラグ。カメラ・音・ジングルなし）、`jingle([音])`（BGM 停止 → 既定 0x41 → 1 秒 → BGM 再開）、`bgmPause(秒)` / `bgmResume(秒)`。`openDoor` は従来どおりで、`expandDoors` は同じ部品関数（`doorMotionNodes` / `jingleNodes`）を使う。
- `hero` / `self` / `chara(N)` の小文字メソッドを追加した。anim・waitAnim・move・turn・face・show・hide・camera・popup・popupEnd は同名の文と同じノードになる。open・close・remove・vanishMonster は `chara(N)` だけで使える。大文字で始まる名前は従来どおり Script API の呼び出し。`X.move(x, y, z)` もマップ上のドラッグ編集の対象にした。
- ヘルプに「キャラのメソッド」表、見本「扉の演出を自分で組む」を追加。`chara(…).` の後の補完とホバーに組み込みメソッドを表示する。
- 部品で組んだ演出と `openDoor(3)` の展開結果が一致すること、ローカル ROM で生成される CRO のコードが一致することをテストで確認。全テスト 803 件が通過（ROM や環境に依存する既存の 25 件はスキップ）。型チェックと lint、コミット時の Lefthook が通過。エディタの画面操作と実機での見え方は未確認。プレビューでは `chara(N).open()` を省略する（`openDoor` と同じ扱い）。
- 実装コミット: `89511d1 Split openDoor into script parts and add character methods (#223)`。

### ライブラリと Script API の説明 (同 #223)

- Codex で組み込み 53 語と Script API 131 関数を ROM（Update code.bin・本家 CRO）から解析。結果は `roms/tmpmap/issue223-api-analysis.md`・`issue223-api-docs.json`・`issue223-builtins.json`（コミットしない）。
- 解析結果: ローアングルは `ScriptCamera::MoveEyeAndTarget(vec 眼, vec 注視点, 秒, 0)`（CRO 124、眼の Y を注視点より低く）、通常視点への復帰は `MoveFieldCamera(秒, 2)` → `WaitAnimation` → `ResumeCameraUpdater`（CRO 1）。隊形は `SetPartyConvexPosition`（凸形、CRO 18 のボス後）と `SetPartyPosition`（一直線、CRO 2）。`MoveToPartyHorizontalPosition` と `SetPartyConvexPositionMainChara` は Update で空実装（`bx lr`）。話者の音・合成音声は台詞の行の話者種別 (+0x08) と voice 欄で決まり、`say` / `talk` で鳴る（Panana で足した行は voice が空）。このため `who.say()` は実装しなかった。
- スクリプトの関数に引数（`chara` / `num`）と、関数どうしの呼び出しを追加した。呼んだ場所に中身を展開するので、実行時にポインタを渡さない。引数のある関数はイベントに割り当てられない。組み込みの文と同じ名前の関数は作れない。
- `openDoor` をネイティブの文から、スクリプトの言葉で書いたライブラリ関数に移した（`src/lanai/scriptLibrary.ts`）。連続する扉をまとめる扱いはなくなり、扉ごとにジングルとカメラの復帰が付く。ライブラリに `cameraLook`・`cameraNormal`・`partyLineUp`・`partyColumn` を追加。同じ名前の関数をスクリプトに書くと置き換わる。ヘルプの「ライブラリ」でコードの表示・コピー、関数欄で「スクリプトに追加して改造」ができる。
- Script API 131 関数の説明（`src/lanai/scriptApiDocs.ts`）を補完・ホバー・API 一覧に表示。ヘルプとホバーに、組み込みの各語が中で呼ぶ Script API（「中身」）を表示する。
- 関連テスト（引数付き関数・ライブラリ・説明の網羅）とローカル ROM でのコンパイルテストを追加。全テスト 810 件が通過（25 件は既存のスキップ）。型チェック・lint・Lefthook が通過。エディタの画面操作と、ライブラリのカメラ・隊形関数の実機での見え方は未確認。
- 実装コミット: `c63c5b9 Add a script library with parameterized functions and describe the Script API (#223)`。

### Script API を直接呼ぶ言語に整理 (同 #223)

- 方針（ユーザー指示）: 作者は Script API のネイティブ関数を呼ぶ。単一呼び出しのラッパー（`say` / `ask` / `popup` / `anim` / `se` / `wait` / `battle` / `item` / `state` / `monsters` など）と小文字メソッドを削除し、互換は持たない。複数の呼び出しになるものはライブラリへ移す。
- 言語に残したもの: `var`・`function`・`on`・`if` / `switch` / `return` / `break`・代入・`hero` / `self` / `obj(N)`（`chara` から改名、EventObject の行なら何でも）・`vec`・`selfRow`（実行時のこのイベントの番号、Script API の引数専用）・`vanishEffect(だれに)`（ScriptEffect をイベントが保持する唯一の組み込み）。
- 追加: 引数の計算式（`+ - * /` と括弧、コンパイル時に計算）。`who.f(…)` は第 1 引数が `obj`（または `num`、`obj(N)` のとき N）のライブラリ・自作関数の呼び出し。関数の引数の種類は `obj` / `num`。`hero.X` は ScriptPlayer の同名関数を優先。
- ライブラリ（すべて Script API で記述）: `talk`（口パク付き、話しかけイベント専用）・`move`・`walk`・`turn`・`face`・`camera`・`cameraBack`・`cameraLook`・`open`・`jingle`・`openDoor`・`vanish`・`partyLineUp`・`partyColumn`。`cameraNormal` は `cameraBack` と同じなので削除。
- コード生成の特別扱いを呼び出し側へ移した: `PauseCameraUpdater` はイベントで 1 回（r8）、終わりに未復帰なら戻す。`SetPopup` は一時 ScriptChara の +0xB を 0xFF にしてアイコンを残す。`EncountBoss` の後でイベントを終える。開始イベントの自動フェードインは `FadeInWait` / `FadeIn` の有無で判定。
- 付随: プレビューは Script API 呼び出しから動作を読む（`previewSequence.ts`）。補完・ホバー・台詞の注記・群れの注記・行番号の補完・マップの move/walk ドラッグ・チェックを新しい書き方に対応。台詞の行 ID は 0x800000NN で扱う。保存済みのスクリプトが読めなくなっても復元時に捨てず、エディタでエラーを出す（MOD 書き出しは止まる）。
- 検証: 全テスト 811 件通過（25 件は既存のスキップ）。ローカル ROM での CRO 生成テスト（openDoor と中身の展開が同じコード、SetPopup の +0xB、カメラの 1 回停止、窓の種類）を実行。型チェック・lint・Lefthook 通過。エディタの画面と実機の動作は未確認。
- 実装コミット: `78282e3 Make the stage script call the Script API directly (#223)`。

### スクリプト編集をエディタのタブに一本化 (同期の修正)

- 問題: /stages の関数ごとのエディタと別タブの全文エディタが同じセッションを編集していた。/stages の下書きは外で追加・削除された関数と変数を取り込まず、「反映」で外の変更を消していた。全文には割り当て (`on …`) が入っていたため、マップのページで割り当てるたび、スイッチを置いて関数が自動で作られるたびに競合した。リンクを中クリックすると、セッションを共有しない別のインスタンスが開いた。
- 方針 (ユーザーと合意): 変数と関数はエディタのタブでだけ書く。割り当ては全文から外し、マップのページとステージのページの UI で変える。スイッチを置くときは既存の関数を選ぶだけで、関数を作らない。保存はフォーカスが外れたときに自動で行い、ボタンでも押せる (保存済みなら無効)。move() のドラッグは残し、関数ごとに取り込む。
- `eventScript.ts`: `scriptDocCode` (割り当てなしの文字列)、`docWithCode` (割り当てを引き継ぎ、外れたものを返す。`on` の行は拒否)、`mergeScriptCode` (関数単位の三方向マージ)。
- `StageSourcePage.tsx`: 割り当てなしの文字列を編集する。保存はエディタの blur、ウィンドウの blur、visibilitychange で行う。割り当てが外れる場合は自動では保存せず、ボタンで確認してから保存する。外での変更はマージし、両方で変えたときは「最新を読み込む」を出す。サンプルとライブラリは末尾に足す。割り当ての一覧は読むだけで表示する。
- `StageScriptEditor.tsx`: /stages は変数 (フラグ番号付き) と関数・割り当てを読むだけにした。入場の演出とマップの開始のプルダウンは残す。「スクリプトを編集 ↗」は href のないボタンにした。
- スイッチ: `buttonDoor` を `scriptFn` に置き換えた。置くときのダイアログで、引数のない既存の関数を選ぶ。
- 検証: 型チェックと lint が通過。全テスト 815 件が通過し、25 件は既存のスキップ。lanai の stagescript / emptystage / eventparts はローカル ROM で実行し、スキップは 0 件。dev サーバの画面操作 (blur で保存、別タブとの同期、スイッチのダイアログ) は未確認。
- 実装コミット: `fab46c7 Edit stage scripts only in the editor tab and keep the tabs in sync`。

### スクリプトの代入で変数を足し引きする

- `a = a + 1`・`a += 1`・`a++` と、その引き算 (`- -= --`) を書けるようにした。`a = b + 1` / `a = b` のように別の変数からも書ける。足し引きする値は 0〜255 の数。
- `eventScript.ts`: `set` ノードに `from` (読む変数) を足し、`value` を足す値 (変数の幅で回り込む) とした。生成コードは変数を読み (getByte / getBit)、`add r1, r0, #値` と `and r1, r1, #0xff` (bit は `#1`) で回り込ませて書く。`++` / `+=` は `+` と `+`/`=` が隣り合うときに読む (トークナイザは変えていない)。
- `scriptDoc.ts`: 文の一覧に書き方を足した。
- 検証: 型チェックが通過。`lanai-stagescript` / `lanai-scriptdoc` の 42 件が通過し、スキップは 0 件 (ROM での CRO 生成テストを含む)。実機の動作は未確認。
- 実装コミット: `6b29c7e Let a script assignment add to a variable: a = a + 1, a += 1, a++`。

### byte の変数を数、bit の変数を true / false として読む

- 問題: `obj(26).RotateTo(x * 90 * 3.14159265 / 180, …)` の `x` が `var x: byte` のとき「数で書きます」で失敗した。引数の式は作るときに計算する定数だけを受け付け、実行時にしか値の決まらない変数を読めなかった。
- byte の変数は、イベントの実行時に読む数として式に使える (+ - * / と括弧)。使える所: Script API の整数・小数の引数、関数の `num` 引数 (`face(X + 1)`)、byte への代入 (`N = M * 2 + 1`、`N += M`、`N++`)。
- bit の変数は true / false として扱う。Script API の bool の引数 (`hero.SetVisible(B)`) と bit への代入 (`B = C`、`B = !C`) にだけ使える。計算・`B++`・byte への代入はエラー。`6b29c7e` で入れた `B++` は外した。
- 作るときに数が決まっている必要がある所 (obj(N)、vec、case、比べる値、行 ID) で変数を使うと「…には変数を使えません」を出す。
- `eventScript.ts`: `ScriptExpr` (式の木、定数は畳み込む)、`ScriptArg` に `{ k: 'x', as: 'i' | 'f' | 'b' }`、`set` ノードに `expr` を足した (`from` は廃止)。コード生成では、Execute のフレームの上に 16 語のスロットを足す (通常 0xB0、intro は 0x348 から)。変数を getByte / getBit で読んでスロットへ置く。式は整数 (r0-r3, ip, lr、mul) で計算し、小数や割り算を含むときは VFP (s0-s5) で計算して切り捨てる。結果を引数スロットへ置き、引数のレジスタへ読む。bool は 0 / 1 にそろえる。
- `ScriptPreview.tsx`: 実行時の引数を式の文字列で表示する。`scriptDoc.ts`: 書き方を足した。
- 検証: 型チェック・lint・全テスト (Lefthook) が通過。ROM での CRO 生成テストで、フレームの拡張 (0xF0 / intro 0x388)、スロットの保存・読み込み、mul / vdiv / vcvt、整数・小数の引数の受け渡しを確認した。実機 (Azahar) の動作は未確認。
- 実装コミット: `46b1e16 Read byte variables as numbers and bit variables as booleans in the script`。

## 会話イベントの UI (計画 velvety-churning-leaf)

- ROM 解析 (Codex): 結果は `roms/tmpmap/talk-voice-analysis.md`（コミットしない）。StartMessageAuto（話者 1 の行のとき）と StartMessageHero は、渡した行の物理的な位置に先頭の電波人間の性格 0〜6 + 1 を足す（性格 0〜6 = 口調 2〜8、ほかは口調 1）。無印は渡した行をそのまま出す。voice は RubyTalk Ver2.01.00 の読みで、半角カナ・ASCII の 1 バイト文字列（' / | . ? > と $page$・$message:表:十進ID:voice$・$hero$）。空なら喋らない（本文から読む処理はない）。話者 1〜0x0E は声のプリセットを持ち、どの呼び出し（StartMessage を含む）でも行の voice を喋る。主人公に口パク 0x80000079 を使う CRO は見つからなかった。
- 引数入力中の関数ヘルプ: `scriptAssist.ts` の `scriptCallAt` / `scriptSignatureAt`（vec(…) / obj(…) の中では外側の引数番号、自作関数は全文から引数を読む）。`scriptCodeMirror.ts` で StateField + showTooltip、入力中の引数を太字、Escape で閉じる。エディタのハンドルに `insertAtCursor`。`tsconfig.json` で `roms` / `docs` を除外した（Codex の解析用 .ts が型チェックに入るため）。コミット `a043da3`。
- 台詞: `talk.ts` に口調の性格名、話者一覧 `SPEAKERS`、voice の読み書き（`talkVoice` / `encodeTalkVoice` / `setTalkVoice`）、かな → 半角カナ、本文からの下書き `voiceDraft`、改ページ数の検査。`maps.ts` に `lanaiAppendTalkSet` / `addTalkSet`、追加行の Undo で voice も戻す。セリフのページに「＋ 性格違いの組」「＋ 主人公専用」、1 行の話者の選択、「全口調へ写す」、行ごとの読みの欄。
- スクリプト編集画面: 演出プレビューのマップの MapGroup の台詞・群れをエディタに渡し（注記・補完）、「＋ 台詞を追加」（`ScriptLineDialog.tsx`: 相手の台詞 = talk()、先頭の電波人間の 8 口調 = StartMessageAuto、主人公専用・システム = StartMessage）でカーソルの位置に呼び出しを書く。台詞の一覧に「挿入」。
- 演出プレビュー: `mapview.ts` に 3D のイベント番号のラベル（区画の色、使うイベントは黄色、再生中のものは白、プレビューのキャラに追従）とクリックの判定。`previewSequence.ts` の `previewReferencedRows`。プレビューに表示の切り替えと「obj(N) をカーソルの位置に書く」。2D のマップの番号は未対応。
- 検証: 型チェック、本番ビルド、対象テスト（scriptassist 21・talk 11・scriptpreview 6、talk の ROM テスト 2 件を含む）が通過。1 つ目のコミットは Lefthook（整形・lint・型・全テスト）が通過。2 つ目以降は Lefthook が通ったあと gpg の署名がパスフレーズ待ちで失敗し、未コミット。画面操作と実機は未確認。
