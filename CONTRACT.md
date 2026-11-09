# Design canvas plugin — build contract (v1)

A chat-paired design canvas for the DSH Web UI.

* **Host half** (`index.js` + `host/*.js`): owns the design document (a JSON file in the
  session workspace), applies ops, registers agent tools + system-prompt section, serves a
  small JSON API over the Host web server.
* **Client half** (`client.js`): a **right-sidebar tab** whose body renders the canvas,
  plus a composer button and a guide card that open it. All UI -> Host traffic goes through
  `fetch()` against the `/design-canvas` route. Comments become real chat messages through
  the client session service (`session.prompt`).

No dependencies, no build step, no JSX. Node ESM on the Host, one browser bundle on the
Client. Both halves are plain JavaScript checked with `node --check`.

## Files and ownership

| File | Owner | Purpose |
|---|---|---|
| `package.json`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `index.js`, `host/routes.js` | Lead | manifest, patch, display metadata, plugin wiring, HTTP surface |
| `host/model.js`, `host/store.js`, `host/tools.js` | host-engine | document model, ops engine, persistence, agent tools, prompt section |
| `client.js` | canvas-ui | the whole browser half |

Nobody edits another owner's files. `CONTRACT.md` is changed only by the Lead.

## Hard rules

* **Tool results must be lossless JSON.** The Harness rejects a tool output that contains an
  explicit `undefined` property, `NaN`/`Infinity`, a `Date` instance, a function, or a class
  instance ("returned invalid output: value is not lossless JSON"). Build result objects with
  only defined fields; persist only JSON-safe values.
* `design_read` is already live and the right-sidebar body cell already registers in the running
  page; keep those shapes.
* The HTTP route is a **handler** route (`webServer.register({ kind: 'prefix', path, handler })`)
  because a `resource` route only answers GET/HEAD. `POST /design-canvas/ops` and
  `POST /design-canvas/report` work.
* Host plugin code does not hot-reload on edit; the Lead restarts the Loader row. Never call
  `plugin_manager` or start servers from a task.

## Document model (`design-board.json` in the session workspace root)

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

Layer union (all layers carry `id`, `type`, `name`, `x`, `y`, `width`, `height`,
optional `opacity` 0..1, optional `visible` boolean default true, optional `shadow` CSS
box-shadow string, absent by default):

| type | extra props |
|---|---|
| `rect` | `fill` (CSS color or gradient), `radius` (px), `borderWidth`, `borderColor` (color) |
| `ellipse` | `fill` (color or gradient), `borderWidth`, `borderColor` (color) |
| `text` | `text`, `color` (color only), `fontSize`, `fontWeight` (400/500/600/700), `fontFamily`, `align` (`left`/`center`/`right`), `lineHeight`, optional `fill` background (color or gradient), `letterSpacing` (-20..40 px), `textTransform` (`none`/`uppercase`/`lowercase`) |
| `image` | `src` (http(s) or `data:` URL), `fit` (`cover`/`contain`/`fill`), `radius` |

Style strings: `fill` (including a text layer's background fill) and an artboard's `background`
accept any CSS color **or gradient** string, e.g. `linear-gradient(135deg,#2563eb,#1d4ed8)` or
`radial-gradient(circle,#fff,#e5e7eb)`; `color` and `borderColor` accept a plain CSS color only
(gradient keywords are rejected there). Color/gradient strings are capped at 200 characters and
must not contain newlines, braces or semicolons. `shadow` is an optional CSS `box-shadow` string
(max 200 characters, stored trimmed) accepted on every layer type including `frame`; it is absent
by default, `null` or `""` clears it, and invalid values are a `bad-value` op error (dropped by
`normalizeDoc` without inserting a default). `letterSpacing` is clamped to -20..40 and
`textTransform` is an enum; both are text-only and absent unless authored.

Comment:

```json
{ "id": "c-1", "artboardId": "ab-landing", "layerId": "l-title", "text": "...",
  "status": "open", "author": "user", "createdAt": "ISO-8601" }
```

`version` is a monotonically increasing integer bumped on every mutation; the client polls it.
Ids are `ab-<rand>`, `l-<rand>`, `c-<rand>` (host- or client-supplied are both accepted; the
host fills in a missing id).

## Ops

One engine, two callers (agent tool + UI route). `applyOps(doc, ops)` returns
`{ doc, applied, errors }`; it never throws for a bad op, it records
`{ index, code, message }` and continues (or rolls back when the caller asks for `atomic`).

```
artboard.add    { artboard: { name?, width?, height?, background?, x?, y? }, index? }   -> id
artboard.update { artboardId, patch: { name?, width?, height?, background?, x?, y? } }
artboard.delete { artboardId }                       // also drops its comments
layer.add       { artboardId, layer: { type, name?, x?, y?, width?, height?, ...props }, index? } -> id
layer.update    { layerId, patch: { ...any layer prop incl x,y,width,height } }
layer.delete    { layerId }                          // also drops its comments
layer.reorder   { layerId, index }                   // within its artboard, clamped
layer.move_to   { layerId, artboardId, index? }
comment.add     { artboardId?, layerId?, text }      -> id
comment.update  { commentId, status: 'open'|'resolved' }
comment.delete  { commentId }
```

Validation: unknown `type`/`op`/id/property is an error; numbers finite; `width`/`height`
clamped to `>= 1`; `opacity` clamped 0..1; text props coerced to strings; `index` clamped;
`artboardId`/`layerId` must resolve. Empty `ops` is a valid no-op.

## Frames and auto layout (v1.1)

`frame` is a fifth layer type: a container with an ordered `children` array (back-to-front, same
z-order rule as an artboard's `layers`). All common layer props (`id`, `name`, `x`, `y`, `width`,
`height`, `opacity`, `visible`, `shadow`) apply. Frames extend the layer union above; every other type is
unchanged, and the Client computes rendered positions for auto-layout children while the Host
model only stores and validates the tree.

Frame-specific props:

| prop | shape | notes |
|---|---|---|
| `children` | `Layer[]` | back-to-front; built only with `layer.add { parentId }`, moved with `layer.move_to { parentId }`, deleted with `layer.delete`. Never patchable with `layer.update`. |
| `layout` | object \| `null` | `null` (default) = absolute positioning: children paint at their authored `x`/`y` relative to the frame's top-left. An object enables CSS-like auto layout. |
| `clip` | boolean | default `false`; clip children to the frame box. |
| `fill`, `radius`, `borderWidth`, `borderColor` | same as `rect` | frame background/border. |

Layout object (the Host validates it and fills in the defaults, so a stored `layout` is always
complete; `layer.update { patch: { layout } }` replaces the whole object):

```json
{ "direction": "row", "gap": 0,
  "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "align": "stretch", "justify": "start", "wrap": false }
```

| field | values | default |
|---|---|---|
| `direction` | `"row"` \| `"column"` (main axis) | `"row"` |
| `gap` | number >= 0, px; between adjacent children, and between wrapped runs | `0` |
| `padding` | `{ top, right, bottom, left }`, each number >= 0, px | all `0` |
| `align` | `"start"` \| `"center"` \| `"end"` \| `"stretch"`, cross axis | `"stretch"` |
| `justify` | `"start"` \| `"center"` \| `"end"` \| `"space-between"`, main axis | `"start"` |
| `wrap` | boolean | `false` |

Optional child props (accepted on any layer, meaningful inside an auto-layout frame):
`grow` boolean (default `false`, consume free main-axis space) and `alignSelf`
`"start"|"center"|"end"|"stretch"|null` (default `null`, i.e. inherit the parent's `align`).

Limits: layer depth 5 (top-level layers are depth 1, each frame nesting level adds 1) and at most
200 children per frame. Ids are globally unique across the whole document, including nested
layers. Deleting a frame deletes its whole subtree and every comment that referenced any deleted
layer. Moving a frame into itself or its own descendant is rejected; a move that would exceed the
depth limit is rejected. Absolute children of any layer remain allowed; boards without frames
load and behave exactly as before.

Op vocabulary extensions (op names and existing semantics unchanged):

```
layer.add       { artboardId? | parentId?, layer: { type, name?, x?, y?, width?, height?, ...props }, index? } -> id
layer.move_to   { layerId, artboardId? | parentId?, index? }   // index clamped in the destination; in-place reorder keeps the old semantics
layer.update    { layerId, patch: { ...props, layout?, clip?, grow?, alignSelf? } }
layer.reorder   { layerId, index }                             // index within the current parent (artboard or frame)
layer.delete    { layerId }                                    // deletes the subtree + its comments
```

Exactly one of `artboardId` (top level) / `parentId` (a frame id; the artboard is derived) is
required for `layer.add`/`layer.move_to`; the parent must be type `frame`. `children` is not
patchable; `layer.add` does not accept a literal `children` array — add the frame, then add each
child with `parentId`.

Renderer semantics (Client): behave like CSS flexbox. The frame's stored box is the container
(children coordinates are relative to it, padding included); for a frame with a `layout` object the
children are placed inside the padding box and their authored `x`/`y` are ignored, while
`width`/`height` provide their sizes; `grow` consumes free main-axis space (before `justify`
distributes the rest), `alignSelf` overrides `align` on the cross axis, `wrap` starts a new run
when the next child no longer fits, and `clip` clips overflow to the frame box. The Host never
rewrites children's stored `x`/`y` from the computed layout.

`design_read`'s summary indents nested layers two spaces per depth level and shows frame layout as
`layout=row gap=16 pad=16 align=center justify=space-between` (`pad` shows `top/right/bottom/left`
when the sides differ; `wrap` appears when true; a frame with `layout:null` is marked `absolute`).

`normalizeDoc` repairs hand-edited nested files: depth and children caps are applied, unknown
props dropped, an invalid `layout` dropped to `null`, colliding ids regenerated, and comments
pointing at layers missing from the repaired tree dropped.

## HTTP API (Host, registered on `ctx.webServer`, prefix route `/design-canvas`)

Every response is JSON with `cache-control: no-store`. Errors are
`{ ok: false, error: { code, message } }` with codes `bad-request`, `no-session`,
`not-found`, `io-failed`, `internal`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/design-canvas/health` | — | `{ ok: true, name: 'design-canvas', version: '1.0.0' }` |
| GET | `/design-canvas/state` | `?sessionId=<id>` | `{ ok: true, sessionId, path, version, doc, ui }` |
| POST | `/design-canvas/ops` | `{ sessionId, ops, atomic? }` | `{ ok: true, version, applied, errors, doc }` |
| POST | `/design-canvas/report` | `{ sessionId, kind, message?, stats?, services? }` | `{ ok: true, serverTime }` |

`ui` is `{ connected, lastReport }` where `lastReport` is the client's last report:
`{ kind, message?, stats?, services?, time }`. The route resolves the session's workspace
from the Host `agents`/`workingDirectory` services; a session that is not live is
`no-session`. The state route creates the starter document when the file is absent.

## Agent tools

* `design_read` — parameters `{ artboardId?, include?: 'all' | 'summary' }`. Returns
  `{ ok, path, version, doc, summary, ui }`. `doc` is the full document unless
  `include:'summary'`.
* `design_apply` — parameters `{ ops: [...], atomic?: boolean }`. Returns
  `{ ok, version, applied, errors, summary }`; an op error does not fail the call, the
  `errors` array reports it. The description must teach the op vocabulary in one or two
  lines and point at `design_read` for ids.

Plus a `systemPrompt.section` (short: how the canvas pairs with the chat, when to use the
tools, never to hand-edit the board file).

## Client half

* Registers tab type `{ id: '@andretaccelerator/dsh-design-canvas', kind: 'design-canvas' }` through
  `ctx.get('sidebarRightTabs')` (optional service, never a hard inject), body
  `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: '@andretaccelerator/dsh-design-canvas' })`.
* Adds a composer-row button in `conversation.input.left` (id `design-canvas-open`) that calls
  `ctx.get('sidebarRight').openTab('design-canvas')`.
* The body receives the framework prop `sessionId`; every request carries it.
* Polling: `GET state` on mount and every 2000ms while `document.visibilityState === 'visible'`;
  replace local document when `version` changes and no pointer edit is in flight.
* Comment submit: `POST ops` with `comment.add`, then send a chat message with
  `ctx.get('sessions').using(sessionId, { source: 'controllerOperation' }, ref => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))`.
  Message text:
  `Design canvas revision request` + board path + artboard/layer names + ids + geometry +
  `Comment: <text>` + a line telling the model to use `design_read` / `design_apply`.
* Client -> Host diagnostics: on activation and on first canvas mount, `POST report` with
  `{ kind: 'boot' | 'mount' | 'error', stats, services }`, wrapped in try/catch so a broken
  bridge never breaks the UI.
* Only `--dsw-alias-*` theme tokens for chrome; artboard content may use authored colors.
* No `require()` of any Harness client package; React comes from `require('react')`.
