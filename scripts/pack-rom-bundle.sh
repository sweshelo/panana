#!/usr/bin/env bash
# CI の ROM テスト用に、ダンプと golden.json を暗号化した 1 ファイルにまとめる (.github/workflows/test.yml の rom ジョブが使う)。
#
#   ROM_BUNDLE_PASSPHRASE=... scripts/pack-rom-bundle.sh [ELPULSE_ROOT] [OUT]
#
# 中身: 00040000000A7900.cia、golden.json、あれば mod/out (base MOD のテスト用)。
# 出力 (既定 rom-bundle.tar.gpg) はリポジトリに入れず、非公開のストレージ (R2 など) に置く。
set -euo pipefail

ROOT=${1:-${ELPULSE_ROOT:-$(dirname "$0")/../../elpulse}}
OUT=${2:-rom-bundle.tar.gpg}
GOLDEN=$(dirname "$0")/../test/golden/golden.json
: "${ROM_BUNDLE_PASSPHRASE:?ROM_BUNDLE_PASSPHRASE を設定してください}"

[ -f "$ROOT/00040000000A7900.cia" ] || { echo "$ROOT/00040000000A7900.cia がありません" >&2; exit 1; }
[ -f "$GOLDEN" ] || { echo "$GOLDEN がありません (python test/golden/export_golden.py で作る)" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ln -s "$(cd "$ROOT" && pwd)/00040000000A7900.cia" "$STAGE/00040000000A7900.cia"
cp "$GOLDEN" "$STAGE/golden.json"
if [ -d "$ROOT/mod/out" ]; then mkdir -p "$STAGE/mod" && cp -r "$ROOT/mod/out" "$STAGE/mod/out"; fi

tar -C "$STAGE" -h -cf - . \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --compress-algo zlib -o "$OUT" 3<<<"$ROM_BUNDLE_PASSPHRASE"
ls -lh "$OUT"
