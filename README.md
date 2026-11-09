# Design canvas (plugin)

**Repository:** <https://github.com/AndreTheAccelerator/dsh-design-canvas>

A **chat-paired design canvas** for the DeepSeek Harness Web UI: a right-sidebar board with
artboard-based editable layers, CSS-like auto-layout frames, inline element comments that become
targeted chat messages, and Figma-style direct manipulation that the agent can revise with tools.

This repository *is* the plugin package: `package.json` declares the Harness bundle plus its
browser half (`dsh.client`), the Host half lives in `index.js` + `host/`, and the browser half is
the single plain-JavaScript bundle `client.js`. There is no build step and no npm dependency.

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
| `client.js` | The whole browser half (React from the Harness module table, no JSX/build) |
| `cordis.patch.yml`, `package.json` | Bundle manifest / Loader patch |
| `locale/`, `icon.svg` | Display metadata for Plugin Manager |
| `tests/model.test.mjs` | Node test suite for the document model |
| `CONTRACT.md` | Internal design contract (requested result, model, ops, API, ownership) |
| `examples/starter-board.json` | A generated starter board you can paste into a workspace |

## Open it

Three ways, all landing in the same right-sidebar tab:

1. **Automatically once** — after the page loads, the tab is opened one time per browser tab
   (guarded with `sessionStorage`), so the canvas is visible without hunting for it.
2. **Composer button** — the 24×24 design glyph at the left of the composer tool row.
3. **Right-sidebar guide** — expand the right sidebar and pick the **Design canvas** card.

## Canvas navigation and shortcuts

| Gesture | Action |
|---|---|
| Middle-mouse drag · Space + drag · drag empty background | Pan the canvas |
| Ctrl/Cmd + wheel · trackpad pinch | Zoom about the cursor (10 %–400 %) |
| Wheel · Shift + wheel | Scroll the canvas vertically / horizontally |
| Header zoom −, %, Fit | Zoom out / fit / zoom in (Fit frames all artboards) |
| Click layer · click empty | Select · clear selection |
| Drag / 8 handles | Move / resize (auto-layout children drag-to-reorder instead) |
| Arrow keys · Shift + arrows | Nudge 1 px / 10 px (batched; disabled for auto-layout children) |
| Ctrl/Cmd + D · toolbar copy | Duplicate selection (recursive for frames) |
| Ctrl/Cmd + Z · Ctrl/Cmd + Shift + Z or Ctrl + Y | Undo / redo (last 50 edits, comments excluded) |
| Delete / Backspace · Escape | Delete selected layer · clear selection |
| `c` / toolbar Comment | Open the inline comment composer for the selection |

## Layers, frames and auto layout

Layers live on artboards (vertically stacked, arbitrary placement) and may be nested inside
`frame` layers, back-to-front array order = z-order.

* Types: `rect`, `ellipse`, `text`, `image`, **`frame`** (container).
* A frame with `layout: null` positions its children absolutely (their authored x/y relative to
  the frame). A frame with a `layout` object behaves like CSS flexbox:
  `direction` row/column, `gap`, per-side `padding`, `align` (cross axis start/center/end/stretch),
  `justify` (main axis start/center/end/space-between), `wrap`, plus `clip`.
* Any layer accepts `grow` (flex-grow: 1 inside an auto-layout parent) and `alignSelf`.
* Frames nest up to depth 5 (200 children each); ids are globally unique.
* Layer tree (left panel) shows the hierarchy with indentation and collapse chevrons; drag a row
  onto a frame to reparent (`layer.move_to`), or use the inspector's **Move into** picker.
* Frame inspector edits direction/gap/padding/align/justify/wrap/clip and enables/disables auto
  layout; every change is one `layer.update` with a complete layout object.

## Styling

* `fill` / artboard `background`: any CSS color **or gradient**
  (`linear-gradient(135deg,#2563eb,#1d4ed8)`, `radial-gradient(...)`).
* `shadow`: any CSS box-shadow string (`0 10px 24px rgba(37,99,235,.28)`), clearable.
* `radius`, `borderWidth`, `borderColor`, `opacity`, `visible`; text layers also
  `fontSize`, `fontWeight` (400/500/600/700), `fontFamily`, `align`, `lineHeight` (px),
  `letterSpacing` (px), `textTransform`.
* Inspector commits each control as one op; the Host validates and returns per-op errors inline.

## Inline element comments → chat revisions

Select an element, press `c` (or the Comment action), write the request, Send. The canvas:

1. stores the comment on the board (`comment.add`, numbered pin on the element, thread panel with
   Resolve/Reopen/Delete), and
2. posts a real chat message: a *"Design canvas revision request — apply it now"* block with the
   board path/version, artboard size, target layer id/type/geometry/current props, the comment id
   and text, and a 4-step instruction (skip `design_read` when possible, apply the minimal ops,
   resolve the comment, reply in one sentence).

The agent then uses the tools below; the canvas adopts the new version on its next poll and shows
the "AI revising" state while the version moves.

## Images

Image layers take a URL (`http(s)` or `data:`) and can be filled from the OS: toolbar Image
button, inspector **Choose file…**, drag-and-drop an image file onto the canvas, or paste from the
clipboard. Files up to 1.5 MiB (png/jpeg/webp/gif/svg) are inlined as data URLs and placed at the
drop point / centred in the target artboard, sized to natural dimensions capped at ~40 % of the
artboard width.

## Agent tools

* **`design_read`** — board path, version, full document or a compact summary
  (`include:"summary"` indents nested layers and prints `layout=row gap=16 pad=16 align=center
  justify=space-between`), optional `artboardId` filter, plus the last canvas UI report.
* **`design_apply`** — visual operations:
  `artboard.add|update|delete`, `layer.add|update|delete|reorder|move_to`, `comment.add|update|delete`.
  `layer.add`/`layer.move_to` take `artboardId? | parentId?`; `layer.update` accepts `layout`,
  `clip`, `grow`, `alignSelf`, `shadow`, text style props. Per-op errors are returned in `errors`
  and do not fail the other ops unless `atomic: true`.

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
* Not a full design editor yet: no boolean ops, no vector paths, no export to image, single-run
  text, no rotation/skew, no multi-select.
* Auto-layout is single-run flexbox only (no `align-content` across wrapped lines, no min/max
  sizes, no `space-around`/`space-evenly`); `grow` is flex-grow: 1.
* Undo history is client-side and per tab: it is lost on reload and cannot restore comments
  dropped by a frame delete.
* Image layers inline data URLs into the board JSON (1.5 MiB cap); nothing is uploaded.
* The HTTP route is a loopback endpoint with the app's transport but no extra auth token; it only
  touches the one board file inside the session workspace.
* Client code updates are picked up by the running page when the bundle file changes; if a change
  does not appear, restart the `include:design-canvas` row and reload the page.

## Verification performed

* **Host half** — a Node harness booted the real `index.js` against a fake Cordis context and
  exercised the registered route and both tools end to end: **39/39 checks**. A second harness
  covered the frame/auto-layout model (frame creation with inline layout, defaults, bad layout
  rejection, `layout:null`, grow/alignSelf, cross-parent moves, depth cap, subtree comment
  cleanup, normalize repair): **24/24 checks**. Host model suites from the build: **32/32**
  (frames) and **17/17** (shadow/gradient/text styles).
* **Client half** — `node --check`; stubbed-loader activation suites during the build:
  **24/24** (base), **69/69** (camera + image input), **69/69** (frames/flex rendering),
  **46/46** (styling render, duplicate, nudge, undo/redo).
* **Live page** — installed with `install_bundle`, activated through the Loader, verified in the
  running Web GUI: tab body mount reports measured canvas stats, agent ops are adopted by the
  polling client (`state-loaded … external:true`), user drags post one `layer.update` each and
  persist, comment pins render, the auto-layout frame and gradient/shadow button render correctly
  (user-confirmed), and every browser→Host call (state, ops, report, beacon) answers 200.
* Display resources: `locale/en.json`, `locale/ru.json` and `icon.svg` are exported and
  validated; the bundle and its `design-canvas` row appear in the profile.

## Development

* The model is pure and dependency-free: `npm test` (or `node --test tests/model.test.mjs`) runs
  the suite. `node --check` on `index.js`, `host/*.js` and `client.js` validates syntax.
* `client.js` is hand-written plain JavaScript running inside the Harness browser module loader
  (`window.__ModuleLoader__.load`): React comes from `require('react')`, there is no JSX, no
  imports and no build step. Keep it that way when editing.
* Renaming a fork: the package name, the Loader row name in `cordis.patch.yml` and the client
  module id / `PLUGIN_ID` inside `client.js` must change together, otherwise the tab type and its
  body cell no longer match.
* `CONTRACT.md` is the authoritative design contract (document model, ops vocabulary, HTTP API,
  file ownership); update it with behaviour changes.

## License

[MIT](LICENSE).
