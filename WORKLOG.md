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
- 2・3 のコミット: `611d1b6`（Lefthook 通過。gpg の署名はユーザーがパスフレーズを入力）。

## マップの電波人間のモデル (計画 playful-juggling-sparrow)

- 原因: `lanaiRecordLook` が MapChara +0x2C を常に MapObject の行として読み、MapChara 種類 3（電波人間、+0x2C = DenpaCustom の行）が扉・門のモデルになっていた。演出プレビューの `obj(N)`、マップの 3D 表示、見た目の欄、イベント選択が同じ誤り。
- ROM 解析 (Codex): `roms/tmpmap/denpa-npc-analysis.md`（コミットしない）。`FUN_0023CFAC` が EO +0x5C (0/1/2) で MapChara +0x2C u16 / +0x10 u32 / +0x2E u16 を選び、種類 0 MapObject、1 MonsterDesign、2 MonsterParameter（+0x00 bit20..29 が MonsterDesign。電波人間ではない、11 行・15 配置）、3 DenpaCustom（96 行・141 配置、セーブ参照なし、無効は行 0 マネキン）。値は表の行番号か行 ID（+0x10 は ID。EO +0x5C=1 は NPC 8・ボス 8 件）。DenpaCustom (0x50) の外観: +0x0C/+0x10/+0x14 模様・主色・副色、+0x38 レベル、+0x3A AntennaGroup、+0x41 頭、+0x43 体 (BodyData)、+0x44〜+0x4C 顔・髪・肌色・髪色・眉・目・鼻・口・頬（髪以外 1 起点）。
- 実装: `mapObjects.ts` の `lanaiCharaModel` / `lanaiCharaTables`、`{ type: 'denpa', custom }`。`animationModels.ts` の `lanaiDenpaCustomLook` / `lanaiDenpaCustomModel`（見本 `lanaiDenpaModel` も同じ組立て）: HeadData の頭、BodyData の大きさ、顔アトラス（RPG3 の `faceMaterials`）、BodyPattern のテクスチャ、ColorData の 2 色を体の材質の定数色 1 / 2 に。BCH の材質に段ごとの定数色の番号 `tevConstants` を足した（TevStage に入れると移植テストの材質比較が崩れるため材質の任意欄）。アンテナと特殊色（ColorData +4 = 0x1000）は未対応。
- 検証: 型チェック・全テスト 832 件通過。ROM のテストでコンテンツ 16 MapChara 7 → DenpaCustom 11 かしたろう、58 の 18 (EO +0x5C=1) → MonsterDesign 108、地図の電波人間 80 行以上が組み上がる。画面と実機は未確認。コミット `1733024`。

## 1 ステージに複数のショップ (a5462df) / STATE #7 共通の上限 (32bcea6)

ROM 解析 (Codex、Update v17408 code.bin、読み取りのみ)。docs/lanai/shops.md §4 の「店の人は行 0 を開く・引数に店の番号はない」は誤りで、1 店のステージで引数が 0 だっただけ。submodule の訂正は未実施。

- 店の選び方 (確定): 型 0x32 店の人 / 0x33 範囲に入ると店 は、動作の引数 2 (型 +0x08) を店の選択子として渡す。`FUN_0031C038` が 0x80000000 未満を Shop の行番号、以上を行 ID として探し、ないときは行 0 (`0x474734` / `0x45B4B0`、`0x24A2DC`)。コンテンツ 97 は型 0x33 × 36 件が行 0〜35 を開く (テストで確認)。24 は CRO から `ShopCommon::CallShop` (`0x19341C`)、0 は CRO のメニュー (8 行と入口の対応は未確認)。店を開く Script API はない。
- 買える数 (+0x26) の記録 (確定): 店の番号は `0x1325DC` が求めた Shop の行。0x99 は店 0〜9 だけ。行 10 は記録されず、11 以上は 10 で割った余りの店と共有。
- 共通の上限 (確定): 保存値 0x9A はセーブ全体で 1 つの 200 要素の配列。読み `0x002AEF18–30`、書き `0x0045F0A8–C8` とも添字は +0x28 だけ。同じ番号なら店・ステージをまたいで共有。ROM の +0x27 ≠ 0 は 219 行・51 番号 (コンテンツ 0 と 97 だけ、コンテンツをまたぐ重複なし)。+0x27 = 0 で番号がある行はコンテンツ 0・店 3 の番号 6 の 1 行。リセットは `0x00246D40` (配信で店の品が変わったとき、その品の枠) と全保存値の初期化 `0x0043DE40` (推定: 新しいセーブ)。
- 実装 a5462df: `LanaiContentShops.addShop` / `removeShop` / `shopOf`、`lanaiClerks(maps, shops)` が 0x33 も拾い、開く店を解決。ショップのページに「＋ 店を追加」・追加した店の削除・店ごとの店の人・行 10 以上の警告。マップのインスペクタの引数 2 と「店の人」を置くダイアログで店を選ぶ (`ShopSelect`)。ROM パーツの店の人は引数 2 を 0 に。
- 実装 32bcea6: `#/shops/shared` (番号ごとの行と空き番号)、共通の上限の欄に「空き」と →、ほかのステージと同じ番号を使うと警告。説明文を確定した内容に。
- 検証: `bun test test/lanai-shops.test.tsx` 14 件通過 (ローカル ROM で ROM のテストも実行)。コミット時の Lefthook 通過。画面と実機は未確認。

## マップの電波人間のアンテナと体色 (STATE 14-1)

- 照合: コンテンツ 16 のパーティの画面写真 (MapChara 7〜14 = DenpaCustom #11〜#18、全員 Lv220) で、体色・アンテナの属性・装備 (DenpaCustom +0x18〜+0x34 = ItemData の行 ID、+0x10 は持ち物) が一致。
- ROM 解析 (Codex): `roms/tmpmap/antenna-analysis.md`。段階は AntennaGroup +0x22 (u16 × 6) を先頭から比べ、最後に到達した +0x04+4k のスキル (未到達は SkillData 1 アンテナのねっこ、グループ 0 は行 0 なし、0x2B69CC)。モデルは SkillData +0x15 → AntennaModel +4 (E50D0000)。アトラスは AntennaModel +0 & 3 (0x340 → 75F22000 のアイコン集 ETC1A4、0x341 → 33945C00 の専用モデルの絵 ETC1 でアルファなし。Codex は SkillData +0x10 & 3 と読んだが誤り: アイコンを持つ 190 件中 173 件が 1 で、はるお・かしたろうが不透明な別の絵 (ねむらせる) になっていた。+0x10 & 3 はスキルの種類と見られる)、アイコンは +0x11 & 0x3F (1 起点、8 × 8 を列ごとに上から)、倍率は +0x10 bit 2..5 (0.8/1/1.2/1.4/1.6)。頭の ante ボーンに、頭の倍率を打ち消して付ける。
- 体色の訂正: フィールドの体は F0F40000/679F6C00 で、定数色 0 = 主色、1 = 副色、2 = 黒 (96EB0000 版は割り当てが違う)。同じ 2 色なら模様なし、模様ありで副色 0 / 2 は黒 (3)、模様なしで副色 2 は 0、副色 0 は主色。
- 実装: `animationModels.ts` の `lanaiDenpaColors` / `lanaiAntennaSkill` / `antennaPart`。テスト: 8 人のアンテナが画像の属性どおり (じごくのごうか・ならくのそこ・マグニチュード12・みんなかんぜんふっかつ・みんなわざアップ・みんなムキムキ・みんなたたり・みんなぜんぶかいふく)。地図の電波人間がすべて組み上がる。
- アンテナのコミット `255db6d`。

## マップの電波人間の装備 (STATE 14-2)

- Codex は利用枠の上限で途中終了（分布のスクリプト `roms/tmpmap/equip-distribution.ts` だけ残った）。以降はデータと BCH から推定し、コードでの裏付けは未了。
- 枠 (DenpaCustom、全 209 行の ItemDataCore +0x32 の分布): +0x18 頭・めがね、+0x1C 首、+0x20 グラブ・うでわ、+0x24 足、+0x28 背中 (ぶき・スカート・マント・しっぽ・はね・だいこ)、+0x2C ふく。+0x10 は持ち物 (回復・ランプなど)。
- 付け方 (BCH から): 体のボーン名 (spine, L_hand, R_heel, L_wing, manteau1 …) を 2 本以上持つ、または頂点がその 1 本の位置にある装備は体の座標で作られており、名前で体のボーンにスキンする (グラブ・足・首・マント・はね・うでわ)。ほかは付け先の原点で作られている: 頭・めがね (equ_face_*) は頭のモデルの根元、ぶき・だいこなどは shoulder_back、スカート・うきわは hip、しっぽは tail、首は spine。ふく (0xD1 / 0xD2) は hum_base のテクスチャで体の模様を置き換える。頭の装備は顔の絵 (描く順 1〜30、深度を書かない) の後に描く (40)。
- 不具合と修正: `lanaiItems()` は ItemDataCore のない行を飛ばすので、配列の添字は ItemData の行ではない。添字で引いて別の装備 (ダウンジャケットなど) が付いていたのを、行番号で引くよう直した。
- 検証: 簡易ソフトウェア描画 (scratchpad の denpa-render.png) で、かしたろうのグローブ・げた・ベルト・胸の飾り、りゅうのグラブ・じゅず・あくまのはね、さなこのはね・ネックレス・ブーツが画像と同じ部位に付くことを確認。全テスト 835 件通過。
- 装備のコミット `79242e6`。
- 服の色の反転: 体の材質の TEV は c2 (黒) → + tex × c0 → + (1 − tex) × c1 で、模様 (白黒のマスク) で主色と副色を混ぜる。服 (0xD1 / 0xD2) はカラーの絵 (ETC1) なので、人の体色を入れると混ざり、主色が暗く副色が明るい人では明暗が反転していた。服を着ているときは c0 = 白、c1 = 黒 (色 = tex、/items ページの表示と同じ) にした。ゲームが服のときに入れる定数色はコードで未確認 (ColorData 2 = 白 / 3 = 暗い灰の可能性あり)。
- 服の色のコミット `3116cdb` (レアの色のテストも同梱)。
- 体色の特殊値: ColorData +4 は色の系統のビット (1 黒、2 赤 … 0x800 銀、0x1000 レア)。レア (行 2) は副色にだけ使われ (23 か所)、服なしで見えるのは #169 ゆう (模様 5) だけで、規則どおり黒 (3) になる。

## 装備の付け方のコードでの裏付け (Sonnet のサブエージェント、roms/tmpmap/equip-code-analysis.md)

- 組立て 0x1B6440〜0x1B64E4 が欄ごとに装備を作る。名前追従 (0x4479F0 → 0x3DE744) は種類ごとの決まった名前だけ: 首 root/hip/spine/L_arm/R_arm/head/scarf (基点 head)、グラブ spine/L_elbow/L_hand/R_elbow/R_hand (基点 Root)、うでわ L_hand/R_hand、足 hip/L_foot/L_knee/L_heel/R_foot/R_knee/R_heel (基点 hip)、マント・はね root/hip/tail/spine/L_arm/R_arm/head/manteau1〜3/L_wing/R_wing (基点 spine)。
- 1 本のボーンに固定 (0x3018CC): 頭 0x81 → head、ぶき 0xC3 → shoulder_back、だいこ 0xC4 → head (推定の shoulder_back は誤り)、スカート 0xC5 → hip、しっぽ 0xC6 → tail。うでわは R_hand 固定ではなく名前追従。
- めがね 0x82 はモデルを作らない: equipInfo_face +0x00 の bit 0〜4 (23 個が 1〜23、docs/lanai/equipment.md §1) で顔の Megane のマスを選ぶ (0x2D3418 → 0x26CE7C)。顔のアトラスで列 14 行 1〜15・列 15 行 0〜7 の 23 個で、RPG3 の denpaFaceUv('Megane') と同じ並び (報告の x/y は逆の表記)。
- 服: 白・黒・黒で確定 (0x2D3C18〜0x2D3C5C、服ありは体への色の再適用を飛ばす)。
- 未確認: 頭の装備を顔の絵の後に描く (drawOrder 40) のはコードに根拠なし (仮定)、固定の付け方 (モード 7) の拡大・回転の扱い。
- 実装: `denpaEquipment.ts` を書き直し (FOLLOW の表、rigidBone、lanaiDenpaGlasses)。テストに 23 個のめがねの番号、さなこのサングラスが顔のマスでモデルなし、はるおのおおきめサングラス (0x81) がモデル。
- 装備の付け方の修正のコミット `7746c01`。
- 体色の修正: 画像の 8 人は服でなく行の模様・色で写っているため、マップでは服を描かない。色の規則をコード (0x2DABE0, 0x45DB54) どおりに直し、模様なし・副色レアを rare とした (光る手続きテクスチャは未実装)。解析は roms/tmpmap/clothes-flag-analysis.md。コミット `1f6e3fe`。
- 頭の色: 頭のモデルの Body 材質 (hum_base) にも本人の主色・副色を入れる (既定の赤・黄が出ていた)。コミット `79c4c58`。
- 服: 体の Body 材質だけを服のテクスチャ (hum_base/clothes) にし体の定数を白・黒・黒に、頭は模様と本人の色のまま (1f6e3fe の「服を描かない」は誤りで、これで置き換え)。コミット `28d0563`。

## STATE #8 サムネイルの反映 (調査、2026-11-21)

- 症状 (配信用 zip、追加したステージ): 一覧で最初にホバーすると絵が出ず、直前のステージの絵が残る。確認画面では絵の両端にノイズが出てちらつく。
- Panana の書出しは正常 (既存テスト)。ROM の走査では、ほぼ全コンテンツが Stage_symbol01.arc (578F1C00) を自分のアーカイブに持ち、名前の衝突ではない (roms/tmpmap/scan-symbol.ts)。
- 0x31F108 (アーカイブのハッシュ→パス) の BL 呼出しは 7 箇所で、lanai-custom-stages の置換対象と同じ。stage_archive_path は state->active (stage_activate 後) のときだけ SD へ読み替えるので、選ぶ前の絵の読込みは ROM の場所で失敗する、と推定 (確度 中、呼出し元は vtable 経由で未特定)。スロット表は一覧の表示前に埋まる (stage_catalog_load)。詳細は roms/tmpmap/stage-symbol-analysis.md。
- Codex は利用上限のため、agy (Claude/GPT) も試したが、確認なしの実行ができず、解析はサブエージェントで行った。
- 修正は lanai-custom-stages 99304a5 で入れた。選ぶ前でも、受け取ったステージのアーカイブを SD に読み替える。ARM のテスト 14 件が通った。ゲーム内では未確認。Panana のコードは変更していない。

## STATE #15 タイルセットのテクスチャ (2026-11-21)

- 症状: カスタムステージの新しい MapData に Relic を割り当てると、タイルが白飛びする。
- 原因: `lanaiTilesets` は MapResource の行全体をキーにして数えていた。Relic には 2 つのテクスチャがある。`3DC60000/6D3A9800` は bg_kabrickfloor などで、モデル bgpt_09_relic が参照する。12 行あるが、+0x10 (戦闘背景) が違うため票が割れていた。`2B84B000` は bg_wall_stone_* で、10 行がすべて同じバイト列だった。結果として後者が選ばれ、テクスチャ名が解決できなかった。
- 修正 (コミット `b0ca085`): テクスチャ (+0x00/+0x04) ごとに行を数える。床のモデルのマテリアルのテクスチャ名を最も多く持つものを選び、同点なら行数で決める。新しい MapResource 行の +0x10 は、マップが元の行で使っていた値を保つ。同じタイルセットを選び直したとき、テクスチャが違えば再適用する (`tilesetTextureDiffers`)。
- テスト (ROM あり、13 件が通過): Relic は 6D3A9800。全タイルセットで床のテクスチャ名が解決できる。例外は Boutique の bg_floor_01 で、ROM でも欠けている。
- CaveC: 床の M_ground は、段 0 で頂点色 × caveC_pro (tex0)、段 1 で段 0 のアルファにより bg_ground_01 と補間する。GSC にもテクスチャ BCH にもマテリアルアニメはない。caveC_pro は実行時に proctex_files の pctxbin へ差し替えると推定 (未確認)。Codex は利用上限で、agy は確認なしの実行の権限が拒否されたため、解析は未着手。

## チップ自動配置の接続ロジック (6e353e1、2026-11-21)

- 症状: 隣り合う部屋の横に線を引くと部屋同士が通路でつながる。触れ合う 2 部屋の継ぎ目を塗ると 1 マスごとに出入口ができ、隣の別の部屋ともつながる。新しい部屋が斜めにできると、既存の内角 (8) が床 (5) に置き換わる。
- 原因: 「隣が埋まっているか」で接続を決め、ストロークの 8 近傍を作り直していた。内角は「斜めのマスが部屋か」で判定していた。
- 変更 (`src/editor/autotile.ts`): 地形を辺のグラフ (閉 / narrow / wide) として扱う。ドラッグは通った辺だけを開く (補間は 4 連結)。部屋の床は 2×2 で成立する。別の部屋は塗った場合だけ 2×2 に含め、継ぎ目を 2 マス幅で塗ると合体し、1 本線なら出入口が 1 つになる。形が変わらないタイルは返さない。内角は斜めのマスが両隣と wide でつながっているかで決める。`islands`・`edgeGraph`・`cellShape`・`partFor` を追加。
- 自動消しゴム (`autoErase`): 消しゴムツールで、消したマスを最初からなかったものとして扱う。2×2 の床が欠けた wide の辺は narrow になる (消した後の形を塗ったときと同じ結果)。Delete キーは選択したマスだけを消す (従来どおり)。
- ミニマップ (`src/editor/minimap.ts`): 置かれたタイル自身の形を 3×3 の区画で描く。端のマスは 2/3、角は 4/9、通路は中央の 1/3。隣が開き返さない開口は赤で示す。
- テスト: autotile / minimap に再現テストを追加。全体で 847 件が通過、25 件がスキップ (ROM なしのため。スキップは ROM 検証の成功ではない)。実画面 (3D 表示との見比べ) は未確認。

## スクリプトエディタで自作の変数・関数を補完 (822a207、2026-11-21)

- 症状: 自分で定義した変数や関数が補完されない。
- 原因: 変数の候補は全文を `scriptDocFromSource` で厳密に読んで作っていた。名前を打ちかけた時点で全文は読めないので候補が空になっていた。自作の関数と関数の引数は、そもそも候補に入っていなかった (引数のヒントだけが正規表現で関数を探していた)。
- 変更: `scriptOwnNames` (`src/lanai/scriptAssist.ts`) が、コメントを除いた本文から `var` と `function 名前(引数)` を単語として拾う。`ScriptAssist.functions` を追加した。単語の位置で自作の関数を候補にし、`名前(` を挿入する。カーソルがある関数の引数も候補にする。1 つ目の引数が obj の関数は `hero.` / `self.` / `obj(n).` の後にも出す (num の関数は `obj(n).` の後だけ)。`StageSourcePage.tsx` はマップの読み込み前からこれらの名前を渡す。
- テスト: `test/lanai-scriptassist.test.ts` に 1 件を追加 (22 件が通過)。型チェックと全テストも通過した。エディタ画面での操作は未確認。
- ScriptState (イベントの状態) の調査結果は会話でだけ報告した。実装はまだしていない。本体の CtrlFlag が実行後に状態を 0→1 に進めるので、作者が状態を管理するには何もしない CtrlFlag を出すかどうかを決める必要がある。0〜3 より大きい値と、マップを出入りしたときに状態が残るかは Azahar で確かめていない。

## STATE #15 CaveC のプロシージャルテクスチャの解析 (2026-11-22)

- 解析: Codex がファイル形式を解き、途中で利用上限に達した。続きはサブエージェントで行った。資料は roms/tmpmap/cavec-proctex-analysis.md、cavec-proctex-format-notes.md、cavec-mud03-proctex-dump.json。アドレスは update のコード。
- 選び方: タイルの読み込み (0x1E10C0) が 0x2BEAF8 を呼ぶ。MapParts のアーカイブが 0xD17B0000 (CaveC の全パーツ。ほかのタイルセットにはない) のとき、名前の表 0x4EB52C の +0x14 = `rom:/proctex_files/proctex_mud03.pctxbin` を全マテリアルに付ける。テクスチャ名の `_pro` では決まらない。
- 描画: コールバック 0x234040 が TEV の段 0 を Modulate(頂点色, Texture3) に書き換える。proctex は texcoord0 で引く PICA のテクスチャ 3 なので、caveC_pro は使われない (置き場だけ)。段 1 (bg_ground_01 との補間) はそのまま。タイルごとの UV 行列 (0x233228) は u' = 2(u + 列)、v' = 2(v − 行) で、ノイズはタイルをまたいで続く。
- アニメ: 0x233364 (場面の更新ごと、0x42ABA0 から呼ぶ) で、ノイズの位相 U/V だけを変える。mud03 はモード 1 で、位相 = P0·sin(2π·fmod(n·step, P0)/P0)。n は 1/60 秒単位。U = 3.5·sin(2πt/29.2 s)、V = 1.5·sin(2πt/12.5 s)。
- mud03: 合成 5 (U²+V²)、mirrored clamp、linear、bias 0.5、LUT 幅 128・offset 0。ノイズの振幅 2/1、周波数 0.35/0.30。色の LUT は紫のランプで、アルファ 0.914。
- Kahara: 0x2F1B68 が、引数 0 が 8 で ID が 0xA5CCD17B のとき mud03 を選ぶ (名前の表 0x55FF00)。
- 未解決: コールバックが tex1 の行列も書き換えるか、レジストリのスロット 0x21 のフック、pctxbin の 0x163C〜0x1648、壁にも見た目の効果があるか (実機)。

## STATE #17 出荷 CRO のイベントの逆変換: 調査 (2026-11-22、82fcff4)

- 資料: notes/lanai-cro-decompile.md (ステージ済み)。集計スクリプトは roms/tmpmap/decomp/scan.ts と q.ts、出力は同じ場所の functions.tsv・factories.tsv・slots.tsv・summary.txt。
- 集計: イベント系のクラスは 808、仮想関数は 1727 本。Execute 系 794 本のうち、そのまま言語で書ける形は 226 本。欠落が多いのは、ベクトル値 (GetPos と VEC 演算)、数値の局所変数、メンバー変数 (588 本)、ScriptMonster・ScriptEffect、TurnNpc / TurnHero。枠 3 は 125 本中 99 本が、フラグで返すクラスを選んでいる。
- Codex は、まず標準入力待ちで止まった (`< /dev/null` で解消)。そのあと利用上限に達した。agy は auto mode に拒否されたので、集計は自分で書いた。
- 最初のコミットは GPG の署名で失敗した。gpg-agent が動いていなかったので、Gpg4win の gpgconf で起動してからコミットした。

## STATE #17 言語の拡張: 局所変数・位置・呼出しの値 (2026-11-22、f16e104)

- 目的: 出荷 CRO を逆変換するとき、頻出の形をそのまま書けるようにする。言語で書けない呼出しの上位は GetPos (1161)、VECSubtract (451)、GetShadowPos (112)、VECAdd (111) で、位置と局所変数が最も多く欠けていた。
- API 表: 生成器 (lanai-custom-stages 3ds/research/script-api-table.ts) は、シグネチャが `)` で終わるものだけを関数としていた。そのため `) const` の const メンバーをデータとみなし、件数にも出さずに落としていた。正規表現を直し、GetPos・GetShadowPos・GetChara・GetAnimDataID など 10 件を表に足した (lanai-custom-stages 側の修正は未コミット)。
- 言語 (eventScript.ts):
  - `let 名前 = 値` で局所変数を宣言する。数 (float) か位置 (vec) を持ち、保存はされない。代入は `=`、数は `+= ++`、位置は `+= -=`。関数の中の let はその関数だけのもので、展開のたびに `p#3` のような一意の名前になる。
  - 位置は vec(式, 式, 式)、局所変数、GetPos / GetShadowPos (const GSvec* を返す: VEC_RESULT) で書く。位置どうしの足し引き、数との掛け算・割り算、`.x / .y / .z` ができる。
  - 値を返す Script API を式・引数の中に書ける (入れ子も可)。void とポインターは不可。
  - byte 変数か整数の戻り値を定数と比べる条件は、従来どおり整数で比べる。それ以外 (局所変数、float の戻り値、計算) は vcmp で小数として比べる (ScriptNumComparison)。
- コード生成:
  - フレームは「既存のフレーム + 局所変数 (最大 0x100) + スクラッチ 0x140」。スクラッチは take / release でスタックとして使う。
  - 呼出しで計算する引数は、呼出し先の ScriptChara を作る前に評価する。入れ子の呼出しが FRAME.obj を壊さないため。
  - vldr / vstr が 0x3FC より先に届かないときは ip 経由にする (入場の演出はフレームが 0x348 あるため)。
  - `sub sp` の即値に表せないサイズは 8 ずつ切り上げる。
- 影響: 通常イベントのフレームは 0xF0 → 0x1F0 に増えた。1 つの式が読む変数のスロットの位置が変わった (既存テストの期待値を直した)。
- ほか: ヘルプ (scriptDoc.ts) に let と位置の計算を足した。補完が let の名前も出す。eventProblem・charaRows は式の中の呼出しも見る (nodeCalls / callsIn)。
- テスト: test/lanai-stagescript.test.tsx に、局所変数・位置・小数の比較のコンパイル (ROM) と、拒否する書き方のテストを追加した。全テスト 851 件が通過、25 件は ROM がないためスキップ。小数の計算は命令の有無で確かめただけで、ARM の実行器は VFP を実行しないため実行結果は見ていない。実機 (Azahar) でも未確認。

## STATE #17 言語の拡張 2: 隊列のループ・event・ScriptMonsterCtrl (2026-11-22、d975c3d、署名なし)

- `for p in party { … }`: パーティの電波人間 1 人ずつに本体を実行する。出荷 CRO の ScriptPlayer[8] ループ (461 本) と同じく、毎回 GetPlayerNum と比べ、GetPlayer(i) を ScriptPlayer にして呼ぶ。配列は持たず、呼出しのたびに作って壊す。p は hero と同じに使え、ライブラリ関数 (walk・turn) にも渡せる。break でループを抜ける。数え上げの変数はフレームの局所変数を 1 語使う。ScriptWho に `party`、ScriptNode に `party` を足した。走査は scriptBodies に寄せた。
- `event.関数()`: 話しかけたときのイベント自身 (NpcCommonTurn) の関数を呼ぶ。TurnNpcRecover (出荷 78)、ZoomHeroCamera (59)、RecoverHeroCamera (17)、TurnNpc / TurnHero。話しかけ以外のイベントでは eventProblem がエラーにする。
- API 表: 生成器の静的クラスに ScriptMonsterCtrl を足し、GetMonsterSize / GetMonsterLevel(ChrObject*, u32) が呼べるようになった (lanai-custom-stages 側は未コミット)。
- 予約語に for / in / party / event を足した。ヘルプにも書いた。プレビューは party の電波人間を先頭として扱う。
- テスト: 隊列ループの import と命令、event、ScriptMonsterCtrl、拒否する書き方を追加した。全テストが通過 (ROM がない 25 件はスキップ)。実機では未確認。
- 残り: ScriptMonster (603 呼出し)、ScriptEffect (1106)。大きさと寿命 (イベントが持ち続けるか) を調べる必要がある。

## STATE #17 言語の拡張 3: ScriptMonster・ScriptEffect (2026-11-22、f03f541、署名なし)

- 出荷 CRO の使い方 (lanai-custom-stages out/script-abi/calls.tsv): ScriptMonster(ChrObject*) は 367 回のうち大半がスタック上 (sp+0x288 / sp-60) で、マップのキャラ (GetMapChara / GetChara) を包んで関数を呼び、~ScriptChara で壊す (content 7 +0x2AA4: SetForceFollowRotate → GetMonsterLevel → SetMapLabel)。大きさ 0x58 (後ろのメンバーが +0x58)。ScriptEffect() 381 回はイベントのメンバーとしてコンストラクターで作る (隣が +0x4C、大きさ 0x4C)。どちらも専用のデストラクターは公開されておらず ~ScriptChara。ScriptEffect には ScriptChara::SetPos を呼んでいる。
- obj(N) / self の関数: ScriptChara に無い名前は ScriptMonster の関数として、呼出しのたびに FRAME.obj に ScriptMonster を作って呼ぶ (0x58 なので obj2 にかかるが、ScriptMonster の関数は ScriptChara& を取らない)。CreateChara / CreateMonster / CreateMonsterParameter / SetChara (作り直す関数) はエラー。hero / party では呼べない。ScriptCall.player を of ('chara' | 'player' | 'monster') に変えた。
- `effect 名前`: イベントのオブジェクトに ScriptEffect を足す (new のサイズ + 0x4C ずつ、ファクトリで作り、デストラクターで後ろから ~ScriptChara)。vanishEffect の分が先頭。名前.CreateEffect / SetPos / StartEffect / StartAnimation / StopEmission と ScriptChara の関数が呼べる。名前はその on の中だけ (on ごとに env を空にするようにした)。プレビューはエフェクトを飛ばす。
- API 表: 生成器のメンバークラスに ScriptMonster / ScriptEffect を足して再生成 (390 関数、lanai-custom-stages 側は未コミット)。
- テスト: ScriptMonster の import、作り直す関数の拒否、effect のオフセット (0x58 / 0xA4)、別の on からは見えないこと。全テストが通過 (852、ROM がない 25 件はスキップ)。実機では未確認。

## STATE #17 出荷 CRO のイベントの逆変換 1〜5 (2026-11-22、ca46a8f)

- 実装: `src/lanai/croDecompile.ts` (`decompileContentCro` / `decompiledSource`)。UI は `CroEventDialog.tsx` と、スクリプト編集画面の「既存のイベントから挿入」(選んだクラスの関数と、使うフラグの var を末尾に足す。既にある var は足さない)。出荷ステージ (自作でないもの) のページには「スクリプトを閲覧 ↗」を置いた (`CroScriptView.tsx`)。別タブで CRO を戻したスクリプトを読み取り専用のエディタに出す (イベントごとに絞れる)。出荷ステージの CRO はスクリプトから作り直さないので、編集・反映はない。
- 1 ファクトリ: CRO の各セグメントを平らに並べ、内部の再配置を当て、import は偽のアドレスのスタブにして `game/arm.ts` で実行する。グループと行 ID の候補は、ファクトリ (と呼ぶ CRO 内の関数) の比較・リテラルの定数。フラグなど値を返す呼出しは 0 → 1・定数の順で木のように試し、結果のクラスが変わるときだけ「生成の条件」を注記に出す。作ったオブジェクトのメンバー (基底クラスより後ろ) で、どのオブジェクトでも同じ値は本体の定数として読む (+0x74 のモンスターの行など)。退場時の export 27 を実行し、0 にするフラグは `reset`。
- 2 本体: Execute (IntroCommon は vt+0x18) と CtrlFlag (vt+0x10、本体の末尾に足す) を記号実行する。基本ブロック → 後支配木で if / else、ジャンプ表で switch、後ろ向きの辺でループ。GetPlayer / GetPlayerNum を呼ぶループは `for p in party`、ほかのループは 1 回分をコメントにする。合流で分岐ごとに違う値 (台詞の行 ID など) が残るときは、合流後を両方の枝に書く (24 回まで)。ScriptChara / ScriptPlayer / ScriptMonster の ctor と SetChara で相手 (obj(N) / hero / self / p) を覚える。ScriptPlayer[8] の [0] は hero。VECAdd / VECSubtract / VECScale は `let vN = …`、VECSquareMag は成分の積の和。言語の制約 (同じ引数の形のオーバーロード、ScriptPlayer の関数を obj に、selfRow の計算、引数の数の上限) に当たる呼出しは注記にする。
- 3 畳み込み: ライブラリ関数の本文をテンプレートにして照合 (talk / open / jingle / camera / cameraBack / move / walk / openDoor / partyLineUp …。turn / face / vanish は除く)。話しかけの先頭の TurnNpc / TurnHero は外す (コンパイラが書く)。
- 4 フラグ: `bit_0xNN` / `byte_0xNN` として宣言し、元の番号を注記に残す。行 ID・台詞・マップは元のまま。
- 集計 (lanai-custom-stages の out/script-abi/cro 127 本、`roms/tmpmap/decomp/run.ts`): 567 イベント (ファクトリが作るクラス 555)、パーサーを通るもの 563、未対応のないもの 45、Execute だけなら 58。完了条件の 226 には届いていない。多い未対応: 配列のループ、blx、OpenMessage の呼び分け、メンバーへの書き込み、準備 (vt+0x8)。1 CRO あたり約 0.2 秒。
- テスト: `test/lanai-crodecompile.test.ts` 5 件 (ROM 2 件を実行: コンテンツ 65 の talk の割り当てと畳み込み、全イベントの文が読めること、未対応のない talk をコンパイルできること。コンテンツ 1 の Yes/No で台詞が分かれる形)。画面での確認と実機は未実施。

## STATE #19・#20 閲覧タブとパーツの選び方 (2026-11-23、0619ace)

- 閲覧タブ: エディタを縦いっぱいに。window.open のタブで CodeMirror が親ウィンドウの IntersectionObserver を使い、スクロール先を描かなかった → 作る間だけタブの Observer を使う (`scriptCodeMirror.ts withObserversOf`)。
- Codex 調査 (roms/tmpmap/parts-npc-findings.md): 歩き回りは EventObject +0x5C が選ぶ MapChara +0x0C / +0x1C / +0x28 の下位 10 bit (0 = 立つ、出荷値 75〜250)。Update 0x23D04C〜0x23D18C。アクションは無関係。NPC・話す・店の人はアクション (と台詞・Shop 行) だけの差。区画 5 の装置は 9 筏 (17 件)・10 筏の門 (61)・14 汎用の置物 (186、25 外観)・15 シンボル (2)。
- Codex 調査 (roms/tmpmap/parts-props-findings.md、mapobject-classes.json): MapObject +0x20 f32 = 不透明度 (409〜442 と 447〜480 が同じ BCH で 1.0 / 0.4、0x23D134)。+0x24 下位 16 bit = 付属エフェクト (0x23 松明の炎、0x24 かがり火、行 520 / 530 が炎あり / なし)。建物の入口の 2 候補は動作 0x80000017 / 0x80000019 の違い。種類 4 の 2 候補は外観 44 / 735。
- 実装: 右クリックの使用例メニュー (romParts の places、PartPicker)、NPC の役割ダイアログ (`lanaiPurposeParts`・`RolePlacement`)、「新規・設定付き」廃止、歩き回り (`LookField WanderField`)、建物を選ぶ (`BuildingField`)、外観違いの統合 (`lanaiMergedRomParts`)、置物の分類 (`objectClasses.ts`)。
- テスト: 全体 858 pass / 25 skip / 1 fail → 失敗は外観統合の意図した変更で、テストを直して lanai-mapedit 14 pass。新規 test/lanai-objectclasses.test.ts 2 pass (ROM あり)。画面・実機の確認はまだ。
- 追加 (ユーザー指摘「同じアイコンの選択肢を出さない」): picker を (区画, 種別) ごとに 1 つに (`mapedit.ts lanaiKindParts`)。新規・既存ギミックの選択肢を廃止し、動作は置くときの `ActionPlacement` で選ぶ (新規レコードが同じ動作の ROM 候補を吸収し、件数と使用例を引き継ぐ)。`lanaiMergedRomParts` は (区画, 種別, 動作) で統合、見本は最多の外観。建物の入口は種別ごと。
- /animations → /models (`ModelPage.tsx`、`lanaiObjectModelRef`、`AnimatedModel.allMotions` でマテリアルのみのアニメも選べる)。右クリックメニューに「モデルとアニメを見る」。置物 #540 は置物・移動 (`objectClasses.ts ROW_CATEGORIES`)。
- Codex 調査 (roms/tmpmap/kinds-gaps-findings.md): 区画 1 +0x0D は FUN_0021C534 @0x21C588 で 0→#90 damg5、1→#89 damg3、2/3→#113 frozen。0/1 は危険床フラグ +0x5476 (@0x21C738)、3 だけセル +0x0A bit1 (滑る、@0x21C784)。→ 0「ダメージ床」、2「凍った床 (すべらない)」。区画 3 は FUN_004334F8 のジャンプ表が 0〜69 全てに分岐を持ち、歯抜けは出荷マップで未使用な番号 (9 はワープ、20〜69 に船・建物の既定行)。100 は壁の扉の別経路。同じ種別でも外観 (+0x5A) と動作 (+0x10) は独立 (種別 4: 外観 0/735 = 59/16 件)。
- テスト: 全体 858 pass / 25 skip / 1 fail (shell の CSS 規則が animations のまま) → 修正後、該当テストと lanai 系 60 + 22 pass。画面の確認はまだ。
- 並び順: 「区画 1〜9」(ギミックあり) を先頭に、続けて 装飾・置物・移動〜の順 (`recordparts.tsx rank`、59c41b8)。それまでは一覧にないカテゴリ (区画 n) がコメントに反して末尾だった。

## 重なったオブジェクトの選択 (2026-11-23、25631c1・cae154d)

- 選択ツールで同じ場所をダブルクリック (400ms・0.3 マス以内) → 半径 0.3 のレコード (近い順) と地形のマスをアイコンの列で出す (`src/editor/stackpick.ts`、`Controller.hitRecs / stackAt / doublePress`)。ホバーで仮選択、クリックで確定、Esc・外側のクリックで元の選択に戻す。1 件ならふつうの選択。クリックしたキャンバスの document に出す (別タブの表示)。
- 名前は `MapEditState.recordLabel` (既定は区画名、lanai は `lanaiRecLabel`、RPG2 は区画 3 の種類・区画 7 の扉)。
- 左下のステータスに「ここに N 件重なっています: ダブルクリックで選ぶ」(`Controller.stackHint`、RPG2 / lanai / oahu / honolulu)。
- 演出プレビューのイベント番号: 水平 150 以内の番号を番号の小さい順に上へ積む (`lanai/mapview.ts syncIds`)。
- テスト: test/stackpick.test.ts 4 pass、typecheck 通過。画面での確認はまだ。

## STATE #15 CaveC のプロシージャルテクスチャの実装 (2026-11-23)

- `src/cgfx/proctex.ts`: pctxbin の読み込み (`parsePctx`)、位相 (`procTexPhase`: モード 1 は sin、ほかは歩幅を足し、周波数 × 位相 ≥ 16 で 0 に戻す)、LUT のテクスチャ (256×4 float)、GLSL (`procTexGlsl`: Azahar と同じ順で、ノイズ → shift → clamp → 合成 → RGB/α マップ → 色 LUT)。
- `tev.ts`: 色の元 6 = t3。proctex があれば段 0 を Modulate(頂点色, t3) にする。頂点シェーダでタイルの UV を回し、`s(R(uv) + 列)`・`s(R(v) − 行)` にする。
- `three.ts` (ModelFactory): `set.proctex.models` のモデルは全マテリアルに proctex を付ける。`tick(秒)` で位相を進める。`placeOnGrid` は onBeforeRender で列・行・向きを uniform に入れる。`mapModels.ts`: アーカイブ D17B0000 のパーツには `proctex_files/proctex_mud03.pctxbin` を読む。`MapScene.setTicker` で、動く間は描画を続ける。
- 確認: パースの値が解析と一致した。WebGL2 (Edge、node + playwright-core を scratchpad に入れた) で、TEV と proctex のシェーダのコンパイルが通った。proctex だけの画像は紫の泥のうねりになり、時間で模様が変わった (roms/tmpmap/proctex-glsl-check.ts)。test/lanai-proctex.test.ts は 2 件通過。マップの画面ではまだ見ていない。
- 他のタイルセットのマップを CaveC にしたときの崩れ (roms/tmpmap/cavec-tile-usage.ts): ROM の CaveC のマップは種類 0〜14 と文字 z だけを使い、部屋の床 (種類 5) は 87 枚すべて向き 0。ゲームは CaveC の全パーツの全マテリアルに proctex を付け (0xFFFF)、UV をタイルの向きで回す。そのため (1) 向きのある床ではノイズの流れる向きが変わり、(2) CaveC のマップが使わない装飾 (種類 15 以降、文字 a〜d) にも模様が乗る。どちらもゲームの仕様どおりで、Panana の描画もこれを再現する。

## STATE #15 CaveC の継ぎ目・装飾・Kahara (2026-11-24)

- 継ぎ目: タイルは 1/4 回転ごとに rotation.y = −90° 回るのに、proctex の UV も同じ向きに回していたため、回転が打ち消されず 2 倍になっていた。`placeOnGrid` の角度を −向き×90° にし、どの向きでも u = +x・v = −z になった (roms/tmpmap/cavec-uv-check.ts で全パーツを当てはめた)。
- 装飾: `caveC_pro` を参照するのは文字 z のパーツだけで、装飾 (文字 1 以降) のマテリアルは持たない。proctex は段 0 が `*_pro` のマテリアルだけに付ける (ゲームの 0xFFFF の上書きが装飾でどう見えるかは未確認)。
- Kahara: タイルセット 11 のモデルのアーカイブは A5CCD17B で、0x2F1B68 の比較値と一致。`loadTilesetModels` がこのアーカイブに proctex_mud03 を付け、マップエディタの 3D ビューで並べ・動かす。
- 確認: test/lanai-proctex.test.ts 3 件 (回転ごとの UV と世界座標の一致を追加)、test/kahara-proctex.test.ts 1 件が ROM ありで通過。ユーザーが画面で Lanai の見た目を確認 (OK)。
- コミット: 6464e2a。
- コミット: fa32c31。

## STATE #17 ボス勝利の start・コンストラクタのエフェクト・アイテムを授かる演出 (2026-11-23、c330e19)

- 調査 (ボス戦の流れ): 動作 0x0C の引数は (MonsterGroup の行, byte フラグ, ボスの EO 行)。戦闘前にフラグを 2、勝って再構築した start 枠が `== 2` で BossWin を作り 3 にする。枠 27 で戻す。エフェクト: EffectData 0x14 fx_bg_trebox_op (宝箱)、0x22 warpzone_goal、0x32 fx_bg_shrine_birth、0xC1〜0xC3 fx_enm_dead_01〜03。
- `croDecompile.ts`: 呼出し直後の `cmp r0, #imm` / `ldr; cmp` の値を代替値に試す。同じ読み出しは同じ値を返す。値を変えても作るクラスが変わらない読み出しは条件から外す。どのグループでも作るクラスは `ANY_GROUP` (0) の 1 件に。クラスと契機の組 555 → 669、重複した条件行 2868 → 257。ファクトリの `CreateEffect` を `effect fxNN` + `fxNN.CreateEffect(行, 層)` として本体の前に、準備 (vt+0x8) はコメントで出す。ScriptEffect の相手不明の注記 446 → 34。
- `eventScript.ts`: `rareItem(アイテム, 数, 前置き, 後片付け, 仲間を消す, 隊列に戻す)`。RareItemDirection (0x378) をイベントに持たせ、StartItem / StartItemNum を呼ぶ (ItemGet で所持数と台詞も演出がする)。`scriptLibrary.ts`: giveItem (NPC から)、chestItem (本体の宝箱 0x1F2750 の順。せり上がりと光 0x14 はなし)。
- テスト: 全体 868 pass / 25 skip / 0 fail、typecheck 通過。実機は未確認。

## ステージ全体を初期値に戻す・/stages の編集済みの印 (2026-11-24、416145e)

- 原因: uwapo (lanai-custom-stages web/stage-files.ts) は ZIP 内の ContentsDef を持つアーカイブを全て配信対象とし、CRR がなければ「コンテンツ N の CRR がありません」で止める。`denpa-free-stage(2).zip` の 5EFC0000 (コンテンツ 1、D01) は mapdb が ROM と同じで、MapChara・D01_EventObject・d01_msg に 1 行ずつ追加 (NPC 1 体分) が残っていた。/maps の「元に戻す」(LanaiMaps.revert) はマップの区画だけ戻し、置いたときに表へ足した行は残る。
- `session.ts`: `changedArchives()` (表・追加した表・mapdb・マップ表・ステージ画像が変わったアーカイブ)、`revertArchive()`。
- `stageEdit.ts`: `lanaiChangedContents()` (アーカイブ + MapStageIntegration の行 + その MessageMapStage の行)、`revertLanaiContent()` (追加したステージは不可)。
- `StagePage.tsx`: 左リストに ● (追加したステージには出さない)。詳細に「ステージ全体を初期値に戻す」(確認ダイアログ、変更がなければ無効。追加したステージは従来の削除ボタン)。
- テスト: test/lanai-stagerevert.test.ts 1 件通過 (ROM あり)。commit hook の lint・typecheck・全テストは通過。

## STATE #18 の下準備: フラグを変数から選ぶ・条件スクリプトの廃止 (2026-11-24、未コミット: GPG 署名がタイムアウト、ステージ済み)

- `src/lanai/FlagSelect.tsx`: `scriptVarFlags` (変数の種類ごとに宣言順で 12000〜 / 24000〜)、`lanaiStageFlags` (開いているコンテンツのスクリプト)、`FlagSelect` (byte / bit の変数を名前で選ぶ、末尾に「手動」。ネイティブの <option> には input を入れられないので、手動のときだけ同じ枠の右に番号の欄を出す)。
- 出る・消える条件 (`EventConditionFields.conditionFlagKind`: 3 / 4 = bit、5〜7・0x30〜0x38 = byte) とボス戦 (actions.ts の pick `byteFlag`、0x0C の引数 2) に使う。
- 条件スクリプト: `ConditionEditor` から組み合わせの UI を外し、`EventConditionFields`・`StageEditor` の作成処理を消した。0x72 の既存の条件は保持して書き出しも従来どおり (session.conditionScripts は残す)。
- 調査 (#18 本体): Codex は利用上限、agy は auto mode が拒否したため未着手。
- テスト: test/lanai-flagselect.test.ts 2 pass、typecheck 通過、commit hook (lint・typecheck・全テスト) 通過。画面での確認はまだ。

## STATE #18 先行: スクリプトでイベントの状態を読み書きする (2026-11-24、未コミット: GPG 署名がタイムアウト。上の変更はステージ済み、こちらは未ステージ)

- 根拠: ../lanai-custom-stages/3ds/research/event-actions.md §0 (状態で段 1〜3 を選ぶ、既定の CtrlFlag 0x2C1DC0 が 0→1→2→3 と進める)、lanai/map.md §7.2 (状態の枠 = EO +0x58、MapGroup +0x28 / +0x2A、セーブのキー 3)。既存の生成コードの `GetScriptState(行)` / `SetScriptState(行, 値)` (r0 = 行 ID、主人公がいる MapGroup) と同じ呼び方。
- `eventScript.ts`: トークナイザが `state ( 数 )` を 1 語 `state(N)` にまとめる。`scriptStateRow`・`stateVar` (byte の疑似変数、script.vars には入らない)。読み (`compileValue`) と書き (`set`) で `ldr r0, [r4, #4]` (自分の行) か行番号を入れて Get/SetScriptState。`writesOwnState` のイベントは vtable +0x10 を `pn_prepare` (bx lr) に (倒したとき `defeat` は従来の pn_done のまま)。`eventProblem`: start / intro での `state` はエラー。`var state` は不可。
- `stageScript.ts`: 読み書きする行の状態の枠が MapGroup +0x2A 以上 (いつも 0) か、行がないとき problems。状態の枠はもともとステージの持ち物 (owned の state) としてマニフェストに入る。
- ヘルプ (`scriptDoc.ts`: state / state(イベント))・補完 (ATOMS)。
- テスト: test/lanai-scriptstate.test.ts 3 pass (ROM で CRO を作る 1 件を含む)、全体 873 pass / 25 skip / 1 fail → ヘルプの例を足して解消 (lanai-scriptdoc 20 pass)、typecheck・lint 通過。format:check は AGENTS.md (ユーザーの未コミットの変更) だけが不合格。実機は未確認。

## スクリプトのサンプル (2026-11-24、79a1958)

- スクリプト編集 (`StageSourcePage.tsx`) の「例: …」挿入ボタンを廃止し、左の欄を「スクリプト」「サンプルを見る」のタブにした。サンプルは選んで説明・割り当て・読み取り専用のコードを見る (挿入しない)。スクリプトの欄は隠すだけで、編集中の状態は残る。
- `scriptDoc.ts SCRIPT_SAMPLES` の先頭に 3 本: モンスターとの会話 (暗転 → partyLineUp → 水平カメラ shoot で話者を正面から → say で話者を切り替え → 暗転して戻す)、ボタンで隠れたワープを出す (マップが始まるときに SetPos(20000, 0, 20000) で外へ、ボタンで SetScaleA(0) → 元の位置 → ScaleTo。content 107 と同じ)、範囲で主人公が話して無効になる (EnableEventCollision(selfRow, 0) + bit を消える条件に)。サンプルは補助の関数 (引数付き) を持てる。
- テスト: 全体 875 pass / 25 skip / 0 fail。サンプルを割り当てどおりに CRO までビルド (ROM)。画面・実機は未確認。
- 作業ツリーにある別作業の変更 (FlagSelect・state) は含めず、一時 index で自分の差分だけをコミットした。

## スクリプトのページの座標・ワープのサンプルの修正 (2026-11-24)

- 未コミットだった state の読み書き・FlagSelect・AGENTS の変更を `75362f8` でコミット。
- `cb25b73`: /maps の MOVE (ScriptMovePanel・2D/3D の点・レイヤーの切り替え) を /maps から外し、スクリプトのページの演出プレビュー (`StagePreviewScene` の `onSource`) に移した。`mapview.moveText` がエディタの本文 (保存前) を読み書きし、`sourceScriptMoves` (parseStageScript の関数の from/to で全文の行・位置に直す)、`withMoveAt`。`movePointer`: 3D で点をつかんだときだけ OrbitControls を止める。`scriptMoves` は `who.SetPos(vec(x, y, z))` も読む。割り当ては保存済みのもの。イベント番号のクリックは「obj(N) をカーソルの位置に書く」をやめ、`eventPosition` (マス・ROM の値と単位・スクリプトの vec) を表示。ワープのサンプルの効果音を 717 に。テスト: scriptmoves (SetPos・本文から読む・書き戻す) 追加、Lefthook 通過。画面は未確認。
- ミニマップの解析 (サブエージェント。Codex は上限、agy は auto mode が拒否): `roms/tmpmap/minimap-analysis.md`。アイコンはマップ読込み時 (0x21D744) に出る条件を通った実体をリストに登録し、ミニマップがその現在位置のセルに 1 度だけ作る (0x1F7668 / 0x1F841C)。SetPos で動かない。種類 2/3 は毎フレーム IsVisible か IsEnabled が真なら表示 (0x1F6338) → SetVisible(0) と SetViewActive(0) の両方で消える。種類 4 は連動しない。探索済みのセルだけ。出る条件を後から立てても読み直すまで実体もアイコンも生まれない。いずれもコード上の確定、実機は未確認。
- `c6640de` ワープのサンプル: 隠す間は SetVisible(0)・SetViewActive(0) (+ 従来どおり外へ移して踏めなくする)、ボタンで 1 に戻す。lanai-scriptdoc 20 pass (サンプルを CRO までビルド)。
- `9bfbb60` 追加の指示: move の点に関数名とオブジェクト ID を、右側の「スクリプトの座標」欄は不要。→ `mapview.moveLabel` で 3D の円錐の上にスプライトのラベル (`関数 #順番 obj(N)`、self は `self = obj(割り当ての行)`、選んだ点は座標付き)。`ScriptMovePanel.tsx` と `.move-*` の CSS を削除。プレビューの説明文に円錐の操作を書いた。

## ステージのインポート・スクリプト入りの配信 zip・リリース用 zip (2026-11-25、2f2e0bd)

- 依頼: Lanai の配信用 zip を取り込む「インポート」。ID の衝突はずらす。配信 zip にスクリプトのソース (コメントも) を入れる。ソースなしの「リリース」も作る。ROM の行の衝突は既定でスキップ。
- 調査: Panana の `cloneLanaiContent` と uwapo の `web/renumber.ts` が同じ規則で番号を振り直している。それを外部の zip に当てた。
- `eventScript.ts`: ScriptDoc に `note` / `trail` / `tail` を足し、関数の外のコメントをコード欄の保存・マージで保つ (`scriptNotesOf`)。
- `stageScript.ts` / `session.ts`: 配信 zip に `panana-stage-source.json` (ScriptDoc)。`distributionZip({ release: true })` はそれを入れない。uwapo への送信はリリース用。`importedStages` (ソースなしで取り込んだステージの鍵・所有範囲) を保存・復元し、`lanai-stage.json` に書く。
- `stageImport.ts` + `StageImportDialog.tsx` (ステージのページの「インポート」)。振り直し・取り込まないものは notes/lanai-stage-authoring.md に。
- テスト: 全体 884 pass / 25 skip / 0 fail。`lanai-stageimport.test.ts` (ROM 3 件)、コメントの往復 (lanai-stagescript)。画面とゲーム内は未確認。

## 追加したステージをどの順でも削除 (2026-11-25、92e4434)

- 依頼: ID をずらす処理を使い、「最後に追加したステージから順に削除できます」の制約を外す。
- `table.ts removeRow`、`stageEdit.ts retargetContentTables` (複製・取り込み・削除で共通) と `removeLanaiContent` の書き直し、`maps.ts forgetLanaiMaps`、削除ボタンの確認文 (後ろのステージの番号がずれる)。詳細は notes/lanai-stage-authoring.md。
- テスト: 全体 885 pass / 25 skip / 0 fail。画面・ゲーム内は未確認。

## 書き出しダイアログを 3DS / Azahar / Uwapo に整理 (2026-11-25、ccf1320)

- `src/lanai/ExportDialog.tsx`: 変更一覧を隠し、遊ぶ環境の大ボタン3つ (3DS / Azahar / Uwapo、選択は localStorage `lanai/export-target`) と、選んだ環境のパネルにした。取り消しボタンは下段。
- 3DS: `modZip({ target: '3ds' })` で code.ips をタイトルフォルダ直下に置く (Luma3DS の luma/titles/)。カスタムステージは読めない旨を案内。Azahar: 従来どおり exefs/code.ips。
- コードの MOD は 3DS / Azahar のパネルだけ、Uwapo 用の編集モードと「Uwapo で欠落する変更だけを取り消す」は Uwapo のときだけ表示。Uwapo はセルフホスト、パッチも Uwapo から入手と案内。編集用・リリース用 zip は Uwapo パネルの「zip で保存する」に畳んだ。
- テスト: `test/lanai-distribution.test.ts` に 3DS / Azahar の code.ips 配置を追加 (ローカル ROM で実行)。画面での目視確認は未実施。
