# Design canvas (plugin)

**Repository:** <https://github.com/AndreTheAccelerator/dsh-design-canvas>

A **chat-paired design canvas** for the DeepSeek Harness Web UI: a right-sidebar board with
artboards, multi-selection and groups, lines, CSS-like auto-layout frames, deep-linkable inline
element comments (single or batch), export to code/SVG/PNG, and Figma-style direct manipulation
that the agent can revise with tools.

This repository *is* the plugin package: `package.json` declares the Harness bundle plus its
browser half (`dsh.client`), the Host half lives in `index.js` + `host/`, and the browser half is
authored in `src/client/` and concatenated into the single shipped artifact `client.js` by
`npm run build` (no runtime build step, no npm dependency; CI verifies the artifact is current).

## Requirements

* DeepSeek Harness with the Web UI (the right-sidebar client packages). Developed and verified
  against DSH `0.2.2-rc.1`.
* Node.js 20+ for the Host half and the tests.

## Install from source

1. `git clone https://github.com/AndreTheAccelerator/dsh-design-canvas.git` (or download and
   unpack the folder).
2. Install it into your Harness profile as a local bundle. From a Harness session, ask the agent to
   **install the bundle at** `<absolute path to this folder>`, or call the `plugin_manager` tool
   yourself with `action: "install_bundle"` and that path as `target`.
3. The bundle is enabled immediately (linked installation). If the browser half does not appear,
   restart the `include:design-canvas` plugin row (or the Harness app) and reload the page.
4. Open the canvas from the composer-row design button or the right-sidebar guide card.

To remove it: `plugin_manager` → `remove_bundle` with `target: "@andretaccelerator/dsh-design-canvas"`.

## Repository layout

| Path | Purpose |
|---|---|
| `index.js` | Host plugin entry: config defaults, store + route + tool wiring |
| `host/model.js` | Pure document model: starter doc, ops engine, validation, normalization, summary |
| `host/store.js` | Per-session document store: atomic writes, versioning, outside-edit adoption |
| `host/routes.js` | `/design-canvas` HTTP surface used by the browser half |
| `host/tools.js` | Agent tools `design_read` / `design_apply` + system-prompt section |
| `src/client/*.js` | **The browser half, authored as 24 ordered parts** (state machine, layout engine, renderer, tree, inspector, comments, export, chrome) |
| `client.js` | **Generated**: `npm run build` concatenates the parts into the one artifact the Harness loads |
| `scripts/build-client.mjs` | The build (and `--check` gate used by CI) |
| `dev/` | Preview harness: `npm run dev` renders the real bundle against the real model in Chrome |
| `cordis.patch.yml`, `package.json` | Bundle manifest / Loader patch |
| `locale/`, `icon.svg` | Display metadata for Plugin Manager |
| `tests/model.test.mjs` | Node test suite for the document model (25 tests) |
| `tests/client.test.mjs` | Loads the generated bundle in Node and tests the pure helpers (9 tests) |
| `CONTRACT.md` | Internal design contract (model, ops, API, part ownership, extension registries) |
| `examples/starter-board.json` | A generated starter board you can paste into a workspace |

## Open it

Three ways, all landing in the same right-sidebar tab:

1. **Automatically once** — after the page loads, the tab is opened one time per browser tab
   (guarded with `sessionStorage`), so the canvas is visible without hunting for it.
2. **Composer button** — the 24×24 design glyph at the left of the composer tool row.
3. **Right-sidebar guide** — expand the right sidebar and pick the **Design canvas** card.

The tab title follows the design name (rename the project in the header and the panel renames
with it).

## Canvas navigation and shortcuts

| Gesture | Action |
|---|---|
| Middle-mouse drag · Space + drag · drag empty background | Pan the canvas |
| Ctrl/Cmd + wheel · trackpad pinch | Zoom about the cursor (10 %–400 %) |
| Wheel · Shift + wheel | Scroll the canvas vertically / horizontally |
| Header zoom −, %, + · `Shift+1` · `Shift+2` | Zoom out / fit artboards / zoom in · Fit · Fit selection |
﻿| Click layer · Shift/Ctrl/Cmd + click · drag empty background | Select · add/remove from selection · marquee select (it may start outside the artboards and select across them) |
| Double-click a nested layer | Deep select: reach the layer under the pointer through any number of frames/groups |
| Enter · Escape (with a selection) | Drill into a frame/group · step out, then clear |
| Right-click a layer, artboard or the empty canvas | Context menu (copy/paste/duplicate/delete/rename, comment, group, arrange, lock, hide, copy as PNG/SVG, export) |
| Drag / 8 handles | Move / resize the whole selection (auto-layout children reorder instead) |
| Alt + drag | Duplicate while dragging (Alt also disables snapping) |
| Arrow keys · Shift + arrows | Nudge 1 px / 10 px (batched, whole selection) |
| Ctrl/Cmd + A · C · X · V · D | Select all · copy · cut · paste (into the selected container) · duplicate |
| Ctrl/Cmd + G · Ctrl/Cmd + Shift + G | Group selection · ungroup |
| Ctrl/Cmd + ] / [ · + Shift | Bring forward / send backward · to front / to back |
| Ctrl/Cmd + Shift + arrows · Ctrl/Cmd + Shift + H / V | Align selection · distribute horizontally / vertically |
| Delete / Backspace · Ctrl/Cmd + Shift + Backspace | Delete the selection (or the artboard when only it is selected) · delete the artboard |
| Ctrl/Cmd + Z · Ctrl/Cmd + Shift + Z or Ctrl + Y | Undo / redo (last 50 edits, comments excluded) |
| `V` `R` `O` `T` `F` `L` `B` `I` `C` | Select · rectangle · ellipse · text · frame · line · button · image · comment mode |
| `Ctrl/Cmd + 0` / `1` / `2` · `+` `=` `-` | Zoom 100 % · fit artboards · fit selection · zoom in/out |
| `Alt+1` / `Alt+2` / `Alt+3` · `Alt+C` · `Ctrl/Cmd + Shift + E` | Layers panel · inspector · export dialog · comments panel · export dialog |
| `Tab` / `Shift+Tab` · `Ctrl/Cmd + Enter` | Next / previous sibling · select parent |
| `Ctrl/Cmd + Shift + L` · `Alt+Shift + H` | Lock / unlock the selection · hide / show it |
| `?` | Keyboard shortcuts sheet (searchable; also in the toolbar and the command menu) |
| Double-click a tree row or artboard name | Rename that layer / artboard inline |

## Layers, frames, groups and auto layout

Layers live on artboards (vertically stacked, arbitrary placement) and may be nested inside
`frame` or `group` layers, back-to-front array order = z-order.

* Types: `rect`, `ellipse`, `text`, `image`, `line`, `group`, **`frame`** (container).
* `line` draws a straight stroke in its own box: `stroke`, `strokeWidth` (0.5–64), `orientation`
  (`horizontal`/`vertical`/`diagonal`), `dashed`, `arrowStart`/`arrowEnd` — crisp at any zoom.
* `group` is an absolute container (no layout, no fill): children keep authored `x`/`y`,
  `clip` optional, `opacity` applies to the subtree. Create one from a selection with
  `Ctrl/Cmd+G` (or the selection bar) and dissolve it with `Ctrl/Cmd+Shift+G`.
* A frame with `layout: null` positions its children absolutely (their authored x/y relative to
  the frame). A frame with a `layout` object behaves like CSS flexbox:
  `direction` row/column, `gap` (plus `rowGap`/`columnGap` overrides), per-side `padding`,
  `align` (cross axis start/center/end/stretch), `justify` (main axis start/center/end/
  space-between/**space-around**/**space-evenly**), `wrap`, **`alignContent`** for wrapped runs,
  plus `clip`.
* Any layer accepts `grow` (flex-grow: 1 inside an auto-layout parent), `alignSelf`,
  **`minWidth`/`minHeight`/`maxWidth`/`maxHeight`** clamps and **`hugWidth`/`hugHeight`**
  (size to content: text hugs its glyphs, containers hug children + padding).
* Any layer can be **locked** (`locked: true`): the canvas refuses drag/resize/delete of it while
  remaining selectable, and the inspector can unlock it.
* Containers nest up to depth 5 (200 children each); ids are globally unique.
* Layer tree (left panel) shows the hierarchy with indentation, collapse chevrons, per-row lock
  and visibility toggles, a filter box, inline rename, drag reordering and drag-into-container.
* Frame inspector edits direction/gap/gaps overrides/padding/align/justify/wrap/alignContent/clip
  and enables/disables auto layout; every change is one `layer.update` with a complete layout
  object.

## Multi-selection, alignment and grouping

Selection is a set: Shift/Ctrl/Cmd-click toggles layers, dragging on the artboard background
draws a marquee, `Ctrl/Cmd+A` selects the top-level layers. Every edit — drag, resize, nudge,
delete, duplicate, lock, z-order, inspector field — applies to the whole selection as one undo
step, and the inspector shows a shared multi-edit view (mixed values render blank until you type).
A contextual selection bar offers align (6), distribute (2), tidy into a row/column, arrange,
group/ungroup and a lock toggle.

## Styling

* `fill` / artboard `background`: any CSS color **or gradient**
  (`linear-gradient(135deg,#2563eb,#1d4ed8)`, `radial-gradient(...)`).
* `shadow`: any CSS box-shadow string (`0 10px 24px rgba(37,99,235,.28)`), clearable.
* `radius`, `borderWidth`, `borderColor`, `opacity`, `visible`; text layers also
  `fontSize`, `fontWeight` (400/500/600/700), `fontFamily`, `align`, `lineHeight` (px),
  `letterSpacing` (px), `textTransform`, and `hugHeight` for auto height.
* `line` layers use `stroke`/`strokeWidth`/`orientation`/`dashed`/arrows instead of a fill.
* Inspector commits each control as one op (one undo step, whole selection for multi-edit); the
  Host validates and returns per-op errors inline.

### Rendering quality

The camera applies CSS `zoom` rather than a CSS `transform: scale()`, so glyphs, borders and
radii are laid out and rasterised at their final size: text stays crisp at 400 %, and the overlay
chrome (selection outline, handles, pins, artboard labels) is counter-scaled to a constant screen
size. `line` layers render as inline SVG with authored stroke widths.

## Inline element comments → chat revisions

Select an element, press `c` (or the Comment action), write the request, Send. The canvas:

1. stores the comment on the board (`comment.add`, numbered pin on the element, thread panel with
   filter chips, Resolve/Reopen/Delete, jump-to-layer and a hover highlight), and
2. posts a real chat message: a *"Design canvas revision request — apply it now"* block with the
   board path/version, artboard size, target layer id/type/geometry/current props, the comment id
   and text, and a 4-step instruction (skip `design_read` when possible, apply the minimal ops,
   resolve the comment, reply in one sentence).

The agent then uses the tools below; the canvas adopts the new version on its next poll and shows
the "AI revising" state while the version moves.

### Batch comments

The **Comments** panel (`Alt+C`, toolbar button with an open-count badge) lists every comment in
the document grouped by artboard and layer, with filters (All / Open / Resolved / Sent / Unsent),
search, per-row actions and select-all. **"Send N comments to agent"** posts **one** message that
walks through every selected comment in order (ids, artboard, layer type/geometry/props, text) and
tells the model to resolve each one — so a review pass of ten notes is one chat turn instead of
ten. Comments stay `open` until the agent resolves them. The composer can also **save only**
(store the comment without pinging the agent).

## Export

The **Export** button in the toolbar (or `Ctrl/Cmd+Shift+E`, or the header overflow menu) opens a
dialog that previews the generated output before you copy or download it:

| Format | Output |
|---|---|
| **HTML + CSS** | One standalone `.html` file with an inline stylesheet. Auto-layout frames become real flexbox, so the markup is editable rather than a coordinate dump. |
| **React** | A `export default function Artboard()` JSX component with inline style objects — no CSS file needed. |
| **SVG** | Pixel-true vector output built from the rendered geometry: shapes, gradients (translated to SVG `<linearGradient>`/`<radialGradient>`), text, lines, clipped containers, images. |
| **PNG** | Raster of the artboard at 1×–4×, rendered from the vector export so text stays sharp. |
| **JSON** | The document model for that artboard — exactly what `design_read` returns. |

Scope can be the current artboard, all artboards, or **the current selection**. A selection is
exported by re-rooting it into a synthetic document sized to its bounding box, so the output is
only the selected layers, at the position they render at — including layers that live inside an
auto-layout frame. That makes "export these three cards" a first-class action rather than a
crop of the artboard. The file name is pre-filled from the design/artboard name (or `selection`)
and sanitised per OS. The dialog also shows the output size and offers **Copy code** and
**Download**.

The right-click context menu exposes the same machinery without the dialog: **Copy as PNG** and
**Copy as SVG** put the selected objects on the clipboard directly (`copySelectionAs(format)` in
the client API also accepts `html`, `react` and `json`).

## Panels and window layout

The layer tree and inspector are resizable (drag the splitter, double-click to reset) and
collapsible; their widths and collapsed state persist per browser. Below ~640 px of panel width —
i.e. inside the real right sidebar — they become **overlay drawers**: the canvas takes the full
width and the Layers/Inspector buttons float the panels over it (Esc or the scrim closes them).

## Images

Image layers take a URL (`http(s)` or `data:`) and can be filled from the OS: toolbar Image
button, inspector **Choose file…**, drag-and-drop an image file onto the canvas, or paste from the
clipboard. Files up to 1.5 MiB (png/jpeg/webp/gif/svg) are inlined as data URLs and placed at the
drop point / centred in the target container, sized to natural dimensions capped at ~40 % of the
artboard width.

## Agent tools

* **`design_read`** — board path, version, full document or a compact summary
  (`include:"summary"` indents nested layers, prints `layout=row gap=16 pad=16 align=center
  justify=space-between`, `ac=`, `rgap=`/`cgap=`, `locked`, `hug=`, `minW`, line props), optional
  `artboardId` filter, plus the last canvas UI report.
* **`design_apply`** — visual operations:
  `board.update`, `artboard.add|update|delete|duplicate`,
  `layer.add|update|delete|reorder|move_to|duplicate|group|ungroup`,
  `comment.add|update|delete|batch_update`.
  `layer.add`/`layer.move_to`/`layer.duplicate` take `artboardId? | parentId?`; `layer.update`
  accepts `layout` (with `alignContent`, `rowGap`, `columnGap`), `clip`, `grow`, `alignSelf`,
  `shadow`, `locked`, `min`/`max` bounds, `hug`, line props and text style props. Per-op errors are
  returned in `errors` and do not fail the other ops unless `atomic: true`.

Plus a system-prompt section that tells the model the canvas pairs with the chat, that the user
also edits it directly, that element comments arrive as revision requests, and to never hand-edit
the board file.

## The board file

`design-board.json` in the session workspace root (configurable). It is the single source of
truth, owned by the Host store:

```json
{
  "schemaVersion": 1,
  "name": "Untitled design",
  "version": 14,
  "updatedAt": "2026-11-09T16:44:00.000Z",
  "artboards": [
    { "id": "ab-landing", "name": "Landing", "x": 0, "y": 0, "width": 1200, "height": 760,
      "background": "#ffffff", "layers": [
        { "id": "l-row", "type": "frame", "name": "Feature row", "x": 96, "y": 420,
          "width": 1008, "height": 180, "fill": "transparent",
          "layout": { "direction": "row", "gap": 24,
                      "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
                      "align": "stretch", "justify": "start", "wrap": false },
          "children": [
            { "id": "l-card-1", "type": "rect", "name": "Feature card 1", "width": 320,
              "height": 180, "fill": "#f3f4f6", "radius": 14, "grow": true }
          ] }
      ] }
  ],
  "comments": [
    { "id": "c-1", "artboardId": "ab-landing", "layerId": "l-cta",
      "text": "Make the primary button feel more premium", "status": "resolved",
      "author": "user", "createdAt": "2026-11-09T14:34:39.404Z" }
  ]
}
```

The store writes atomically (temp file + rename), keeps one version bump per successful op batch,
serializes concurrent writers, adopts outside edits by mtime+size, and refuses files over 4 MiB.
A missing or empty file is created from a starter design; a corrupt file is reported, never
silently replaced.

## HTTP API (internal, used by the Client half)

Prefix route `/design-canvas` on the Host web server:

| Method | Path | Purpose |
|---|---|---|
| GET | `/design-canvas/health` | `{ ok, name, version }` |
| GET | `/design-canvas/state?sessionId=` | `{ ok, path, version, doc, ui }` |
| POST | `/design-canvas/ops` | `{ sessionId, ops, atomic? }` → `{ ok, version, applied, errors, doc }` |
| POST | `/design-canvas/report` | `{ sessionId, kind, message?, stats?, services? }` |
| GET | `/design-canvas/ping?m=&d=` | image-beacon diagnostics channel (1×1 GIF) |
| GET | `/design-canvas/_debug` | recorded beacon ring |

The route resolves the workspace from the live session (`agents` + `workingDirectory`); a session
that is not live answers `no-session`.

## Configuration

The bundle row `design-canvas` accepts:

| Field | Default | Meaning |
|---|---|---|
| `boardPath` | `design-board.json` | Board file, relative to the session workspace root (must stay inside it) |
| `maxOpsPerCall` | `200` | Ops accepted in one batch |
| `maxLayersPerArtboard` | `300` | Layer cap per artboard |
| `promptSection` | `true` | Contribute the system-prompt section |

## Limits

* The board is per session workspace; two sessions in the same workspace share one board file.
* Not a full design editor: no boolean ops, no freeform vector paths (lines are straight), no
  rotation/skew, single-run text (no rich-text runs), no components/variants, no multi-user
  presence or multiplayer editing, no data/API connectors.
* Auto-layout is single-run flexbox for the layout itself (`align-content` applies across wrapped
  lines); `grow` is flex-grow: 1 — there is no fractional grow or shrink factor.
* Undo history is client-side and per tab: it is lost on reload and cannot restore comments
  dropped by a frame delete.
* Export is client-side: the HTML/React renderers approximate text wrapping for SVG (native
  `<text>` with estimated advances) while the canvas uses real font metrics, so long wrapped
  paragraphs can break a line or two differently in an SVG export.
* Image layers inline data URLs into the board JSON (1.5 MiB cap); nothing is uploaded.
* The HTTP route is a loopback endpoint with the app's transport but no extra auth token; it only
  touches the one board file inside the session workspace.
* Client code updates are picked up by the running page when the bundle file changes; if a change
  does not appear, restart the `include:design-canvas` row and reload the page.

## Verification performed

* **Model** — `node --test tests/model.test.mjs`: **25/25** tests (312 assertions), covering every
  op including error paths, layout defaults/back-compat, container normalization, and a 200-op
  seeded fuzz loop that asserts unique ids, `normalizeDoc` idempotence and lossless-JSON results.
* **Client bundle** — `node --test tests/client.test.mjs`: **9/9** tests. It loads the generated
  bundle in Node with a React stub (so a broken part or a load-order mistake fails the suite), then
  asserts `createLayer` shapes for every type, immutable `docPatchLayer`, flex child placement,
  computed world rects, the comment message contract and the export generators.
* **Visual/product** — the preview harness (`npm run dev`) renders the real bundle against the real
  model. Verified there: crisp text at 25/100/400 % (objective sharpness 2.54 → 9.44), the 78-layer
  scenario with 3 artboards, multi-selection (50 layers dragged in one op), marquee + snap guides,
  group/ungroup, align/distribute/tidy with undo, tree rename/lock/filter, inspector multi-edit and
  the new layout props, batch comment sending (one chat prompt for three comments), and all five
  export formats (HTML compared side by side with the canvas, SVG/PNG rendered in the browser).
* **Live page** — the plugin row was restarted after the Host changes: `GET
  /design-canvas/health` reports `2.0.0`, the client bundle re-applied (`apply-ok`, all four
  services true) and `GET /design-canvas/state` serves the session document.
* Display resources: `locale/en.json`, `locale/ru.json` and `icon.svg` are exported and validated;
  the bundle and its `design-canvas` row appear in the profile.

## Development

* `npm test` runs both suites. `npm run check` also verifies that the committed `client.js` matches
  the sources (`node scripts/build-client.mjs --check`, the same gate CI runs) and syntax-checks the
  Host half and the artifact.
* **`client.js` is generated.** The browser half is authored as ordered parts in `src/client/`
  (state machine, layout engine, renderer, tree, inspector, comments, export, chrome) that share one
  module scope; `npm run build` concatenates them. Edit the parts, never the artifact — a stale
  `client.js` fails `npm run check` and CI. Features add UI through the extension registries
  (`EXTENSIONS.toolbar/appPanels/inspector/selection/keys/commands`) instead of editing another
  part's file; part ownership is listed in `CONTRACT.md`.
* `npm run dev` starts the preview harness (default <http://127.0.0.1:5599>) which serves
  `/client.js` assembled live from the parts and stubs the Host API against the real document model
  — the fastest way to see the canvas without restarting the Harness. `dev/README.md` documents the
  scenarios and the `window.__harness` scripting surface.
* Renaming a fork: the package name, the Loader row name in `cordis.patch.yml` and the client
  module id / `PLUGIN_ID` must change together, otherwise the tab type and its body cell no longer
  match.
* `CONTRACT.md` is the authoritative design contract (document model, ops vocabulary, HTTP API,
  part ownership, extension API); update it with behaviour changes.

## License

[MIT](LICENSE).
