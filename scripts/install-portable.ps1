param(
  [string]$SourceDir = $PSScriptRoot,
  [string]$InstallDir = "$env:LOCALAPPDATA\\Programs\\SingBox Client",
  [switch]$NoDesktopShortcut,
  [switch]$NoStartMenuShortcut,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Save()
}

$resolvedSourceDir = (Resolve-Path $SourceDir).Path
$sourceExe = Join-Path $resolvedSourceDir "singbox-client.exe"
$sourceBinDir = Join-Path $resolvedSourceDir "bin"

if (-not (Test-Path $sourceExe)) {
  throw "Missing singbox-client.exe in $resolvedSourceDir"
}

if (-not (Test-Path (Join-Path $sourceBinDir "sing-box.exe"))) {
  throw "Missing bin\\sing-box.exe in $resolvedSourceDir"
}

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "bin") | Out-Null

Copy-Item $sourceExe (Join-Path $InstallDir "singbox-client.exe")
Copy-Item (Join-Path $sourceBinDir "*") (Join-Path $InstallDir "bin") -Recurse -Force

$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "SingBox Client.lnk"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startMenuShortcut = Join-Path $startMenuDir "SingBox Client.lnk"
$installedExe = Join-Path $InstallDir "singbox-client.exe"

if (-not $NoDesktopShortcut) {
  New-Shortcut -ShortcutPath $desktopShortcut -TargetPath $installedExe -WorkingDirectory $InstallDir
}

if (-not $NoStartMenuShortcut) {
  New-Shortcut -ShortcutPath $startMenuShortcut -TargetPath $installedExe -WorkingDirectory $InstallDir
}

Write-Host "Installed to $InstallDir"

if (-not $NoLaunch) {
  Start-Process -FilePath $installedExe -WorkingDirectory $InstallDir
}
