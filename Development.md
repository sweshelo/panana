# 開発

## 準備

```bash
git submodule update --init docs   # 解析資料 (naauao)
bun install
bun run dev        # http://localhost:5173/
bun run build      # tsc --noEmit と vite build。dist/ に静的ファイルを出す
bun run typecheck
bun run deploy     # build のあと wrangler deploy
```

- `docs/` は [naauao](https://github.com/sweshelo/naauao) の submodule です。ゲームの解析資料 (`docs/lanai/`、`docs/item-effects.md`、`docs/action-performance.md` など) はそこにあります。
- マップ・イベントの設計資料は elpulse リポジトリにあります (`../elpulse/docs/map-editor-design.md`、`map.md`、`encounters.md`、`events.md`、`battle.md`)。
- `tools/gen_reference.py` (elpulse) と同じ読み方でモンスターの表を展開しています。

## テスト

```bash
python test/golden/export_golden.py   # ../elpulse の展開済みデータから roms/golden.json を作る
bun test
```

- `test/unit.test.ts`: ROM なしで動く単体テスト
- `test/ui.test.tsx`: React のページを文字列に描画して確かめるテスト (ROM なし)
- `test/rom.test.ts`: Python の参照実装との照合とラウンドトリップ。
- `test/oahu*.test.ts(x)` (RPG3)、`test/lanai*.test.ts(x)` (RPG FREE!)。

ROM のテストは、リポジトリ直下の `roms/` (git には入れない) にあるファイルを読みます (`test/env.ts`)。ないファイルを使うテストはスキップします。

| ファイル | 中身 |
|---|---|
| `roms/00040000000A7900.cia` | RPG2 の復号済み CIA |
| `roms/golden.json` | 参照実装の照合データ (`export_golden.py` で作る) |
| `roms/mod/out/` | 土台の MOD (elpulse の mod/out。任意) |
| `roms/oahu-base.cia` / `roms/oahu-update.cia` | RPG3 の Base / Update (復号済み) |
| `roms/lanai-base.cia` / `roms/lanai-update.cia` | RPG FREE! の Base / Update (復号済み) |

ROM のテストで確かめていること:

- code.bin (BLZ の展開) が ctrtool の結果と一致する
- 全 205 マップの名前・ダンジョン・階・区画のハッシュとサイズが一致する
- LZ10 の圧縮結果が `gsarc.lz10_compress` とバイト一致する
- 無編集で書き出したマップ DB・アーカイブが元とバイト一致し、編集時は A2C14C00 以外のエントリが一致する
- バニラのマップで検証が何も出さず、壊した編集は検出する

## CI

- `.github/workflows/test.yml`: push ごとに型チェックと `bun test` (ROM なし) を実行します。フォークからの PR でも動きます。
- `rom` ジョブ: 暗号化したダンプを非公開の R2 バケットから取ってきて ROM のテストを走らせます。push と手動実行だけで、シークレットが未登録ならスキップします。ダンプはリポジトリ・アーティファクト・キャッシュのどこにも置きません。
- `.github/workflows/deploy.yml`: デプロイ。

### ROM バンドルの準備 (一度だけ)

1. `roms/` に RPG2 の CIA と `golden.json` (あれば `mod/out`) を置いてから、PowerShell で暗号化したバンドルを作ります: `.\scripts\pack-rom-bundle.ps1` (パスフレーズを聞かれます)。`rom-bundle.tar.gpg` ができます。gpg (Gpg4win など) が要ります。
2. Cloudflare R2 に非公開バケット `panana` を作り、`rom-bundle.tar.gpg` をアップロードします (300 MB を超えるときは `aws s3 cp` など S3 API で)。RPG3 と RPG FREE! の復号済み CIA は、同じバケットに `oahu-base.cia` / `oahu-update.cia`、`lanai-base.cia` / `lanai-update.cia` として置きます (キーはリポジトリ変数 `OAHU_BASE_KEY` などで変えられます)。CI はバンドルの中身とこれらを `roms/` に置いてテストします。
3. R2 の API トークンを「Object Read only・このバケットだけ」で作ります。
4. リポジトリの Settings → Secrets and variables → Actions に登録します: `ROM_BUNDLE_PASSPHRASE`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。バケット名・キーを変えるときは Variables の `ROM_BUNDLE_BUCKET`・`ROM_BUNDLE_KEY`。

ダンプや `golden.json` を作り直したら、同じ名前で上書きアップロードするだけです。

## 構成

```
src/
  rom/      cia.ts ncch.ts exefs.ts romfs.ts blz.ts dump.ts cache.ts   ダンプ → code.bin / RomFS のファイル
  archive/  gsarc.ts lz10.ts zip.ts gstable.ts                          独自アーカイブ・LZ10・GS テーブル
  game/     codebin.ts mapdb.ts sections.ts master.ts game.ts          マップ表・マップ DB・区画・mapParts など
            events.ts objects.ts names.ts                              EventObject、オブジェクトのモデル、名前
            monsters.ts sound.ts items.ts actions.ts                   モンスター・群れ・区画 6・耐性、音の名前、アイテム・お店、アクション
            arm.ts asm.ts disasm.ts                                    イベントのスクリプトを動かす ARM 実行器・アセンブラ・逆アセンブル
            tabledef.ts kaharatables.ts                                テーブルの欄の定義 (作品ごと)
  cgfx/     cgfx.ts texture.ts tileset.ts worker.ts loader.ts three.ts  CGFX → three.js (Web Worker で変換)
            anim.ts player.ts tev.ts                                   アニメ (CANM) の読み込みと再生、PICA の TEV 再現
  editor/   mapeditor.tsx state.ts controller.ts view2d.ts view3d.ts validate.ts ...  マップ編集: 状態・操作・2D / 3D ビュー (canvas)
            panes.tsx inspector.tsx addpanel.tsx palette.tsx treasure.tsx ...  マップ編集のヘッダーと左右のペイン (React)
  pages/    monsters.tsx items.tsx groups.tsx actions.tsx messages.tsx shops.tsx  図鑑などのページ (React)
            modelview.ts                                               モデルの写真と 3D ビューア (three.js)
  romfs/    kahara.ts oahu.ts formats.tsx                              作品ごとのプロファイル、形式ごとのビュー (FORMAT_VIEWS)
  ui/       Root.tsx StartScreen.tsx Shell.tsx ExportDialog.tsx        開始画面、上部のタブとルーティング、書き出し
            book.tsx Dialog.tsx Photo.tsx ModelView.tsx Radar.tsx message.tsx GroupDetail.tsx
            MapPicker.tsx ItemPicker.tsx ActionEditor.tsx               ページの共通部品、マップ・アイテムを選ぶダイアログ
            mount.tsx useEditorState.ts                                React の外の要素の差し込み、EditorState の購読
  session.ts                                                           開いたダンプ: 編集の状態・図鑑・編集の保存と復元
  port/     gfx/ h3d/                                                  CGFX と BCH (H3D 版 8・0x21) の読み書き (SPICA の移植。ゲームの全モデルがバイト一致で往復)
            convert/                                                   CGFX ⇄ BCH・BCH の版の変換 (作品ごとのシェーダー名・スキニング・モーションのファイル)
            store.ts looks.ts apply.ts items.ts                        移植したファイルの保存とアーカイブへの追加、見た目 (デザインの行) とアイテムのモデルの付け替え
  export/   pack.ts                                                    マップ DB → A90C8038、イベント、マスター → zip
```

- UI は React (TSX) です。マップ編集は、2D / 3D ビュー (canvas) と操作を持つクラス (`src/editor/mapeditor.tsx`) が、ヘッダーと左右のペイン (`src/editor/panes.tsx` 以下) を自分の要素に描き、外枠 (`src/ui/Shell.tsx`) がその要素をマップのページに置きます。
- ペインは `useEditorState` で編集の状態を、`Signal` で表示の設定 (ビュー、モデル、検証の結果) を購読して描き直します。
- three.js のモデルビューアはクラスのまま `src/ui/mount.tsx` の `Dom` で差し込みます。
- マップ・アイテムの選択は、ページでもマップ編集でも同じダイアログ (`MapPicker` / `ItemPicker`) を使います。
- RomFS の欄 (位置・型・ビット・意味・メッセージや別の表の行を指すか) は `src/game/tabledef.ts` の形で、作品ごとに `src/oahu/tables.ts` / `src/game/kaharatables.ts` に書きます。RPG3 の図鑑はこの定義を通して行を読み書きします。
- 作品ごとの違い (ファイルの中身・種類の番号の意味) は `src/romfs/kahara.ts` / `oahu.ts` のプロファイルに書きます。形式ごとのビューは `src/romfs/formats.tsx` の `FORMAT_VIEWS` に足します。

## 実装メモ

- mapResource の行 = `[0] モデルのアーカイブ, [1] テクスチャのアーカイブ (469B3DC6), [2] その中のテクスチャ (bcres), [3] 空のモデル`。タイルのモデルはテクスチャを持たず、[2] の共有テクスチャを名前で参照します。
- CGFX の頂点バッファは 0x40000002 (インターリーブ)、その属性が 0x40000001、固定値の属性が 0x80000000。
- モデルは陰影を頂点カラーに焼き込んでいる (法線がない) ので、ライティングなしで描きます。頂点カラーのアルファは不透明な面では使いません。
- テクスチャのデータは上の行から並びますが UV は v = 0 が下なので、上下を反転して渡します。
- 回転: 種類 7 (部屋の辺) の回転 0 のモデルは -Z (北) 側に壁があります。three.js では `rotation.y = -rot × 90°`。
- 置物 (区画 2) の向きの表は区画 3 のものと 180° 違います (向き 0 = 180°、1 = 90°、2 = 0°、3 = −90°)。一部の行は向きで壁際に寄せます。区画 3 の +0x19 はセルの中の 3×3 の位置 (4 = 中央) です。
- CGFX のボーンの world 行列は空のことが多いので、拡大・回転・移動を親から合成します (門の枠や宝箱のふたの位置)。
- マテリアルは PICA のテクスチャ合成 (TEV 6 段)・アルファテスト・ブレンドをシェーダーで再現します (`src/cgfx/tev.ts`)。フラグメントライティングは未対応で、白として扱います。
- マップ表 (0x4C3AFC) の +0x10 (タイルセットの上書き) は、ダンジョンのマップではすべて 0 です。
- マップ DB のサイズ 0 のエントリは、次のブロックと同じオフセットを持ちます。再構築では (オフセット, サイズ) の順に並べると元とバイト一致します。
- ダンジョン名は mapGroup +0x14 の u16 です (u32 で読むと K / M / S 系が引けません)。
- オブジェクトのモデルは mapObject (マスター) の行です。区画ごとの決め方は `../elpulse/docs/map.md` §6・§8〜§10、実装は `src/game/objects.ts`。
- 状態 (宝箱を開けた・押した) はセーブ変数 0x8E の「ダンジョンの基準 (mapGroup +0x1A) + 枠 (EventObject +0x44)」に入ります。行と枠はダンジョンごとに mapGroup +0x1C 個までです。
- 装備の効果の種類 (0x01〜0x35) は、code.bin の対応表 (FUN_001A6348) で conditionData の状態に当たります。その状態の名前と足し合わせ方 (+0x36) から読み方を決めています。
- 道具のアクションの +0x14 は、元のゲームでは行 178〜230 でしか読まれません (`FUN_002f4c54` → `FUN_0031140c`)。表の後ろに足したアクションを使う道具があると、書き出しに code.ips のパッチ「追加したアイテムのアクション」(行 178 以降をすべて読む) が入ります。
- ボス戦の行 (種類 0x31) はゲームにない動きなので、あると書き出しの code.ips にパッチ「ボス戦」を自動で加えます。
- コードの MOD「ドロップ率の天井を撤廃」 (`src/game/dropcap.ts`) は作品ごとにパッチの元を持ち、書き出しの画面で選ぶと code.ips に入ります。元のゲームの命令 (`EXPECT`) と違う code.bin には入れません。RPG3・RPG FREE! の状態は s16 なので、上限は 0x7FFF までしか上げられません。
- 新しいメッセージ番号は作れません。MessageSystemCommon 0〜6106、MessageBattle 6107〜7134、MessageField 7135〜8623 が隙間なく続き、ゲームは範囲に番号を含む最初のファイルを使います (FUN_00310438)。新しいメッセージは `MessageMod_JP.gsmb` (ID 0x2C00〜、elpulse の MOD と同じ) に入ります。
- 変身時のセリフ (+0x38) は、ユニットがその形態に変わったときに出す戦闘のメッセージです (`FUN_0022f430` @0x22FDE8 ほか)。
- 群れのエントリ (monsterGroup) は +0x28〜が未解析です。

## 作品間の移植 (#100)

- 見た目はデザインの行が持つ: RPG2 は monsterDesign (2713402F) +0x10 モデル・+0x14 色のテクスチャ (470D2848)、RPG3 は monsterDesign (402F0000) +0x0C / +0x10 / +0x14 ワザのモーション (28480000)、FREE! は MonsterDesign (2135000A) +0x08 / +0x0C / +0x10 で、+0x04 の bit20〜22 がそれぞれ 719F0000 にあることを示す (なければ 28480000)。
- モーションは名前の先頭 4 文字 (`001_` 待機、`003_` 歩き、`004_` 走り、`005_`〜`007_`・`010_` ワザ、`008_` ダメージ、`009_` 倒れる、`101_`〜 色) で選ばれ、3 作品で同じ。RPG3・FREE! は `002_` と `005_`〜`013_` をワザのモーションのファイル、残りをモデルのファイルに入れる。
- RPG3 と FREE! は BCH の版を読み込み時に確かめる (RPG3 は 8、FREE! は 0x21) ので、同じ BCH でも変換が要る。シェーダー (`h3d_DefaultShader.bch` の `{0..3}@DefaultShader-…`) の番号は 3 − テクスチャ数、bool のユニフォームの意味も作品で違う (`src/port/convert/retarget.ts`)。
- 新しいエントリのハッシュは中身から決めた値 (下位 8 ビット 0) で、ゲームは値を比べるだけ (名前からハッシュを作る関数は見つかっていない)。
- 新しいデザインの行は、移植先のモンスターの今の行を写して、ファイルと大きさ・高さ・取り付け位置 (3 作品で単位が同じ) を移植元から入れる。色のアニメ・付いているエフェクトの欄は 0 にする。

## 未対応

- マップのフラグ +0xA8CE が立つときの位置の変換 (`FUN_002f1784`) と、屋外の階段のセル +0x24 の bit0 は未対応です。
- 区画 6 / 7 / 9 の意味は未確定です (7 は保持のみ)。
- 装備の値 (+0x2D / +0x2E) は未解析なので、数値だけを出します。
- 演出プレビューのパーティクルの見た目は未対応です (エフェクトの位置をボーンで印として示すだけです)。
- 色のアニメ (`*.cmcla`) と表示のアニメは未対応です。
