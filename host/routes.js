/**
 * HTTP surface of the design canvas.
 *
 * One prefix route on the Host web server, handled as a plain Node request/response pair so
 * every method works (a `resource` route only answers GET/HEAD):
 *
 *   GET  /design-canvas/health
 *   GET  /design-canvas/state?sessionId=<id>
 *   POST /design-canvas/ops      { sessionId, ops, atomic? }
 *   POST /design-canvas/report   { sessionId, kind, message?, stats?, services? }
 */

const PREFIX = '/design-canvas'
const MAX_BODY_BYTES = 1024 * 1024

/** Image-beacon diagnostics: the canvas page reports stages with <img> GETs. */
const pings = []
const MAX_PINGS = 60

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)


const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function send(res, status, body, method) {
  const text = JSON.stringify(body)
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(text) })
  if (method === 'HEAD') res.end()
  else res.end(text)
}

function failure(res, method, code, message, status) {
  send(res, status, { ok: false, error: { code, message } }, method)
}

class DesignRouteError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new DesignRouteError('bad-request', 'request body is too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => reject(error))
  })
}

async function readJson(req) {
  const text = await readBody(req)
  if (!text.trim()) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new DesignRouteError('bad-request', 'request body is not valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesignRouteError('bad-request', 'request body must be a JSON object')
  }
  return value
}

function splitPath(url) {
  return url.pathname.slice(PREFIX.length).replace(/\/+$/, '') || '/'
}

export function registerDesignRoutes(ctx, store) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
      let url
      try {
        url = new URL(req.url ?? '/', 'http://localhost')
      } catch {
        failure(res, method, 'bad-request', 'malformed request URL', 400)
        return
      }
      const sub = splitPath(url)

      try {
        if (method === 'GET' || method === 'HEAD') {
          if (sub === '/health') {
            send(res, 200, { ok: true, name: 'design-canvas', version: '1.0.0' }, method)
            return
          }
          if (sub === '/ping') {
            pings.push({
              time: new Date().toISOString(),
              stage: (url.searchParams.get('m') ?? '').slice(0, 160),
              data: (url.searchParams.get('d') ?? '').slice(0, 600),
            })
            if (pings.length > MAX_PINGS) pings.shift()
            res.writeHead(200, {
              'content-type': 'image/gif',
              'cache-control': 'no-store',
              'content-length': TRANSPARENT_GIF.length,
            })
            if (method === 'HEAD') res.end()
            else res.end(TRANSPARENT_GIF)
            return
          }
          if (sub === '/_debug') {
            send(res, 200, { ok: true, pings, count: pings.length }, method)
            return
          }
          if (sub === '/state') {
            const sessionId = url.searchParams.get('sessionId') ?? ''
            const state = await store.read(sessionId)
            send(
              res,
              200,
              {
                ok: true,
                sessionId,
                path: state.path,
                version: state.version,
                doc: state.doc,
                ui: state.ui,
              },
              method,
            )
            return
          }
          failure(res, method, 'not-found', `unknown design-canvas path: ${sub}`, 404)
          return
        }

        if (method === 'POST') {
          const body = await readJson(req)
          if (sub === '/ops') {
            const result = await store.applyOps(body.sessionId, body.ops, {
              atomic: body.atomic === true,
              origin: 'ui',
            })
            send(
              res,
              200,
              {
                ok: true,
                version: result.version,
                applied: result.applied,
                errors: result.errors,
                doc: result.doc,
              },
              method,
            )
            return
          }
          if (sub === '/report') {
            const kind = typeof body.kind === 'string' ? body.kind.slice(0, 40) : 'report'
            const report = {
              kind,
              message: typeof body.message === 'string' ? body.message.slice(0, 4000) : null,
              stats: body.stats ?? null,
              services: body.services ?? null,
            }
            // Tool results must be lossless JSON: strip undefined/NaN/functions before anybody
            // hands this report back through `design_read`.
            await store.recordReport(
              typeof body.sessionId === 'string' ? body.sessionId : '',
              JSON.parse(JSON.stringify(report)),
            )
            send(res, 200, { ok: true, serverTime: new Date().toISOString() }, method)
            return
          }
          failure(res, method, 'not-found', `unknown design-canvas path: ${sub}`, 404)
          return
        }

        failure(res, method, 'bad-request', `method ${method} is not supported`, 405)
      } catch (error) {
        if (error instanceof DesignRouteError) {
          failure(res, method, error.code, error.message, error.status)
          return
        }
        const code = typeof error?.code === 'string' ? error.code : 'internal'
        const status =
          code === 'no-session' || code === 'bad-request'
            ? 400
            : code === 'too-large'
              ? 413
              : 500
        const message = typeof error?.message === 'string' ? error.message : 'design canvas failed'
        failure(res, method, code, message, status)
      }
    },
  })
}
