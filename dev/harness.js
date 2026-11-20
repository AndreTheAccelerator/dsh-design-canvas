/**
 * Design canvas — dev harness driver.
 *
 * What this file does, in order:
 *   1. installs the event console (window errors, unhandled rejections, the plugin's own
 *      `<img>` beacons and JSON fetches),
 *   2. asks the dev server which scenarios exist and which one is seeded,
 *   3. loads React 18 UMD (`dev/vendor/` when vendored, otherwise unpkg.com),
 *   4. loads `/client.js` — assembled live from `src/client/*.js` by `dev/serve.mjs` — after
 *      installing the `window.__ModuleLoader__` capture shim,
 *   5. calls `plugin.factory(require)` then `plugin.apply(stubCtx)` with a stub of the five
 *      services the real plugin injects,
 *   6. mounts the registered `sidebar.right.pane.tab` body with `{ sessionId: 'dev-session' }`
 *      into `#panel`, which the harness sizes like the DSH right sidebar.
 *
 * The plugin is never modified: everything it needs from the Host is a same-origin fetch against
 * `/design-canvas/*`, which dev/serve.mjs answers from an in-memory document.
 */

const SESSION_ID = 'dev-session'
const PANEL_MIN = 360
const PANEL_MAX = 1000
const LOG_LIMIT = 240
const BEACON_URL = /\/design-canvas\/ping(\?|$)/
const API_URL = /\/design-canvas\/(state|ops|report|health|_debug)/

const UNPKG_REACT = 'https://unpkg.com/react@18.3.1/umd/react.development.js'
const UNPKG_REACT_DOM = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'
const VENDOR_REACT = '/vendor/react.development.js'
const VENDOR_REACT_DOM = '/vendor/react-dom.development.js'

/**
 * `/client.js` is assembled live from `src/client/*.js` (the default: always shows everyone's
 * current work). `?bundle=built` serves the committed `client.js` artifact instead, which is the
 * escape hatch for bisecting a regression in someone's in-flight part against the last known
 * good bundle — no rebuild, no touching their files.
 */
const BUNDLE_SOURCE = new URLSearchParams(location.search).get('bundle') === 'built' ? 'built' : 'parts'

/* ------------------------------------------------------------------------------------------------
 * Event console
 * ---------------------------------------------------------------------------------------------- */

const ui = {
  log: document.getElementById('log'),
  logEmpty: document.getElementById('log-empty'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  overlayDetail: document.getElementById('overlay-detail'),
  panel: document.getElementById('panel'),
  status: document.getElementById('status-pill'),
  bundlePill: document.getElementById('bundle-pill'),
  boardName: document.getElementById('board-name'),
  boardMeta: document.getElementById('board-meta'),
  scenario: document.getElementById('scenario'),
  width: document.getElementById('width'),
  widthOut: document.getElementById('width-out'),
  theme: document.getElementById('theme'),
}

const state = {
  log: [],
  errors: [],
  /** Chat prompts the plugin sent through the `sessions` service (revision requests). */
  prompts: [],
  react: '—',
  bundle: { parts: 0, bytes: 0 },
  facts: { version: 0, artboards: 0, layers: 0, comments: 0, name: '' },
  ops: 0,
  scenario: '',
  lastBeaconAt: 0,
  polling: null,
  ready: false,
}

function stamp() {
  return new Date().toISOString().slice(11, 19)
}

function pushLog(kind, text) {
  state.log.push({ kind, text, time: stamp() })
  if (state.log.length > LOG_LIMIT) state.log.shift()
  renderLog()
}

function renderLog() {
  const { log } = state
  ui.logEmpty.hidden = log.length > 0
  ui.log.innerHTML = ''
  const fragment = document.createDocumentFragment()
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index]
    const item = document.createElement('li')
    item.dataset.kind = entry.kind
    const time = document.createElement('time')
    time.textContent = entry.time
    const text = document.createElement('span')
    text.textContent = entry.text
    item.append(time, text)
    fragment.append(item)
  }
  ui.log.append(fragment)
}

function setStatus(text, tone) {
  ui.status.textContent = text
  ui.status.dataset.state = tone || 'idle'
}

function showOverlay(title, text, detail) {
  ui.overlay.hidden = false
  ui.overlayTitle.textContent = title
  ui.overlayText.textContent = text
  ui.overlayDetail.textContent = detail || ''
  ui.overlayDetail.hidden = !detail
}

function hideOverlay() {
  ui.overlay.hidden = true
}

function noteError(source, message) {
  const line = `${source}: ${message}`
  state.errors.push(line)
  pushLog('error', line)
  updateFact('fact-errors', String(state.errors.length))
}

function updateFact(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

/* ------------------------------ interception: beacons + API traffic ------------------------------ */

// The plugin reports lifecycle stages with `new Image().src = '/design-canvas/ping?...'` because
// an <img> GET survives CSP rules that block fetch. Patch the setter, keep the real behaviour.
const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
if (imageSrc && imageSrc.set && imageSrc.get) {
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() {
      return imageSrc.get.call(this)
    },
    set(value) {
      try {
        if (typeof value === 'string' && BEACON_URL.test(value)) {
          const url = new URL(value, location.href)
          const stage = url.searchParams.get('m') || '(no stage)'
          const data = url.searchParams.get('d')
          pushLog('beacon', data ? `beacon ${stage} ${data}` : `beacon ${stage}`)
          state.lastBeaconAt = Date.now()
        }
      } catch {
        /* logging must never break the beacon */
      }
      return imageSrc.set.call(this, value)
    },
  })
}

const nativeFetch = window.fetch.bind(window)
window.fetch = function harnessFetch(input, init) {
  let url = ''
  try {
    url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  } catch {
    url = String(input)
  }
  const absolute = new URL(url, location.href).href
  const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  const isApi = API_URL.test(absolute) || /\/dev\//.test(absolute)
  return nativeFetch(input, init).then(
    (response) => {
      if (isApi) {
        const label = new URL(absolute).pathname + new URL(absolute).search.replace(/[?&]sessionId=[^&]*/, '')
        if (label.includes('/ops')) state.ops += 1
        pushLog('api', `${method} ${label} -> ${response.status}`)
      }
      return response
    },
    (error) => {
      if (isApi) {
        pushLog('error', `${method} ${new URL(absolute).pathname} -> network error (${error.message})`)
        noteError('fetch', error.message)
      }
      throw error
    },
  )
}

window.addEventListener('error', (event) => {
  if (event.target && event.target !== window && event.target.tagName === 'SCRIPT') {
    noteError('script', `failed to load ${event.target.src}`)
    return
  }
  const where = event.filename ? ` (${String(event.filename).split('/').pop()}:${event.lineno})` : ''
  noteError('window.onerror', `${event.message}${where}`)
  // A parse error in one of the parts surfaces against the assembled bundle. Name the file to
  // fix instead of leaving a bundle-relative line number nobody can use.
  if (event.lineno && /SyntaxError/.test(String(event.message))) explainBundleLine(event.lineno)
})

async function explainBundleLine(lineNumber) {
  try {
    const body = await nativeFetch(`/dev/where?line=${encodeURIComponent(lineNumber)}`).then((r) => r.json())
    if (body && body.ok && body.part) {
      pushLog('warn', `syntax error in ${body.part}:${body.localLine} — ${body.source || '(line unavailable)'}`)
    }
  } catch {
    /* diagnostics must never throw */
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason && reason.message ? reason.message : String(reason)
  noteError('unhandledrejection', message)
})

/* ------------------------------------------------------------------------------------------------
 * React + bundle loading
 * ---------------------------------------------------------------------------------------------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.onload = () => {
      script.remove()
      resolve(src)
    }
    script.onerror = () => {
      script.remove()
      reject(new Error(`could not load ${src}`))
    }
    document.head.append(script)
  })
}

async function ensureReact() {
  if (window.React && window.ReactDOM) {
    state.react = 'already present'
    return state.react
  }
  const vendor = await nativeFetch('/dev/vendor-status')
    .then((response) => response.json())
    .catch(() => ({ available: false }))
  const attempts = []
  if (vendor.available) attempts.push({ label: 'dev/vendor', react: VENDOR_REACT, dom: VENDOR_REACT_DOM })
  attempts.push({ label: 'unpkg.com', react: UNPKG_REACT, dom: UNPKG_REACT_DOM })
  // A forced source is handy when both work and you want to prove the CDN path still renders.
  const forced = new URLSearchParams(location.search).get('react')
  const ordered = forced
    ? [...attempts.filter((a) => a.label.includes(forced)), ...attempts.filter((a) => !a.label.includes(forced))]
    : attempts

  const problems = []
  for (const attempt of ordered) {
    try {
      await loadScript(attempt.react)
      await loadScript(attempt.dom)
      state.react = attempt.label
      pushLog('info', `react 18 UMD from ${attempt.label}`)
      return attempt.label
    } catch (error) {
      problems.push(`${attempt.label}: ${error.message}`)
      pushLog('warn', `react source failed (${attempt.label}); trying the next one`)
    }
  }
  throw new Error(
    `No React 18 UMD available.\n${problems.join('\n')}\n\n` +
      'Offline fix: run `node dev/fetch-vendor.mjs` once, then reload this page.',
  )
}

let bundleScript = null

async function loadBundle() {
  window.__ModuleLoader__ = {
    load(def) {
      window.__dc = def
      pushLog('info', `module registered: ${def && def.id ? def.id : '(no id)'}`)
    },
  }
  delete window.__dc
  const bundlePath = BUNDLE_SOURCE === 'built' ? '/client.built.js' : '/client.js'
  const url = `${bundlePath}?t=${Date.now()}`
  const script = document.createElement('script')
  script.src = url
  script.async = false
  await new Promise((resolve, reject) => {
    script.onload = resolve
    script.onerror = () => reject(new Error(`could not load ${url}`))
    document.head.append(script)
  })
  bundleScript = script
  if (!window.__dc || typeof window.__dc.factory !== 'function') {
    throw new Error('client.js did not call window.__ModuleLoader__.load({ factory })')
  }
  state.bundle = { parts: 0, bytes: 0, source: BUNDLE_SOURCE }
  const info = await nativeFetch(BUNDLE_SOURCE === 'built' ? '/dev/built-info' : '/dev/bundle')
    .then((response) => response.json())
    .catch(() => null)
  if (info && info.ok) {
    state.bundle = { parts: info.parts || 0, bytes: info.bytes || 0, source: BUNDLE_SOURCE }
    updateFact('fact-parts', BUNDLE_SOURCE === 'built' ? `built / ${((info.bytes || 0) / 1024).toFixed(0)} KB` : `${info.parts} / ${((info.bytes || 0) / 1024).toFixed(0)} KB`)
  }
  pushLog(
    'info',
    `bundle loaded from ${BUNDLE_SOURCE === 'built' ? 'the committed client.js artifact' : 'live src/client parts'} (${(state.bundle.bytes / 1024).toFixed(0)} KB)`,
  )
}

/* ------------------------------------------------------------------------------------------------
 * Stub Host context — the five services the plugin injects
 * ---------------------------------------------------------------------------------------------- */

let slotRegistry = new Map()
let tabDefinition = null

function createStubContext() {
  slotRegistry = new Map()
  tabDefinition = null
  const locale = { id: 'en', getLocale: () => ({ active: { id: 'en' } }) }
  const services = {
    sidebarRightTabs: {
      register(def) {
        tabDefinition = def
        pushLog('api', `sidebarRightTabs.register({ id: ${def && def.id}, kind: ${def && def.kind} })`)
        return () => {}
      },
      list() {
        return tabDefinition ? [tabDefinition] : []
      },
    },
    sidebarRight: {
      openTab(kind) {
        pushLog('api', `sidebarRight.openTab(${kind})`)
        return () => {}
      },
      closeTab() {},
    },
    sessions: {
      binding() {
        return null
      },
      using(sessionId, options, run) {
        // The comment workflow's observable side effect IS `session.prompt(...)`, so record it
        // instead of rejecting: a "Design canvas revision request" message then becomes
        // assertable from `window.__harness.prompts()` and from the event console.
        const session = {
          prompt(parts, mode) {
            const text = Array.isArray(parts) && parts[0] ? String(parts[0].text || '') : ''
            state.prompts.push({
              sessionId: String(sessionId || ''),
              source: (options && options.source) || '',
              mode: String(mode || ''),
              text,
              time: stamp(),
            })
            updateFact('fact-prompts', String(state.prompts.length))
            pushLog('prompt', `${mode || 'queue'} · ${text.split('\n')[0].slice(0, 90)} · ${text.length} chars`)
            return Promise.resolve({ ok: true })
          },
        }
        try {
          return Promise.resolve(run({ binding: { session } }))
        } catch (error) {
          return Promise.reject(error)
        }
      },
    },
    locale,
  }
  return {
    get(name) {
      return services[name]
    },
    slots: {
      inject(name, callback) {
        try {
          callback()
        } catch (error) {
          noteError('slots.inject', error.message)
        }
        return () => {}
      },
      register(options, component) {
        const key = options && typeof options.name === 'string' ? options.name : '(unnamed slot)'
        slotRegistry.set(key, { options, component })
        pushLog('info', `slot registered: ${key}`)
        return () => {}
      },
    },
    effect(callback) {
      try {
        callback()
      } catch (error) {
        noteError('ctx.effect', error.message)
      }
      return () => {}
    },
  }
}

/* ------------------------------------------------------------------------------------------------
 * Mount / remount
 * ---------------------------------------------------------------------------------------------- */

let root = null

function unmountPanel() {
  if (root) {
    try {
      root.unmount()
    } catch (error) {
      pushLog('warn', `unmount failed: ${error.message}`)
    }
    root = null
  }
  ui.panel.innerHTML = ''
}

function mountPanel() {
  const entry = slotRegistry.get('sidebar.right.pane.tab')
  if (!entry) {
    throw new Error(
      'the plugin did not register a "sidebar.right.pane.tab" body; slots seen: ' +
        ([...slotRegistry.keys()].join(', ') || '(none)'),
    )
  }
  if (!window.React || !window.ReactDOM) throw new Error('React is not loaded')
  unmountPanel()
  root = window.ReactDOM.createRoot(ui.panel)
  root.render(window.React.createElement(entry.component, { sessionId: SESSION_ID }))
  pushLog('info', 'mounted sidebar.right.pane.tab with { sessionId: "dev-session" }')
  updateFact('fact-slots', [...slotRegistry.keys()].map((key) => key.split('.').pop()).join(', '))
}

async function reloadBundle() {
  setStatus('reloading', 'busy')
  ui.bundlePill.dataset.state = 'busy'
  ui.bundlePill.textContent = 'loading'
  try {
    // React is a page-level dependency: load it once, reuse it across bundle reloads.
    await ensureReact()
    updateFact('fact-react', state.react)
    unmountPanel()
    if (bundleScript) {
      bundleScript.remove()
      bundleScript = null
    }
    await loadBundle()
    applyPlugin()
    mountPanel()
    hideOverlay()
    ui.bundlePill.dataset.state = 'ok'
    ui.bundlePill.textContent = 'live'
    setStatus('running', 'ok')
    await refreshFacts()
  } catch (error) {
    ui.bundlePill.dataset.state = 'bad'
    ui.bundlePill.textContent = 'failed'
    setStatus('bundle failed', 'bad')
    noteError('bundle', error.message)
    showOverlay('Could not boot the design canvas', 'The client bundle or React failed to load.', error.message)
  }
}

function applyPlugin() {
  const def = window.__dc
  if (!def || typeof def.factory !== 'function') throw new Error('no module definition captured')
  const plugin = def.factory(function require(id) {
    if (id === 'react') return window.React
    throw new Error(`unexpected require(${id})`)
  })
  if (!plugin || typeof plugin.apply !== 'function') throw new Error('module factory did not return { apply }')
  if (Array.isArray(plugin.inject)) pushLog('info', `plugin.inject: ${plugin.inject.join(', ')}`)
  const ctx = createStubContext()
  plugin.apply(ctx)
  window.__dcPlugin = plugin
  window.__dcCtx = ctx
}

/* ------------------------------------------------------------------------------------------------
 * Facts
 * ---------------------------------------------------------------------------------------------- */

async function refreshFacts() {
  try {
    const response = await nativeFetch('/dev/doc')
    const body = await response.json()
    if (!body || !body.ok) return
    let layers = 0
    const walk = (list) => {
      for (const layer of list || []) {
        layers += 1
        if (layer.type === 'frame') walk(layer.children)
      }
    }
    for (const artboard of body.doc.artboards || []) walk(artboard.layers)
    state.facts = {
      version: body.version,
      artboards: (body.doc.artboards || []).length,
      layers,
      comments: (body.doc.comments || []).length,
      name: body.doc.name || '',
      scenario: body.scenario,
    }
    updateFact('fact-version', String(body.version))
    updateFact('fact-counts', `${state.facts.artboards} / ${layers}`)
    updateFact('fact-comments', String(state.facts.comments))
    updateFact('fact-ops', String(state.ops))
    ui.boardName.textContent = state.facts.name || 'Untitled design'
    ui.boardMeta.textContent = `${body.scenario} · v${body.version} · ${state.facts.artboards} artboards · ${layers} layers`
  } catch {
    /* the facts panel is diagnostic only */
  }
}

/* ------------------------------------------------------------------------------------------------
 * Chrome wiring
 * ---------------------------------------------------------------------------------------------- */

async function loadScenarios() {
  const response = await nativeFetch('/dev/scenarios')
  const body = await response.json()
  if (!body || !body.ok) throw new Error('could not list scenarios')
  ui.scenario.innerHTML = ''
  for (const item of body.scenarios) {
    const option = document.createElement('option')
    option.value = item.name
    option.textContent = `${item.id} — ${item.artboards} artboards, ${item.layers} layers${
      item.error ? ' (invalid!)' : ''
    }`
    if (item.name === body.current) option.selected = true
    ui.scenario.append(option)
  }
  state.scenario = body.current
  pushLog('info', `scenarios: ${body.scenarios.map((item) => item.id).join(', ')}`)
  return body
}

async function switchScenario(name) {
  setStatus('switching', 'busy')
  try {
    const response = await nativeFetch('/dev/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await response.json()
    if (!body.ok) throw new Error(body.error ? body.error.message : 'scenario switch failed')
    state.scenario = body.scenario
    pushLog('info', `scenario -> ${body.scenario} (v${body.version}, ${body.layers} layers)`)
    state.ops = 0
    // A scenario swap resets the document version to 1, which the plugin's poller treats as
    // "not newer". Remounting is the honest way to make the client refetch from scratch.
    mountPanel()
    await refreshFacts()
    setStatus('running', 'ok')
  } catch (error) {
    noteError('scenario', error.message)
    setStatus('scenario failed', 'bad')
  }
}

/**
 * Harness preferences live in `sessionStorage`, not `localStorage`: every agent's dev harness
 * tab is its own window over one shared Chrome profile on one origin, so `localStorage` would
 * let one agent's panel width / theme silently change another agent's screenshots. Per-tab
 * storage still survives a reload, which is all a preference needs here.
 */
const prefs = {
  get(key) {
    try {
      return sessionStorage.getItem(key) || ''
    } catch {
      return ''
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* private mode */
    }
  },
}

function setPanelWidth(value) {
  const width = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Number(value) || 460))
  ui.panel.style.width = `${width}px`
  ui.width.value = String(width)
  ui.widthOut.textContent = String(width)
  prefs.set('design-canvas-harness-width', String(width))
}

function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = value
  for (const button of ui.theme.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeValue === value))
  }
  prefs.set('design-canvas-harness-theme', value)
}

function wireChrome() {
  ui.width.addEventListener('input', (event) => setPanelWidth(event.target.value))
  ui.theme.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme-value]')
    if (button) setTheme(button.dataset.themeValue)
  })
  document.getElementById('reload').addEventListener('click', () => reloadBundle())
  document.getElementById('remount').addEventListener('click', () => {
    try {
      mountPanel()
    } catch (error) {
      noteError('remount', error.message)
    }
  })
  document.getElementById('reset').addEventListener('click', async () => {
    try {
      const response = await nativeFetch('/dev/reset', { method: 'POST' })
      const body = await response.json()
      pushLog('info', `doc reset (v${body.version})`)
      state.prompts = []
      updateFact('fact-prompts', '0')
      mountPanel()
      await refreshFacts()
    } catch (error) {
      noteError('reset', error.message)
    }
  })
  document.getElementById('clear-log').addEventListener('click', () => {
    state.log = []
    state.errors = []
    state.prompts = []
    updateFact('fact-prompts', '0')
    updateFact('fact-errors', '0')
    renderLog()
  })
  ui.scenario.addEventListener('change', (event) => switchScenario(event.target.value))

  let savedWidth = ''
  let savedTheme = ''
  try {
    savedWidth = prefs.get('design-canvas-harness-width')
    savedTheme = prefs.get('design-canvas-harness-theme')
  } catch {
    /* private mode */
  }
  setPanelWidth(savedWidth || 460)
  setTheme(savedTheme || 'light')
}

/* ------------------------------------------------------------------------------------------------
 * Scripted API for other agents
 * ---------------------------------------------------------------------------------------------- */

window.__harness = {
  /** Recreate the React root (fresh mount, fresh plugin state in the body). */
  remount() {
    mountPanel()
    return true
  },
  /** Switch the seeded document: `__harness.scenario('rich.json')`. */
  async scenario(name) {
    await switchScenario(name)
    return state.scenario
  },
  /** The current mock Host document. */
  async getDoc() {
    const body = await nativeFetch('/dev/doc').then((response) => response.json())
    return body.doc
  },
  /** Replace the mock Host document (normalized server-side) and remount. */
  async setDoc(doc) {
    const response = await nativeFetch('/dev/doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc }),
    })
    const body = await response.json()
    if (!body.ok) throw new Error(body.error ? body.error.message : 'setDoc failed')
    mountPanel()
    await refreshFacts()
    return body
  },
  /** Snapshot of harness + document state, synchronous. */
  stats() {
    return {
      scenario: state.scenario,
      react: state.react,
      bundle: { ...state.bundle },      facts: { ...state.facts },
      ops: state.ops,
      errors: state.errors.slice(),
      slots: [...slotRegistry.keys()],
      tab: tabDefinition ? { id: tabDefinition.id, kind: tabDefinition.kind } : null,
      panelWidth: ui.panel.getBoundingClientRect().width,
      theme: document.documentElement.dataset.theme,
      mounted: root !== null,
    }
  },
  /** Reload `/client.js` from the live parts (same as the Reload bundle button). */
  async reload() {
    await reloadBundle()
    return true
  },
  /** Recent harness events, newest last. */
  log() {
    return state.log.slice()
  },
  /** Chat prompts the plugin sent (revision requests), newest last. */
  prompts() {
    return state.prompts.slice()
  },
}

/* ------------------------------------------------------------------------------------------------
 * Boot
 * ---------------------------------------------------------------------------------------------- */

async function boot() {
  wireChrome()
  renderLog()
  try {
    await loadScenarios()
  } catch (error) {
    noteError('bootstrap', error.message)
  }
  await reloadBundle()
  state.ready = true
  state.polling = setInterval(refreshFacts, 2000)
  refreshFacts()
}

boot()
