# Design canvas plugin — build contract (v2)

A chat-paired design canvas for the DSH Web UI.

* **Host half** (`index.js` + `host/*.js`): owns the design document (a JSON file in the
  session workspace), applies ops, registers agent tools + system-prompt section, serves a
  small JSON API over the Host web server.
* **Client half**: a **right-sidebar tab** whose body renders the canvas, plus a composer
  button and a guide card that open it. All UI -> Host traffic goes through `fetch()` against
  the `/design-canvas` route. Comments become real chat messages through the client session
  service (`session.prompt`).

No dependencies, no runtime build step, no JSX. Node ESM on the Host, one browser artifact on
the Client. Both halves are plain JavaScript checked with `node --check`.

---

## 0. Files and ownership

The browser half is **authored as ordered parts** in `src/client/` that share one module scope
and are concatenated into the shipped `client.js` by `npm run build`
(`scripts/build-client.mjs`). `client.js` is generated: **never edit it by hand**. CI runs
`node scripts/build-client.mjs --check` and fails on a stale artifact, so a forgotten rebuild
cannot ship.

| Path | Part of | Owner | Purpose |
|---|---|---|---|
| `package.json`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `index.js`, `host/routes.js`, `scripts/*`, `docs/*`, `README.md`, `CHANGELOG.md`, `CONTRACT.md` | build/wiring | **Lead** | manifest, patch, display metadata, plugin wiring, HTTP surface, tooling, docs |
| `host/model.js`, `host/tools.js`, `tests/model.test.mjs` | host engine | **host-engine** | document model, ops engine, agent tools, prompt section, tests |
| `host/store.js` | host persistence | **Lead** | atomic writes, versioning, outside-edit adoption |
| `src/client/00-core.js` | client | **Lead** | constants, diagnostics, **extension registries** |
| `src/client/10-strings.js` | client | **Lead** | `STRINGS` + locale helpers (shared copy; extend by asking the Lead) |
| `src/client/20-http.js` | client | **Lead** | `getState` / `postOps` / `report` / `beacon` bridge |
| `src/client/25-doc.js`, `26-camera.js`, `27-images.js`, `30-defaults.js`, `70-editor.js` | client | **interactions** | local doc helpers, camera math, image ingestion, layer defaults, `useEditor` (state, selection, gestures, history, mutations) |
| `src/client/28-layout.js`, `60-render.js` | client | **renderer** | flex layout engine, computed tree, `LayerView` / `SelectionOverlay` / `ArtboardView`, crisp zoom rendering |
| `src/client/40-icons.js`, `42-css.js`, `45-primitives.js`, `74-shell.js` | client | **chrome** | glyph set, application CSS, form primitives, shell (header/toolbar/panels/stage/composer), panel resizing, visual design |
| `src/client/50-tree.js`, `55-inspector.js` | client | **inspector** | layer tree, inspector, inline rename, multi-edit |
| `src/client/35-comment-msg.js`, `52-comments.js`, `53-batch.js` | client | **comments** | chat message builder, comment thread, batch sending, filters |
| `src/client/43-export-code.js`, `44-export-ui.js` | client | **export** | code/vector export renderers + export dialog and entry points |
| `src/client/65-boundary.js`, `80-boot.js` | client | **Lead** | error boundary, body entry, tab/composer registration, `apply()` |
| `dev/**` | dev tooling | **harness** | local preview server + harness page |

Nobody edits another owner's files. `CONTRACT.md` is changed only by the Lead.

### Build rules for parts

* Parts are **function-body fragments** of one factory: 4-space indentation base, no imports,
  `require('react')` only happens once in `00-core.js`.
* `function` declarations hoist across parts, so a part may call a helper declared later.
* Top-level `const` initialisation runs in MANIFEST order; a part must not *call* another part's
  function at load time.
* Each part ends with exactly one newline.
* Run `npm run build` after editing; `npm run check` = build freshness + syntax + tests.

### Extension registries (how a part adds UI without touching another part's file)

`00-core.js` exposes registries that the shell, inspector and keyboard handler render:

```js
EXTENSIONS = { toolbar, appPanels, inspector, selection, keys, commands }

registerToolbar({ id, render(ctx) })            // shell toolbar, after the built-in tools
registerAppPanel({ id, render(ctx) })           // full-app overlay (dialogs), rendered last
registerInspectorSection({ id, render(ctx) })   // appended inspector sections
registerSelectionTool({ id, render(ctx) })      // selection bar, shown while something is selected
registerKeyHandler({ id, match(event, api), run(event, api) })  // runs before built-in keys
registerCommand({ id, label, run(api) })        // reserved for the command palette
```

`ctx` (and `api`) is the editor context: `{ editor, strings, doc, tree, layout, camera, zoom,
selection: { layerIds, primaryLayerId, artboardId }, selectedLayerId, selectedArtboardId,
selectedNode, comments, commentIndex, actions: {...} }`. `actions` contains
`commitLayer`, `commitArtboard`, `addLayer`, `deleteSelected`, `duplicateSelected`,
`selectLayer`, `selectArtboard`, `clearSelection`, `runOps`, `undo`, `redo`, `setInlineError`,
`openComposerFor`, `setCommentStatus`, `deleteComment`, `fitCamera`, `zoomCameraBy`, …

A part may keep **its own CSS** as a local `const X_CSS = \`...\`` and render it inside its own
component's `<style>` element. Only `42-css.js` holds shared/app-level CSS.

---

## 1. Document model (`design-board.json` in the session workspace root)

```json
{
  "schemaVersion": 1,
  "name": "Untitled design",
  "version": 12,
  "updatedAt": "2026-11-09T13:00:00.000Z",
  "artboards": [
    {
      "id": "ab-landing",
      "name": "Landing",
      "x": 0, "y": 0, "width": 1440, "height": 900,
      "background": "#ffffff",
      "layers": [ /* back-to-front order */ ]
    }
  ],
  "comments": []
}
```

`version` is a monotonically increasing integer bumped by the store on every mutation; the client
polls it. Ids are `ab-<rand>`, `l-<rand>`, `c-<rand>` (host- or client-supplied are both
accepted; the host fills in a missing id) and are globally unique, including nested layers.

### Layer union

Common: `id`, `type`, `name`, `x`, `y`, `width`, `height`, optional `opacity` (0..1),
optional `visible` (default true), optional `shadow` (CSS box-shadow string, max 200 chars),
optional `locked`, optional `minWidth`/`minHeight`/`maxWidth`/`maxHeight`, optional
`hugWidth`/`hugHeight`, optional `grow`/`alignSelf` (meaningful inside an auto-layout frame).

| type | extra props |
|---|---|
| `rect` | `fill` (CSS color **or gradient**), `radius` (px), `borderWidth`, `borderColor` (color) |
| `ellipse` | `fill` (color or gradient), `borderWidth`, `borderColor` (color) |
| `line` | `stroke` (color), `strokeWidth` (0.5..64), `orientation` (`horizontal`/`vertical`/`diagonal`), `dashed`, `arrowStart`, `arrowEnd` |
| `text` | `text`, `color` (color only), `fontSize`, `fontWeight` (400/500/600/700), `fontFamily`, `align` (`left`/`center`/`right`), `lineHeight` (px), optional `fill` background (color or gradient), `letterSpacing` (-20..40 px), `textTransform` (`none`/`uppercase`/`lowercase`) |
| `image` | `src` (http(s) or `data:` URL), `fit` (`cover`/`contain`/`fill`), `radius` |
| `frame` | `fill`, `radius`, `borderWidth`, `borderColor`, `clip` (bool), `layout` (object \| null), `children` |
| `group` | `children`, `clip` (bool). No `layout`, `fill`, `radius`, border — always absolute positioning |

Style strings: `fill` (including a text layer's background fill) and an artboard's `background`
accept any CSS color **or gradient** string, e.g. `linear-gradient(135deg,#2563eb,#1d4ed8)` or
`radial-gradient(circle,#fff,#e5e7eb)`; `color`, `stroke` and `borderColor` accept a plain CSS
color only (gradient keywords are rejected there). Color/gradient strings are capped at 200
characters and must not contain newlines, braces or semicolons. `shadow` is an optional CSS
`box-shadow` string (max 200 characters, stored trimmed) accepted on every layer type; absent by
default, `null` or `""` clears it, invalid values are a `bad-value` op error (dropped by
`normalizeDoc` without inserting a default). `letterSpacing` is clamped to -20..40 and
`textTransform` is an enum; both are text-only and absent unless authored.

`locked`/`hugWidth`/`hugHeight` are stored only when `true`; `minWidth`/`minHeight`/`maxWidth`/
`maxHeight` only when authored (`>= 0`, `min <= max`). Setting them to `false`/`null` clears the
property. `locked` blocks direct manipulation in the canvas (drag/resize/select by click); the
agent may still edit it, and the UI must say so.

Comment:

```json
{ "id": "c-1", "artboardId": "ab-landing", "layerId": "l-title", "text": "...",
  "status": "open", "author": "user", "createdAt": "ISO-8601" }
```

---

## 2. Ops

One engine, two callers (agent tool + UI route). `applyOps(doc, ops)` returns
`{ doc, applied, errors }`; it never throws for a bad op, it records
`{ index, code, message }` and continues (or rolls back when the caller asks for `atomic`).

```
artboard.add     { artboard: { name?, width?, height?, background?, x?, y? }, index? }   -> id
artboard.update  { artboardId, patch: { name?, width?, height?, background?, x?, y? } }
artboard.delete  { artboardId }                       // also drops its comments
artboard.duplicate { artboardId, name?, offsetX?, offsetY? }                             -> id
board.update     { patch: { name? } }                 // rename the design ("project")
layer.add        { artboardId? | parentId?, layer: { type, name?, x?, y?, width?, height?, ...props }, index? } -> id
layer.update     { layerId, patch: { ...any layer prop incl x,y,width,height } }
layer.delete     { layerId }                          // also drops the subtree's comments
layer.reorder    { layerId, index }                   // within its current parent, clamped
layer.move_to    { layerId, artboardId? | parentId?, index? }
layer.duplicate  { layerId, offsetX?, offsetY?, parentId?, artboardId?, index? }          -> id
layer.group      { layerIds: string[], name?, artboardId? }                               -> id
layer.ungroup    { layerId }                          // group only
comment.add      { artboardId?, layerId?, text }      -> id
comment.update   { commentId, status: 'open'|'resolved' }
comment.delete   { commentId }
comment.batch_update { commentIds: string[], status: 'open'|'resolved' }
```

Validation: unknown `type`/`op`/id/property is an error; numbers finite; `width`/`height`
clamped to `>= 1`; `opacity` clamped 0..1; text props coerced to strings; `index` clamped;
`artboardId`/`layerId` must resolve; a `group` is created at the union box of its members and
members' `x`/`y` become relative to it; `ungroup` promotes children with absolute coordinates.
Empty `ops` is a valid no-op.

---

## 3. Frames, groups and auto layout

`frame` is a container with an ordered `children` array (back-to-front, same z-order rule as an
artboard's `layers`), plus a CSS-flexbox-like `layout`. `group` is the same container shape
without layout/background: purely a transform/selection unit.

Layout object (the Host validates it and fills in the defaults, so a stored `layout` is always
complete; `layer.update { patch: { layout } }` replaces the whole object):

```json
{ "direction": "row", "gap": 0,
  "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "align": "stretch", "justify": "start", "wrap": false, "alignContent": "stretch" }
```

| field | values | default |
|---|---|---|
| `direction` | `"row"` \| `"column"` (main axis) | `"row"` |
| `gap` | number >= 0, px; between adjacent children and wrapped runs (fallback when the axis gaps are absent) | `0` |
| `rowGap`, `columnGap` | optional numbers >= 0, override `gap` per axis | absent |
| `padding` | `{ top, right, bottom, left }`, each number >= 0, px | all `0` |
| `align` | `"start"` \| `"center"` \| `"end"` \| `"stretch"`, cross axis | `"stretch"` |
| `justify` | `"start"` \| `"center"` \| `"end"` \| `"space-between"` \| `"space-around"` \| `"space-evenly"`, main axis | `"start"` |
| `alignContent` | `"start"` \| `"center"` \| `"end"` \| `"stretch"` \| `"space-between"` \| `"space-around"`, wrapped cross axis | `"stretch"` |
| `wrap` | boolean | `false` |

Optional child props (accepted on any layer, meaningful inside an auto-layout frame):
`grow` boolean (default `false`, consume free main-axis space) and `alignSelf`
`"start"|"center"|"end"|"stretch"|null` (default `null`, i.e. inherit the parent's `align`).
`hugWidth`/`hugHeight` make a layer size to its content (text to its glyphs, containers to their
children + padding); `minWidth`/`maxWidth`/`minHeight`/`maxHeight` clamp the final box.

Limits: layer depth 5 (top-level layers are depth 1, each frame/group nesting level adds 1) and
at most 200 children per container. Moving a container into itself or its own descendant is
rejected. The renderer computes positions for auto-layout children; the Host never rewrites their
stored `x`/`y`.

### Renderer semantics (Client)

Behave like CSS flexbox. The container's stored box is the frame (children coordinates are
relative to it, padding included); for a frame with a `layout` object the children are placed
inside the padding box and their authored `x`/`y` are ignored, while `width`/`height` provide
their sizes; `grow` consumes free main-axis space (before `justify` distributes the rest),
`alignSelf` overrides `align` on the cross axis, `wrap` starts a new run when the next child no
longer fits, and `clip` clips overflow to the frame box. Groups position children absolutely.

**Vector-crisp zoom (v2):** the canvas must render text and strokes at native resolution at every
zoom level. Scaling the stage with a CSS transform is not acceptable: it makes text blurry above
100 %. The renderer therefore lays out at the current scale (multiply authored px by `zoom` in the
rendered style, or an equivalent technique that keeps glyphs rasterized at their final size) and
keeps overlay chrome (selection outline, handles, pins) at a constant *screen* size.

---

## 4. HTTP API (Host, prefix route `/design-canvas`)

Every response is JSON with `cache-control: no-store`. Errors are
`{ ok: false, error: { code, message } }` with codes `bad-request`, `no-session`,
`not-found`, `io-failed`, `internal`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/design-canvas/health` | — | `{ ok: true, name: 'design-canvas', version }` |
| GET | `/design-canvas/state` | `?sessionId=<id>` | `{ ok: true, sessionId, path, version, doc, ui }` |
| POST | `/design-canvas/ops` | `{ sessionId, ops, atomic? }` | `{ ok: true, version, applied, errors, doc }` |
| POST | `/design-canvas/report` | `{ sessionId, kind, message?, stats?, services? }` | `{ ok: true, serverTime }` |

`ui` is `{ connected, lastReport }` where `lastReport` is the client's last report:
`{ kind, message?, stats?, services?, time }`. The route resolves the session's workspace from the
Host `agents`/`workingDirectory` services; a session that is not live is `no-session`. The state
route creates the starter document when the file is absent. `GET /design-canvas/ping` (image
beacon) and `GET /design-canvas/_debug` (beacon ring) are diagnostics.

---

## 5. Agent tools

* `design_read` — parameters `{ artboardId?, include?: 'all' | 'summary' }`. Returns
  `{ ok, path, version, doc, summary, ui }`. `doc` is the full document unless
  `include:'summary'`.
* `design_apply` — parameters `{ ops: [...], atomic?: boolean }`. Returns
  `{ ok, version, applied, errors, summary }`; an op error does not fail the call, the
  `errors` array reports it. The description teaches the op vocabulary compactly and points at
  `design_read` for ids.

Plus a `systemPrompt.section` (short: how the canvas pairs with the chat, when to use the tools,
never to hand-edit the board file, how to treat "Design canvas revision request" messages).

---

## 6. Client half

* Registers tab type `{ id: '@andretaccelerator/dsh-design-canvas', kind: 'design-canvas' }`
  through `ctx.get('sidebarRightTabs')`, body
  `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '@andretaccelerator/dsh-design-canvas' })`.
* Adds a composer-row button in `conversation.input.left` (id `design-canvas-open`) that calls
  `ctx.get('sidebarRight').openTab('design-canvas')`.
* The body receives the framework prop `sessionId`; every request carries it.
* Polling: `GET state` on mount and every 2000 ms while `document.visibilityState === 'visible'`;
  replace the local document when `version` changes and no pointer edit is in flight.
* Comment submit: `POST ops` with `comment.add`, then send a chat message with
  `ctx.get('sessions').using(sessionId, { source: 'controllerOperation' }, ref => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))`.
  Message text: `Design canvas revision request` + board path + artboard/layer names + ids +
  geometry + `Comment: <text>` + a line telling the model to use `design_read` / `design_apply`.
  Batch send (v2) sends ONE message listing every selected comment.
* Diagnostics: on activation and on first canvas mount, `POST report` with
  `{ kind: 'boot' | 'mount' | 'error', stats, services }`, wrapped in try/catch so a broken bridge
  never breaks the UI. `<img>` beacons (`/design-canvas/ping`) survive a CSP `connect-src` block.
* Only `--dsw-alias-*` theme tokens for chrome; artboard content may use authored colors.
* No `require()` of any Harness client package; React comes from `require('react')`.
* Client-side history (undo/redo) is per tab, capped at 50 entries, comments excluded.

### `useEditor(sessionId)` — the editor hook (`70-editor.js`)

Returns the canvas state machine. Stable API consumed by the shell and the extension context:

* state: `doc`, `version`, `boardPath`, `loading`, `loadError`, `status`, `inlineError`, `camera`,
  `panning`, `spaceHeld`, `dragOver`, `commentMode`, `composer`, `commentBusy`, `commentError`,
  `gestureActive`, `treeOpen`, `inspectorOpen`, `strings`
* selection: `selectedLayerId` (primary), `selectedLayerIds` (v2 array), `selectedArtboardId`,
  `selectedNode`, `selectLayer(id, artboardId, options)`, `selectLayers(ids)`,
  `selectArtboard(id)`, `clearSelection()`
* derived: `tree` (computed layout tree), `layout`, `commentIndex`, `selectedComments`,
  `composerPlacement`, `handlers` (pointer handlers for `ArtboardView`)
* mutations: `commitLayer(patch)`, `commitArtboard(patch)`, `addLayer(type)`, `addArtboard`,
  `deleteSelectedLayer`, `duplicateSelected`, `moveSelected(direction)`, `reparentLayer`,
  `setFrameAutoLayout`, `patchFrameLayout`, `commitShadow`, `clearShadow`, `runOps(ops)`,
  `applyDocLocal(doc)`, `undoOnce`, `redoOnce`
* images: `openImagePicker(source)`, `onImageInputChange`, `placeImageInArtboard`, …
* comments: `openComposerFor(layerId, artboardId)`, `submitComment()`, `setCommentStatus`,
  `deleteCommentById`, `submitComments(commentIds)` (v2 batch)

Multi-select is part of the state machine: **`selectedLayerIds` is the source of truth**;
`selectedLayerId` stays as the primary layer for single-layer affordances (inspector, composer,
tree focus). Every mutation applies to the whole selection.

---

## 7. Dev harness

`npm run dev` starts `dev/serve.mjs` (default `http://127.0.0.1:5599`) which serves a harness page
plus a mock `/design-canvas` API backed by the real `host/model.js` and scenario documents in
`dev/docs/`. It exists because the real GUI is a desktop window we cannot drive: it is how the
canvas UI is verified visually (`browser_navigate` + `browser_screenshot` + `read_image`).
`window.__harness` exposes `remount`, `scenario`, `getDoc`, `setDoc`, `stats` for scripted checks.

---

## 8. Hard rules

1. **Tool results must be lossless JSON.** No explicit `undefined`, `NaN`/`Infinity`, `Date`,
   functions or class instances in a tool result or stored document.
2. The HTTP route is a **handler** route (a `resource` route only answers GET/HEAD).
3. Host plugin code does not hot-reload on edit; the client bundle usually does. Never call
   `plugin_manager` or start servers from a task — the Lead owns install/restart.
4. Never hand-edit the board file: the Host store owns it.
5. `children` is not patchable with `layer.update`; use `layer.add {parentId}` /
   `layer.move_to` / `layer.delete`.
6. Auto-layout children ignore authored `x`/`y` in the renderer.
7. A part must not edit another part's file; add UI through the extension registries.
8. Run `npm run build` after editing a part; `node --check client.js` must pass.
9. Visible UI text goes through the strings table when it already exists; new feature copy may be
   a local constant in the owning part and is localized in the docs pass.
