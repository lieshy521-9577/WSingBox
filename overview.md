# SingBox Client UI Redesign — Overview

## What was done

Created a complete UI redesign package for the SingBox desktop proxy client based on the provided screenshot and workspace structure.

### Deliverables

1. **`design-system.md`** — Full design tokens and component specifications.
   - Color palette for light/dark themes with WCAG AA contrast targets.
   - Typography, spacing, radius, shadow, and motion tokens.
   - Component library covering app shell, navigation, buttons, cards, status pills, node rows, log rows, switches, inputs, and empty states.
   - Responsive breakpoints and accessibility requirements.

2. **`prototype.html`** — Self-contained interactive five-screen prototype.
   - **Overview**: runtime status, snapshot tiles, active rules, recent activity.
   - **Nodes**: outbound groups, selectable node cards with latency/flag/state.
   - **Logs**: filter chips, search, color-coded log stream, pause/copy/clear.
   - **Settings**: segmented tabs (Inbound / Rule Sets / TUN / DNS), switch rows, inputs.
   - **About**: brand card, version, diagnostics key-value list.
   - Interactive navigation (sidebar + mobile bottom rail), theme toggle, connection switch, node selection, log filtering, settings tabs.

3. **`overview.md`** — This summary document.

## Key design decisions

- **Kept the dark-first, desktop-native aesthetic** from the original screenshot while tightening spacing, typography, and hierarchy.
- **Unified status language**: a single green/red/amber/blue semantic palette runs through session pills, control bar, node latency, and log levels.
- **Improved scanability**: snapshot tiles replace dense header metadata; node rows use radio-selection and clear latency badges.
- **Accessible by default**: 44px minimum touch targets, visible focus indicators, `prefers-reduced-motion` support, and color-always-paired-with-text/icon.
- **Responsive**: sidebar collapses to a bottom navigation rail below 760px; grids adapt from 4 → 2 → 1 columns.

## Notes and follow-up

- `index.html` was intentionally **not** overwritten because it is the Vite entry point for the existing React + Tauri app. The prototype lives in `prototype.html` and can be opened directly in any browser.
- Recent implementation fixes applied to `src/`:
  1. **Light mode contrast** — darkened `--text-secondary` / `--text-muted` tokens; replaced ambiguous `text-primary`/`text-secondary`/`text-muted` classes with semantic `text-content`/`text-content-secondary`/`text-content-muted` in Sidebar, TitleBar, AboutPanel, App empty state.
  2. **Missing surface classes** — added `.panel-card`, `.subtle-row`, `.mode-toggle` / `.mode-toggle-button` definitions in `global.css` so panels, rows, and the latency mode control render correctly in light mode.
  3. **LogViewer theme-aware** — removed hardcoded `bg-slate-950`/`text-slate-300` terminal colors; now uses semantic surface/content tokens with dark variants.
  4. **Overview live route** — `ConfigOverviewPanel` now receives `runtimeDebug` and displays the actual `active_leaf_outbound` as "Live route" when sing-box is running, avoiding the mismatch where the route showed a newly selected profile while the runtime was still on the old node.
  5. **Profile export/refresh feedback** — wired the existing Toast system into the UI; added success/error toasts for copy-subscription-URL, copy-profile-JSON, and refresh-from-URL actions; added a Refresh button for URL profiles in the sidebar dropdown.
  6. **Node latency duplicate test** — fixed `NodeList` auto-test running twice under React StrictMode by guarding with `useRef`.

## Files created

- `C:\_dCode\SingBox\design-system.md`
- `C:\_dCode\SingBox\prototype.html`
- `C:\_dCode\SingBox\overview.md`
