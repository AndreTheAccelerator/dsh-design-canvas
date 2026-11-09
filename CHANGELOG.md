# Changelog

## 1.0.0 — 2026-11-09

First public version.

Host half (`index.js` + `host/`):

* Design document model persisted to `design-board.json` in the session workspace: artboards,
  `rect` / `ellipse` / `text` / `image` / `frame` layers, comments, atomic validated op engine
  with per-op error reporting and optional atomic rollback.
* Frames with CSS-like auto layout: `direction` (row/column), `gap`, per-side `padding`,
  `align`, `justify`, `wrap`, `clip`, plus `grow` / `alignSelf` on children; nesting to depth 5.
* Styling: any CSS paint (colors and gradients) for fills/backgrounds, `shadow`, `radius`,
  borders, opacity, text `letterSpacing` / `textTransform`.
* Store with atomic writes, version bumps, concurrent-writer serialization and outside-edit
  adoption; agent tools `design_read` and `design_apply`; system-prompt section; JSON API over
  the Host web server for the browser half.

Client half (`client.js`, single plain-JavaScript bundle):

* Right-sidebar canvas tab (guide card + composer-row button + auto-open once), artboards,
  layer tree, inspector, comments.
* Camera navigation: middle-mouse / space / background pan, ctrl-wheel and pinch zoom about the
  cursor, wheel scrolling, fit.
* Direct manipulation: select, drag, 8-handle resize, duplicate, nudge, undo/redo, reparenting
  into frames, drag-to-reorder inside auto-layout frames.
* Image input from file picker, drag-and-drop and clipboard.
* Inline element comments that become chat revision requests and resolve back into the board.
* Optimistic ops with 2-second version polling, error-boundary fallback and a self-diagnostic
  beacon channel.
