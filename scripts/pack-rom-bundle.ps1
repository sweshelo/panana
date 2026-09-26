# CI の ROM テスト用に、ダンプと golden.json を暗号化した 1 ファイルにまとめる (.github/workflows/test.yml の rom ジョブが使う)。
#
#   .\scripts\pack-rom-bundle.ps1 [-Elpulse ..\elpulse] [-Out rom-bundle.tar.gpg]
#
# 中身: 00040000000A7900.cia、golden.json、あれば mod/out (base MOD のテスト用)。
# パスフレーズは環境変数 ROM_BUNDLE_PASSPHRASE、なければ入力を求める。
# 要るもの: tar (Windows 10 以降は標準)、gpg (Gpg4win など)。
# 出力はリポジトリに入れず、非公開のストレージ (R2 など) に置く。
param(
  [string]$Elpulse = $(if ($env:ELPULSE_ROOT) { $env:ELPULSE_ROOT } else { Join-Path $PSScriptRoot '..\..\elpulse' }),
  [string]$Out = 'rom-bundle.tar.gpg'
)
$ErrorActionPreference = 'Stop'

$cia = Join-Path $Elpulse '00040000000A7900.cia'
$goldenDir = Join-Path $PSScriptRoot '..\test\golden'
if (-not (Test-Path $cia)) { throw "$cia がありません" }
if (-not (Test-Path (Join-Path $goldenDir 'golden.json'))) { throw 'test/golden/golden.json がありません (python test/golden/export_golden.py で作る)' }
foreach ($cmd in 'tar', 'gpg') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd が見つかりません" } }

$pass = $env:ROM_BUNDLE_PASSPHRASE
if (-not $pass) {
  $a = Read-Host 'パスフレーズ' -AsSecureString
  $b = Read-Host 'パスフレーズ (確認)' -AsSecureString
  $pass = [Net.NetworkCredential]::new('', $a).Password
  if ($pass -ne [Net.NetworkCredential]::new('', $b).Password) { throw 'パスフレーズが一致しません' }
  if (-not $pass) { throw 'パスフレーズが空です' }
}

# tar に直接並べる (-C で場所を切り替え)。PowerShell のパイプはバイナリを壊すので、いったんファイルに書く。
$tmp = [IO.Path]::GetTempFileName()
$tarArgs = @('-cf', $tmp, '-C', $Elpulse, '00040000000A7900.cia')
if (Test-Path (Join-Path $Elpulse 'mod/out')) { $tarArgs += 'mod/out' }
$tarArgs += @('-C', $goldenDir, 'golden.json')
try {
  & tar @tarArgs
  if ($LASTEXITCODE -ne 0) { throw "tar が失敗しました ($LASTEXITCODE)" }

  $OutputEncoding = [Text.UTF8Encoding]::new($false)
  $pass | & gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 --compress-algo zlib -o $Out $tmp
  if ($LASTEXITCODE -ne 0) { throw "gpg が失敗しました ($LASTEXITCODE)" }
} finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}
Get-Item $Out | Select-Object Name, Length
