# SingBox Client 发布指南

> 当前版本: **1.4.0** · 平台: **Windows x64**

---

## 1. 版本号位置

版本号需要在以下 **5 个文件** 中同步更新：

| 文件 | 字段 | 说明 |
|------|------|------|
| `package.json` | `"version"` | 前端 npm 包版本 |
| `src-tauri/tauri.conf.json` | `"version"` | Tauri 应用版本（About 页面显示） |
| `src-tauri/Cargo.toml` | `version = "x"` | Rust crate 版本 |
| `src-tauri/Cargo.lock` | `version = "x"` | Cargo 锁定文件（手动更新或 `cargo update -p singbox-client`） |
| `scripts/package-portable.ps1` | `$Version` 默认值 | 便携包命名用 |

> **自动化脚本**: 可用以下命令一键检查版本一致性：
> ```bash
> grep '"version"' package.json src-tauri/tauri.conf.json && grep '^version' src-tauri/Cargo.toml
> ```

---

## 2. 发布资源清单

每次发布需要产出以下 assets：

### 必需资源

| 资源 | 文件名示例 | 来源命令 | 大小参考 |
|------|-----------|---------|---------|
| **NSIS 安装包** | `SingBox Client_1.4.0_x64-setup.exe` | `npm run tauri build` | ~14 MB |
| **便携版 ZIP** | `SingBox-Client_1.4.0_x64-portable.zip` | `npm run package:portable` | ~36 MB |

### 可选资源（提升体验）

| 资源 | 说明 | 何时需要 |
|------|------|---------|
| 更新签名文件 `.sig` | Tauri updater 自动更新验证 | 启用自动更新功能时 |
| `latest.json` | 自动更新清单 | 启用自动更新功能时 |
| SHA-256 校验文件 | `SHA256SUMS.txt` | 安全分发 |
| Release Notes | `CHANGELOG.md` 或 GitHub Release body | 每次发布 |

### 已有依赖资源

| 资源 | 路径 | 说明 |
|------|------|------|
| sing-box 核心 | `bin/sing-box.exe` (~35 MB) | 代理内核，打包时自动嵌入 |
| 应用图标 | `src-tauri/icons/icon.ico` | NSIS 安装包 + 托盘图标 |
| 托盘图标 | `src-tauri/icons/tray-*.ico` | 连接/断开状态图标 |

---

## 3. 完整发布流程

### Step 1: 更新版本号

```bash
# 确认 5 个文件版本号已统一为目标版本（如 1.4.0）
grep '"version"' package.json src-tauri/tauri.conf.json
grep '^version' src-tauri/Cargo.toml
```

### Step 2: 构建前端

```bash
npm run build
```

验证 TypeScript 无错误、Vite 构建成功。

### Step 3: 构建 NSIS 安装包

```bash
npm run tauri build
```

产出位置:
```
src-tauri/target/release/bundle/nsis/SingBox Client_1.4.0_x64-setup.exe
```

> **注意**: 首次构建需 5-10 分钟（Rust 编译）。增量构建约 1-2 分钟。

### Step 4: 构建便携版 ZIP

```bash
npm run package:portable
```

产出位置:
```
src-tauri/target/release/bundle/portable/SingBox-Client_1.4.0_x64-portable.zip
```

> 便携版包含: `singbox-client.exe` + `bin/sing-box.exe` + `install.ps1` + `README.md`

### Step 5: 生成 SHA-256 校验

```powershell
$files = @(
  "src-tauri\target\release\bundle\nsis\SingBox Client_1.4.0_x64-setup.exe",
  "src-tauri\target\release\bundle\portable\SingBox-Client_1.4.0_x64-portable.zip"
)
foreach ($f in $files) {
  $hash = (Get-FileHash $f -Algorithm SHA256).Hash
  $name = Split-Path $f -Leaf
  Write-Output "$hash  $name"
}
```

### Step 6: 提交代码 + 创建 Git Tag

```bash
git add -A
git commit -m "release: v1.4.0"
git tag v1.4.0
git push origin main --tags
```

### Step 7: 创建 GitHub Release

```bash
gh release create v1.4.0 \
  "src-tauri/target/release/bundle/nsis/SingBox Client_1.4.0_x64-setup.exe" \
  "src-tauri/target/release/bundle/portable/SingBox-Client_1.4.0_x64-portable.zip" \
  --title "v1.4.0" \
  --notes "release notes here"
```

Release Notes 模板:
```markdown
## What's New

- [功能1简述]
- [功能2简述]

## Fixes

- [修复1]

## Downloads

| 文件 | 说明 |
|------|------|
| `SingBox Client_1.4.0_x64-setup.exe` | Windows 安装包（推荐） |
| `SingBox-Client_1.4.0_x64-portable.zip` | 便携版（免安装） |

## SHA-256
```
[粘贴 Step 5 的校验值]
```
```

---

## 4. 一键发布脚本

将以下脚本保存为 `scripts/release.ps1`，实现一键构建+打包：

```powershell
# scripts/release.ps1
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
$nsis = Get-Item "$repoRoot\src-tauri\target\release\bundle\nsis\SingBox Client_${Version}_x64-setup.exe"
$portable = Get-Item "$repoRoot\src-tauri\target\release\bundle\portable\SingBox-Client_${Version}_x64-portable.zip"

$hashFile = "$repoRoot\src-tauri\target\release\SHA256SUMS.txt"
"$(Get-FileHash $nsis.FullName -Algorithm SHA256).Hash  $($nsis.Name)" | Out-File $hashFile
"$(Get-FileHash $portable.FullName -Algorithm SHA256).Hash  $($portable.Name)" | Out-File $hashFile -Append

Write-Host ""
Write-Host "=== Release v$Version complete! ===" -ForegroundColor Green
Write-Host "NSIS:     $($nsis.FullName)"
Write-Host "Portable: $($portable.FullName)"
Write-Host "SHA256:   $hashFile"
```

使用方式：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 1.4.0
```

---

## 5. 自动更新（未来可选）

当前项目 **未配置** Tauri updater。如需启用自动更新，需要：

1. **生成签名密钥对**：
   ```bash
   npx @tauri-apps/cli signer generate -w ~/.tauri/singbox.key
   ```
   会生成私钥 `.key` 和公钥 `.key.pub`

2. **配置 `tauri.conf.json`**：
   ```json
   {
     "plugins": {
       "updater": {
         "active": true,
         "endpoints": ["https://github.com/YOUR_USER/SingBox/releases/latest/download/latest.json"],
         "pubkey": "粘贴公钥内容"
       }
     }
   }
   ```

3. **构建时签名**：
   ```bash
   $env:TAURI_PRIVATE_KEY = "私钥内容"
   $env:TAURI_KEY_PASSWORD = "密码"
   npm run tauri build
   ```
   会额外产出 `.sig` 签名文件

4. **生成 `latest.json`**：每次发布时生成更新清单

> 目前项目仍处于手动分发阶段，自动更新可作为后续迭代目标。

---

## 6. 检查清单 (Release Checklist)

发布前逐项确认：

- [ ] 5 个文件版本号已统一
- [ ] `npm run build` 无 TypeScript 错误
- [ ] `cargo check` 无 Rust 警告/错误
- [ ] NSIS 安装包构建成功
- [ ] 便携版 ZIP 构建成功
- [ ] SHA-256 校验值已生成
- [ ] `git tag vX.Y.Z` 已创建
- [ ] GitHub Release 已创建，附带 2 个 assets
- [ ] Release Notes 已填写
- [ ] 安装包在干净环境测试通过
- [ ] 便携版解压后可正常运行
