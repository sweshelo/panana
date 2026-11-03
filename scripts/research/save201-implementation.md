# #201 実装: 存在確認時の移行と ExtData 保存

対象: 日本版 RPG2 v1.1.0 / Title ID `00040000000A7900`。2026-11-03。

## 今回実装したもの

- `src/game/savepatch.ts`: 元命令・競合・空き領域を検査し、存在確認と File I/O 等のフックを一括して生成。
- `scripts/save201/runtime.c` / `bridges.S`: ARMv6K の freestanding runtime と SDK/IPC の橋渡し。
- `scripts/save201/build.ts`: devkitARM でビルドし、再配置情報つきの `src/game/savepatchdata.ts` を生成。ROM やセーブはビルド入力にしない。生成済みコードがあるため、Panana 利用者のブラウザにコンパイラは不要。
- Panana の書き出し画面に **「セーブをExtDataに移行」**を追加。選択は編集プロジェクトと一緒に保存する。デフォルトは無効。
- `test/savepatch.test.ts` / `savepatch-export.test.ts`: compiled ARM と元 ROM のロード/保存本体、故障注入、書き出しの検証。

再ビルド: `bun scripts/save201/build.ts`。`DEVKITARM` または Windows の `C:/devkitPro/devkitARM` を使用する。出力 ELF は管理対象外の `roms/save201/runtime.elf`、実行ペイロードは現在 3,732 B。writable globals は linker の ASSERT で禁止する。通常のアプリビルドでは、この工程は不要。

## 移行と起動

1. `0x3FD700` を変更し、元 data: archive の mount 失敗に対する自動 format を回避する。読み取り不能を「壊れているから消して作り直す」に変換しない。初回移行元 archive 自体をマウントできず、有効な ExtData もなければ中断する。
2. 通常セーブの存在チェック `0x3FD800` の BL を adapter に置換。入力は構築済み File と controller+0x210 の `data:/savedata.bin`。
3. **archive ID 6**、SD、ExtData ID `0xA79` を `pns:` として mount。未作成を示す FS NotFound の場合だけ CreateExtSaveData IPC `0x08510242` を送り、再度 mount。容量不足・権限不足・別エラーでは作り直さない。
4. `/panana-a.bin` / `/panana-b.bin` をチェック。PNSV の形式・長さ・CRC・世代を検査し、最新の完全な世代を読み込む。片側が壊れていれば他方を使う。同世代で CRC が違う場合は中断。
5. **両方のファイルが存在しない場合だけ**、元 savedata.bin を read mode で取り出す。ヘッダと全38ブロックの既知のサイズ・offset・復元先indexを検査し、全バイトを `LEGC` として保存。元ファイルは削除・上書きしない。元のファイルがない場合は空のプロファイルを保存し、新規ゲーム扱いにする。
6. 移行成功後に controller の path を内部 marker と RAM state pointer に置換。後続の native loader はこの仮想 stream から元の配置で読む。移行失敗を「セーブが無い」という false に変換しない。

初期化前の data: 自動 format も避けるため、有効な ExtData があれば元 archive が読めなくても ExtData を利用できる。一方で、完全な初回環境で元 archive 自体がマウント不能の場合には、読み取り不能の既存進行と区別できないため中断する。既存 archive 内に savedata.bin がない新規ゲームは対応済み。

## 保存ファイル

PNSV v1 (前回の PC codec と同じヘッダ/索引/CRC)。各ファイルは **262,272 B (`0x40080`)** の固定長。先頭96 Bがヘッダ、その次32 Bが `LEGC` 索引、128 B以降が最大256 KiBの native image。索引のlengthが実際のnativeセーブ長。残りは予約paddingで、ファイルCRCの対象にもなる。

ExtData は OpenFile の CREATE flag とファイル伸長を許さないため、CreateFile で固定長を確保してからmode3で開く。archive 作成時はファイル数2、ディレクトリ0、容量1 MiBを指定。既存archiveのquotaを変更したりformatしたりしない。不足する場合は失敗として中断する。

現在の ARM reader が受け付けるのは minor0 / `LEGC` v1 一件の形式。profileId と sourceDigest は0 (未設定)。PC codec はこれらの領域を保持するが、**ARM 側で SHA-256 の出自記録や複数 MOD profile の分離はまだ行わない**。ブロックの追加や変数拡張は後続作業で、現時点でジャンプやアイテム上限は変わらない。native 部分の可変サイズ化もまだ行わず、今回確認した0x3B668の配置のみ移行対象とする。

## 読み書きと復元

`open / exists / seek / read / write / flush / close / dtor` をフック。controller path に内部markerがある場合だけ、RAMにある native image を扱う。他のファイル、特に `trial:/savedata.bin` は元処理へ戻す。

File の `+0x14` は元と同じ論理cursor。native create が直接cursorを読んで作るヘッダoffsetも、元ファイルと同じになる。`+0x18` を仮想streamのmarkerに、`+0x10` をstate pointerに使う。close/dtorでこれらを消してからnative destructorを呼ぶため、RAM stateをnative IFile poolへ渡さない。

通常保存、snapshot保存、snapshot復元、nativeの新規ファイル構築を変更せず、このstream上で動かす。**primaryだけではなくsecondaryとsmall-block delta mappingも同じ世代に含まれる**。

`0x3FDFFC` の入口で仮想controllerのasync flagを0にし、非同期File subclassとwrite workerを使わない。startupで0にするだけでは `0x303F54` が後で1へ戻すため、保存入口でも行う。元 data: commit の3つのcall siteは、現在のcontroller (`*(0x5674B4)`) が仮想の場合だけ抑制する。`0x57457C` はcontrollerではなくarchive manager、`0x574580` はdata: mount名のpointer slot。

format経路 `0x3FDD68` は仮想controllerの状態を空にする操作へ変更。disposeはRAMとpns: mountを解放してから元のcleanupへ戻し、data:/trial:のmount解放も維持する。元のcleanupはarchiveのformatや削除ではない。

## A/B と失敗

変更はRAMに集め、flush/closeで非active側へ世代+1の完全なPNSVを書き込む。Resultと転送バイト数、flush、close後の再open・size・CRCを検証してからRAM上のactiveを切り替える。activeだったファイルを先に削除しない。

境界違反・範囲外書込み・書込み失敗・世代overflow等は `svcBreak` で処理を中断する。native保存コードが個々の戻り値を無視するため、単に0を返して保存成功画面へ進めない。**現時点の失敗UIは正常なゲーム内エラーダイアログではなく中断**。エラー後の同一プロセス内再試行は未実装。

両側にファイルがあって両側とも不正なら元セーブへ再移行しない。ただしユーザーがExtData自体やA/B両ファイルを削除した場合は、初回未移行との区別はできず、残っている元セーブから移行する。移行済みmarkerを元セーブへ書かない設計とのトレードオフ。

A/BとCRCは、アプリから見た完全世代を保つ仕組み。実機の電源断やSD故障に対する物理的な永続性まで保証したものではない。

## Pananaでの使用と競合

ROMを開き、書き出し画面の「セーブをExtDataに移行」を有効にしてzipを書き出す。通常の `exefs/code.ips` に全フックとruntimeが入る。元命令不一致、他のパッチとの同一アドレス競合、code cave不足の場合は書き出しを拒否し、保存パッチだけ欠落したMODを作らない。

単独の試験用ZIPは `bun scripts/save201/package.ts roms/kahara-code.bin roms/save201/panana-extdata-save.zip` で生成できる。code.binを読むだけで、ZIPにROMや個人セーブは含めず、エミュレータへの配置も行わない。

現在のruntimeはcode caveを約3.7 KiB使う。ほかの大きなパッチや既存のbase MODと共存できる空きがない場合がある。その場合の実行領域増設は未対応。上限を外したり、他のコードを無条件に上書きしたりしない。

パッチを外すと元のsavedata.binの時点へ戻る。ExtDataから元形式への逆移行・安全なMOD取り外しは別工程。

## 検証と残る実機項目

自動テストでは、compiled ARMによる移行・byte一致・読書き・CRC・境界・短いwrite・flush失敗・破損時の復帰を検証。mount stubのarchive6/pathとCreateExtSaveDataのpacked IPC storesも実行して照合した。元v1.1.0 ROMのload、通常save、snapshot save/restore、新規createもARM実行器上で通した。OS/FS境界はテスト用stubであり、エミュレーター本体のFSサービスを実行した試験ではない。

未実施: Azahar本体での起動・移行・プレイ・再起動、実機のExtData権限、icon size0の許可、物理SDへの永続化、電源断試験、ゲーム内エラーUI。ユーザーの起動中Azaharや現行セーブには適用していない。

検証コマンド: `bun test` は **432 pass / 90 skip / 0 fail** (ROM/参照データのない項目はskip)。その後formatとtrialへのfallbackの1件を追加し、ARM/runtimeは **13 pass / 0 fail**。`bun run build` は型チェック・Viteビルドとも成功し、ZIP生成スクリプト追加後のtypecheckも成功。追加分はコンテナ8件、ARM/runtime13件、export3件。全体テストログは管理対象外の `roms/save201/full-test.log`。
