# #201 runtime ABI / hook 調査

2026-11-03。code.bin SHA-256 は [save201-analysis.md](save201-analysis.md) と同じ。原本・実セーブ・エミュレーターは変更していない。逆アセンブル抜粋は gitignore 対象 `roms/save201/runtime-disasm.txt`。以下は静的解析であり、呼出しの実機成功を保証しない。

## 最重要の訂正: `trial:` は ExtData ではない

前報で `0x3FD824 → 0x1CF778` を ExtData open と呼んだのは誤り。

| pointer slot | 指す文字列 | 用途 |
|---|---|---|
| `0x574580` | ASCII `data:` (`0x505D8E`) | 現在タイトルの通常save |
| `0x574584` | ASCII `ext:` (`0x507823`) | 名前だけで archive 種別を決めない |
| `0x574588` | ASCII `trial:` (`0x507814`) | demo save |
| `0x574590` | UTF16 `data:` (`0x50DD3E`) | controller+0x210 の prefix |
| `0x574594` | UTF16 `ext:` (`0x50DD4A`) | 別 prefix |
| `0x574598` | UTF16 `trial:` (`0x50DD54`) | controller+0x250 の prefix |

`0x1CF778 → 0x35F524 → 0x2BBF54` が使う archive ID は **`0x567890B4`**。`0x1CF664 → 0x35F314` も同じ関数へ入り、binary path の selector が異なる。`0x567890B4` は DEMO_SAVEDATA、真の ExtData は **6**。[devkitPro の archive 定義](https://github.com/devkitPro/libctru/blob/master/libctru/include/3ds/services/fs.h)

したがって `0x3FE538` は trial save 読込であり ExtData 世代選択ではない。既存の demo import は保存先だけ新 backend に向け、読み元 trial は保持する。

## 最初の存在確認への挿入

`0x3FD680` は通常archiveを準備し、controller+`0x210` に `data:/savedata.bin` を構築する。`0x3FD7EC` で stack File を構築した直後:

```text
3FD7F8 E2841E21  add r1,r4,#0x210
3FD7FC E28D0020  add r0,sp,#0x20
3FD800 EBF BBD68 bl  0x2ECDA8    ; 正確なu32は0xEBFBBD68
3FD804 E3500000  cmp r0,#0
3FD808 E320F000  nop
3FD80C 0A000002  beq 0x3FD81C
```

**`0x3FD800` の BL 一命令置換**なら、元の命令を trampoline に移動する必要がない。hook 引数は r0=構築済み File、r1=controller+0x210。controller は `r1-0x210` で得られる。r4 も controller だが C ABI 引数ではない。r4–r11/sp を保持し、return r0=bool。戻り先 `0x3FD804` の cmp が結果を判定し、true 時 controller+0x290 bit1 をセットする。callee への stack は8-byte aligned。

hook は完成した拡張世代の有無、初回 import、新規開始を判定する位置として使える。破損・I/O失敗を false (=セーブなし) に変換しない。false は後で新規save作成に進む。controller+0x210 を virtual-path marker に置換する場合、元pathはその前に source import 用に保持する。

残る早い分岐: `0x3FD6F0–0x3FD750` は **この hook より前**に元data archiveを mount、必要時formatする。`0x4354FC → 0x3FDD68` にもformat経路がある。元archiveを常に読み取り専用にするという仕様なら、これらも扱う必要があり「存在確認hookだけで原本完全保護」は成立しない。

## Native File ABI

File は0x24 bytes。callerはstackに0x28を確保する例がある。`+0x10` から低レベルstream、`+0x14/+0x18` は64bit cursor、`+0x1C/+0x20` はsize cache。`+4` open mode、`+5` open flag。`+0` はvtable。

| VA | 引数 / return | 注意 |
|---|---|---|
| `33BA30` | `File* ctor(File*)`, r0保持 | `+10..20` を0に初期化 |
| `33B880` | `dtor(File*)` | open flagがfalseでも後半で`+10`を触る。virtual streamは完全に迂回する |
| `2ECDA8` | `bool exists(File*, const u16* fullPath)` | READ open→close。失敗種別を捨てfalse |
| `33789C` | `bool open(File*, const u16* fullPath, u32 mode)` | mode1=read、2=write、3=rw、6=write/create |
| `33791C` | `bool seek(File*, s32 offset, u32 origin)` | origin0/1/2=start/current/end。内部errorはfatalを呼ぶ |
| `33794C` | `u32 read(File*, void* dst, u32 length)` | 内部errorはfatal; return byte count |
| `2CEF50` | `u32 write(File*, const void* src, u32 length, u32 flush)` | 内部errorはfatal; return byte count |
| `31AE64` | `flush(File*)` | 内部errorはfatal |
| `3378E0` | `bool close(File*)` | successを返しopenflagを消す |

Checked backing-file primitives (virtual hookを回避して実ファイルを扱う場合):

| VA | AAPCS-compatible signature | return |
|---|---|---|
| `33CA7C` | `Result open(stream=file+0x10, u16*path, u32mode)` | 負が失敗。cursor/cache初期化はcaller側 |
| `33C908` | `Result read(stream, u32*readCount, void*dst, u32size)` | 成功0、countは成功時のみ設定 |
| `361674` | `Result write(stream, u32*writtenCount, const void*src, u32size, u32flush)` | 第5引数はstack; 成功0、count検証必須 |
| `3605C0` | `Result flush(stream)` | 負が失敗 |
| `335460` | `Result size(u64*out, IFile* p)` | p=`*(file+0x10)&~1`。File*やstream*ではない |
| `32FCC4` | `Result seek(stream, unused_r1, s64 offset, u32origin)` | offsetはr2/r3、originはstack |

初期migrationはsourceを1回先頭から読むだけならseek不要。後続 backing I/O も毎回close/openすればcursor0。**count出力は失敗時に未初期化なので、Result確認後にcountを使う**。

Native frame `3FDB2C` は `File+0x14` を直接読んで書き込み位置をヘッダに記録する。RAM-backed File のcursorは同位置に置く。seek/read/writeだけの抽象APIを実装して、cursorを別の場所に置く方式は不可。

## 保存・読込の覆盖範囲

| 経路 | native path / 特徴 |
|---|---|
| `2E28E0 → 3FD9F0` | controller+210、open mode1、primary load |
| `3FDB2C` | controller+210、mode6、ヘッダと全38block作成、cursor直接参照 |
| `3FDFFC(r1=0)` | controller+210、mode2、primary更新 |
| `3FDFFC(r1!=0)` | 同path、secondary snapshot更新、small delta mapping更新 |
| `3FE44C → 3FDDB4` | controller+210、mode3、snapshot restoreとheader bit0クリア |
| `3FE538 → 3FD9F0` | controller+250=`trial:/savedata.bin`、mode1。試用版からの読込を維持 |

`0x303F54` はcontroller+292=1にしてから3FDFFCを呼び、戻り後0にする。**3FDFFC入口でvirtual controllerの+292=0にする**と、File subclass allocationと290480のasync枝、flush workerをまとめて同期にできる。存在確認時だけ0を書いてもwrapperが後で1に戻す。

`0x290480(ctrl,file,offset,data,stack size)` はctrl+292で分岐し、sync時seek→2CEF50。global high File hooksで両者は覆える。native保存本体は各writeの失敗を全て回収しないので、virtual write/flush失敗時は単に0を返して続行させない。

`31AE30` は渡されたr0を無視し **常に data: archiveをcommitする**。sync保存、new作成、restoreに加えasync worker `1796C8` も呼ぶ。virtual streamのflushがA/B世代を確定した後、ここで元archiveをcommitする必要はない。ただしglobal no-op化より、virtual保存中だけ抑制する方が他用途を保持できる。

## 真の ExtData を native mount table に登録する

新しいASCII prefix例 `pana:` (8文字未満)。UTF16 `pana:/a.bin` などを既存File wrapperに渡せるようにする。`0x33395C` mount registryは32 slots、同名登録は`0xC82044B4`、満杯は`0xD8604659`。

既存mount関数の後半は再利用可能。新規ARM stubの設計:

```asm
; r0=ASCII prefix, r1=media, r2=idLow, r3=idHigh
push {r4-r8,lr}           ; exactly native 2BBF54 frame
sub sp,sp,#0x20
mov r4,r0                ; prefix survives calls
add r0,sp,#0x10
stmia r0,{r1,r2,r3}      ; 12-byte binary archive path
ldr r6,=0x574A20
ldr r2,[r6,#0x10]        ; FS:USER session Handle
str r2,[sp,#0x1C]
mov r1,#12
str r0,[sp]
str r1,[sp,#4]           ; stack args: data,length
add r0,sp,#0x1C          ; Handle*
add r1,sp,#8             ; u64 archiveHandle output
mov r2,#6               ; ARCHIVE_EXTDATA, NOT native 0x567890B4
mov r3,#2               ; PATH_BINARY
bl 0x2BBEF4
b 0x2BBF9C              ; allocation/registration/error cleanup and matching epilogue
```

`2BBEF4` returns raw Result. Reused tail makes IArchive `{vtable=0x501598, fsSession, rawLo, rawHi}`, registers prefix, frees/closes on failure, and returns raw Result. Tail depends on r4=prefix,r6=0x574A20 and above exactstack layout. Do not emit C code that jumps into this tail with a compiler-generated frame.

Simpler alternative: reproduce allocation/registration in C using `333BA4(0x608CE4)` allocator and `33395C(prefix,obj,0,0)`, with explicit cleanup on failure. `333AD8(fullUTF16Path)` obtains registered IArchive*, NULL when mount missing.

## CreateExtSaveData と fixed-size backing files

ROM 内に `0x08510242` literal は見つからなかった。新規IPC stubが必要。FS handleは `[0x574A20+0x10]`、TLS=`mrc p15,0,<reg>,c13,c0,3`、command buffer=TLS+0x80。`svc 0x32` のreturnが負ならそのまま返し、成功ならcommand buffer word1をResultとして返す。

CreateExtSaveData command words:

```text
0: 0x08510242
1..4: packed ExtSaveDataInfo = {media byte + unknown/reserved=0, idLow, idHigh, 0}
5: directory quota
6: file quota (A/Bなら少なくとも2、必要な管理file分も数える)
7..8: sizeLimit low/high
9: icon buffer byte count
10: (iconBytes << 4) | 0xA    ; mapped read buffer descriptor
11: icon buffer pointer
```

このwire形式は [libctru fs.c](https://github.com/devkitPro/libctru/blob/master/libctru/source/services/fs.c) のCreateExtSaveData実装と一致。icon size0の実機許可、titleのExtData権限、quota最小値は未検証。Azahar側はicon_size分のmappedbufferを読むため、size0でも正しいdescriptorが必要。

ExtDataは **OpenFileのCREATE flagを拒否し、Write/SetSizeでサイズを変更できない**。A/Bは必要サイズでCreateFileしてからmode3でopenする。通常saveのmode6をそのままExtDataに渡してはいけない。[Azahar のExtSaveData backend](https://github.com/azahar-emu/azahar/blob/master/src/core/file_sys/archive_extsavedata.cpp)

Native explicit CreateFile (`0x3607C8`):

```text
r0 = IArchive* from 333AD8(fullpath)
r1 = pointer to SDK Path {u32 type, pointer data, u32 byteLength}
r2 = fileSizeLow
r3 = fileSizeHigh
return = raw Result
```

Pathはmount prefixを除いたUTF16 `/a.bin\0`、type4、byteLengthに終端を含む。**SDK Pathのfield順は type,data,size**で、libctruのtype,size,dataと異なる。helperはIPC `0x08080202` (CreateFile)へ到達し、attributes=0。

ファイルを拡張する将来形式は、旧inactivefileの削除/再作成を伴う。active世代を先に削除しない。今回のサイズ固定A/Bでは最初に2fileとも正確なPNSVサイズで作る案が単純。

## Result分類と失敗

rawResult はbit31=error。native bool wrappersは原因を潰すのでmigration判定にはlower Resultが必要。

Azahar定義ではFS module=17、description=`result&0x3FF`。file112/path113/general120のNotFound、notformatted340、alreadyexists180/190。通常ExtDataが無いopenは **InvalidState summary + description120**。したがって単純な`0xC8804478`一値判定も不十分。[Azahar errors](https://github.com/azahar-emu/azahar/blob/master/src/core/file_sys/errors.h)

 native `1CF664/1CF778` はFS module17のdescription100..179→return1、340..389→2、390..399→3、230..339→4、その他→5。成功0。これらは**demo wrapper独自分類**であり、true ExtDataのエラー分類として無条件流用しない。

未mount `0xC8804465`、同mount名 `0xC82044B4`、メモリ/registry不足 `0xD8604659` はROMでliteral確認。permission/SD抜去/容量不足/破損を「未作成」に変換しない。CreateExtDataは既存世代の修復として呼ばない。

## global hook の先頭命令 guards

| VA | first u32 | trampoline上の注意 |
|---|---|---|
| `2ECDA8` | `E92D4070` | push r4,r5,r6,lr |
| `33BA30` | `E59F1050` | **PC-relative**。移動時literal値`0x4FBB78`に置換必須 |
| `33B880` | `E92D4070` | push |
| `33789C` | `E92D4070` | push |
| `33791C` | `E1A0C002` | mov ip,r2 |
| `33794C` | `E92D4008` | push r3,lr |
| `2CEF50` | `E52DE004` | str lr,[sp,#-4]! |
| `31AE64` | `E2800010` | add r0,r0,#0x10 |
| `3378E0` | `E92D4070` | push |
| `31AE30` | `E59F0028` | **PC-relative**。literal値`0x574580` |
| `3FDFFC` | `E92D4FF8` | push r3-r11,lr |

8byte以上を置換する場合はその範囲内の全命令をrelocateする。特に31AE64+8にはBLがある。ARM11/ARMv6KにはMOVW/Thumb2なし。memory markerをFile+18に置く案はnative64bitcursorの上位語を使うので、全対象APIでnativeに漏れないことが条件。新規ctorはuninitializedmemoryのmarkerを読まず必ず初期化し、customdtorはunderlyingpointerをnativepoolにfreeしない。

## 結論

原本丸ごとのRAM imageをnative File互換で扱い、flushで完全なPNSV A/B世代へ書く案は、native header offsets・primary/secondary・新規作成のcursorを保ちやすい。単なるpath書換えよりhooksは多いが、ExtDataの固定サイズ制約とPNSVヘッダをnativeI/Oから隠せる。最低限、存在確認、open/read/seek/write/flush/close/dtor、save同期化、旧data:commitとformat分岐の扱いを揃える。code caveに収まったことと、各ABI・エラー・電源断の正しさは別に検証する。
