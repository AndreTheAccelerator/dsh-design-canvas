# Changelog

## 2.1.2 — 2026-11-20

* **Text alignment was dropped from every exported text layer.** `font-family` contains quotes
  (`"Segoe UI"`) and the HTML writer put it inside `style="..."` unescaped, so the browser ended the
  attribute at that quote and silently discarded every declaration after it — `text-align`,
  `line-height` and `white-space` all vanished. Centered button labels and the CTA heading then
  rendered left-aligned (a button "with too much space on the right"), and authored newlines were
  collapsed. Style attribute values are now HTML-escaped (`cssAttribute`); the `<style>` element
  intentionally keeps raw CSS, where entities would not be decoded.
  Test: a label whose font stack contains quotes still carries `text-align`, `white-space` and
  `line-height`.

## 2.1.1 — 2026-11-20

Export fidelity fixes found by exporting the Northwind mockup. All three were in the browser half
(`src/client/43-export-code.js`); the document model and the Host half are unchanged.

### SVG / PNG

* **Pill buttons rendered as ellipses.** The SVG writer emitted the authored `radius` verbatim, so a
  button authored with `radius: 999` became `<rect rx="999" ry="999">`. SVG clamps `rx` and `ry`
  independently, which yields rx = width/2 and ry = height/2 — an *ellipse*. CSS `border-radius`
  does the opposite: it scales every radius down uniformly, which is why the canvas showed a
  stadium. Radii are now clamped to half the short side (and the same clamp feeds the clip paths),
  so `116×38 → 19`, `148×44 → 22`, `178×48 → 24`: pills again, in SVG and in the PNG rasterised
  from it.
* **Labels split in the middle of a phrase.** `"Sign in"` in a 52 px box became two `<tspan>`s
  because wrapping used a fixed "0.52 em per character" estimate instead of real advances. The
  export now measures with a 2D canvas context (cached per font/text) and only breaks a line when
  the *measured* width overflows; the estimate remains as the fallback for a pure Node renderer.

### HTML

* **Sections went missing.** A frame with `layout: null` was always emitted as
  `position: absolute` — even when it was a **flex child** of an auto-layout parent. `layout: null`
  only says how that frame positions *its own* children. In the mockup the hero's art panel landed
  at `left: 0` on top of the hero copy, hiding the headline, subhead and both buttons behind the
  gradient panel. Flex children are now left in flow (the parent layout places them).
* **Inner content escaped its container.** With the panel back in flow it became `position: static`,
  which is not a containing block, so its absolutely-positioned children resolved against the
  artboard and drifted (the "Live board" card sat over the headline). A layout-less container now
  gets `position: relative` when it is in flow, so its children keep their authored offsets.

Tests: **13 client tests** (was 10) — a pill-radius case, a layout-less-flex-child case and a
measured-wrapping case (which uses a newly exported `setExportTextMeasurer` seam so the browser
path is covered in Node).

﻿# Changelog

## 2.1.0 — 2026-11-20

The editor-feedback release: everything here came from using the v2 canvas on real work. The
Host half is untouched (the model, the ops and the HTTP surface are still 2.0.0); this is the
browser half catching up with how the canvas is actually used.

### Interaction

* **Toasts instead of a banner.** Transient messages used to be an inline banner above the stage,
  so every refusal shifted the toolbar and the canvas down. They now float over the bottom of the
  panel (`role="status"`, auto-dismiss after ~5 s, hover pauses, close button) and the shell has
  no banner block left.
* **Deep select.** A double-click now selects the layer under the pointer even when it is buried
  in several frames/groups — one gesture instead of one per level. Double-clicking a container's
  own background descends to the child under the cursor, and the clicks that follow stay inside
  that scope.
* **Marquee from anywhere.** A left drag on the empty canvas draws a selection rectangle even
  when it starts outside every artboard, and it selects across artboards (each board gets its own
  union box). Space-drag and middle-drag still pan.
* **Selection chrome.** One strong blue (`#0d99ff`) union box around the whole selection with 8
  white/blue handles, plus thin outlines on each member. Stroke and handles stay a constant
  screen size at any zoom (they are computed in canvas units from the zoom), edges snap to device
  pixels, and a handle drag scales every member about the union box.
* **Multi-selection resize.** Handles used to belong to the primary layer only; they now scale
  the whole selection in artboard space and subtract each member's parent offset back out.

### Commands and chrome

* **Right-click context menu** for layers, artboards and the empty canvas: copy/cut/paste/
  duplicate/delete/rename, add comment, enter selection, group/ungroup, frame selection, arrange
  (front/forward/backward/back), lock, hide, copy as PNG/SVG, export. Inapplicable items are
  disabled with a reason, the menu flips when it would leave the panel, and arrows/Enter/Esc work.
* **Keyboard shortcuts.** A single registry feeds a searchable sheet (`?`, a toolbar button, or
  the command menu) and installs the bindings through `EXTENSIONS.keys`, so tool keys
  (`V R O T F L B I C`), `Ctrl/Cmd+0/1/2`, `+`/`=`/`-`, `Alt+1/2/3`, `Tab`/`Shift+Tab`,
  `Ctrl/Cmd+Enter`, `Ctrl/Cmd+Shift+L`, `Alt+Shift+H` and `Ctrl/Cmd+Shift+Backspace` never fight
  the editor's own keys. Bindings are gated on canvas focus or pointer position.
* **Artboards are deletable.** A trash button on the artboard row in the layers panel, `Delete`
  when only an artboard is selected, the context menu, and
  `Ctrl/Cmd+Shift+Backspace`. Undo restores the artboard and re-inserts its layers.

### Export

* **Objects, not only artboards.** `renderExport` and the export dialog accept a selection and
  re-root it into a synthetic document sized to the selection's bounding box, so HTML, React, SVG,
  PNG and JSON all export just the selected layers at their rendered positions (auto-layout
  children included). `copySelectionAs()` puts SVG/PNG/HTML/React/JSON on the clipboard for the
  context menu, and the dialog names the file after the selection.
* Client tests: **10** (was 9), adding a selection-export case that pins the union box, the
  re-based layer offsets and the empty-selection fallback.

### Structure

* The browser half grows from 24 to **27 parts**: `46-context-menu.js`, `47-shortcuts.js` and
  `48-toast.js`, all built on the v2 extension registries
  (`registerAppPanel`/`registerToolbar`/`registerKeyHandler`/`registerCommand`), so none of them
  needs a shell edit.
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
