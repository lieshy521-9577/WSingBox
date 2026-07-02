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
- Next steps to fully implement the design:
  1. Map the tokens in `design-system.md` to the existing Tailwind config (`tailwind.config.js`) and CSS variables (`src/styles/global.css`).
  2. Refactor `src/components/Sidebar.tsx`, `ProxyControl.tsx`, `ConfigOverviewPanel.tsx`, `NodeList.tsx`, `LogViewer.tsx`, `SettingsPanel.tsx`, and `AboutPanel.tsx` to match the prototype layout and component specs.
  3. Add mobile bottom navigation component and wire it to the existing page state in `App.tsx`.
  4. Run a contrast/keyboard audit against the implemented components.

## Files created

- `C:\_dCode\SingBox\design-system.md`
- `C:\_dCode\SingBox\prototype.html`
- `C:\_dCode\SingBox\overview.md`
