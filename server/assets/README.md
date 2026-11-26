# 実行ファイルに同梱するもの

- `master-baseline.json`: ROM の master の行ハッシュ (先頭 12 桁だけで、ROM のデータは含まない)。取り込んだ配信用 ZIP の master の差分をステージに割り当てるのに使う。lanai-custom-stages の `web/tools/master-baseline.ts` で作る。
- `lanai-cs.ips`: カスタムステージ用のゲームのパッチ (Update v17408 の code.ips)。lanai-custom-stages の `bun 3ds/build.ts` で作る (devkitARM と手元の CIA が要る)。中身は追加したコードと分岐の語だけで、ROM のデータは含まない。サーバのアドレスは含まず、ゲームの「せってい」→「カスタムステージサーバ」で入力する。
  - 現在のもの: lanai-custom-stages 2875887 のビルド (build 1fea2e12、2026-11-26)。
- `lanai-cs.json`: `lanai-cs.ips` の版（`buildId`、`sha256`、`source`）。`bun 3ds/build.ts <出力先>` が IPS と一緒に出力するので、2 つを組で置き換える。配信中は、ゲームの「カスタム」がこの `buildId` を自分の版と比べ、違えば `/api/patch/code.ips` を取ってきて Luma3DS の code.ips を書き換える（server/patch.ts）。`sha256` が IPS と合わないときは版を出さないので、ゲームは更新しない。
