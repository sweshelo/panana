# #201: kahara v1.1.0 セーブ形式の読み取り専用解析

2026-11-03。日本版 `00040000000A7900` / TitleVersion 1040。実セーブ 1 個、同一 CIA から新規展開した code.bin と flagData.bin、および ARM 命令列を照合した。**未実機検証。書き込み・移行・ARM パッチは実装していない。** アドレスは code.bin の VA、base `0x100000`。

追記: この文書は最初の読み取り解析時点の記録。実装後の到達点は [save201-implementation.md](save201-implementation.md)。また下記 archive の解釈は追跡調査で訂正され、`0x3FD824` は **ExtData ではなく trial (DEMO_SAVEDATA)**。正式な ABI と根拠は [save201-runtime.md](save201-runtime.md) を優先する。

## 入力同定と再現

- 展開済み code.bin: 5,136,384 bytes、SHA-256 `453387393c02e564e6bda88ca4066e14cf65c2a87aa87ae8ce0dfd010d37fd13`。`roms/kahara-code.bin` と CIA から今回展開したものは一致。
- `flagData.bin`: 2,464 bytes、SHA-256 `50b6d78fec580bf3f18edc6832d6477f95c14f9c07268504bd125b46353c6015`。
- セーブ: 243,304 bytes (`0x3B668`)。ユーザー名・ユニット内容・セーブ本体はこの文書に収録しない。
- コピーの展開先とレポート: gitignore 対象の `roms/save201/`。元 CIA・元セーブは変更していない。

再現用スクリプトは同ディレクトリの `inspect-kahara-save.py`。標準ライブラリだけで構造と flag 配置を出力する。逆アセンブルだけ Capstone が必要。スクリプト自体にファイル書き込み処理はない。

```sh
python docs/roms/tools/ctr.py extract roms/kahara-base.cia roms/save201/extracted
python docs/roms/tools/gsarc.py unpack roms/save201/extracted/romfs/56562135 roms/save201/master
python scripts/research/inspect-kahara-save.py --flags roms/save201/master/0098_E4F94C00_flagData.bin --save /path/to/savedata.bin
python scripts/research/inspect-kahara-save.py --code roms/kahara-code.bin --disasm 0x3fd9f0 --count 77
python scripts/research/inspect-kahara-save.py --code roms/kahara-code.bin --xrefs 0x3fddb4
python scripts/research/inspect-kahara-save.py --self-test
```

今回の Windows 環境には Python が PATH にないため、読み取り解析は WSL の既存 Python runtime を使用した。標準ライブラリ部分は `wsl --exec python3 scripts/research/inspect-kahara-save.py --self-test` でも実行可能。WSL に渡す入力ファイルは `/mnt/c/...` 形式にする。逆アセンブルには Capstone 導入済みの既存 runtime を指定した。環境外への新規インストールはしていない。

`--values 0x26` 等は進行値も出力するので結果を追跡対象にしない。`--xrefs` は ARM B/BL のビットパターンを列挙するだけなので、候補にデータ領域由来の偽陽性が混じり得る。個別の呼び出し元を逆アセンブルして確認する。

## ヘッダ: 0x178 bytes、little endian

`0x205F60` がヘッダを初期化し、`0x3FDB2C` が位置とサイズを埋める。以下は実ファイルと命令列の両方で確認した。

| ヘッダ offset | 型 / 個数 | 意味 | 今回の値 |
|---|---|---|---|
| `0x000` | u32 | 初期化時に 10 を設定。形式識別らしいがロードでの検証は未確認 | 10 |
| `0x004` | u32 | 状態ビット。単調増加する generation ではない | `0xC` |
| `0x008` | u32 × 2 | primary flags の offset, size | `0x178, 0x9EC8` |
| `0x010` | u32 × 2 | secondary flags の offset, size | `0x1DBF0, 0x9EC8` |
| `0x018` | u32 × 16 | primary small-block offsets | `0x15270 + i*0x898` |
| `0x058` | u32 × 16 | primary small-block sizes | 全て `0x898` |
| `0x098` | u32 × 16 | secondary small-slot offsets | `0x32CE8 + i*0x898` |
| `0x0D8` | u32 × 16 | secondary slot の保存サイズ。0 は復元対象外 | 全て 0 |
| `0x118` | u32 × 16 | secondary slot の復元先 primary index | slot 1 に 8、他 0。サイズ 0 のため現在は不使用 |
| `0x158` | u32 × 2 | primary units offset, size | `0xA040, 0x8A80` |
| `0x160` | u32 × 2 | secondary units offset, size | `0x27AB8, 0x8A80` |
| `0x168` | u32 × 2 | primary 第三ブロック offset, size | `0x12AC0, 0x27B0` |
| `0x170` | u32 × 2 | secondary 第三ブロック offset, size | `0x30538, 0x27B0` |

物理配置は `header + (flags + units + 第三 + 16 small) * 2`。今回の 38 ブロックは重複も隙間もなく EOF `0x3B668` に一致する。ヘッダは位置を持つので一般化した読み取り処理は固定 offset だけに依存しない。

第三ブロックはロード前の構築 `0x435464` で save object `+0xD14` のポインタを渡し、units は `+0xD0C`。16 small のポインタ配列は `+0x410`、サイズ配列は `+0x450`。この解析では第三・small 内部の全フィールドを特定していない。

## flagData から配置を計算する

テーブルは 150 行 × `0x10`、データ開始 `0x40`。各行:

| 行内 offset | 型 | 意味 |
|---|---|---|
| `+0` | u32 | 最大値。0 またはビット幅の mask を超える場合、初期化で mask に補正 |
| `+4` | u32 | 実行時に計算・上書きされる **bit offset**。ROM 上では 0 |
| `+8` | u16 | 要素数 |
| `+A` | u8 | 範囲外書き込み処理。0→0、1→最大値、その他→`value % (maximum+1)` |
| `+B` | u8 | 下位 2 bit=bank、上位 6 bit=幅 |
| `+C` | u8 | 1 要素あたり component 数 |

今回の全行は bank 0。`+C` は単なる注釈ではなく実際の保存サイズ・index stride に掛かる。例えば key `0x95` は 16 要素 × 2 component × 32 bit。

`0x28152C` の allocator は、全行の `count * components * raw_width` を足す。今回 **325,038 bits**:

```text
allocation = align4(ceil(325038 / 8) + 0x10) = 40648 = 0x9EC8
bank0 pointer = allocation start
bank1 pointer = allocation start + allocation - 4
cursor[0] = cursor[1] = 0
for row in table order:
    width = clamp(raw_width, 1, 32)
    row.bit_offset = cursor[row.bank]
    cursor[row.bank] += width * count * components
```

根拠: サイズ計算 `0x2815B0–0x281604`、bank pointers `0x281658` / `0x2816D0`、offset 更新 `0x281848–0x2819AC`。**追加の 0x10 は先頭ヘッダではない**。flag の bit 0 はブロックの最初の byte に始まる。bank1 は末尾 4 bytes なので、MOD が大量の bank1 データを置けると解釈してはいけない。今回の bank1 使用量は 0。

末尾の差分は `0x9EC8*8 - 325038 = 146 bits`。bank1 の 32 bits を除いた bank0 の未定義部分は **114 bits**。この算術上の114は確認できたが、allocator の追加領域・丸めを含むため **安全に再利用できる予約済み MOD 領域とは未証明**。padding、word跨ぎアクセス用余裕、将来定義用領域を区別せず流用する案は保留する。

`FUN_00304ADC(save,key,index,out)` は index<count を確認し、各 component を `FUN_00281E7C` で読む:

```text
bit = row.bit_offset + (index * row.components + component) * row.width
value = little_endian_bits(bank_pointer, bit, row.width)
```

`0x281E30` は scalar 用の入口、`0x281E7C` は bit offset を引数に取る本体。write は `0x281C1C` / `0x281C70`。7-bit の値が 32-bit word を跨ぐ場合も処理する。

| 関数 | r0 | r1 | r2 | r3 |
|---|---|---|---|---|
| `0x281E30` | save | key | — | — |
| `0x281E7C` | save | key | bit offset | — |
| `0x281C1C` | save | key | value | — |
| `0x281C70` | save | key | value | bit offset |
| `0x304ADC` | save | key | element index | output pointer |

低レベル関数にも key は残るが、`0x304ADC` はその前に row を参照し `index<count` を確認する。**低レベル read/write の hook だけでは key>=150 や既存 row の count 外 index を扱えない**。scalar wrapper も row を参照してから低レベルへ入る。拡張 key/index の routing は既存 table の参照・範囲検査より前で行う必要がある。

| key | count | width | raw max | bit offset (bank0) |
|---|---:|---:|---:|---:|
| `0x01` | 1 | 32 | 0 | 1 |
| `0x15` | 750 | 1 | 0 | 128 |
| `0x22` | 750 | 1 | 0 | 1166 |
| `0x26` | 750 | 7 | **99** | 2004 |
| `0x27` | 750 | 7 | **99** | 7254 |
| `0x64` | 70 | 1 | 0 | 96086 |
| `0x65` | 40 | 1 | 0 | 96156 |
| `0x70` | 750 | 1 | 0 | 107450 |
| `0x71` | 750 | 8 | 150 | 108200 |
| `0x72` | 750 | 8 | 150 | 114200 |
| `0x73` | 750 | 1 | 0 | 120200 |
| `0x74` | 750 | 8 | 210 | 120950 |
| `0x75` | 750 | 8 | 210 | 126950 |
| `0x76` | 750 | 1 | 0 | 132950 |

key `0x26/0x27` の overflow mode は 2。したがってこの低レベル writer に 100 を渡すと 0、127 を渡すと 27 になる。「7 bit だから 127 まで保存できる」「最大値 100 で clamp」はこの ROM の挙動ではない。アイテムごとの UI/所持上限処理は別途ある。

計算の独立照合: key `0x01` を両方の flag block の bit 1 から読むと **`0x17847D0C`**。loader `0x3FDA38–0x3FDA54` はこの値を ROM の `0x4CF070` の u32 と比較し、実際に同値だった。サイズも loader が比較する `0x9EC8` に一致した。構造上の一致であり、全 key のゲーム内意味を検証したという意味ではない。

## 二重化の実態と検証の限界

**secondary は未使用コピーでも、新旧を自動選択する一般的な A/B generation でもない。明示的な snapshot/restore 経路が存在する。**

- 通常ロード `0x2E28E0 → 0x3FD9F0`: primary を読む。ヘッダ 0x178 bytes の取得、key1 の識別値、flags size を確認。16 small、units、第三を読み、`0x317E30` / `0x434FF8` の後処理へ進む。
- 保存 `0x3FDFFC` は第2引数 `r1` で分岐。0 は primary flags/units/第三と dirty small を更新。非0 は secondary flags/units/第三を更新し、dirty small を secondary slots に詰め、`+0xD8` にサイズ、`+0x118` に元 index を記録する (`0x3FE12C–0x3FE248`)。
- snapshot 保存はヘッダ `+4 bit0` をセット。restore `0x3FDDB4` は secondary flags/units/第三を読み、サイズ非0の small のみ記録された元 index へ戻し、bit0 をクリアする。`0x3FE44C` が read/write open して restore を呼び、実 caller は `0x1EBA90`。
- 新規作成 `0x3FDB2C` は両方の full block を同じ初期状態から書くが、secondary small のサイズと index は0にする。
- 今回の header `0xC` は bit0=0。primary と secondary は flags 99 bytes、units 32 bytes が異なる。第三は一致。small の secondary は全てサイズ0で現在の restore 対象外なので、同じ slot 番号同士の差を履歴世代として解釈できない。

`+4 bit1` は全 small を書き戻す経路に関係する (`0x3FE354–0x3FE37C`)。bit3 は `0x1A6114` の条件下でセットされ、`0x2E306C` が読み出す。`0x3FDFF0` は bit0/bit3 を消し bit1/bit2 をセットする。これらを時刻や generation と見なしてはいけない。全ビットのゲーム上の意味と restore UI 条件は未確定。

解析したトップレベル load/save/restore 経路には、アプリ独自の CRC/hash 比較・更新は見当たらない。key1 は ROM 定数との照合であり、内容チェックサムではない。ただし **「全セーブ領域・全下位処理を調べて絶対にチェックサムなし」とは未証明**。3DS archive 層の整合性も raw `savedata.bin` のアプリ形式とは別。

loader は flags を読んだ **後** にサイズを比較し、後続ブロックの read 戻り値を各々検証していない。この loader を破損入力の妥当性検査器として使わない。移行ツールでは読込前に全 offset/size/overlap/EOF・index<16・想定 schema/サイズを独自に確認する必要がある。

## Archive / save I/O と hook 候補の訂正

| アドレス | 検証結果 |
|---|---|
| `0x43542C` | 起動時の save setup/load を含む関数入口 |
| `0x43548C` | `0x3FD680` 初期化 call |
| `0x435490` | **関数内部の load 前命令**。`ldr r0,[r7]`、続く `0x435498` が `0x2E28E0` を呼ぶ。単独の「ロード完了 hook」として使えない |
| `0x3FD9F0` | primary の header/body 読込と schema/size 確認 |
| `0x3FDFFC` | 通常/snapshot 両方の保存本体。両分岐の対応が必要 |
| `0x303F54` | 非同期書込フラグと context をセットして保存本体を呼ぶ wrapper |
| `0x290480` | offset seek + sync/async write helper。これ一箇所の hook だけでは read/create/restore を覆えない |
| `0x3FDB2C` | 新しい savedata.bin の初期ファイル作成 |
| `0x3FDD68` | archive close → format wrapper → reopen。既存データ保護のため移行に流用しない |
| `0x3611D4` | IPC header `0x084C0242` を組み立てる format 呼出し。`0x35F3C0` から到達 |

`0x3FDD78–0x3FDD90` は `0x1CF5F8` に `(1,0,1)` を渡す。`0x1CF5F8` が `0x35F3C0` へ forward し、`0x3611D4` の format パラメータに **max directories=0 / max files=1** が入る。従来 archive に追加ファイルを無条件に作れるという前提は置けない。ここを変更しても既存 archive の quota を自動拡張できると証明したわけではない。

`0x3FD824–0x3FD830` は ID `0xA79` で trial open wrapper `0x1CF778` を呼ぶ。追跡調査で `0x35F524 → 0x2BBF54 → 0x2BBEF4` が archive `0x567890B4` (DEMO_SAVEDATA) を開くと確認した。これは archive 6 の ExtData ではない。`0x3FE538 → 0x3FD9F0` も trial save のロード。新しいパッチは別の `pns:` mount を作り、正しい archive 6 を明示して開く。

ExHeader の save-data size (`+0x1C0`, u64) は `0x80000` = 512 KiB。storage-info bytes (`+0x230..0x24F`) は `0000000000000000000000000000000000000000007e07108000000000000000`。先頭8 bytes の ExtSaveData ID 欄は0で、コード内ID `0xA79` と単純一致しない。実行時 access-control bits / access descriptor と SDK の特殊 archive ID の意味を解決していないため、この値だけで任意 ExtData ID に作成権限があるとは判断しない。今回確認したのは当該IDの **open を試みるコードの存在**まで。

write helper は seek と write を行い、上位保存処理は全 write の成功を逐一確認しない。同期側は終盤 `0x31AE64` → `0x3378E0` → `0x31AE30`、非同期側は worker `0x1796C8` へ進む。下位の flush/close/archive commit の完全な永続性と電源断時挙動は未検証。成功 return だけで新世代が durable と判定する設計にはしない。

## #201 の実装準備に使える結論

1. 旧 save はそのまま読み込める。現行 flagData を拡張すると全後続 bit offset と flags allocation が変わり、旧 loader のサイズ照合にも失敗する。native row の count/width を変更する方式には、旧 table による独立 decode と全項目の再 encode が必要。
2. 旧 flagData を維持して拡張分を別 namespace へ routing する案は実現候補。ただし key/index/component の識別、範囲確認、ゲーム内上限、MOD ID の安定性を別途実装する。scalar と array、read と write、snapshot restore の全経路が対象。
3. ExtData A/B 内に **全 legacy file snapshot (`LEGC`) + extension を同一 generation で保存**する提案には整合性上の利点がある。LEGC は primary だけでなくヘッダと secondary/delta mapping を含む全ファイルを保持する。native secondary と ExtData A/B generation は別概念。
4. extension にも native の primary/snapshot 対応が必要。旧 restore が発生したとき native だけが戻り extension が現状態のままだと不整合になる。少なくとも restore0x3FDDB4 と非0保存 branch に対する設計を明示する。
5. 1回の startup hook では既存/新規/通常保存/snapshot保存/restore/ExtData読込を覆えない。`0x435490` をそのまま hook するパッチは保留し、上記 call graph と戻り値処理を踏まえた adapter 境界を決める。
6. 移行時は元 savedata を読み取り専用の import source として保全し、完全検証済み ExtData 世代が commit された後でのみ使用状態を変更する。片方の archive 書込み成功をもう片方の成功と扱わない。ExtData 不在・破損時に元 save へ黙って戻ると進行が巻き戻るので、復旧方針も仕様に含める。

ランタイムの次の段階は emulator 上の **複製セーブ**で、通常保存・snapshot作成・restore・新規開始・終了再起動それぞれの前後 dump を採ること。独立した schema/version/generation/checksum と commit 規則を持つ ExtData コンテナのオフライン実装・検証は [save201-plan.md](save201-plan.md) を参照。オフラインの成功はタイトル内 FS adapter や電源断時の永続性を保証しない。今回の結果だけで未検証 ARM patch を配布できる状態にはならない。

## 今回の検証範囲

- 読み取りスクリプトで header の38物理ブロックを検証し、隙間/重複なし・EOF一致を確認。
- freshly extracted table から150行の配置を再計算し allocation と識別値を実save/ROM双方に照合。
- `--self-test`: bit reader の byte/word跨ぎと32-bit幅を合成データ 8,320 ケースで確認。table のcomponent計算、最大値、offset、allocationと切り詰めheader拒否も確認。
- save/restore/load/create/format/open の記載箇所を ARM 逆アセンブルで確認。
- 未実施: emulator 実行、実機、セーブ書換え、破損時のゲーム挙動、全 game flag の意味特定、ExtData 作成/容量/永続化、ARM hook のレジスタ保持と命令 relocation。
