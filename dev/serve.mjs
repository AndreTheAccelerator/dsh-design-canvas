/**
 * Design canvas — local development preview server.
 *
 * A zero-dependency Node HTTP server that reproduces the Host's `/design-canvas` API in
 * memory and serves a harness page, so the real browser half of the plugin can be opened and
 * driven in Chrome without the desktop DSH GUI (whose page is `dsh-app://app/` behind auth).
 *
 * Two deliberate differences from the shipped Host route, both for development ergonomics:
 *
 *  1. `GET /client.js` is assembled **in memory** from `src/client/*.js` in MANIFEST order on
 *     every request, instead of serving the committed `client.js` artifact. Several authors can
 *     edit client parts in parallel and the harness always shows the current parts without
 *     anyone running `npm run build` (which would rewrite the shared artifact and clobber the
 *     other authors' builds). The committed artifact is still available at `/client.built.js`.
 *  2. The document store is in memory and seeded from a scenario file, so a reload starts from
 *     a known board and nothing is ever written to disk — in particular a `--doc` seed of a real
 *     board is strictly read-only.
 *
 * Usage:
 *   node dev/serve.mjs                      # http://127.0.0.1:5599 with the first scenario
 *   node dev/serve.mjs --port 5601          # or PORT=5601
 *   node dev/serve.mjs --scenario rich.json
 *   node dev/serve.mjs --doc "C:\...\design-board.json"
 *
 * Node builtins only. This is a dev tool; it is not part of the published plugin.
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MANIFEST, PARTS_DIR, ROOT } from '../scripts/build-client.mjs'
import { applyOps, normalizeDoc } from '../host/model.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEV_DIR = HERE
const DOCS_DIR = path.join(DEV_DIR, 'docs')
const VENDOR_DIR = path.join(DEV_DIR, 'vendor')
const ARTIFACT = path.join(ROOT, 'client.js')

const MAX_JSON_BYTES = 1 * 1024 * 1024
const MAX_DOC_BYTES = 8 * 1024 * 1024
const MAX_PINGS = 60
const MAX_REPORTS = 40

/**
 * The canvas page reaches the Host with a 1x1 `<img>` GET when `fetch` is blocked. Keep the
 * same diagnostic shape as `host/routes.js` so the harness shows real traffic.
 */
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

function parseArgv(argv) {
  const options = {
    port: 5599,
    host: '127.0.0.1',
    scenario: '',
    doc: '',
    log: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, '']
    const take = () => (inline !== '' ? inline : argv[++index] ?? '')
    if (flag === '--port') options.port = Number(take())
    else if (flag === '--host') options.host = take()
    else if (flag === '--scenario') options.scenario = take()
    else if (flag === '--doc') options.doc = take()
    else if (flag === '--quiet') options.log = false
    else if (flag === '--help' || flag === '-h') options.help = true
    else if (flag) {
      console.error(`unknown argument: ${arg}`)
      process.exitCode = 1
    }
  }
  if (process.env.PORT && !process.argv.includes('--port') && !process.argv.some((a) => a.startsWith('--port='))) {
    options.port = Number(process.env.PORT)
  }
  if (process.env.HOST && !process.argv.includes('--host') && !process.argv.some((a) => a.startsWith('--host='))) {
    options.host = process.env.HOST
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error(`invalid port: ${options.port}`)
    process.exitCode = 1
  }
  return options
}

const OPTIONS = parseArgv(process.argv.slice(2))

if (OPTIONS.help) {
  console.log(
    [
      'design-canvas dev harness',
      '',
      '  node dev/serve.mjs [--port <n>] [--host <addr>] [--scenario <name>] [--doc <abs path>]',
      '',
      '  --port      listen port (default 5599, or $env:PORT)',
      '  --host      listen address (default 127.0.0.1)',
      '  --scenario  dev/docs/<name>.json to seed (default: first scenario found)',
      '  --doc       absolute path to a real board JSON, seeded read-only',
      '  --quiet     do not log a line per request',
    ].join('\n'),
  )
  process.exit(0)
}

/* ------------------------------------------------------------------------------------------------
 * In-memory document store
 * ---------------------------------------------------------------------------------------------- */

const store = {
  /** Current document (already passed through normalizeDoc). */
  doc: normalizeDoc({ name: 'Untitled design', artboards: [], comments: [] }),
  version: 1,
  /** `dev/docs/rich.json`, or `file:///C:/.../design-board.json` for --doc seeds. */
  path: 'dev/docs/starter.json',
  scenario: 'starter.json',
  /** Set when the seed came from --doc: never written anywhere, but never silently replaced. */
  external: '',
  pings: [],
  reports: [],
}

function nowIso() {
  return new Date().toISOString()
}

function scenarioFiles() {
  return readdir(DOCS_DIR)
    .then((names) => names.filter((name) => name.endsWith('.json')).sort())
    .catch(() => [])
}

/** Resolve a scenario request to a file inside dev/docs (never outside it). */
function resolveScenarioName(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return ''
  const base = path.basename(trimmed)
  const file = base.endsWith('.json') ? base : `${base}.json`
  if (file !== base || base.startsWith('.')) return ''
  return file
}

async function loadScenarioDoc(file) {
  const abs = path.join(DOCS_DIR, file)
  const text = await readFile(abs, 'utf8')
  const parsed = JSON.parse(text)
  return normalizeDoc(parsed)
}

async function seedScenario(file, quiet) {
  const resolved = resolveScenarioName(file)
  if (!resolved) throw Object.assign(new Error(`unknown scenario: ${file}`), { code: 'bad-request' })
  const doc = await loadScenarioDoc(resolved)
  store.doc = doc
  store.version = 1
  store.path = `dev/docs/${resolved}`
  store.scenario = resolved
  store.external = ''
  if (!quiet) console.log(`seed: dev/docs/${resolved} (${countLayers(doc)} layers, ${doc.artboards.length} artboards)`)
  return { scenario: store.scenario, path: store.path, version: store.version, doc: store.doc }
}

async function seedFromPath(absPath) {
  const resolved = path.resolve(absPath)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`not a file: ${resolved}`)
  const text = await readFile(resolved, 'utf8')
  const doc = normalizeDoc(JSON.parse(text))
  store.doc = doc
  store.version = Math.max(1, Number(doc.version) || 1)
  store.path = resolved
  store.scenario = path.basename(resolved)
  store.external = resolved
  console.log(`seed: ${resolved} (read-only, ${countLayers(doc)} layers, version ${store.version})`)
  return doc
}

function countLayers(doc) {
  let total = 0
  const walk = (layers) => {
    for (const layer of layers || []) {
      total += 1
      if (layer.type === 'frame') walk(layer.children)
    }
  }
  for (const artboard of doc.artboards || []) walk(artboard.layers)
  return total
}

function uiState() {
  const lastReport = store.reports.length ? store.reports[store.reports.length - 1] : null
  return { connected: true, lastReport }
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function logLine(req, status, bytes, startedAt, extra) {
  if (!OPTIONS.log) return
  const ms = Date.now() - startedAt
  const stamp = new Date().toISOString().slice(11, 23)
  const suffix = extra ? ` ${extra}` : ''
  console.log(`${stamp} ${req.method.padEnd(4)} ${req.url} -> ${status} ${bytes}b ${ms}ms${suffix}`)
}

function sendJson(req, res, status, body, startedAt, extra) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') res.end()
  else res.end(text)
  if (startedAt !== undefined) logLine(req, status, Buffer.byteLength(text), startedAt, extra)
}

function sendText(req, res, status, type, text, startedAt, extra) {
  const buffer = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'content-type': type,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  if (req.method === 'HEAD') res.end()
  else res.end(buffer)
  if (startedAt !== undefined) logLine(req, status, buffer.length, startedAt, extra)
}

function failure(req, res, status, code, message, startedAt) {
  sendJson(req, res, status, { ok: false, error: { code, message } }, startedAt)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error(`request body is too large (max ${limit} bytes)`), { code: 'bad-request', status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => reject(error))
  })
}

async function readJsonBody(req, limit) {
  const text = await readBody(req, limit)
  if (!text.trim()) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { code: 'bad-request' })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('request body must be a JSON object'), { code: 'bad-request' })
  }
  return value
}

/** Concatenate the current client parts exactly like scripts/build-client.mjs does. */
async function assembleBundle() {
  const chunks = []
  for (const name of MANIFEST) {
    const text = await readFile(path.join(PARTS_DIR, name), 'utf8')
    chunks.push(text.endsWith('\n') ? text : `${text}\n`)
  }
  return chunks.join('')
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

async function serveFile(req, res, absPath, startedAt) {
  let body
  try {
    body = await readFile(absPath)
  } catch {
    failure(req, res, 404, 'not-found', `no such file: ${path.relative(ROOT, absPath)}`, startedAt)
    return
  }
  const type = STATIC_TYPES[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  sendText(req, res, 200, type, body, startedAt)
}

/** Resolve a URL path under a directory, refusing traversal outside it. */
function safeJoin(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath)
  const joined = path.resolve(baseDir, `.${path.posix.normalize(decoded)}`)
  return joined === baseDir || joined.startsWith(`${baseDir}${path.sep}`) ? joined : ''
}

async function vendorStatus() {
  const files = ['react.development.js', 'react-dom.development.js']
  const found = {}
  for (const file of files) {
    try {
      const info = await stat(path.join(VENDOR_DIR, file))
      found[file] = info.size
    } catch {
      found[file] = 0
    }
  }
  return {
    ok: true,
    dir: 'dev/vendor',
    available: files.every((file) => found[file] > 0),
    files: found,
    hint: 'run `node dev/fetch-vendor.mjs` to vendor React 18 UMD for offline use',
  }
}

/** Map a line number in the assembled bundle back to `src/client/<part>` + local line. */
async function mapBundleLine(lineNumber) {
  if (!Number.isFinite(lineNumber) || lineNumber < 1) return { part: null }
  let offset = 1
  for (const name of MANIFEST) {
    let text
    try {
      text = await readFile(path.join(PARTS_DIR, name), 'utf8')
    } catch {
      return { part: name, localLine: null }
    }
    const count = (text.match(/\n/g) || []).length + (text.endsWith('\n') ? 0 : 1)
    if (lineNumber >= offset && lineNumber < offset + count) {
      const localLine = lineNumber - offset + 1
      const lines = text.split('\n')
      return {
        part: `src/client/${name}`,
        localLine,
        source: (lines[localLine - 1] ?? '').slice(0, 240),
      }
    }
    offset += count
  }
  return { part: null }
}

async function scenarioList() {
  const names = await scenarioFiles()
  const scenarios = []
  for (const name of names) {
    try {
      const text = await readFile(path.join(DOCS_DIR, name), 'utf8')
      const doc = normalizeDoc(JSON.parse(text))
      scenarios.push({
        name,
        id: name.replace(/\.json$/, ''),
        artboards: doc.artboards.length,
        layers: countLayers(doc),
        comments: doc.comments.length,
        bytes: Buffer.byteLength(text),
        title: doc.name,
      })
    } catch (error) {
      scenarios.push({ name, id: name.replace(/\.json$/, ''), error: String(error.message || error) })
    }
  }
  return scenarios
}

/* ------------------------------------------------------------------------------------------------
 * Routes
 * ---------------------------------------------------------------------------------------------- */

async function handle(req, res) {
  const startedAt = Date.now()
  const method = String(req.method || 'GET').toUpperCase()
  let url
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  } catch {
    failure(req, res, 400, 'bad-request', 'malformed request URL', startedAt)
    return
  }
  const pathname = url.pathname

  try {
    /* ------------------------------- page + assets ------------------------------- */

    if (pathname === '/' || pathname === '/index.html') {
      await serveFile(req, res, path.join(DEV_DIR, 'harness.html'), startedAt)
      return
    }

    if (pathname === '/harness.js' || pathname === '/harness.css') {
      await serveFile(req, res, path.join(DEV_DIR, pathname.slice(1)), startedAt)
      return
    }

    if (pathname === '/client.js') {
      const source = await assembleBundle()
      sendText(req, res, 200, 'text/javascript; charset=utf-8', source, startedAt, `(assembled ${MANIFEST.length} parts)`)
      return
    }

    if (pathname === '/client.built.js') {
      await serveFile(req, res, ARTIFACT, startedAt)
      return
    }

    if (pathname.startsWith('/vendor/')) {
      const target = safeJoin(VENDOR_DIR, pathname.slice('/vendor'.length))
      if (!target) {
        failure(req, res, 400, 'bad-request', 'bad vendor path', startedAt)
        return
      }
      await serveFile(req, res, target, startedAt)
      return
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      logLine(req, 204, 0, startedAt)
      return
    }

    /* ------------------------------- dev control API ------------------------------ */

    if (method === 'GET' || method === 'HEAD') {
      if (pathname === '/dev/scenarios') {
        sendJson(req, res, 200, {
          ok: true,
          current: store.scenario,
          path: store.path,
          version: store.version,
          scenarios: await scenarioList(),
        }, startedAt)
        return
      }
      if (pathname === '/dev/vendor-status') {
        sendJson(req, res, 200, await vendorStatus(), startedAt)
        return
      }
      if (pathname === '/dev/bundle') {
        const source = await assembleBundle()
        sendJson(req, res, 200, {
          ok: true,
          parts: MANIFEST.length,
          bytes: Buffer.byteLength(source),
          manifest: MANIFEST,
          source: 'src/client/*.js',
        }, startedAt)
        return
      }
      if (pathname === '/dev/where') {
        // Map a line number in the assembled bundle back to src/client/<part>:<line>. Agents
        // edit parts in parallel and a torn read during a save surfaces in the browser as
        // "Uncaught SyntaxError" against the bundle; this names the file to fix.
        const line = Number(url.searchParams.get('line') ?? '0')
        const mapping = await mapBundleLine(line)
        sendJson(req, res, 200, { ok: true, line, ...mapping }, startedAt)
        return
      }
      if (pathname === '/dev/built-info') {
        // The committed artifact, for bisecting live parts against the last known good bundle.
        let bytes = 0
        try {
          bytes = (await stat(ARTIFACT)).size
        } catch {
          bytes = 0
        }
        sendJson(req, res, 200, { ok: true, bytes, artifact: 'client.js', source: 'committed artifact' }, startedAt)
        return
      }
      if (pathname === '/dev/doc') {
        sendJson(req, res, 200, { ok: true, scenario: store.scenario, path: store.path, version: store.version, doc: store.doc }, startedAt)
        return
      }
    }

    if (method === 'POST') {
      if (pathname === '/dev/scenario') {
        const body = await readJsonBody(req, MAX_JSON_BYTES)
        const name = String(body.name ?? body.id ?? '')
        const seeded = await seedScenario(name, true)
        sendJson(req, res, 200, {
          ok: true,
          scenario: seeded.scenario,
          path: seeded.path,
          version: seeded.version,
          artboards: seeded.doc.artboards.length,
          layers: countLayers(seeded.doc),
        }, startedAt, `scenario=${seeded.scenario}`)
        return
      }
      if (pathname === '/dev/reset') {
        if (store.external) {
          // A --doc seed is re-read from its file; it is never written back.
          await seedFromPath(store.external)
        } else {
          await seedScenario(store.scenario, true)
        }
        sendJson(req, res, 200, {
          ok: true,
          scenario: store.scenario,
          path: store.path,
          version: store.version,
          artboards: store.doc.artboards.length,
          layers: countLayers(store.doc),
        }, startedAt, 'reset')
        return
      }
      if (pathname === '/dev/doc') {
        const body = await readJsonBody(req, MAX_DOC_BYTES)
        if (!body || !Array.isArray(body.doc?.artboards)) {
          failure(req, res, 400, 'bad-request', 'body must be { doc: { artboards: [...] } }', startedAt)
          return
        }
        store.doc = normalizeDoc(body.doc)
        store.version += 1
        store.doc.version = store.version
        store.external = ''
        sendJson(req, res, 200, { ok: true, version: store.version, artboards: store.doc.artboards.length, layers: countLayers(store.doc) }, startedAt, 'set-doc')
        return
      }
    }

    /* ------------------------------- mock Host API -------------------------------- */

    if (pathname === '/design-canvas/health' && (method === 'GET' || method === 'HEAD')) {
      sendJson(req, res, 200, { ok: true, name: 'design-canvas', version: 'dev' }, startedAt)
      return
    }

    if (pathname === '/design-canvas/ping' && (method === 'GET' || method === 'HEAD')) {
      store.pings.push({
        time: nowIso(),
        stage: (url.searchParams.get('m') ?? '').slice(0, 160),
        data: (url.searchParams.get('d') ?? '').slice(0, 600),
      })
      if (store.pings.length > MAX_PINGS) store.pings.shift()
      res.writeHead(200, {
        'content-type': 'image/gif',
        'cache-control': 'no-store',
        'content-length': TRANSPARENT_GIF.length,
      })
      if (method === 'HEAD') res.end()
      else res.end(TRANSPARENT_GIF)
      logLine(req, 200, TRANSPARENT_GIF.length, startedAt, `ping=${(url.searchParams.get('m') ?? '').slice(0, 60)}`)
      return
    }

    if (pathname === '/design-canvas/_debug' && (method === 'GET' || method === 'HEAD')) {
      sendJson(req, res, 200, {
        ok: true,
        pings: store.pings,
        count: store.pings.length,
        reports: store.reports,
        scenario: store.scenario,
        path: store.path,
        version: store.version,
      }, startedAt)
      return
    }

    if (pathname === '/design-canvas/state' && (method === 'GET' || method === 'HEAD')) {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!sessionId) {
        failure(req, res, 400, 'no-session', 'the design canvas needs a live chat Session id (none was provided)', startedAt)
        return
      }
      sendJson(req, res, 200, {
        ok: true,
        sessionId,
        path: store.path,
        version: store.version,
        doc: store.doc,
        ui: uiState(),
      }, startedAt)
      return
    }

    if (pathname === '/design-canvas/ops' && method === 'POST') {
      const body = await readJsonBody(req, MAX_JSON_BYTES)
      const ops = body.ops
      if (!Array.isArray(ops)) {
        failure(req, res, 400, 'bad-request', 'ops must be an array of operation objects', startedAt)
        return
      }
      const result = applyOps(store.doc, ops, { atomic: body.atomic === true })
      store.doc = result.doc
      store.version += 1
      store.doc.version = store.version
      store.doc.updatedAt = nowIso()
      const kinds = ops.map((op) => (op && typeof op.type === 'string' ? op.type : '?')).join(',')
      sendJson(req, res, 200, {
        ok: true,
        version: store.version,
        applied: result.applied,
        errors: result.errors,
        doc: store.doc,
      }, startedAt, `ops=${ops.length}[${kinds.slice(0, 80)}] errors=${result.errors.length}`)
      return
    }

    if (pathname === '/design-canvas/report' && method === 'POST') {
      const body = await readJsonBody(req, MAX_JSON_BYTES)
      const report = JSON.parse(
        JSON.stringify({
          time: nowIso(),
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
          kind: typeof body.kind === 'string' ? body.kind.slice(0, 40) : 'report',
          message: typeof body.message === 'string' ? body.message.slice(0, 4000) : null,
          stats: body.stats ?? null,
          services: body.services ?? null,
        }),
      )
      store.reports.push(report)
      if (store.reports.length > MAX_REPORTS) store.reports.shift()
      sendJson(req, res, 200, { ok: true, serverTime: nowIso() }, startedAt, `report=${report.kind}`)
      return
    }

    if (pathname.startsWith('/design-canvas/')) {
      failure(req, res, 404, 'not-found', `unknown design-canvas path: ${pathname}`, startedAt)
      return
    }

    if (pathname.startsWith('/dev/')) {
      failure(req, res, 404, 'not-found', `unknown dev path: ${pathname}`, startedAt)
      return
    }

    // Anything else resolves inside dev/ so extra harness assets work without touching routes.
    const target = safeJoin(DEV_DIR, pathname)
    if (target) {
      await serveFile(req, res, target, startedAt)
      return
    }

    failure(req, res, 404, 'not-found', `no route for ${pathname}`, startedAt)
  } catch (error) {
    const status = Number(error?.status) || 500
    const code = typeof error?.code === 'string' ? error.code : 'internal'
    const message = typeof error?.message === 'string' ? error.message : 'dev server failed'
    if (status >= 500) console.error('  !', error)
    failure(req, res, status, code, message, startedAt)
  }
}

/* ------------------------------------------------------------------------------------------------
 * Boot
 * ---------------------------------------------------------------------------------------------- */

async function bootstrap() {
  if (OPTIONS.doc) {
    try {
      await seedFromPath(OPTIONS.doc)
    } catch (error) {
      console.error(`could not seed from --doc ${OPTIONS.doc}: ${error.message}`)
      process.exitCode = 1
      return false
    }
  } else {
    let file = resolveScenarioName(OPTIONS.scenario)
    if (!file) {
      const names = await scenarioFiles()
      file = names.includes('rich.json') ? 'rich.json' : names[0] ?? ''
    }
    if (!file) {
      console.error(`no scenario documents found in ${DOCS_DIR}`)
      process.exitCode = 1
      return false
    }
    try {
      await seedScenario(file)
    } catch (error) {
      console.error(`could not seed scenario ${file}: ${error.message}`)
      process.exitCode = 1
      return false
    }
  }
  return true
}

const ready = await bootstrap()

if (ready) {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: { code: 'internal', message: String(error?.message || error) } }))
      } else {
        res.end()
      }
      console.error('  ! unhandled', error)
    })
  })

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`port ${OPTIONS.port} is already in use — pass --port <n> or stop the other server`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  })

  server.listen(OPTIONS.port, OPTIONS.host, () => {
    console.log('')
    console.log('  design-canvas dev harness')
    console.log(`  ${'-'.repeat(46)}`)
    console.log(`  page      http://${OPTIONS.host}:${OPTIONS.port}/`)
    console.log(`  scenario  ${store.scenario} (${countLayers(store.doc)} layers, ${store.doc.artboards.length} artboards)`)
    console.log(`  doc path  ${store.path}${store.external ? '  [read-only seed]' : ''}`)
    console.log(`  bundle    assembled from ${MANIFEST.length} parts in src/client/ (in memory)`)
    console.log(`  api       /design-canvas/{health,state,ops,report,ping,_debug}`)
    console.log(`  control   /dev/{scenarios,scenario,reset,doc,vendor-status,bundle}`)
    console.log('')
    console.log('  Ctrl+C to stop. Nothing is written to disk.')
    console.log('')
  })

  const shutdown = (signal) => {
    console.log(`\n${signal}: stopping dev server`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
