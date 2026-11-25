# 実行ファイルに同梱するもの

- `master-baseline.json`: ROM の master の行ハッシュ (先頭 12 桁だけで、ROM のデータは含まない)。取り込んだ配信用 ZIP の master の差分をステージに割り当てるのに使う。lanai-custom-stages の `web/tools/master-baseline.ts` で作る。
- `lanai-cs.ips`: カスタムステージ用のゲームのパッチ (Update v17408 の code.ips)。lanai-custom-stages の `bun 3ds/build.ts` で作る (devkitARM と手元の CIA が要る)。中身は追加したコードと分岐の語だけで、ROM のデータは含まない。サーバのアドレスは含まず、ゲームの「せってい」→「カスタムステージサーバ」で入力する。
  - 現在のもの: lanai-custom-stages 3dd3168 のビルド (2026-11-25)。
