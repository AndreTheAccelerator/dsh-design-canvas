/**
 * Per-Session design document store.
 *
 * One document per workspace: the board is persisted as JSON at
 * `<session cwd>/<options.boardPath>` and cached in memory per absolute path. A cache entry is
 * invalidated by comparing `mtimeMs` + `size` from `fs.stat`, so an outside edit (or a human
 * editing the file) is picked up instead of being overwritten by a stale cache.
 *
 * Every read/mutate pair for one path is serialized through an in-memory promise chain, so the
 * UI route and the agent tools never lose each other's updates.
 *
 * Interface (see CONTRACT.md and host/routes.js):
 *   read(sessionId)                  -> { path, version, doc, ui, absPath }
 *   applyOps(sessionId, ops, opts)   -> { version, doc, applied, errors }
 *   recordReport(sessionId, report)  -> Promise<void>  (empty sessionId -> global fallback)
 *   status(sessionId)                -> { connected, lastReport }
 *
 * Failures throw an Error with a string `code`: 'no-session', 'bad-request', 'io-failed',
 * 'too-large'. All returned/persisted values are lossless JSON (no undefined / NaN / Date).
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { applyOps as applyDocOps, cloneDoc, createStarterDoc, normalizeDoc } from './model.js'

const DEFAULT_BOARD_PATH = 'design-board.json'
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_REPORTS = 20
const MAX_TRACKED_SESSIONS = 200
const MAX_REPORT_JSON_BYTES = 4096

const DEFAULT_OPTIONS = Object.freeze({
  boardPath: DEFAULT_BOARD_PATH,
  maxOpsPerCall: 200,
  maxLayersPerArtboard: 300,
  maxFileBytes: MAX_FILE_BYTES,
  maxReports: MAX_REPORTS,
})

const now = () => new Date().toISOString()

function fail(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampInt(value, min, max, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(number, min), max)
}

function safeClone(value) {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

/** JSON-safe copy with a byte budget; returns undefined when the value cannot be represented. */
function jsonSafe(value, maxBytes) {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    if (typeof text !== 'string') return undefined
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > maxBytes) return { truncated: true, bytes }
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function sanitizeBoardPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return DEFAULT_BOARD_PATH
  return value.trim()
}

function sanitizeReport(report) {
  const source = isPlainObject(report) ? report : {}
  const value = {
    kind: typeof source.kind === 'string' && source.kind ? source.kind.slice(0, 64) : 'report',
    time: now(),
  }
  if (typeof source.message === 'string') value.message = source.message.slice(0, 2000)
  const stats = jsonSafe(source.stats, MAX_REPORT_JSON_BYTES)
  if (stats !== undefined) value.stats = stats
  const services = jsonSafe(source.services, MAX_REPORT_JSON_BYTES)
  if (services !== undefined) value.services = services
  return value
}

function pushReport(ring, value) {
  ring.push(value)
  while (ring.length > MAX_REPORTS) ring.shift()
}

export function createDesignStore(ctx, options) {
  const settings = {
    ...DEFAULT_OPTIONS,
    ...(isPlainObject(options) ? options : {}),
  }
  settings.boardPath = sanitizeBoardPath(settings.boardPath)
  settings.maxOpsPerCall = clampInt(settings.maxOpsPerCall, 1, 1000, DEFAULT_OPTIONS.maxOpsPerCall)
  settings.maxLayersPerArtboard = clampInt(
    settings.maxLayersPerArtboard,
    1,
    5000,
    DEFAULT_OPTIONS.maxLayersPerArtboard,
  )
  settings.maxFileBytes = MAX_FILE_BYTES
  settings.maxReports = MAX_REPORTS

  /** absPath -> { doc, version, mtimeMs, size } */
  const cache = new Map()
  /** absPath -> tail promise of the last read/write chain */
  const locks = new Map()
  /** sessionId -> ring buffer of reports (most recent last) */
  const reports = new Map()
  const globalReports = []
  let tempCounter = 0

  /* ------------------------------------------------------------------------------------------
   * Workspace resolution
   * ---------------------------------------------------------------------------------------- */

  async function resolveTarget(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (!id) {
      throw fail('no-session', 'the design canvas needs a live chat Session id (none was provided)')
    }
    const agent = typeof ctx?.agents?.get === 'function' ? ctx.agents.get(id) : undefined
    if (!agent) {
      throw fail('no-session', `Session ${id.slice(0, 48)} is not live; open the design canvas from an active chat`)
    }
    let cwd
    try {
      cwd = await ctx.workingDirectory.ensure(agent)
    } catch (error) {
      throw fail(
        'no-session',
        `could not resolve the workspace directory for Session ${id.slice(0, 48)}: ${messageOf(error)}`,
        error,
      )
    }
    if (typeof cwd !== 'string' || !cwd) {
      throw fail('no-session', `Session ${id.slice(0, 48)} has no usable workspace directory`)
    }

    const root = path.resolve(cwd)
    const joined = path.join(root, settings.boardPath)
    const absPath = path.resolve(joined)
    if (!absPath.startsWith(root + path.sep)) {
      throw fail(
        'bad-request',
        `design board path ${JSON.stringify(settings.boardPath)} escapes the Session workspace`,
      )
    }
    return { sessionId: id, cwd: root, absPath }
  }

  /* ------------------------------------------------------------------------------------------
   * Serialized file access
   * ---------------------------------------------------------------------------------------- */

  function withLock(key, task) {
    const previous = locks.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    locks.set(key, tail)
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key)
    })
    return run
  }

  async function statOrNull(file) {
    try {
      return await stat(file)
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw fail('io-failed', `could not inspect ${file}: ${messageOf(error)}`, error)
    }
  }

  function serializeDoc(doc) {
    let text
    try {
      text = JSON.stringify(doc)
    } catch (error) {
      throw fail('io-failed', `could not serialize the design board: ${messageOf(error)}`, error)
    }
    if (typeof text !== 'string') {
      throw fail('io-failed', 'could not serialize the design board to JSON')
    }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > settings.maxFileBytes) {
      throw fail(
        'too-large',
        `the design board would be ${bytes} bytes, over the ${settings.maxFileBytes}-byte limit; remove some layers or images`,
      )
    }
    return text
  }

  async function writeDocFile(target, text) {
    const directory = path.dirname(target.absPath)
    try {
      await mkdir(directory, { recursive: true })
    } catch (error) {
      throw fail('io-failed', `could not create ${directory}: ${messageOf(error)}`, error)
    }

    tempCounter += 1
    const tempPath = path.join(
      directory,
      `.${path.basename(target.absPath)}.${process.pid}.${tempCounter}.tmp`,
    )
    try {
      await writeFile(tempPath, text, { encoding: 'utf8' })
      let lastError
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await rename(tempPath, target.absPath)
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          // Windows can transiently refuse a rename over a file another process has open.
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
        }
      }
      if (lastError) throw lastError
    } catch (error) {
      try {
        await unlink(tempPath)
      } catch {
        /* best effort cleanup only */
      }
      throw fail('io-failed', `could not write ${target.absPath}: ${messageOf(error)}`, error)
    }

    try {
      return await stat(target.absPath)
    } catch (error) {
      throw fail('io-failed', `could not confirm ${target.absPath}: ${messageOf(error)}`, error)
    }
  }

  /** Load (and cache) the board from disk. Returns null when the file is absent/empty. */
  async function loadFromDisk(target) {
    const info = await statOrNull(target.absPath)
    if (!info) return null
    if (info.size > settings.maxFileBytes) {
      throw fail(
        'too-large',
        `design board ${target.absPath} is ${info.size} bytes, over the ${settings.maxFileBytes}-byte limit`,
      )
    }

    const cached = cache.get(target.absPath)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached

    let text
    try {
      text = await readFile(target.absPath, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw fail('io-failed', `could not read ${target.absPath}: ${messageOf(error)}`, error)
    }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > settings.maxFileBytes) {
      throw fail(
        'too-large',
        `design board ${target.absPath} is ${bytes} bytes, over the ${settings.maxFileBytes}-byte limit`,
      )
    }
    if (!text.trim()) return null

    let raw
    try {
      raw = JSON.parse(text)
    } catch (error) {
      throw fail('io-failed', `design board ${target.absPath} is not valid JSON: ${messageOf(error)}`, error)
    }
    const doc = normalizeDoc(raw, {
      maxLayersPerArtboard: settings.maxLayersPerArtboard,
      nowIso: now(),
    })
    const entry = {
      doc: cloneDoc(doc),
      version: doc.version,
      mtimeMs: info.mtimeMs,
      size: bytes,
    }
    cache.set(target.absPath, entry)
    return entry
  }

  /** Load the board, creating (and persisting) the starter document when it is missing. */
  async function ensureState(target) {
    const existing = await loadFromDisk(target)
    if (existing) return existing

    const doc = createStarterDoc(now())
    const text = serializeDoc(doc)
    const info = await writeDocFile(target, text)
    const entry = {
      doc: cloneDoc(doc),
      version: doc.version,
      mtimeMs: info.mtimeMs,
      size: info.size,
    }
    cache.set(target.absPath, entry)
    return entry
  }

  /* ------------------------------------------------------------------------------------------
   * UI reports
   * ---------------------------------------------------------------------------------------- */

  function reportFor(sessionId) {
    const ring = typeof sessionId === 'string' && sessionId ? reports.get(sessionId) : undefined
    if (ring && ring.length) return ring[ring.length - 1]
    if (globalReports.length) return globalReports[globalReports.length - 1]
    return null
  }

  function uiFor(sessionId) {
    const lastReport = reportFor(sessionId)
    return { connected: lastReport !== null, lastReport: lastReport === null ? null : safeClone(lastReport) }
  }

  /* ------------------------------------------------------------------------------------------
   * Public interface
   * ---------------------------------------------------------------------------------------- */

  return {
    options: settings,

    async read(sessionId) {
      const target = await resolveTarget(sessionId)
      return withLock(target.absPath, async () => {
        const state = await ensureState(target)
        return {
          path: settings.boardPath,
          version: state.version,
          doc: cloneDoc(state.doc),
          ui: uiFor(target.sessionId),
          absPath: target.absPath,
        }
      })
    },

    async applyOps(sessionId, ops, opts) {
      const target = await resolveTarget(sessionId)
      const options = isPlainObject(opts) ? opts : {}
      if (!Array.isArray(ops)) {
        throw fail('bad-request', 'ops must be an array of operation objects')
      }
      return withLock(target.absPath, async () => {
        const state = await ensureState(target)
        const result = applyDocOps(state.doc, ops, {
          atomic: options.atomic === true,
          maxOpsPerCall: settings.maxOpsPerCall,
          maxLayersPerArtboard: settings.maxLayersPerArtboard,
          newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
          nowIso: now(),
        })

        if (result.applied.length === 0) {
          return {
            version: state.version,
            doc: cloneDoc(result.doc),
            applied: result.applied,
            errors: result.errors,
          }
        }

        const version = state.version + 1
        const doc = { ...result.doc, version, updatedAt: now() }
        const text = serializeDoc(doc)
        const info = await writeDocFile(target, text)
        cache.set(target.absPath, {
          doc: cloneDoc(doc),
          version,
          mtimeMs: info.mtimeMs,
          size: info.size,
        })
        return { version, doc, applied: result.applied, errors: result.errors }
      })
    },

    async recordReport(sessionId, report) {
      try {
        const id = typeof sessionId === 'string' ? sessionId.trim() : ''
        const value = sanitizeReport(report)
        if (!id) {
          pushReport(globalReports, value)
          return
        }
        let ring = reports.get(id)
        if (!ring) {
          ring = []
          reports.set(id, ring)
          if (reports.size > MAX_TRACKED_SESSIONS) {
            const oldest = reports.keys().next()
            if (!oldest.done) reports.delete(oldest.value)
          }
        }
        pushReport(ring, value)
      } catch {
        /* Diagnostics from the client must never break the Host. */
      }
    },

    async status(sessionId) {
      try {
        return uiFor(typeof sessionId === 'string' ? sessionId.trim() : '')
      } catch {
        return { connected: false, lastReport: null }
      }
    },
  }
}
