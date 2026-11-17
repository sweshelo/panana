# 作業ログ

## 2026-11-17

- `TASK.md` の8項目を `STATE.md` に手順と完了条件付きで分割。最初の作業をワープ先選択に設定した。
- ワープ先のマップ欄と地点 ID 欄からマップ→地点の順に選べるよう変更。地点 ID 欄は候補マップが1つなら最初のダイアログを省略する。地点確定前のキャンセルでは保存値を変更しない。
- 関連テスト `bun test test/lanai-eventeditor.test.tsx` は8件通過。`bun run typecheck` とコミット時の Lefthook（整形、lint、型チェック、全テスト）が通過した。画面上の手動操作は未確認。
- 実装コミット: `0975fb7 Add staged destination picker flow and task state`。
- 次の作業はエディタの定義済み関数 hover、保存時のスクロール、条件式の論理演算子。補完情報は `src/lanai/scriptAssist.ts`、エディタ本体は `src/lanai/scriptCodeMirror.ts` にあることを確認済み。
