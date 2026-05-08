# AIC Website Design System

## Visual Direction

Mountain Study Console is a restrained product interface inspired by a Wears Valley cabin study overlooking the Smoky Mountains at sunrise. The design should be striking because it is specific, quiet, and well-composed, not because it uses heavy decoration.

Physical scene: an owner sits at a wooden desk before morning work, with soft mountain light, paper notes, podcast sources, and sermon research open on a large monitor.

Use product patterns first: top rail, sidebar sections, tabs, filters, tables, source drawers, transcript panes, command-style search, clear empty states, and explicit error states.

## Imagery

Use original generated or commissioned imagery inspired by Wears Valley, Tennessee, Smoky Mountain ridges, cabin porches, rural roads, pasture fences, and small mountain churches.

Imagery should act as orientation and atmosphere, not marketing decoration. It may appear as narrow mastheads, route context strips, source placeholders, public episode art, or quiet empty-state panels.

Avoid stock-photo darkness, fantasy lighting, posed people, logos, readable signage, heavy bokeh, oversaturation, and images that obscure the product task.

## Color Tokens

Use OKLCH values. Keep the interface light and morning-toned, with enough contrast for long research sessions.

- `--mineral-mist`: `oklch(92% 0.015 215)`, cool gray page canvas.
- `--mineral-mist-2`: `oklch(86% 0.018 210)`, rail and divider surfaces.
- `--parchment`: `oklch(96% 0.026 87)`, main reading and writing surface.
- `--parchment-deep`: `oklch(90% 0.036 82)`, quiet elevated surface.
- `--cypress`: `oklch(34% 0.07 156)`, primary accent and selected state.
- `--cypress-soft`: `oklch(56% 0.055 156)`, secondary accent and icons.
- `--clay`: `oklch(58% 0.09 54)`, warning and needs-review state.
- `--ochre`: `oklch(70% 0.09 78)`, pending and processing state.
- `--soft-ink`: `oklch(24% 0.025 235)`, primary text.
- `--soft-ink-muted`: `oklch(44% 0.025 230)`, secondary text.
- `--line`: `oklch(78% 0.018 98)`, borders.
- `--error`: `oklch(49% 0.12 28)`, failure state.
- `--success`: `oklch(45% 0.08 150)`, complete state.

Do not use pure black, pure white, purple/blue SaaS gradients, or full-saturation inactive states.

## Typography

Use a system UI stack for product clarity: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.

Scale:

- Page title: 2rem, 700 weight, tight but readable.
- Section title: 1.25rem, 650 weight.
- Panel title: 1rem, 650 weight.
- Body: 0.95rem, 400 weight.
- Small UI text: 0.82rem, 500 weight.
- Data labels: 0.78rem, 650 weight, letter spacing 0.

Body prose should stay under 75 characters where possible. Dense tables may run wider.

## Spacing And Shape

Use an 8px rhythm: 4, 8, 12, 16, 24, 32, 48.

Radii:

- Buttons and fields: 6px.
- Repeated item cards and route panels: 8px maximum.
- Large shell sections: 0 to 8px, never pill-shaped.

Borders should be thin and visible. Avoid nested cards. Use full-width bands, side rails, split panes, and bordered rows before reaching for repeated card grids.

## Navigation Model

Private console: top rail with primary destinations, plus a compact context strip per route. Primary labels are Overview, Archive, Sources, Compose, Signals, Pipeline.

Public site: simple signed-out shell with Home and Episodes first. Public pages should feel related to the private console but less dense.

Mobile: collapse navigation into horizontally scrollable top tabs and stack source/detail panes below the active workspace.

## Component States

Every interactive control needs clear default, hover, focus, active, disabled, loading, empty, and error states. Focus states should be visible through outline and not depend on color alone.

Use skeleton rows for future data loading. Use quiet empty states that explain what is missing and what will appear there.

Warnings use clay or ochre with text labels. Estimates must be explicitly labeled.

## Data Visualization Rules

Use real metrics only. Do not invent totals, trends, chart points, or fake comparisons.

Prefer compact line charts, ranked tables, timeline rows, and annotated status bands. Avoid repeated metric-card grids as the dominant layout.

Episode-by-country values are not exact in the current import. Omit them or label them as estimates until a true cross-tab exists.

## RAG And Provenance Rules

RAG and content surfaces must show retrieval lanes, source episodes, transcript timestamps, speaker labels when available, and tool usage. Sources should be expandable without leaving the task.

The answer area should never hide source uncertainty. If generation is pending or mocked, label it clearly.

## Accessibility And Responsiveness

Maintain readable contrast on parchment and mineral surfaces. Controls must be keyboard reachable, visible on focus, and large enough to tap on mobile.

Desktop optimizes for split-pane research. Tablet keeps navigation visible and lets source panels stack. Mobile preserves the same route order with compact tabs, single-column content, and no text overlap.
