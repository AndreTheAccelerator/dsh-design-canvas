# Changelog

## 2.0.0 — 2026-11-20

The "make it a design tool" release: multi-selection, groups, lines, a real layout vocabulary,
an export pipeline, batch comments, resizable panels and a visual redesign. The document model
stays backward compatible — a 1.0 board loads, normalizes and renders unchanged.

### Host half (`index.js` + `host/`)

* New layer type **`line`**: `stroke`, `strokeWidth` (0.5–64), `orientation`
  (`horizontal`/`vertical`/`diagonal`), `dashed`, `arrowStart`/`arrowEnd`.
* New layer type **`group`**: an absolute container with `children` and `clip`, created from a
  selection and dissolved again. Frames and groups are now "containers" everywhere (lookup, ids,
  depth, comments, summary, moves).
* New common props on every layer: **`locked`**, **`minWidth`/`minHeight`/`maxWidth`/`maxHeight`**,
  **`hugWidth`/`hugHeight`** (size to content). Booleans and bounds clear back to "absent".
* Layout vocabulary: `justify` gains **`space-around`** / **`space-evenly`**, new
  **`alignContent`** for wrapped runs, and **`rowGap`/`columnGap`** overriding `gap` per axis.
* New ops: **`board.update`** (rename the design), **`layer.duplicate`**, **`layer.group`**,
  **`layer.ungroup`**, **`artboard.duplicate`**, **`comment.batch_update`**.
* `normalizeDoc` repairs containers/`line`/absent props; `summarizeDoc` shows groups, lock, hug,
  min/max, line props, `ac=`/`rgap=`/`cgap=`; agent tool descriptions teach the new vocabulary.
* Tests: **25 model tests** (was 8), including a 200-op fuzz loop asserting id uniqueness,
  `normalizeDoc` idempotence and lossless-JSON results.

### Client half (`client.js`, generated from `src/client/`)

* **Crisp vector zoom.** The camera now applies CSS `zoom` instead of `transform: scale()`, so
  text, borders and strokes are rasterised at their final size at every zoom step. Measured
  sharpness on a text band at 400 %: 2.54 → 9.44 (mean |laplacian|).
* **Multi-selection.** Shift/Ctrl/Cmd-click toggles, marquee drags on the artboard background,
  select-all, drill into containers (Enter) and step back out (Esc), N-layer outlines with
  handles on the primary layer only. Every mutation applies to the whole selection in one undo
  step.
* **Groups.** Group a selection (`Ctrl/Cmd+G`), ungroup (`Ctrl/Cmd+Shift+G`), click a child to
  select the group, double-click to drill in.
* **Direct manipulation extras.** Alt-drag duplicate, snapping to sibling edges/centres and to
  the artboard with on-canvas guides (Alt disables), arrow-key nudge for the whole selection,
  locking that blocks drag/resize/delete, copy/cut/paste of layer subtrees.
* **Alignment and arranging.** Align (6), distribute (2), tidy into a row/column, arrange
  front/forward/backward/back, all exposed as a contextual selection bar with icon buttons and
  keyboard shortcuts (`Ctrl/Cmd+Shift+arrows`, `Ctrl/Cmd+]`/`[`).
* **Layout v2 in the renderer.** `space-around`/`space-evenly`, `alignContent`, per-axis gaps,
  `min`/`max` clamping, hug sizing (text measured with canvas metrics), groups, lines with
  arrowheads/dashes, and a locked-layer affordance.
* **Resizable, collapsible panels** with persisted widths, plus a narrow layout that turns the
  layer and inspector panels into overlay drawers below 640 px so the canvas keeps the full
  sidebar width (243 px → 458 px on a 460 px sidebar).
* **Renaming.** Project/design name inline in the header (renames the sidebar tab too), artboards
  and layers via double-click in the tree or the inspector field.
* **Export** (`Export` toolbar button, `Ctrl/Cmd+Shift+E`, header menu): standalone **HTML+CSS**
  (auto-layout frames become real flexbox), **React** JSX component, **SVG** (pixel-true vector,
  gradients translated to SVG defs), **PNG** (1×–4×, rasterised from the vector output) and a
  **JSON** snapshot. The dialog previews the output, explains each format and offers copy/download.
* **Batch comments.** A Comments panel (toolbar button, `Alt+C`) with filters, search and
  multi-select; "Send N comments to agent" produces **one** chat message listing every comment
  with ids, geometry and props, plus a composer that can save a comment without pinging the agent.
* **Toolbar and header redesign**: single-row toolbar (no wrap), Line and Button preset tools,
  overflow menu with shortcuts sheet, artboard presets (desktop/tablet/mobile/square), zoom group
  with Fit (`Shift+1`) and Fit selection (`Shift+2`), status dot, accessible focus rings.
* **Client bundle test suite** that loads the generated bundle in Node with a React stub — a
  broken part or a load-order mistake fails `npm test` instead of the browser.
* Editor state, layout engine, renderer, panels and comment/export flows are now authored as
  ordered parts in `src/client/` joined by `npm run build` (CI verifies the artifact is current).

### Developer experience

* `npm run dev` serves a zero-dependency **preview harness** (`dev/`) that renders the real
  bundle against the real document model with scenario documents, theme tokens, live-part bundling
  and a `window.__harness` scripting surface.
* `npm test` runs the model suite and the client bundle suite; `npm run check` adds build-freshness
  and syntax checks.

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
