# UAC Optimization Overview

## What was done
Reduced TUN mode UAC prompts from **3 → 1** (worst case), and **1 → 0** (when app runs as admin).

## Key changes

### Option A — Merge elevated operations (3→1 UAC)
- `launch_singbox_with_config(tun=true)` now combines `Stop-Process` (kill old) + start new in a single `-Verb RunAs` PowerShell command
- Bootstrap retry no longer calls separate `stop_singbox_process()` — just calls `launch_singbox_with_config()` again, which handles kill+start in one UAC
- `stop_singbox_process()` checks `is_elevated()` — if admin, kills directly without elevated fallback

### Option B — Self-elevation (1→0 UAC)
- Added `is_elevated()` check (Windows Administrators SID)
- Added `request_elevation` Tauri command — restarts app as admin via UAC, then exits current instance
- Added `save/load_elevation_intent` — one-shot flag for auto-connect after admin restart
- When app IS elevated, `launch_singbox_with_config` spawns sing-box directly (no `-Verb RunAs`)
- Sidebar shows elevation status: amber "Restart as admin" button (not elevated) or emerald "Running as admin" badge (elevated)

## UAC count comparison
| Scenario | Before | After |
|----------|--------|-------|
| Clean start (TUN) | 1 UAC | 1 UAC (or 0 if admin) |
| Bootstrap retry (TUN) | 3 UAC | 1 UAC (or 0 if admin) |
| Stop elevated process | 1 UAC | 0 UAC (if admin) or 1 UAC |
| Switch node while running | 2 UAC | 1 UAC (or 0 if admin) |

## Files modified
- `src-tauri/src/core_process.rs` — `is_elevated`, merged launch, elevation intent, `restart_as_admin`
- `src-tauri/src/commands/singbox.rs` — 3 new Tauri commands, simplified retry
- `src-tauri/src/lib.rs` — registered commands
- `src/hooks/useSingbox.ts` — `isElevated` state, `requestElevation`, auto-connect
- `src/components/Sidebar.tsx` — elevation status banner
- `src/App.tsx` — passed new props to Sidebar
