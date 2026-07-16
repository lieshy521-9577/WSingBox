param(
  [string]$Version = "1.3.1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot "src-tauri\target\release"
$portableRoot = Join-Path $repoRoot "src-tauri\target\release\bundle\portable"
$appDir = Join-Path $portableRoot "SingBox-Client"
$zipPath = Join-Path $portableRoot ("SingBox-Client_{0}_x64-portable.zip" -f $Version)

$exePath = Join-Path $releaseDir "singbox-client.exe"
$coreDir = Join-Path $repoRoot "bin"

if (-not (Test-Path $exePath)) {
  throw "Missing app executable: $exePath. Run 'npm run tauri build' first."
}

if (-not (Test-Path (Join-Path $coreDir "sing-box.exe"))) {
  throw "Missing sing-box core: $(Join-Path $coreDir 'sing-box.exe')"
}

New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
if (Test-Path $appDir) {
  Remove-Item -Recurse -Force $appDir
}

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "bin") | Out-Null

Copy-Item $exePath (Join-Path $appDir "singbox-client.exe")

Get-ChildItem $coreDir | Where-Object { $_.Name -ne "sing-box.zip" } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $appDir "bin") -Recurse -Force
}

$installScript = Join-Path $repoRoot "scripts\install-portable.ps1"
if (Test-Path $installScript) {
  Copy-Item $installScript (Join-Path $appDir "install.ps1")
}

$readme = Join-Path $repoRoot "README.md"
if (Test-Path $readme) {
  Copy-Item $readme (Join-Path $appDir "README.md")
}

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $appDir "*") -DestinationPath $zipPath

Write-Host "Portable package created:"
Write-Host $zipPath
