# SingBox Client — Code Review Standards & Process

## 1. Overview

This document establishes the code review standards, severity classification, review checklist, and workflow for the SingBox Client project (Tauri + React desktop app). The goal is to ensure consistent quality across Rust backend and TypeScript frontend code.

---

## 2. Severity Classification

| Level | Symbol | Meaning | Action |
|-------|--------|---------|--------|
| **Blocker** | 🔴 | Must fix before merge. Security vulnerability, data loss risk, breaking API contract, race condition. | PR cannot proceed. |
| **Suggestion** | 🟡 | Should fix. Missing input validation, unclear naming, missing tests, performance issue, code duplication. | PR can proceed with a tracking issue. |
| **Nit** | 💭 | Nice to have. Style inconsistencies, minor naming, documentation gaps, alternative approaches. | PR proceeds; no obligation to change. |

---

## 3. Review Dimensions

### 3.1 Correctness
- Does the code do what it's supposed to?
- Are edge cases handled (empty arrays, null values, concurrent access)?
- Does the error path produce correct behavior?
- Are state transitions well-defined and complete?

### 3.2 Security
- Is user input validated before processing?
- Are PowerShell/shell commands free from injection risks?
- Are file paths sanitized (no `..` traversal)?
- Are credential/subscription URLs handled securely (no logging, no exposure)?
- Is the elevation flow safe (UAC intent cannot be spoofed)?
- Is clipboard content validated before use?

### 3.3 Maintainability
- Can someone understand this code in 6 months?
- Are functions single-purpose and named clearly?
- Is state management predictable (no hidden mutations)?
- Are dependencies explicit (no global state via `let` outside React hooks)?
- Is dead code removed (no `#[allow(dead_code)]` without explanation)?

### 3.4 Performance
- Are there N+1 patterns (serial `await invoke()` calls that could be parallel)?
- Are unnecessary allocations avoided?
- Are async operations properly cancelled on unmount?
- Is the Tauri IPC boundary efficient (no serializing huge objects unnecessarily)?

### 3.5 Testing
- Are critical paths tested (connect, disconnect, profile switch)?
- Are error paths tested (network failure, config parse failure)?
- Are React hooks tested for StrictMode double-invocation?

---

## 4. Project-Specific Rules

### 4.1 Rust Backend (`src-tauri/src/`)

#### 🔴 Blocker Rules
- **No string interpolation into PowerShell commands** — always use `quote_powershell_literal()` for any value that could contain special characters. Raw `format!()` with variable interpolation is a command injection risk.
- **No filesystem operations without error handling** — every `fs::read`, `fs::write`, `fs::remove_file` must handle `Err` and return a meaningful error message, not silently fail.
- **No `unwrap()` on I/O operations** — `unwrap()` is acceptable only for invariant assertions (e.g., `current_exe()` in `run()` startup). I/O operations must use `.map_err()`.
- **Process management must be deterministic** — `stop_singbox_process()` must verify the process is actually stopped before returning `Ok`. No "best effort" kills.

#### 🟡 Suggestion Rules
- **Avoid `#[allow(dead_code)]`** — if code is intentionally kept, document why in a comment. Otherwise, remove it.
- **Extract repeated patterns** — `hidden_command("taskkill").args(...)` appears multiple times; consider a helper.
- **Prefer `Command::new` directly over PowerShell** — PowerShell invocations are expensive (process spawn + interpreter). Prefer `tasklist`, `taskkill`, `reg` CLI tools. Use PowerShell only when native CLI cannot do the job.
- **Thread::sleep after process kills** — prefer `child.wait()` for synchronous kills, or `WaitForSingleObject` on Windows for better reliability than arbitrary sleep durations.

#### 💭 Nit Rules
- **Consistent error message format** — `"Failed to X: {}"` pattern is good; keep it consistent.
- **Comment domain knowledge** — explain Windows-specific behavior (SID S-1-5-32-544, `CREATE_NO_WINDOW` flag, UAC flow).

### 4.2 TypeScript Frontend (`src/`)

#### 🔴 Blocker Rules
- **No `useEffect` without guarding against React StrictMode** — any effect that triggers side effects (IPC calls, state mutations) must use `useRef` guards or stable refs to prevent double-invocation in dev mode.
- **No direct DOM mutations** — React state must drive all UI changes. No `document.getElementById()` + `.style` patterns.
- **No unchecked `invoke()` results** — all Tauri IPC calls must handle both success and error paths. No silent `catch {}` or `.catch(() => {})` without logging.
- **No hardcoded dark-mode-only colors** — all visible UI elements must work in both light and dark themes. Use `dark:` prefix for Tailwind or semantic CSS variables.

#### 🟡 Suggestion Rules
- **Prefer `useCallback` for all event handlers** — prevents unnecessary re-renders and keeps dependency tracking explicit.
- **Avoid `await` chains that could be parallel** — multiple `invoke()` calls with no dependency between them should use `Promise.allSettled()` instead of sequential `await`.
- **State should be minimal** — derive computed values via `useMemo` rather than storing them as separate state.
- **Prop drilling limit** — if a prop passes through 3+ components, consider React Context or a hook refactoring.
- **Extract sub-components from large files** — `NodeList.tsx` (515 lines) contains `NodeDetailPanel`, `ModeToggle`, `DetailKv` — these should be separate files for maintainability.

#### 💭 Nit Rules
- **Consistent import ordering** — React hooks first, then external libs, then local modules.
- **JSDoc for complex functions** — `testAllLatency`, `selectOutboundTag`, `startProxy` have complex flow logic; add brief docs.

---

## 5. Review Checklist Template

```markdown
## PR Review: [title]

### Summary
[Brief description of what this PR does and overall impression]

### 🔴 Blockers
- [List any blocker-level issues with file/line references]

### 🟡 Suggestions
- [List suggestion-level issues]

### 💭 Nits
- [List nit-level issues]

### ✅ What's Good
- [Call out clever solutions, clean patterns, good naming]

### Action Items
1. [Must-fix before merge]
2. [Should-fix, can track separately]
3. [Optional improvements]
```

---

## 6. Review Workflow

### 6.1 PR Submission
1. Author creates PR with descriptive title and body
2. Author self-reviews using the checklist template
3. Author marks which severity level they expect each issue to be

### 6.2 Review Process
1. Reviewer reads the full diff, not just the description
2. Reviewer checks each file against the project-specific rules (Section 4)
3. Reviewer checks the cross-cutting dimensions (Section 3)
4. Reviewer provides feedback using the comment format:
   ```
   🔴 **Security: PowerShell Injection**
   Line X: [explain what's wrong and why]
   Suggestion: [specific code change]
   ```

### 6.3 Resolution
1. Author addresses 🔴 blockers — PR cannot merge without this
2. Author addresses 🟡 suggestions or creates tracking issues
3. 💭 nits are optional — author can accept or decline
4. Reviewer re-checks after changes
5. PR merges only when all 🔴 blockers are resolved

### 6.4 Automation (Future)
- ESLint + TypeScript strict mode for frontend
- Clippy for Rust backend
- CI check: `cargo check` + `npx tsc --noEmit` must pass
- CI check: no `#[allow(dead_code)]` without explanatory comment
- CI check: no `unwrap()` on I/O operations (custom clippy lint)

---

## 7. Current Codebase Review Findings

Based on the review of the current workspace (v1.2.2 + UAC optimization), here are the findings:

### 🔴 Blockers

1. **Shell Injection Risk in `restart_as_admin()`** — `core_process.rs:543`
   ```rust
   &format!("Start-Process -FilePath '{}' -Verb RunAs", exe_str),
   ```
   The exe path is quoted with single quotes but `exe_str` could contain `'` characters (unlikely for a path, but the `quote_powershell_literal()` helper exists and should be used for consistency).

2. **Race condition in elevation intent** — `useSingbox.ts:585-597`
   The `check_elevation_intent` effect runs based on `hasConfig` dependency, but `hasConfig` starts as `false` and may not be ready when the intent file is read. If `hasConfig` becomes `true` asynchronously, the auto-connect fires — but the `startProxy` function depends on `selectedOutboundTag` which may also not be loaded yet. This could cause a failed auto-connect on admin restart.

3. **Toast ID collision** — `App.tsx:39-43`
   ```typescript
   let toastIdCounter = 0;
   const addToast = useCallback((type, message) => {
     const id = Date.now() + (toastIdCounter++);
   ```
   `toastIdCounter` is a `let` variable inside the component body (not a ref or state). It resets to 0 on every render. Two toasts created in the same millisecond within the same render cycle could collide. Use `useRef` for the counter.

### 🟡 Suggestions

1. **Dead code in `singbox.rs:251-294`** — The local `stop_singbox_process()` function is marked `#[allow(dead_code)]` but is a near-duplicate of `core_process::stop_singbox_process()` with the old 3-UAC logic. It should be removed or documented if intentionally kept for fallback.

2. **Serial `await` chains in `useSingbox.ts`** — Multiple functions like `switchConfigProfile`, `deleteConfigProfile`, `refreshConfigProfile` chain 6-8 sequential `await invoke()` calls. Independent calls (e.g., `loadNodes()`, `loadProfiles()`, `loadRuntimeDebug()`) should use `Promise.allSettled()`.

3. **Hardcoded dev path** — `core_process.rs:96`
   ```rust
   normalize_existing_binary_path(std::path::PathBuf::from(r"C:\_dCode\SingBox\bin\sing-box.exe"))
   ```
   This is a development-only fallback path. It should be removed before production or replaced with a config-based path.

4. **Missing cleanup on component unmount** — `NodeList.tsx:179-183`
   The `autoTestedRef` prevents duplicate test, but if the component unmounts and remounts (e.g., page navigation), the ref resets and triggers another full latency test. Consider persisting the "tested" state at a higher level.

5. **Large monolithic files** — `singbox.rs` (1302 lines) and `NodeList.tsx` (515 lines) are too large. `singbox.rs` should be split into `proxy.rs`, `bootstrap.rs`, and `registry.rs`. `NodeList.tsx` should extract `NodeDetailPanel`, `ModeToggle`, etc.

6. **`is_elevated()` called multiple times per session** — `core_process.rs:25-50` calls PowerShell every time. The result should be cached at startup since elevation status doesn't change during a session.

### 💭 Nits

1. **Mixed Chinese/English in error messages** — `core_process.rs:169` contains `"æ²¡æœ‰æ‰¾åˆ°"` (UTF-8 encoded `没有找到`). This works but is fragile across encoding changes. Consider using only English error strings for backend, and translating in frontend.

2. **Inconsistent badge color patterns** — Some components use `text-amber-700 dark:text-yellow-400` while others use `text-amber-700 dark:text-amber-400`. Standardize to a consistent mapping.

3. **No TypeScript strict mode** — `tsconfig.json` should enable `strict: true` for better type safety.

---

## 8. Severity Escalation Rules

- A 🟡 suggestion that appears 3+ times in the codebase becomes a 🔴 blocker (systemic pattern)
- A 💭 nit that affects user-facing functionality becomes a 🟡 suggestion
- Security findings are always 🔴 regardless of likelihood
- Performance findings that affect TUN/connection reliability are 🟡 minimum

---

## 9. Metrics & Goals

| Metric | Current | Target |
|--------|---------|--------|
| TypeScript strict mode | Partial | Full `strict: true` |
| Clippy warnings on check | Unknown | 0 warnings |
| Dead code markers | 2+ `#[allow(dead_code)]` | 0 (or documented) |
| Max file length | 1302 lines (singbox.rs) | < 500 lines per file |
| UAC prompts (worst case) | 3 → 1 | 0 (self-elevation) |
| Light/dark theme coverage | ~90% | 100% |
| React StrictMode safety | 1 useRef guard | All effects guarded |

---

*Document version: 1.0 — July 2026*
*Based on review of commit `5979dcc` (UAC optimization)*
