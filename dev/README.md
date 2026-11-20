# Design canvas — development preview harness

A local, dependency-free preview of the design canvas **browser half**, so a human (or another
agent) can open the real canvas UI in Chrome and drive it without the DSH desktop app.

The shipped plugin renders inside the DSH Web UI's right sidebar, on a `dsh-app://app/` page behind
auth — not reachable with a normal browser session. This harness reproduces the two things the
client needs from its host:

* a same-origin page that loads `client.js`, and
* the `/design-canvas` HTTP API (state / ops / report / ping), backed by the **real** document
  model in `host/model.js`.

Everything the browser runs is the real plugin code. Nothing here is shipped, and nothing here is
a substitute for verifying in the app.

```
node dev/serve.mjs          # or: npm run dev
# -> http://127.0.0.1:5599/
```

Stop it with `Ctrl+C`. Nothing is written to disk except `dev/vendor/` (if you run the optional
React vendoring step).

---

## Quick start

| | |
|---|---|
| Run | `npm run dev` (same as `node dev/serve.mjs`) |
| URL | `http://127.0.0.1:5599/` |
| Port | `--port 5601`, `--port=5601` or `PORT=5601` (default `5599`) |
| Address | `--host 0.0.0.0` if another machine must reach it (default `127.0.0.1`) |
| Seed | `--scenario rich.json` (default: `rich.json` when present, else the first scenario) |
| Real board | `--doc "C:\...\design-board.json"` — **read-only** seed of a real board file |
| Quiet | `--quiet` disables the one-line-per-request log |
| Help | `node dev/serve.mjs --help` |

The server prints its URL, the seeded scenario and the routes on start, then one line per request:

```
10:11:14.080 POST /design-canvas/ops -> 200 27141b 3ms ops=1[layer.add] errors=0
```

That log line is the cheapest end-to-end proof that a UI gesture reached the Host API.

---

## What is served

### The page

| Path | Purpose |
|---|---|
| `GET /` | `dev/harness.html` — harness chrome + the plugin panel |
| `GET /harness.js`, `GET /harness.css` | harness driver and its (token + chrome) stylesheet |
| `GET /client.js` | **assembled in memory from `src/client/*.js` on every request** |
| `GET /client.built.js` | the committed `client.js` artifact (see `?bundle=built`) |
| `GET /vendor/react*.js` | optional vendored React 18 UMD |

### The mock Host API

Same shapes as `host/routes.js`, so the client works unmodified:

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/design-canvas/health` | `{ok:true,name:'design-canvas',version:'dev'}` |
| `GET` | `/design-canvas/state?sessionId=` | `{ok,sessionId,path,version,doc,ui:{connected,lastReport}}` |
| `POST` | `/design-canvas/ops` | `{sessionId,ops,atomic?}` → `applyOps` → `{ok,version,applied,errors,doc}` |
| `POST` | `/design-canvas/report` | records the report, `{ok,serverTime}` |
| `GET` | `/design-canvas/ping` | 1×1 transparent GIF; records stage beacons |
| `GET` | `/design-canvas/_debug` | ring of pings + reports + current scenario/version |

`sessionId` may be any non-empty string (`dev-session`); there is no session service to check
against, so the "no-session" path is never taken.

### Dev control API (harness only)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/dev/scenarios` | list `dev/docs/*.json` with artboard/layer/comment counts |
| `POST` | `/dev/scenario` | `{name:"rich"}` or `{name:"rich.json"}` → swap doc, version back to 1 |
| `POST` | `/dev/reset` | re-read the current scenario from disk (or the `--doc` file) |
| `GET` | `/dev/doc` | current mock document + version + scenario |
| `POST` | `/dev/doc` | `{doc}` → replace the document (normalized), version + 1 |
| `GET` | `/dev/bundle` | parts/bytes of the live-assembled bundle |
| `GET` | `/dev/built-info` | bytes of the committed `client.js` |
| `GET` | `/dev/vendor-status` | whether `dev/vendor/` has both React files |
| `GET` | `/dev/where?line=N` | map a line in the assembled bundle → `src/client/<part>:<line>` |

---

## Scenarios (`dev/docs/`)

Every file is a board document as the Host would store it: already passed through
`normalizeDoc`, so re-reading it changes nothing (that property is checked, see
`dev/check-docs.mjs`).

| File | What it is for |
|---|---|
| `rich.json` | The main demo. 3 artboards (desktop 1440×900, mobile 390×844, components 720×480) and 78 layers: an auto-layout header (row, gap, padding, `justify:space-between`), a wrapped card grid, a hero with a type ramp, gradient + radial fills, an ellipse, a shadowed hero image and cards, an inline-SVG image layer (works offline), hairline dividers, nested frames 3 levels deep, `opacity`, a `visible:false` layer, and 4 comments (3 open, 1 resolved, one of them board-level). |
| `starter.json` | Copy of `examples/starter-board.json` — the document the Host creates for a new workspace (1 artboard, 4 layers). |
| `empty.json` | A valid document with no artboards — exercises the "No artboards yet → Add artboard" empty state. |

Adding a scenario: drop another normalized `*.json` into `dev/docs/`; the server lists it on the
next `/dev/scenarios` (a page reload picks it up) and `POST /dev/scenario` can switch to it.

---

## The harness page

The left column is harness chrome (never the plugin). The right is a sized box — **the plugin's
`<body>` mounted exactly like the sidebar tab body**, with `props.sessionId = 'dev-session'`:

```js
const plugin = window.__dc.factory((id) => { if (id === 'react') return window.React; throw ... })
plugin.apply(ctx)                                  // stub of the five injected services
ReactDOM.createRoot(panel).render(React.createElement(body, { sessionId: 'dev-session' }))
```

Controls:

* **Scenario** — `POST /dev/scenario` then remount (a swap resets the version, and the plugin's
  poller only accepts *newer* versions, so a remount is the honest way to reload).
* **Remount / Reset doc** — recreate the React root / re-read the scenario from disk.
* **Panel width** — 360–1000 px (default 460, the right-sidebar width). The panel is 900 px tall;
  the stage scrolls.
* **Theme** — light/dark, switches the `[data-theme]` token block only.
* **Reload bundle** — re-fetch `/client.js` (live parts) and re-apply the plugin, without a page
  reload. Use this after editing `src/client/*.js`.
* **Events** — window errors, unhandled rejections, the plugin's `<img>` beacons (`/design-canvas/ping`)
  and its JSON traffic, plus recorded chat prompts. Newest first.
* **Facts** — slots registered, React source, bundle size, doc version/counts, ops applied, chat
  prompts sent, error count.

### React 18 UMD

React is not bundled with the plugin (it comes from `require('react')`), so the page loads React
18.3.1 UMD and hands it to the module factory.

* If `dev/vendor/react.development.js` **and** `react-dom.development.js` exist, they win (offline).
* Otherwise the page loads them from `unpkg.com`; if that fails it reports the failure in the event
  console and the overlay.
* `?react=unpkg` forces the CDN even when vendored — handy for proving that path still works.

To vendor (optional, gitignored — these are third-party bundles):

```
node dev/fetch-vendor.mjs          # writes dev/vendor/react.development.js + react-dom.development.js
node dev/fetch-vendor.mjs --force  # refetch
```

`dev/vendor/` is the only ignored path under `dev/`; the rest of this directory is committed.

---

## Scripting it (`window.__harness`)

```js
__harness.scenario('starter.json')   // Promise — POST /dev/scenario, then remount
__harness.getDoc()                   // Promise<doc> — the mock Host document
__harness.setDoc(doc)                // Promise — POST /dev/doc (normalized) + version bump + remount
__harness.remount()                  // recreate the React root (fresh plugin state)
__harness.reload()                   // Promise — re-fetch /client.js and re-apply (live parts)
__harness.stats()                    // synchronous snapshot: scenario, facts, slots, ops, errors,
                                     // panelWidth, theme, bundle {parts,bytes,source}, mounted
__harness.log()                      // recent harness events, newest last
__harness.prompts()                  // chat prompts the plugin sent (revision requests), newest last
```

Notes:

* The chat session service is a stub. `sessions.binding()` returns `null` and
  `sessions.using(id, opts, run)` runs the callback against a fake `session.prompt(parts, mode)`
  that **records** the message and resolves — so comment → chat is observable through
  `__harness.prompts()` instead of failing with "no chat session".
* `getDoc()` / `setDoc()` talk to `/dev/doc`; the plugin itself still talks to
  `/design-canvas/*`, which is what makes the round-trip meaningful.
* A scenario swap resets `version` to 1, so the plugin's poller will not *pull* the new document —
  use `__harness.scenario()`, `setDoc()`, or the Scenario select, which remount instead.

Example — assert an add-rect gesture round-trips:

```js
const before = (await __harness.getDoc()).artboards[0].layers.length
// click the Rectangle toolbar button, then:
const after = (await __harness.getDoc()).artboards[0].layers.length   // before + 1
__harness.stats().ops                                                  // POST /ops count seen
```

---

## Theme tokens

The plugin's stylesheet only uses `var(--dsw-alias-*)`; the surrounding page owns the values. All
13 tokens it references are defined in `dev/harness.css` under `[data-theme="light"]` and
`[data-theme="dark"]`.

The values are **not invented** — they were extracted from the running installation's theme sheet
(`body` and `body[data-ds-dark-theme]` blocks inside
`C:\Users\1\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\`), with the
`var(--dsw-static-*)` references resolved. Notably `--dsw-alias-brand-primary` is **monochrome** in
the real themes (`#0f1115` light / `#f9fafb` dark); the blue accent lives in a different token
(`--dsw-alias-brand-primary-new-colorprimary-new-color` = `#4176e6`) that this plugin does not read.
That is why the canvas accent is near-black rather than blue in the app.

If the app's theme changes upstream, re-extract and update the two blocks; nothing else in this
harness hardcodes a token value.

---

## Interim shim (now inert — delete when convenient)

`dev/harness.css` contains one deliberate override of plugin CSS:

```css
.dc-stage { transform-origin: 0 0 !important; }
```

`.dc-stage` used to be positioned with `translate(x, y) scale(z)`; with the default 50% 50% origin
the whole stage is displaced by `originX * (1 - z)` (≈482 px at 33% zoom), which pushed every
artboard outside the panel. For a while `src/client/42-css.js` shipped the stage rule without
`transform-origin: 0 0`, so the harness pinned it from the outside rather than editing production
CSS mid-rewrite.

The shell has since switched the stage to CSS `zoom` (computed `transform: none`), which makes the
origin irrelevant, so this rule is now a **no-op**. It is harmless — and it keeps the harness
correct if anyone reintroduces a transform-based camera. Delete it with the "Interim shims" comment
block in `dev/harness.css` whenever that is clearly done.

---

## Working with several agents on one server

* The document store is **one in-memory doc per server process** — every harness tab pointed at the
  same server shares it. Two agents editing the canvas will see each other's layers and version
  bumps. That is useful (a shared demo board) but it means "my doc" is not a private sandbox: use
  `Reset doc`, or run a second server on another port (`node dev/serve.mjs --port 5601`) for an
  isolated one.
* Harness preferences (panel width, theme) are kept in **`sessionStorage`**, i.e. per tab, because
  all agents' windows share one Chrome profile/origin — `localStorage` would let one agent's theme
  leak into another's screenshots.
* `GET /client.js` reads the parts on **every** request and caches nothing, so it always shows the
  current work of every author. No one needs to run `npm run build` to use the harness (and nobody
  should, while several authors are mid-edit: it rewrites the shared artifact).
* A torn read while a part is being saved shows up in the browser as `Uncaught SyntaxError` for the
  bundle. The harness resolves the line back to the file and logs
  `syntax error in src/client/55-inspector.js:563 — <source line>`; reload once the author has
  saved. `GET /dev/where?line=N` does the same mapping from the outside.
* `?bundle=built` serves the committed `client.js` instead of the live parts — the escape hatch for
  bisecting a regression in an in-flight part against the last known good bundle.

---

## Verifying a scenario document

```
node dev/check-docs.mjs
```

Normalizes every `dev/docs/*.json` with `normalizeDoc` and fails (exit 1) if a file would change,
printing the first differing path. Hand-authored boards should be written in normalized form: the
model fills defaults, drops unknown properties and rejects out-of-range values, so a file that only
"works" because the app repairs it will drift.

---

## This is a dev tool, not shipped

`package.json` `files` does not include `dev/`, and the published bundle is `index.js` + `host/*` +
`client.js` + manifest/locale/icon only. This directory exists so humans and agents can see and test
the canvas UI quickly; keep it out of the published package.
