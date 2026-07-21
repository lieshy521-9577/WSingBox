param(
  [Parameter(Mandatory)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Normalize: strip leading "v" for filenames (Tauri NSIS output uses raw version),
# keep "v" only for git tag / release title.
$ver = $Version -replace '^v', ''
if ($ver -ne $Version) {
  Write-Host "Note: using '$ver' for artifact filenames (git tag will be 'v$ver')" -ForegroundColor DarkGray
}

if ($ver -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z.-]+)?$') {
  throw "Invalid version '$Version'. Expected SemVer like 1.4.1 or v1.4.1."
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Set-JsonFileVersion {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Version,
    [switch]$UpdatePackageLockRoot
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.AddRange([string[]](Get-Content -Path $Path))
  $remaining = if ($UpdatePackageLockRoot) { 2 } else { 1 }

  for ($i = 0; $i -lt $lines.Count -and $remaining -gt 0; $i++) {
    if ($lines[$i] -match '^(\s*"version"\s*:\s*")[^"]+(".*)$') {
      $lines[$i] = "$($Matches[1])$Version$($Matches[2])"
      $remaining--
    }
  }

  if ($remaining -gt 0) {
    throw "Version entry not found in $Path"
  }

  $content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
  Write-Utf8NoBom -Path $Path -Content $content
}

function Set-TomlPackageVersion {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Version,
    [string]$PackageName
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.AddRange([string[]](Get-Content -Path $Path))
  $inPackage = $false
  $matchedName = [string]::IsNullOrWhiteSpace($PackageName)

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    if ($line -eq "[[package]]" -or $line -eq "[package]") {
      $inPackage = $true
      $matchedName = [string]::IsNullOrWhiteSpace($PackageName)
      continue
    }

    if ($inPackage -and $PackageName -and $line -match '^\s*name\s*=\s*"([^"]+)"') {
      $matchedName = $Matches[1] -eq $PackageName
      continue
    }

    if ($inPackage -and $matchedName -and $line -match '^(\s*version\s*=\s*")[^"]+(".*)$') {
      $lines[$i] = "$($Matches[1])$Version$($Matches[2])"
      $content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
      Write-Utf8NoBom -Path $Path -Content $content
      return
    }
  }

  throw "Package version entry not found in $Path"
}

Write-Host "=== Syncing version metadata ===" -ForegroundColor Cyan
Set-JsonFileVersion -Path "$repoRoot\package.json" -Version $ver
if (Test-Path "$repoRoot\package-lock.json") {
  Set-JsonFileVersion -Path "$repoRoot\package-lock.json" -Version $ver -UpdatePackageLockRoot
}
Set-JsonFileVersion -Path "$repoRoot\src-tauri\tauri.conf.json" -Version $ver
Set-TomlPackageVersion -Path "$repoRoot\src-tauri\Cargo.toml" -Version $ver
if (Test-Path "$repoRoot\src-tauri\Cargo.lock") {
  Set-TomlPackageVersion -Path "$repoRoot\src-tauri\Cargo.lock" -Version $ver -PackageName "singbox-client"
}

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
powershell -ExecutionPolicy Bypass -File "$repoRoot\scripts\package-portable.ps1" -Version $ver
if ($LASTEXITCODE -ne 0) { throw "Portable packaging failed" }

Write-Host "=== Generating SHA-256 ===" -ForegroundColor Cyan
$nsisPath = "$repoRoot\src-tauri\target\release\bundle\nsis\SingBox Client_${ver}_x64-setup.exe"
$portablePath = "$repoRoot\src-tauri\target\release\bundle\portable\SingBox-Client_${ver}_x64-portable.zip"

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
Write-Host "=== Release v$ver complete! ===" -ForegroundColor Green
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
Write-Host "  1. git add -A && git commit -m 'release: v$ver'"
Write-Host "  2. git tag v$ver"
Write-Host "  3. git push origin main --tags"
Write-Host "  4. gh release create v$ver '$nsisPath' '$portablePath' --title 'v$ver' --generate-notes"
