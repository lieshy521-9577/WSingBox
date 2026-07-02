# SingBox Client — UI Design System

## 🎨 Design Foundations

### Design Philosophy
A calm, technical interface for a network proxy client. The visual language prioritizes:
- **Clarity first**: every status, metric, and action is readable at a glance.
- **Confidence through restraint**: muted surfaces, one accent family (blue), and semantic color used sparingly.
- **Desktop-native feel**: rounded panels, subtle depth, and a layout that respects window resizing and reduced-motion preferences.

### Color System

#### Primary Palette
| Token | Hex | Usage |
|-------|-----|-------|
| `primary-50` | `#eff6ff` | Hover tint, light badges |
| `primary-100` | `#dbeafe` | Active backgrounds, selection tint |
| `primary-400` | `#60a5fa` | Dark-mode emphasis |
| `primary-500` | `#3b82f6` | Primary accent, active states |
| `primary-600` | `#2563eb` | Buttons, links |
| `primary-700` | `#1d4ed8` | Hover buttons |

#### Neutral Palette (Light)
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-base` | `#eff4fa` | App canvas |
| `bg-surface` | `#ffffff` | Cards, panels |
| `bg-elevated` | `#f7fafd` | Inputs, hovered rows |
| `bg-muted` | `#edf2f8` | Secondary surfaces |
| `border` | `#c2cedd` | Dividers, borders |
| `text-primary` | `#0f172a` | Headings, body |
| `text-secondary` | `#445772` | Labels, metadata |
| `text-muted` | `#7286a0` | Placeholder, disabled |

#### Neutral Palette (Dark)
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-base` | `#0b1220` | App canvas |
| `bg-surface` | `#111827` | Cards, panels |
| `bg-elevated` | `#182233` | Inputs, hovered rows |
| `bg-muted` | `#1e293b` | Secondary surfaces |
| `border` | `#1e293b` | Dividers, borders |
| `text-primary` | `#f8fafc` | Headings, body |
| `text-secondary` | `#cbd5e1` | Labels, metadata |
| `text-muted` | `#94a3b8` | Placeholder, disabled |

#### Semantic Colors
| State | Light | Dark | Usage |
|-------|-------|------|-------|
| Success | `#10b981` | `#34d399` | Connected, healthy, live |
| Warning | `#f59e0b` | `#fbbf24` | Switching, stale, attention |
| Error | `#ef4444` | `#f87171` | Failed, disconnected, error logs |
| Info | `#3b82f6` | `#60a5fa` | Starting, neutral status |

#### Accessibility
- All normal text meets WCAG AA 4.5:1 contrast.
- Large text and status dots meet 3:1 minimum.
- Color is never the sole indicator of state; icons, labels, and text accompany every semantic color.

### Typography System
- **Primary font**: `"Aptos", "Segoe UI Variable", "Segoe UI", "SF Pro Display", system-ui, sans-serif`
- **Monospace**: `"JetBrains Mono", "Fira Code", "Cascadia Code", monospace` for logs, paths, JSON

#### Type Scale
| Token | Size | Line Height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `display` | 1.5rem / 24px | 1.2 | 700 | Page titles |
| `title` | 1.125rem / 18px | 1.35 | 600 | Card titles, group names |
| `body` | 0.875rem / 14px | 1.5 | 400 | Body text, descriptions |
| `label` | 0.75rem / 12px | 1.4 | 600 | Section labels, badges |
| `caption` | 0.6875rem / 11px | 1.4 | 500 | Timestamps, metadata |
| `mono` | 0.8125rem / 13px | 1.5 | 400 | Logs, paths, JSON |

### Spacing System
Base unit: **4px**

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight inline gaps |
| `space-2` | 8px | Icon gaps, small padding |
| `space-3` | 12px | Card internal padding |
| `space-4` | 16px | Section gaps |
| `space-5` | 20px | Card padding |
| `space-6` | 24px | Page padding |
| `space-8` | 32px | Major section separation |
| `space-10` | 40px | Layout gutters |

### Radius System
| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 8px | Buttons, chips, small inputs |
| `radius-md` | 12px | Cards, lists, rows |
| `radius-lg` | 16px | Panels, modals |
| `radius-xl` | 22px | App shell, sidebar |

### Shadow & Elevation System
| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgb(15 23 42 / 0.04)` | Subtle borders replacement |
| `shadow-md` | `0 4px 12px rgb(15 23 42 / 0.06)` | Cards, dropdowns |
| `shadow-lg` | `0 12px 32px rgb(15 23 42 / 0.08)` | Modals, popovers |
| `glow-primary` | `0 0 20px rgb(59 130 246 / 0.18)` | Active connection |

### Motion
| Token | Value | Usage |
|-------|-------|-------|
| `transition-fast` | 120ms ease | Hover, focus |
| `transition-normal` | 200ms ease | Page transitions, toggles |
| `transition-slow` | 300ms ease | Modals, panels |

All motion respects `prefers-reduced-motion`.

---

## 🧱 Component Library

### App Shell
- **Layout**: fixed padding around a rounded glass panel, with a custom title bar at the top.
- **Sidebar**: 220–260px responsive width, contains session, navigation, and saved profiles.
- **Workspace**: rounded panel to the right of the sidebar; holds the control bar and page content.
- **Responsive**: below 860px width the sidebar collapses to a bottom navigation rail.

### Navigation
**Sidebar nav item**
- Height: 44px minimum touch target.
- Layout: 36px icon container + label.
- Active state: primary-100 background, primary-600 text, 1px primary-200 inner border.
- Inactive state: transparent, text-secondary, hover elevates to surface-elevated.

**Bottom nav rail (mobile)**
- Fixed 64px height at viewport bottom.
- 5 evenly spaced items with icon + label.
- Active item uses primary-600 icon and label.

### Status & Feedback
**Status pill**
- Height: 24px, rounded-full.
- Contains leading 6px dot + label.
- Variants: `success`, `warning`, `error`, `info`, `neutral`.

**Status chip**
- Height: 20px, rounded-full.
- Used for counters and compact metadata.
- Primary variant uses primary-100 background and primary-700 text.

**Toast / Inline alert**
- 12px radius, left 3px accent border.
- Icon + message + optional action.

### Buttons
**Primary button**
- Height: 36px, padding 16px horizontal, radius 10px.
- Background: primary-600 gradient, white text.
- Hover: primary-700, translateY(-1px), shadow-md.
- Focus: 2px primary-400 outline offset 2px.

**Secondary button**
- Height: 36px, padding 14px horizontal, radius 10px.
- Background: surface, border 1px border, text-secondary.
- Hover: elevated background, text-primary.

**Icon button**
- 32px × 32px, radius 8px.
- Hover: muted background.

### Cards
**Panel card**
- Radius 16px, border 1px border-muted.
- Background: surface with subtle top highlight.
- Shadow: shadow-md.
- Hover: shadow-lg + translateY(-1px) only when interactive.

**Snapshot tile**
- Compact metric tile inside overview.
- Layout: icon (24px) + label + value.
- Background: subtle tint based on semantic meaning.

### Data Display
**Node card**
- Horizontal row: radio indicator + flag/avatar + name + protocol + latency + menu.
- Selected state: primary-600 border, primary-50 background, checkmark indicator.
- Failed state: error border, error text, error dot.

**Outbound group header**
- Accordion-style row with chevron, group name, selected node, member count, best latency.
- Expanded body shows node list with vertical radio-group semantics.

**Rule item**
- Two-line row: rule type + payload on first line, action/outbound on second.
- Hover reveals edit action.

**Log row**
- Monospace text, left border color by level (info/success/warn/error).
- Hover shifts 2px right and highlights background.
- Timestamp muted, message content primary.

### Forms
**Text input**
- Height: 40px, radius 10px.
- Border: 1px border, background elevated.
- Focus: primary-500 border + 3px primary-100 ring.

**Switch**
- 44px × 24px track, 20px thumb.
- Checked: primary-600 track, white thumb with shadow.
- Focus: 2px primary-400 outline.

**Select / Dropdown**
- Same sizing as input.
- Chevron icon on right.

### Empty States
- Centered illustration + title + description + primary CTA.
- Used when no config is loaded or no logs exist.

---

## 📱 Responsive Design

### Breakpoints
| Name | Range | Behavior |
|------|-------|----------|
| Mobile | < 640px | Bottom nav rail, single-column stack |
| Tablet | 640–1023px | Collapsed sidebar icon rail or bottom nav |
| Desktop | 1024–1439px | Full sidebar, multi-column grids |
| Large desktop | ≥ 1440px | Wider gutters, 5-column insight grid |

### Layout Patterns
- **Overview**: 4-column tile grid on desktop, 2 on tablet, 1 on mobile.
- **Nodes**: single scrollable list; group cards span full width.
- **Logs**: full-width log stream; filter chips wrap on mobile.
- **Settings**: 2-column layout on desktop; single column on mobile.
- **About**: centered brand card with diagnostic list below.

---

## ♿ Accessibility Standards

### WCAG AA Compliance
- Normal text contrast ≥ 4.5:1.
- Large text and UI components ≥ 3:1.
- Focus indicators are always visible and use primary-400.

### Keyboard Navigation
- All nav items, buttons, and node cards are focusable.
- `Tab` moves linearly; `Enter` activates.
- Modal focus is trapped while open.

### Screen Reader Support
- Navigation uses `<nav>` with `aria-current="page"`.
- Node cards use `role="radio"` and `aria-checked`.
- Log levels use `aria-label`.
- Status pills expose state text, not color alone.

### Inclusive Design
- Minimum interactive target: 44 × 44px.
- Reduced motion disables page entrance and hover transforms.
- Colorblind-safe status dots use icons plus text.

---

## 🛠️ New Components Added for This Redesign

1. **Snapshot tile** — runtime summary metrics (routing targets, inbounds, DNS, node groups).
2. **Rule item** — compact route-rule preview row with edit affordance.
3. **Log stream** — color-coded, filterable, monospace log viewer.
4. **Filter chip** — toggleable log level / category filters.
5. **Preference card** — grouped settings with header and description.
6. **Settings tab** — segmented control for settings sections.
7. **Switch row** — label + description + switch in one accessible row.
8. **Diagnostic key-value list** — About page paths and versions.
9. **Mobile bottom navigation** — 5-item rail for narrow viewports.

---

**UI Designer**: UI Designer
**Design System Date**: 2026-07-02
**Implementation**: Ready for developer handoff
**QA Process**: Design review + accessibility audit checklist
