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
python test/golden/export_golden.py   # ../elpulse の展開済みデータから test/golden/golden.json を作る
bun test
```

- `test/unit.test.ts`: ROM なしで動く単体テスト
- `test/ui.test.tsx`: React のページを文字列に描画して確かめるテスト (ROM なし)
- `test/rom.test.ts`: Python の参照実装との照合とラウンドトリップ。`ROM_CIA` (既定 `../elpulse/00040000000A7900.cia`) と `golden.json` がないときはスキップします。
- `test/oahu.test.tsx` (RPG3): `ROM_OAHU_BASE` / `ROM_OAHU_UPDATE` (既定 `../elpulse/0004000E000EF000-v0.1.0.cia` / `-v4.7.0.cia`) がないときはスキップします。

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

1. `golden.json` を作ってから、PowerShell で暗号化したバンドルを作ります: `.\scripts\pack-rom-bundle.ps1 -Elpulse ..\elpulse` (パスフレーズを聞かれます)。`rom-bundle.tar.gpg` ができます (CIA・`golden.json`・あれば `mod/out`)。gpg (Gpg4win など) が要ります。
2. Cloudflare R2 に非公開バケット `panana` を作り、`rom-bundle.tar.gpg` をアップロードします (300 MB を超えるときは `aws s3 cp` など S3 API で)。RPG3 の復号済み CIA は、同じバケットに `oahu-base.cia` (Base) と `oahu-update.cia` (Update) として置きます (キーはリポジトリ変数 `OAHU_BASE_KEY` / `OAHU_UPDATE_KEY` で変えられます)。
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
- 新しいメッセージ番号は作れません。MessageSystemCommon 0〜6106、MessageBattle 6107〜7134、MessageField 7135〜8623 が隙間なく続き、ゲームは範囲に番号を含む最初のファイルを使います (FUN_00310438)。新しいメッセージは `MessageMod_JP.gsmb` (ID 0x2C00〜、elpulse の MOD と同じ) に入ります。
- 変身時のセリフ (+0x38) は、ユニットがその形態に変わったときに出す戦闘のメッセージです (`FUN_0022f430` @0x22FDE8 ほか)。
- 群れのエントリ (monsterGroup) は +0x28〜が未解析です。

## 未対応

- マップのフラグ +0xA8CE が立つときの位置の変換 (`FUN_002f1784`) と、屋外の階段のセル +0x24 の bit0 は未対応です。
- 区画 6 / 7 / 9 の意味は未確定です (7 は保持のみ)。
- 装備の値 (+0x2D / +0x2E) は未解析なので、数値だけを出します。
- 演出プレビューのパーティクルの見た目は未対応です (エフェクトの位置をボーンで印として示すだけです)。
- 色のアニメ (`*.cmcla`) と表示のアニメは未対応です。
