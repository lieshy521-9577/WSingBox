param(
  [Parameter(Mandatory)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Building frontend ===" -ForegroundColor Cyan
Push-Location $repoRoot
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
Pop-Location

Write-Host "=== Building NSIS installer ===" -ForegroundColor Cyan
Push-Location "$repoRoot\src-tauri"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
Pop-Location

Write-Host "=== Building portable ZIP ===" -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File "$repoRoot\scripts\package-portable.ps1" -Version $Version
if ($LASTEXITCODE -ne 0) { throw "Portable packaging failed" }

Write-Host "=== Generating SHA-256 ===" -ForegroundColor Cyan
$nsisPath = "$repoRoot\src-tauri\target\release\bundle\nsis\SingBox Client_${Version}_x64-setup.exe"
$portablePath = "$repoRoot\src-tauri\target\release\bundle\portable\SingBox-Client_${Version}_x64-portable.zip"

if (-not (Test-Path $nsisPath)) { throw "NSIS installer not found: $nsisPath" }
if (-not (Test-Path $portablePath)) { throw "Portable zip not found: $portablePath" }

$nsisName = Split-Path $nsisPath -Leaf
$portableName = Split-Path $portablePath -Leaf
$nsisHash = (Get-FileHash $nsisPath -Algorithm SHA256).Hash
$portableHash = (Get-FileHash $portablePath -Algorithm SHA256).Hash

$hashFile = "$repoRoot\src-tauri\target\release\SHA256SUMS.txt"
"$nsisHash  $nsisName" | Out-File -FilePath $hashFile -Encoding utf8
"$portableHash  $portableName" | Out-File -FilePath $hashFile -Encoding utf8 -Append

Write-Host ""
Write-Host "=== Release v$Version complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "NSIS installer:" -ForegroundColor Yellow
Write-Host "  $nsisPath"
Write-Host "  SHA-256: $nsisHash"
Write-Host ""
Write-Host "Portable zip:" -ForegroundColor Yellow
Write-Host "  $portablePath"
Write-Host "  SHA-256: $portableHash"
Write-Host ""
Write-Host "SHA-256 sums:" -ForegroundColor Yellow
Write-Host "  $hashFile"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. git add -A && git commit -m 'release: v$Version'"
Write-Host "  2. git tag v$Version"
Write-Host "  3. git push origin main --tags"
Write-Host "  4. gh release create v$Version '$nsisPath' '$portablePath' --title 'v$Version' --generate-notes"
