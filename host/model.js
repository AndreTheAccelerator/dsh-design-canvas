/**
 * Pure design-canvas document model.
 *
 * This module owns the document shape, validation, operation application and normalization.
 * It has no Host or filesystem dependencies: everything is deterministic given its arguments
 * plus the optional `newId` / `nowIso` hooks supplied through `opts`.
 *
 * Geometry is in CSS px. Layers are stored back-to-front: the last layer in an artboard's
 * `layers` array paints on top. Layers are rect/ellipse/text/image/line leaves or `frame` /
 * `group` containers with `children` (nested, capped at MAX_FRAME_DEPTH). Frames may carry an
 * optional CSS-like `layout` object; a frame with `layout: null` and every `group` position their
 * children absolutely. The model only stores and validates the layout description; the Client
 * computes auto-layout child positions. Fills and artboard backgrounds may be CSS gradients,
 * layers may carry an optional CSS `shadow`, text layers accept `letterSpacing` / `textTransform`,
 * and any layer accepts the optional `locked`, min/max size and `hugWidth` / `hugHeight` hints.
 * The store owns the persisted `version` / `updatedAt` fields; this module never bumps them and
 * never places `undefined` values in a document.
 *
 * Document shape (see CONTRACT.md):
 *
 *   { schemaVersion, name, version, updatedAt, artboards: [...], comments: [...] }
 */

export const SCHEMA_VERSION = 1
export const LAYER_TYPES = Object.freeze([
  'rect',
  'ellipse',
  'text',
  'image',
  'line',
  'frame',
  'group',
])
/** Container layer types own an ordered `children` array. */
export const CONTAINER_TYPES = Object.freeze(['frame', 'group'])
export const TEXT_ALIGNS = Object.freeze(['left', 'center', 'right'])
export const IMAGE_FITS = Object.freeze(['cover', 'contain', 'fill'])
export const LINE_ORIENTATIONS = Object.freeze(['horizontal', 'vertical', 'diagonal'])
export const FONT_WEIGHTS = Object.freeze([400, 500, 600, 700])
export const COMMENT_STATUSES = Object.freeze(['open', 'resolved'])

/* Frame containers. The model only validates/stores the auto-layout description; the Client
 * computes rendered child positions. */
export const LAYOUT_DIRECTIONS = Object.freeze(['row', 'column'])
export const LAYOUT_ALIGNS = Object.freeze(['start', 'center', 'end', 'stretch'])
export const LAYOUT_JUSTIFIES = Object.freeze([
  'start',
  'center',
  'end',
  'space-between',
  'space-around',
  'space-evenly',
])
export const LAYOUT_ALIGN_CONTENT = Object.freeze([
  'start',
  'center',
  'end',
  'stretch',
  'space-between',
  'space-around',
])
export const ALIGN_SELF_VALUES = Object.freeze(['start', 'center', 'end', 'stretch'])
export const MAX_FRAME_DEPTH = 5
export const MAX_CHILDREN_PER_FRAME = 200

/* Line strokes: a straight stroke inside the layer's own box. */
export const MIN_STROKE_WIDTH = 0.5
export const MAX_STROKE_WIDTH = 64

/* Small text style props (text layers only). */
export const TEXT_TRANSFORMS = Object.freeze(['none', 'uppercase', 'lowercase'])
const MIN_LETTER_SPACING = -20
const MAX_LETTER_SPACING = 40

const MAX_ARTBOARDS = 50
const MAX_COMMENTS = 2000
const MAX_OPS_PER_CALL = 1000
const MAX_NAME = 200
const MAX_TEXT = 20000
const MAX_COLOR = 200
const MAX_SHADOW = 200
const MAX_FAMILY = 200
const MAX_SRC = 3000000
const MAX_COMMENT_TEXT = 5000
const SUMMARY_LINE_BUDGET = 400
const SUMMARY_OPEN_COMMENTS = 20

/* CSS style strings are stored as authored, but never allow characters that could break out of
 * a style declaration or of the generated summary. */
const UNSAFE_STYLE_CHARS = /[\n\r{};]/
const GRADIENT_KEYWORD = /(?:repeating-)?(?:linear|radial|conic)-gradient/i

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const COMMON_LAYER_KEYS = [
  'name',
  'x',
  'y',
  'width',
  'height',
  'opacity',
  'visible',
  // Meaningful inside an auto-layout frame; harmless (and preserved) elsewhere.
  'grow',
  'alignSelf',
  // Optional CSS box-shadow; absent by default, null/"" clears it.
  'shadow',
  // Declared-only hints: the model stores them, the renderer applies them.
  'locked',
  'hugWidth',
  'hugHeight',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
]

/** Property kind table shared by validation and normalization. */
const LAYER_PROP_KINDS = Object.freeze({
  name: 'name',
  x: 'number',
  y: 'number',
  width: 'length',
  height: 'length',
  opacity: 'opacity',
  visible: 'boolean',
  shadow: 'shadow',
  locked: 'flag',
  hugWidth: 'flag',
  hugHeight: 'flag',
  minWidth: 'bound',
  minHeight: 'bound',
  maxWidth: 'bound',
  maxHeight: 'bound',
  fill: 'paint',
  radius: 'nonnegative',
  borderWidth: 'nonnegative',
  borderColor: 'color',
  text: 'text',
  color: 'color',
  fontSize: 'positive',
  fontWeight: 'fontWeight',
  fontFamily: 'family',
  align: 'align',
  lineHeight: 'positive',
  letterSpacing: 'letterSpacing',
  textTransform: 'textTransform',
  src: 'src',
  fit: 'fit',
  stroke: 'color',
  strokeWidth: 'strokeWidth',
  orientation: 'orientation',
  dashed: 'boolean',
  arrowStart: 'boolean',
  arrowEnd: 'boolean',
  layout: 'layout',
  clip: 'boolean',
  grow: 'boolean',
  alignSelf: 'alignSelf',
})

/**
 * Optional props that are removed (not stored) when they carry their "cleared" value: `shadow`
 * clears on null/"" and the boolean hints clear on false (so documents stay small), while the
 * min/max bounds clear on null. Every other prop is stored as coerced.
 */
const CLEARABLE_KEYS = new Set([
  'shadow',
  'locked',
  'hugWidth',
  'hugHeight',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
])

const ARTBOARD_PROP_KINDS = Object.freeze({
  name: 'name',
  x: 'number',
  y: 'number',
  width: 'length',
  height: 'length',
  background: 'paint',
})

const TYPE_PROPS = Object.freeze({
  rect: Object.freeze(['fill', 'radius', 'borderWidth', 'borderColor']),
  ellipse: Object.freeze(['fill', 'borderWidth', 'borderColor']),
  text: Object.freeze([
    'text',
    'color',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'align',
    'lineHeight',
    'fill',
    'letterSpacing',
    'textTransform',
  ]),
  image: Object.freeze(['src', 'fit', 'radius']),
  line: Object.freeze(['stroke', 'strokeWidth', 'orientation', 'dashed', 'arrowStart', 'arrowEnd']),
  frame: Object.freeze(['fill', 'radius', 'borderWidth', 'borderColor', 'clip', 'layout']),
  // A group is a frame without a background, border or auto layout: children only.
  group: Object.freeze(['clip']),
})

/** Layout object keys (a patch replaces the whole object) and its padding sides. */
const LAYOUT_KEYS = Object.freeze([
  'direction',
  'gap',
  'padding',
  'rowGap',
  'columnGap',
  'align',
  'alignContent',
  'justify',
  'wrap',
])
const PADDING_SIDES = Object.freeze(['top', 'right', 'bottom', 'left'])

/** Keys accepted on each op object; anything else is rejected as `bad-property`. */
const OP_KEYS = Object.freeze({
  'board.update': Object.freeze(['type', 'patch']),
  'artboard.add': Object.freeze(['type', 'artboard', 'index']),
  'artboard.update': Object.freeze(['type', 'artboardId', 'patch']),
  'artboard.delete': Object.freeze(['type', 'artboardId']),
  'artboard.duplicate': Object.freeze(['type', 'artboardId', 'name', 'offsetX', 'offsetY']),
  'layer.add': Object.freeze(['type', 'artboardId', 'parentId', 'layer', 'index']),
  'layer.update': Object.freeze(['type', 'layerId', 'patch']),
  'layer.delete': Object.freeze(['type', 'layerId']),
  'layer.reorder': Object.freeze(['type', 'layerId', 'index']),
  'layer.move_to': Object.freeze(['type', 'layerId', 'artboardId', 'parentId', 'index']),
  'layer.duplicate': Object.freeze([
    'type',
    'layerId',
    'offsetX',
    'offsetY',
    'parentId',
    'artboardId',
    'index',
  ]),
  'layer.group': Object.freeze(['type', 'layerIds', 'name', 'artboardId']),
  'layer.ungroup': Object.freeze(['type', 'layerId']),
  'comment.add': Object.freeze(['type', 'artboardId', 'layerId', 'text', 'id']),
  'comment.update': Object.freeze(['type', 'commentId', 'status']),
  'comment.batch_update': Object.freeze(['type', 'commentIds', 'status']),
  'comment.delete': Object.freeze(['type', 'commentId']),
})

const layerPropCache = new Map()

/* --------------------------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------------------------ */

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function err(code, message) {
  return { ok: false, code, message }
}

function clampInt(value, min, max, fallback) {
  const number = isFiniteNumber(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(number, min), max)
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback
}

function lengthOr(value, fallback) {
  return isFiniteNumber(value) ? Math.max(1, value) : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function plural(count, singular = '', pluralForm = 's') {
  return count === 1 ? singular : pluralForm
}

function fmt(number) {
  if (!isFiniteNumber(number)) return '0'
  return String(Math.round(number * 100) / 100)
}

function short(text, max) {
  const value = String(text)
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

function nowIsoFrom(opts) {
  return typeof opts?.nowIso === 'string' && opts.nowIso ? opts.nowIso : new Date().toISOString()
}

function allowedLayerProps(type) {
  let props = layerPropCache.get(type)
  if (!props) {
    props = new Set([...COMMON_LAYER_KEYS, ...(hasOwn(TYPE_PROPS, type) ? TYPE_PROPS[type] : [])])
    layerPropCache.set(type, props)
  }
  return props
}

/** True when the layer is a container (frame or group) that owns a `children` array. */
function isContainerLayer(layer) {
  return isObject(layer) && CONTAINER_TYPES.includes(layer.type) && Array.isArray(layer.children)
}

function randomId(prefix) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let index = 0; index < 8; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `${prefix}-${suffix}`
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      /* fall through to the JSON copy */
    }
  }
  return JSON.parse(JSON.stringify(value))
}

/* --------------------------------------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------------------------------------ */

function defaultLayer(type) {
  const base = { type, name: '', x: 0, y: 0, width: 200, height: 120 }
  switch (type) {
    case 'rect':
      return {
        ...base,
        name: 'Rectangle',
        fill: '#e5e7eb',
        radius: 0,
        borderWidth: 0,
        borderColor: '#9ca3af',
      }
    case 'ellipse':
      return { ...base, name: 'Ellipse', fill: '#e5e7eb', borderWidth: 0, borderColor: '#9ca3af' }
    case 'text':
      return {
        ...base,
        name: 'Text',
        width: 320,
        height: 48,
        text: '',
        color: '#111827',
        fontSize: 16,
        fontWeight: 400,
        fontFamily: FONT_STACK,
        align: 'left',
        lineHeight: 24,
      }
    case 'image':
      return { ...base, name: 'Image', width: 320, height: 200, src: '', fit: 'cover', radius: 0 }
    case 'line':
      return {
        ...base,
        name: 'Line',
        width: 200,
        height: 1,
        stroke: '#94a3b8',
        strokeWidth: 2,
        orientation: 'horizontal',
        dashed: false,
        arrowStart: false,
        arrowEnd: false,
      }
    case 'frame':
      return {
        ...base,
        name: 'Frame',
        width: 400,
        height: 200,
        fill: '#ffffff',
        radius: 0,
        borderWidth: 0,
        borderColor: '#d1d5db',
        clip: false,
        layout: null,
        children: [],
      }
    case 'group':
      return { ...base, name: 'Group', width: 400, height: 200, clip: false, children: [] }
    default:
      return { ...base }
  }
}

function defaultArtboard() {
  return {
    name: 'Untitled artboard',
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
    background: '#ffffff',
    layers: [],
  }
}

function emptyDoc(nowIso) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled design',
    version: 1,
    updatedAt: nowIso,
    artboards: [],
    comments: [],
  }
}

/**
 * The document created for a brand-new session workspace.
 *
 * Deterministic ids: `ab-landing`, `l-title`, `l-subtitle`, `l-cta`, `l-cta-label`.
 */
export function createStarterDoc(nowIso) {
  const updatedAt = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled design',
    version: 1,
    updatedAt,
    artboards: [
      {
        id: 'ab-landing',
        name: 'Landing',
        x: 0,
        y: 0,
        width: 1200,
        height: 760,
        background: '#ffffff',
        layers: [
          {
            id: 'l-title',
            type: 'text',
            name: 'Title',
            x: 96,
            y: 120,
            width: 760,
            height: 72,
            text: 'Design that speaks for itself',
            color: '#111827',
            fontSize: 56,
            fontWeight: 700,
            fontFamily: FONT_STACK,
            align: 'left',
            lineHeight: 64,
          },
          {
            id: 'l-subtitle',
            type: 'text',
            name: 'Subtitle',
            x: 96,
            y: 212,
            width: 640,
            height: 48,
            text: 'Chat with your design assistant to compose and refine this page.',
            color: '#4b5563',
            fontSize: 20,
            fontWeight: 400,
            fontFamily: FONT_STACK,
            align: 'left',
            lineHeight: 32,
          },
          {
            id: 'l-cta',
            type: 'rect',
            name: 'Primary button',
            x: 96,
            y: 296,
            width: 196,
            height: 52,
            fill: '#111827',
            radius: 10,
            borderWidth: 0,
            borderColor: '#111827',
          },
          {
            id: 'l-cta-label',
            type: 'text',
            name: 'Button label',
            x: 96,
            y: 310,
            width: 196,
            height: 24,
            text: 'Start designing',
            color: '#ffffff',
            fontSize: 16,
            fontWeight: 600,
            fontFamily: FONT_STACK,
            align: 'center',
            lineHeight: 24,
          },
        ],
      },
    ],
    comments: [],
  }
}

/** Deep copy of a document (plain JSON round-trip; safe to hand to callers). */
export function cloneDoc(doc) {
  return clone(doc)
}

/* --------------------------------------------------------------------------------------------
 * Validation primitives
 * ------------------------------------------------------------------------------------------ */

/**
 * Validate and normalize one auto-layout description. Missing fields take their CSS-like
 * defaults, so a stored layout object is always complete for the Client renderer. `null` /
 * `undefined` mean `layout: null` (children are absolutely positioned).
 *
 * @returns {{ ok: true, value: object | null } | { ok: false, code?: string, message: string }}
 */
function coerceLayout(value) {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (!isObject(value)) return { ok: false, message: '"layout" must be an object or null' }

  for (const key of Object.keys(value)) {
    if (!LAYOUT_KEYS.includes(key)) {
      return {
        ok: false,
        code: 'bad-property',
        message: `unknown layout property "${key}"; allowed: ${LAYOUT_KEYS.join(', ')}`,
      }
    }
  }

  const direction = value.direction === undefined ? 'row' : value.direction
  if (!LAYOUT_DIRECTIONS.includes(direction)) {
    return { ok: false, message: '"layout.direction" must be one of row, column' }
  }

  const gap = value.gap === undefined ? 0 : value.gap
  if (!isFiniteNumber(gap) || gap < 0) {
    return { ok: false, message: '"layout.gap" must be a finite number >= 0 (px)' }
  }

  const align = value.align === undefined ? 'stretch' : value.align
  if (!LAYOUT_ALIGNS.includes(align)) {
    return { ok: false, message: '"layout.align" must be one of start, center, end, stretch' }
  }

  const alignContent = value.alignContent === undefined ? 'stretch' : value.alignContent
  if (!LAYOUT_ALIGN_CONTENT.includes(alignContent)) {
    return {
      ok: false,
      message:
        '"layout.alignContent" must be one of start, center, end, stretch, space-between, space-around',
    }
  }

  const justify = value.justify === undefined ? 'start' : value.justify
  if (!LAYOUT_JUSTIFIES.includes(justify)) {
    return {
      ok: false,
      message:
        '"layout.justify" must be one of start, center, end, space-between, space-around, space-evenly',
    }
  }

  const wrap = value.wrap === undefined ? false : value.wrap
  if (typeof wrap !== 'boolean') {
    return { ok: false, message: '"layout.wrap" must be true or false' }
  }

  // Row/column gaps override `gap` when present; absent means "use gap".
  const gaps = {}
  for (const key of ['rowGap', 'columnGap']) {
    if (value[key] === undefined) continue
    if (!isFiniteNumber(value[key]) || value[key] < 0) {
      return { ok: false, message: `"layout.${key}" must be a finite number >= 0 (px)` }
    }
    gaps[key] = value[key]
  }

  const rawPadding = value.padding === undefined || value.padding === null ? {} : value.padding
  if (!isObject(rawPadding)) {
    return {
      ok: false,
      message: '"layout.padding" must be an object with top, right, bottom, left',
    }
  }
  for (const key of Object.keys(rawPadding)) {
    if (!PADDING_SIDES.includes(key)) {
      return {
        ok: false,
        code: 'bad-property',
        message: `unknown layout.padding property "${key}"; allowed: ${PADDING_SIDES.join(', ')}`,
      }
    }
  }
  const padding = {}
  for (const side of PADDING_SIDES) {
    const sideValue = rawPadding[side] === undefined ? 0 : rawPadding[side]
    if (!isFiniteNumber(sideValue) || sideValue < 0) {
      return {
        ok: false,
        message: `"layout.padding.${side}" must be a finite number >= 0 (px)`,
      }
    }
    padding[side] = sideValue
  }

  return {
    ok: true,
    value: {
      direction,
      gap,
      padding,
      ...gaps,
      align,
      alignContent,
      justify,
      wrap,
    },
  }
}

/** Shared safety check for stored CSS style strings (colors, gradients, shadows). */
function unsafeStyleProblem(key, value) {
  if (UNSAFE_STYLE_CHARS.test(value)) {
    return `"${key}" must not contain newlines, braces or semicolons`
  }
  return null
}

/**
 * Repair helper for normalizeDoc: keep a hand-edited CSS paint string only when it is a plain
 * safe string, otherwise fall back to the provided default.
 */
function normalizePaint(value, fallback) {
  if (typeof value !== 'string') return fallback
  if (UNSAFE_STYLE_CHARS.test(value)) return fallback
  return value.slice(0, MAX_COLOR)
}

/**
 * Coerce one property to its contract type. Values are clamped where CONTRACT.md says so
 * (width/height >= 1, opacity 0..1, index) and rejected otherwise.
 *
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
function coerceProp(key, kind, value) {
  switch (kind) {
    case 'name': {
      if (typeof value === 'string') return { ok: true, value: value.slice(0, MAX_NAME) }
      if (isFiniteNumber(value) || typeof value === 'boolean') {
        return { ok: true, value: String(value).slice(0, MAX_NAME) }
      }
      return { ok: false, message: `"${key}" must be a string` }
    }
    case 'text': {
      if (typeof value === 'string') return { ok: true, value: value.slice(0, MAX_TEXT) }
      if (isFiniteNumber(value) || typeof value === 'boolean') {
        return { ok: true, value: String(value) }
      }
      return { ok: false, message: `"${key}" must be a string` }
    }
    case 'paint': {
      if (typeof value !== 'string') {
        return {
          ok: false,
          message: `"${key}" must be a CSS color or gradient string such as "#111827" or "linear-gradient(135deg,#2563eb,#1d4ed8)"`,
        }
      }
      const problem = unsafeStyleProblem(key, value)
      if (problem) return { ok: false, message: problem }
      return { ok: true, value: value.slice(0, MAX_COLOR) }
    }
    case 'color': {
      if (typeof value !== 'string') {
        return { ok: false, message: `"${key}" must be a CSS color string such as "#111827"` }
      }
      const problem = unsafeStyleProblem(key, value)
      if (problem) return { ok: false, message: problem }
      if (GRADIENT_KEYWORD.test(value)) {
        return {
          ok: false,
          message: `"${key}" must be a single CSS color; gradients are not allowed here`,
        }
      }
      return { ok: true, value: value.slice(0, MAX_COLOR) }
    }
    case 'shadow': {
      if (value === null || value === undefined) return { ok: true, value: null }
      if (typeof value !== 'string') {
        return {
          ok: false,
          message: '"shadow" must be a CSS box-shadow string (null or "" clears it)',
        }
      }
      const trimmed = value.trim()
      if (!trimmed) return { ok: true, value: null }
      if (trimmed.length > MAX_SHADOW) {
        return { ok: false, message: `"shadow" is too long (max ${MAX_SHADOW} characters)` }
      }
      const problem = unsafeStyleProblem('shadow', trimmed)
      if (problem) return { ok: false, message: problem }
      return { ok: true, value: trimmed }
    }
    case 'letterSpacing': {
      if (!isFiniteNumber(value)) {
        return {
          ok: false,
          message: `"${key}" must be a finite number (px, ${MIN_LETTER_SPACING}..${MAX_LETTER_SPACING})`,
        }
      }
      return { ok: true, value: clamp(value, MIN_LETTER_SPACING, MAX_LETTER_SPACING) }
    }
    case 'textTransform': {
      if (!TEXT_TRANSFORMS.includes(value)) {
        return { ok: false, message: `"${key}" must be one of none, uppercase, lowercase` }
      }
      return { ok: true, value }
    }
    case 'family': {
      if (typeof value !== 'string') {
        return { ok: false, message: `"${key}" must be a CSS font-family string` }
      }
      return { ok: true, value: value.slice(0, MAX_FAMILY) }
    }
    case 'src': {
      if (typeof value !== 'string') {
        return { ok: false, message: `"${key}" must be an http(s) or data: URL string` }
      }
      if (value.length > MAX_SRC) {
        return { ok: false, message: `"${key}" is too large (max ${MAX_SRC} characters)` }
      }
      return { ok: true, value }
    }
    case 'number': {
      if (!isFiniteNumber(value)) return { ok: false, message: `"${key}" must be a finite number (px)` }
      return { ok: true, value }
    }
    case 'length': {
      if (!isFiniteNumber(value)) return { ok: false, message: `"${key}" must be a finite number (px)` }
      return { ok: true, value: Math.max(1, value) }
    }
    case 'opacity': {
      if (!isFiniteNumber(value)) return { ok: false, message: `"${key}" must be a number` }
      return { ok: true, value: clamp(value, 0, 1) }
    }
    case 'nonnegative': {
      if (!isFiniteNumber(value)) return { ok: false, message: `"${key}" must be a finite number (px)` }
      return { ok: true, value: Math.max(0, value) }
    }
    case 'positive': {
      if (!isFiniteNumber(value)) return { ok: false, message: `"${key}" must be a finite number (px)` }
      return { ok: true, value: Math.max(1, value) }
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return { ok: false, message: `"${key}" must be true or false` }
      return { ok: true, value }
    }
    case 'flag': {
      // Optional boolean flag: true is stored, false clears it (absent means false).
      if (value === true) return { ok: true, value: true }
      if (value === false || value === null) return { ok: true, value: null }
      return { ok: false, message: `"${key}" must be true or false` }
    }
    case 'bound': {
      // Optional min/max size hint: a number >= 0, or null to clear it.
      if (value === null) return { ok: true, value: null }
      if (!isFiniteNumber(value)) {
        return { ok: false, message: `"${key}" must be a finite number >= 0 (px)` }
      }
      return { ok: true, value: Math.max(0, value) }
    }
    case 'strokeWidth': {
      if (!isFiniteNumber(value)) {
        return {
          ok: false,
          message: `"${key}" must be a finite number (px, ${MIN_STROKE_WIDTH}..${MAX_STROKE_WIDTH})`,
        }
      }
      return { ok: true, value: clamp(value, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH) }
    }
    case 'orientation': {
      if (!LINE_ORIENTATIONS.includes(value)) {
        return { ok: false, message: `"${key}" must be one of ${LINE_ORIENTATIONS.join(', ')}` }
      }
      return { ok: true, value }
    }
    case 'fontWeight': {
      if (!FONT_WEIGHTS.includes(value)) {
        return { ok: false, message: `"${key}" must be one of 400, 500, 600, 700` }
      }
      return { ok: true, value }
    }
    case 'align': {
      if (!TEXT_ALIGNS.includes(value)) {
        return { ok: false, message: `"${key}" must be one of left, center, right` }
      }
      return { ok: true, value }
    }
    case 'fit': {
      if (!IMAGE_FITS.includes(value)) {
        return { ok: false, message: `"${key}" must be one of cover, contain, fill` }
      }
      return { ok: true, value }
    }
    case 'layout':
      return coerceLayout(value)
    case 'alignSelf': {
      if (value === null) return { ok: true, value: null }
      if (ALIGN_SELF_VALUES.includes(value)) return { ok: true, value }
      return {
        ok: false,
        message: '"alignSelf" must be one of start, center, end, stretch or null',
      }
    }
    default:
      return { ok: false, message: `"${key}" is not a supported property` }
  }
}

/**
 * Reject a min size larger than the matching max size. `props` is the effective (merged) layer
 * state, so a patch that only sets one side is checked against the stored other side.
 */
function boundsConflict(props) {
  const pairs = [
    ['minWidth', 'maxWidth'],
    ['minHeight', 'maxHeight'],
  ]
  for (const [minKey, maxKey] of pairs) {
    if (
      isFiniteNumber(props[minKey]) &&
      isFiniteNumber(props[maxKey]) &&
      props[minKey] > props[maxKey]
    ) {
      return `"${minKey}" (${fmt(props[minKey])}) must not be greater than "${maxKey}" (${fmt(props[maxKey])})`
    }
  }
  return null
}

/**
 * Validate + coerce every own property of `source` against `kindMap`, then assign the coerced
 * values onto `target` only when the whole set is valid. This keeps a rejected patch from
 * leaving a half-applied layer behind.
 */
function assignProps(target, source, kindMap) {
  const values = {}
  const clears = []
  for (const key of Object.keys(source)) {
    const result = coerceProp(key, kindMap[key], source[key])
    if (!result.ok) return err(result.code ?? 'bad-value', result.message)
    // `shadow: null` / `locked: false` / `maxWidth: null` clears the optional prop instead of
    // storing the cleared value.
    if (CLEARABLE_KEYS.has(key) && result.value === null) clears.push(key)
    else values[key] = result.value
  }
  const merged = { ...target, ...values }
  for (const key of clears) delete merged[key]
  const conflict = boundsConflict(merged)
  if (conflict) return err('bad-value', conflict)
  Object.assign(target, values)
  for (const key of clears) delete target[key]
  return null
}

/** Reject keys that are not part of the allowed property set for the kind being patched. */
function checkUnknownProps(source, allowed, label, skipped) {
  const skip = skipped ?? []
  for (const key of Object.keys(source)) {
    if (skip.includes(key)) continue
    if (!allowed.has(key)) {
      const list = [...allowed].sort().join(', ')
      return err('bad-property', `unknown ${label} property "${key}"; allowed: ${list}`)
    }
  }
  return null
}

function clampIndex(value, max) {
  if (!isFiniteNumber(value)) return err('bad-value', 'index must be a finite number')
  return { ok: true, index: Math.min(Math.max(Math.floor(value), 0), max) }
}

/* --------------------------------------------------------------------------------------------
 * Lookup / id helpers
 * ------------------------------------------------------------------------------------------ */

function findArtboard(doc, artboardId) {
  if (typeof artboardId !== 'string' || !artboardId) return null
  for (let index = 0; index < doc.artboards.length; index += 1) {
    const artboard = doc.artboards[index]
    if (isObject(artboard) && artboard.id === artboardId) return { artboard, index }
  }
  return null
}

/**
 * Depth-first layer lookup across artboards and nested containers.
 *
 * @returns {null | { layer: object, index: number, parent: object[], artboard: object,
 *   artboardIndex: number, parentLayer: object | null, depth: number }} `parent` is the array
 *   that owns the layer (an artboard's `layers` or a frame/group's `children`); `depth` is 1 for
 *   top-level layers and grows by one per container nesting level.
 */
function findLayer(doc, layerId) {
  if (typeof layerId !== 'string' || !layerId) return null
  for (let artboardIndex = 0; artboardIndex < doc.artboards.length; artboardIndex += 1) {
    const artboard = doc.artboards[artboardIndex]
    if (!isObject(artboard) || !Array.isArray(artboard.layers)) continue
    const found = findLayerInList(artboard.layers, layerId, artboard, artboardIndex, null, 1)
    if (found) return found
  }
  return null
}

function findLayerInList(list, layerId, artboard, artboardIndex, parentLayer, depth) {
  for (let index = 0; index < list.length; index += 1) {
    const layer = list[index]
    if (!isObject(layer)) continue
    if (layer.id === layerId) {
      return { layer, index, parent: list, artboard, artboardIndex, parentLayer, depth }
    }
    if (isContainerLayer(layer) && layer.children.length) {
      const found = findLayerInList(
        layer.children,
        layerId,
        artboard,
        artboardIndex,
        layer,
        depth + 1,
      )
      if (found) return found
    }
  }
  return null
}

/** True when `id` belongs to `layer` or to any of its nested container children. */
function layerIdTaken(layer, id) {
  if (!isObject(layer)) return false
  if (layer.id === id) return true
  if (isContainerLayer(layer)) {
    for (const child of layer.children) {
      if (layerIdTaken(child, id)) return true
    }
  }
  return false
}

function idTaken(doc, id) {
  for (const artboard of doc.artboards) {
    if (!isObject(artboard)) continue
    if (artboard.id === id) return true
    if (!Array.isArray(artboard.layers)) continue
    for (const layer of artboard.layers) {
      if (layerIdTaken(layer, id)) return true
    }
  }
  for (const comment of doc.comments) {
    if (isObject(comment) && comment.id === id) return true
  }
  return false
}

/** Add a layer id and every id in its subtree to `target`. */
function collectLayerIds(layer, target) {
  if (!isObject(layer)) return
  if (typeof layer.id === 'string') target.add(layer.id)
  if (isContainerLayer(layer)) {
    for (const child of layer.children) collectLayerIds(child, target)
  }
}

/** Number of layer levels occupied by a subtree (a leaf is 1). */
function subtreeHeight(layer) {
  let height = 1
  if (isContainerLayer(layer)) {
    for (const child of layer.children) {
      const nested = subtreeHeight(child) + 1
      if (nested > height) height = nested
    }
  }
  return height
}

/** True when `id` is `layer` itself or an id anywhere inside its subtree. */
function subtreeContains(layer, id) {
  if (!isObject(layer)) return false
  if (layer.id === id) return true
  if (isContainerLayer(layer)) {
    for (const child of layer.children) {
      if (subtreeContains(child, id)) return true
    }
  }
  return false
}

/**
 * Resolve the id for a new entity: honor a caller-supplied id after validation, otherwise ask
 * `newId(prefix)` for a unique id. A collision with an existing id is an error.
 */
function resolveId(doc, prefix, requested, newId) {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !requested.trim()) {
      return err('bad-id', `id must be a non-empty string when provided (got ${JSON.stringify(requested)})`)
    }
    if (idTaken(doc, requested)) return err('bad-id', `id "${requested}" is already in use`)
    return requested
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let candidate
    try {
      candidate = newId(prefix)
    } catch {
      candidate = undefined
    }
    if (typeof candidate === 'string' && candidate && !idTaken(doc, candidate)) return candidate
  }
  return err('bad-id', `could not allocate a unique ${prefix} id`)
}

/**
 * Allocate a fresh id for a cloned subtree, avoiding ids that are already in the document and
 * ids handed out earlier in the same clone pass (`used`).
 *
 * @returns {{ ok: true, value: string } | { ok: false, code: string, message: string }}
 */
function allocateFreshId(doc, used, context, prefix) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let candidate
    try {
      candidate = context.newId(prefix)
    } catch {
      candidate = undefined
    }
    if (
      typeof candidate === 'string' &&
      candidate &&
      !used.has(candidate) &&
      !idTaken(doc, candidate)
    ) {
      used.add(candidate)
      return { ok: true, value: candidate }
    }
  }
  return err('bad-id', `could not allocate a unique ${prefix} id`)
}

/**
 * Deep-copy a layer subtree with fresh globally unique ids. Every other prop is preserved
 * losslessly and comment references are intentionally not carried over.
 *
 * @returns {{ ok: true, layer: object } | { ok: false, code: string, message: string }}
 */
function cloneLayerTree(doc, layer, used, context) {
  if (!isObject(layer)) return err('bad-value', 'cannot duplicate a non-object layer')
  const id = allocateFreshId(doc, used, context, 'l')
  if (!id.ok) return id
  const { children, ...rest } = layer
  const copy = clone(rest)
  copy.id = id.value
  if (Array.isArray(children)) {
    copy.children = []
    for (const child of children.slice(0, MAX_CHILDREN_PER_FRAME)) {
      if (!isObject(child)) continue
      const cloned = cloneLayerTree(doc, child, used, context)
      if (!cloned.ok) return cloned
      copy.children.push(cloned.layer)
    }
  }
  return { ok: true, layer: copy }
}

/** Read optional `offsetX` / `offsetY` from a duplicate op, defaulting to `dx` / `dy`. */
function readOffsets(op, dx, dy) {
  let offsetX = dx
  let offsetY = dy
  if (op.offsetX !== undefined) {
    if (!isFiniteNumber(op.offsetX)) return err('bad-value', 'offsetX must be a finite number (px)')
    offsetX = op.offsetX
  }
  if (op.offsetY !== undefined) {
    if (!isFiniteNumber(op.offsetY)) return err('bad-value', 'offsetY must be a finite number (px)')
    offsetY = op.offsetY
  }
  return { ok: true, offsetX, offsetY }
}

/** Lower bound for a union box (a group must stay at least 1x1). */
function extent(start, size) {
  return numberOr(start, 0) + Math.max(1, numberOr(size, 1))
}

/* --------------------------------------------------------------------------------------------
 * Op handlers. Each returns `{ ok: true, id? }` or an `err(...)`.
 * ------------------------------------------------------------------------------------------ */

function addArtboard(doc, op, context) {
  if (!isObject(op.artboard)) return err('bad-request', 'artboard.add needs an `artboard` object')
  if (doc.artboards.length >= MAX_ARTBOARDS) {
    return err('limit', `the document already has ${MAX_ARTBOARDS} artboards (maximum)`)
  }
  const allowed = new Set([...Object.keys(ARTBOARD_PROP_KINDS), 'id'])
  const unknown = checkUnknownProps(op.artboard, allowed, 'artboard')
  if (unknown) return unknown

  const artboard = { id: '', ...defaultArtboard() }
  const values = {}
  for (const key of Object.keys(op.artboard)) {
    if (key === 'id') continue
    const result = coerceProp(key, ARTBOARD_PROP_KINDS[key], op.artboard[key])
    if (!result.ok) return err('bad-value', result.message)
    values[key] = result.value
  }
  Object.assign(artboard, values)

  const id = resolveId(doc, 'ab', op.artboard.id, context.newId)
  if (typeof id !== 'string') return id
  artboard.id = id

  const position = clampIndex(op.index === undefined ? doc.artboards.length : op.index, doc.artboards.length)
  if (!position.ok) return position
  doc.artboards.splice(position.index, 0, artboard)
  return { ok: true, id }
}

function updateArtboard(doc, op) {
  const found = findArtboard(doc, op.artboardId)
  if (!found) return err('bad-id', `artboard "${String(op.artboardId)}" does not exist; call design_read for ids`)
  if (!isObject(op.patch)) return err('bad-request', 'artboard.update needs a `patch` object')
  const allowed = new Set(Object.keys(ARTBOARD_PROP_KINDS))
  for (const key of Object.keys(op.patch)) {
    if (key === 'id') return err('bad-property', 'artboard id is immutable')
    if (key === 'layers') return err('bad-property', 'artboard layers are edited with layer.* ops')
  }
  const unknown = checkUnknownProps(op.patch, allowed, 'artboard patch')
  if (unknown) return unknown
  const problem = assignProps(found.artboard, op.patch, ARTBOARD_PROP_KINDS)
  if (problem) return problem
  return { ok: true, id: found.artboard.id }
}

function deleteArtboard(doc, op) {
  const found = findArtboard(doc, op.artboardId)
  if (!found) return err('bad-id', `artboard "${String(op.artboardId)}" does not exist; call design_read for ids`)
  const layerIds = new Set()
  for (const layer of Array.isArray(found.artboard.layers) ? found.artboard.layers : []) {
    collectLayerIds(layer, layerIds)
  }
  doc.artboards.splice(found.index, 1)
  doc.comments = doc.comments.filter((comment) => {
    if (!isObject(comment)) return false
    if (comment.artboardId === found.artboard.id) return false
    if (typeof comment.layerId === 'string' && layerIds.has(comment.layerId)) return false
    return true
  })
  return { ok: true, id: found.artboard.id }
}

/**
 * Resolve the list that receives a new layer. `layer.add` / `layer.duplicate` target either an
 * artboard's top-level `layers` (by `artboardId`) or one container layer's `children` (by
 * `parentId`); exactly one is required. `depth` is the depth of the receiving container
 * (0 for an artboard, the container's own depth for a frame/group).
 */
function resolveWriteTarget(doc, op, context) {
  const hasArtboard = typeof op.artboardId === 'string' && op.artboardId !== ''
  const hasParent = typeof op.parentId === 'string' && op.parentId !== ''
  if (op.artboardId !== undefined && op.artboardId !== null && !hasArtboard) {
    return err('bad-id', 'artboardId must be a non-empty string')
  }
  if (op.parentId !== undefined && op.parentId !== null && !hasParent) {
    return err('bad-id', 'parentId must be a non-empty string')
  }
  if (hasArtboard && hasParent) {
    return err(
      'bad-request',
      'pass exactly one of `artboardId` (top level) or `parentId` (inside a frame or group)',
    )
  }
  if (!hasArtboard && !hasParent) {
    return err(
      'bad-request',
      'pass `artboardId` for a top-level layer or `parentId` for a layer inside a frame or group',
    )
  }

  if (hasParent) {
    const parentFound = findLayer(doc, op.parentId)
    if (!parentFound) {
      return err('bad-id', `layer "${String(op.parentId)}" does not exist; call design_read for ids`)
    }
    if (!CONTAINER_TYPES.includes(parentFound.layer.type)) {
      return err(
        'bad-value',
        `layer "${op.parentId}" is a ${parentFound.layer.type}, not a frame or group; only those have children`,
      )
    }
    if (parentFound.depth >= MAX_FRAME_DEPTH) {
      return err(
        'limit',
        `layer nesting is limited to ${MAX_FRAME_DEPTH} levels; "${op.parentId}" is already at depth ${parentFound.depth}`,
      )
    }
    const parentLayer = parentFound.layer
    if (!Array.isArray(parentLayer.children)) parentLayer.children = []
    return {
      ok: true,
      list: parentLayer.children,
      limit: MAX_CHILDREN_PER_FRAME,
      label: `${parentLayer.type} "${parentLayer.id}"`,
      kind: 'children',
      depth: parentFound.depth,
    }
  }

  const found = findArtboard(doc, op.artboardId)
  if (!found) return err('bad-id', `artboard "${String(op.artboardId)}" does not exist; call design_read for ids`)
  return {
    ok: true,
    list: found.artboard.layers,
    limit: context.maxLayersPerArtboard,
    label: `artboard "${found.artboard.id}"`,
    kind: 'layers',
    depth: 0,
  }
}

function addLayer(doc, op, context) {
  const target = resolveWriteTarget(doc, op, context)
  if (!target.ok) return target
  if (!isObject(op.layer)) return err('bad-request', 'layer.add needs a `layer` object')
  const layerType = op.layer.type
  if (!LAYER_TYPES.includes(layerType)) {
    return err('bad-value', `layer.type must be one of ${LAYER_TYPES.join(', ')} (got ${JSON.stringify(layerType)})`)
  }
  if (target.list.length >= target.limit) {
    return err('limit', `${target.label} already has ${target.limit} ${target.kind} (maximum)`)
  }
  const allowed = allowedLayerProps(layerType)
  for (const key of Object.keys(op.layer)) {
    if (key === 'id' || key === 'type') continue
    if (key === 'children') {
      return err(
        'bad-property',
        'layer.add does not take `children`; add the frame/group first, then add each child with layer.add {parentId: "<container id>"}',
      )
    }
    if (!allowed.has(key)) {
      return err(
        'bad-property',
        `unknown layer property "${key}" for type ${layerType}; allowed: ${[...allowed].sort().join(', ')}`,
      )
    }
  }

  const layer = { id: '', ...defaultLayer(layerType) }
  const values = {}
  for (const key of Object.keys(op.layer)) {
    if (key === 'id' || key === 'type') continue
    const result = coerceProp(key, LAYER_PROP_KINDS[key], op.layer[key])
    if (!result.ok) return err(result.code ?? 'bad-value', result.message)
    // Cleared optional props (shadow, locked:false, min/max:null) stay absent.
    if (CLEARABLE_KEYS.has(key) && result.value === null) continue
    values[key] = result.value
  }
  const conflict = boundsConflict({ ...layer, ...values })
  if (conflict) return err('bad-value', conflict)
  Object.assign(layer, values)
  if (CONTAINER_TYPES.includes(layerType) && !Array.isArray(layer.children)) layer.children = []

  const id = resolveId(doc, 'l', op.layer.id, context.newId)
  if (typeof id !== 'string') return id
  layer.id = id

  const position = clampIndex(op.index === undefined ? target.list.length : op.index, target.list.length)
  if (!position.ok) return position
  target.list.splice(position.index, 0, layer)
  return { ok: true, id }
}

function updateLayer(doc, op) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)
  if (!isObject(op.patch)) return err('bad-request', 'layer.update needs a `patch` object')
  for (const key of Object.keys(op.patch)) {
    if (key === 'id' || key === 'type') {
      return err('bad-property', `layer ${key} is immutable; delete the layer and add a new one to change it`)
    }
    if (key === 'children') {
      return err(
        'bad-property',
        'layer children are edited with layer.add/layer.move_to/layer.delete (pass parentId), not layer.update',
      )
    }
  }
  const allowed = allowedLayerProps(found.layer.type)
  const unknown = checkUnknownProps(op.patch, allowed, `layer (${found.layer.type}) patch`)
  if (unknown) return unknown
  const problem = assignProps(found.layer, op.patch, LAYER_PROP_KINDS)
  if (problem) return problem
  return { ok: true, id: found.layer.id }
}

function deleteLayer(doc, op) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)
  const removedIds = new Set()
  collectLayerIds(found.layer, removedIds)
  found.parent.splice(found.index, 1)
  doc.comments = doc.comments.filter(
    (comment) => !isObject(comment) || typeof comment.layerId !== 'string' || !removedIds.has(comment.layerId),
  )
  return { ok: true, id: found.layer.id }
}

function reorderLayer(doc, op) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)
  if (op.index === undefined) return err('bad-value', 'layer.reorder needs an `index`')
  const list = found.parent
  const position = clampIndex(op.index, list.length - 1)
  if (!position.ok) return position
  const [moved] = list.splice(found.index, 1)
  list.splice(position.index, 0, moved)
  return { ok: true, id: found.layer.id }
}

function moveLayer(doc, op, context) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)

  const hasArtboard = typeof op.artboardId === 'string' && op.artboardId !== ''
  const hasParent = typeof op.parentId === 'string' && op.parentId !== ''
  if (op.artboardId !== undefined && op.artboardId !== null && !hasArtboard) {
    return err('bad-id', 'artboardId must be a non-empty string')
  }
  if (op.parentId !== undefined && op.parentId !== null && !hasParent) {
    return err('bad-id', 'parentId must be a non-empty string')
  }
  if (hasArtboard && hasParent) {
    return err('bad-request', 'layer.move_to takes exactly one of `artboardId` or `parentId`')
  }
  if (!hasArtboard && !hasParent) {
    return err('bad-request', 'layer.move_to needs `artboardId` or `parentId` as the destination')
  }

  let targetList
  let targetLimit
  let targetLabel
  let targetKind
  let targetParentLayer = null
  let targetDepth = 0
  if (hasParent) {
    const parentFound = findLayer(doc, op.parentId)
    if (!parentFound) {
      return err('bad-id', `layer "${String(op.parentId)}" does not exist; call design_read for ids`)
    }
    if (!CONTAINER_TYPES.includes(parentFound.layer.type)) {
      return err(
        'bad-value',
        `layer "${op.parentId}" is a ${parentFound.layer.type}, not a frame or group; only those have children`,
      )
    }
    targetParentLayer = parentFound.layer
    if (!Array.isArray(targetParentLayer.children)) targetParentLayer.children = []
    targetList = targetParentLayer.children
    targetLimit = MAX_CHILDREN_PER_FRAME
    targetLabel = `${targetParentLayer.type} "${targetParentLayer.id}"`
    targetKind = 'children'
    targetDepth = parentFound.depth
  } else {
    const target = findArtboard(doc, op.artboardId)
    if (!target) {
      return err('bad-id', `artboard "${String(op.artboardId)}" does not exist; call design_read for ids`)
    }
    targetList = target.artboard.layers
    targetLimit = context.maxLayersPerArtboard
    targetLabel = `artboard "${target.artboard.id}"`
    targetKind = 'layers'
  }

  // Reordering inside the current parent keeps the historical same-array semantics.
  if (targetList === found.parent) {
    const position = clampIndex(
      op.index === undefined ? targetList.length - 1 : op.index,
      targetList.length - 1,
    )
    if (!position.ok) return position
    const [moved] = targetList.splice(found.index, 1)
    targetList.splice(position.index, 0, moved)
    return { ok: true, id: found.layer.id }
  }

  if (targetParentLayer && subtreeContains(found.layer, targetParentLayer.id)) {
    return err('bad-value', 'cannot move a layer into itself or one of its own descendants')
  }
  const height = subtreeHeight(found.layer)
  if (targetDepth + height > MAX_FRAME_DEPTH) {
    return err(
      'limit',
      `moving "${found.layer.id}" there would exceed the ${MAX_FRAME_DEPTH}-level layer nesting limit`,
    )
  }
  if (targetList.length >= targetLimit) {
    return err('limit', `${targetLabel} already has ${targetLimit} ${targetKind} (maximum)`)
  }
  const position = clampIndex(
    op.index === undefined ? targetList.length : op.index,
    targetList.length,
  )
  if (!position.ok) return position
  const [moved] = found.parent.splice(found.index, 1)
  targetList.splice(position.index, 0, moved)
  return { ok: true, id: found.layer.id }
}

/* --------------------------------------------------------------------------------------------
 * v2 op handlers: board rename, duplicates, grouping, batch comment updates
 * ------------------------------------------------------------------------------------------ */

/** Coerce an optional human name, rejecting empty/whitespace-only values. */
function coerceOptionalName(value) {
  if (value === undefined) return { ok: true, value: undefined }
  const coerced = coerceProp('name', 'name', value)
  if (!coerced.ok) return err('bad-value', coerced.message)
  const name = String(coerced.value).trim()
  if (!name) return err('bad-value', 'name must not be empty')
  return { ok: true, value: name.slice(0, MAX_NAME) }
}

/** `board.update { patch: { name } }`: rename the design (the "project"). */
function updateBoard(doc, op) {
  if (!isObject(op.patch)) return err('bad-request', 'board.update needs a `patch` object')
  const allowed = new Set(['name'])
  const unknown = checkUnknownProps(op.patch, allowed, 'board patch')
  if (unknown) return unknown
  if (!hasOwn(op.patch, 'name')) return { ok: true }
  const nameResult = coerceOptionalName(op.patch.name)
  if (!nameResult.ok) return nameResult
  if (!nameResult.value) return err('bad-value', 'board name must not be empty')
  doc.name = nameResult.value
  return { ok: true }
}

/** `artboard.duplicate { artboardId, name?, offsetX?, offsetY? }`: copy a board flush right after it. */
function duplicateArtboard(doc, op, context) {
  const found = findArtboard(doc, op.artboardId)
  if (!found) return err('bad-id', `artboard "${String(op.artboardId)}" does not exist; call design_read for ids`)
  if (doc.artboards.length >= MAX_ARTBOARDS) {
    return err('limit', `the document already has ${MAX_ARTBOARDS} artboards (maximum)`)
  }
  const offsets = readOffsets(op, 80, 80)
  if (!offsets.ok) return offsets
  const nameResult = coerceOptionalName(op.name)
  if (!nameResult.ok) return nameResult
  const sourceName =
    typeof found.artboard.name === 'string' && found.artboard.name.trim()
      ? found.artboard.name.trim()
      : 'Untitled artboard'
  const name = nameResult.value ?? `${sourceName.slice(0, MAX_NAME - 5)} copy`

  const used = new Set()
  const idResult = allocateFreshId(doc, used, context, 'ab')
  if (!idResult.ok) return idResult

  const { layers: sourceLayers, ...rest } = found.artboard
  const copy = clone(rest)
  copy.id = idResult.value
  copy.name = name
  copy.x = numberOr(copy.x, 0) + offsets.offsetX
  copy.y = numberOr(copy.y, 0) + offsets.offsetY
  copy.layers = []
  const rawLayers = Array.isArray(sourceLayers) ? sourceLayers : []
  for (const layer of rawLayers.slice(0, context.maxLayersPerArtboard)) {
    if (!isObject(layer)) continue
    const cloned = cloneLayerTree(doc, layer, used, context)
    if (!cloned.ok) return cloned
    copy.layers.push(cloned.layer)
  }
  doc.artboards.splice(found.index + 1, 0, copy)
  return { ok: true, id: copy.id }
}

/** `layer.duplicate { layerId, offsetX?, offsetY?, parentId?|artboardId?, index? }`. */
function duplicateLayer(doc, op, context) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)
  const offsets = readOffsets(op, 16, 16)
  if (!offsets.ok) return offsets
  for (const key of ['artboardId', 'parentId']) {
    if (op[key] !== undefined && op[key] !== null && (typeof op[key] !== 'string' || !op[key])) {
      return err('bad-id', `${key} must be a non-empty string`)
    }
  }
  const hasDestination =
    (typeof op.artboardId === 'string' && op.artboardId !== '') ||
    (typeof op.parentId === 'string' && op.parentId !== '')
  let list
  let limit
  let label
  let kind
  let wantedIndex
  if (hasDestination) {
    const target = resolveWriteTarget(doc, op, context)
    if (!target.ok) return target
    if (op.parentId !== undefined && subtreeContains(found.layer, op.parentId)) {
      return err(
        'bad-op',
        `cannot duplicate "${found.layer.id}" into itself or one of its own descendants`,
      )
    }
    if (target.depth + subtreeHeight(found.layer) > MAX_FRAME_DEPTH) {
      return err(
        'limit',
        `duplicating "${found.layer.id}" there would exceed the ${MAX_FRAME_DEPTH}-level layer nesting limit`,
      )
    }
    list = target.list
    limit = target.limit
    label = target.label
    kind = target.kind
    wantedIndex = op.index === undefined ? (list === found.parent ? found.index + 1 : list.length) : op.index
  } else {
    list = found.parent
    if (found.parentLayer) {
      limit = MAX_CHILDREN_PER_FRAME
      label = `${found.parentLayer.type} "${found.parentLayer.id}"`
      kind = 'children'
    } else {
      limit = context.maxLayersPerArtboard
      label = `artboard "${found.artboard.id}"`
      kind = 'layers'
    }
    wantedIndex = op.index === undefined ? found.index + 1 : op.index
  }
  if (list.length >= limit) {
    return err('limit', `${label} already has ${limit} ${kind} (maximum)`)
  }

  const cloned = cloneLayerTree(doc, found.layer, new Set(), context)
  if (!cloned.ok) return cloned
  const copy = cloned.layer
  copy.x = numberOr(copy.x, 0) + offsets.offsetX
  copy.y = numberOr(copy.y, 0) + offsets.offsetY

  const position = clampIndex(wantedIndex, list.length)
  if (!position.ok) return position
  list.splice(position.index, 0, copy)
  return { ok: true, id: copy.id }
}

/**
 * `layer.group { layerIds, name?, artboardId? }`: wrap sibling layers into one absolute group at
 * the union of their boxes, keeping their relative geometry and z-order.
 */
function groupLayers(doc, op, context) {
  if (!Array.isArray(op.layerIds)) return err('bad-request', 'layer.group needs a `layerIds` array')
  const ids = op.layerIds
  if (ids.length < 1) return err('bad-value', 'layer.group needs at least one layer id in `layerIds`')
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || !id) return err('bad-id', 'layerIds must be non-empty strings')
    if (seen.has(id)) {
      return err('bad-value', `layer "${id}" is listed more than once in layerIds`)
    }
    seen.add(id)
  }

  const members = []
  const missing = []
  for (const id of ids) {
    const member = findLayer(doc, id)
    if (member) members.push(member)
    else missing.push(id)
  }
  if (missing.length) {
    const list = missing.map((id) => `"${id}"`).join(', ')
    return err(
      'bad-id',
      `layer${plural(missing.length)} ${list} ${missing.length === 1 ? 'does' : 'do'} not exist; call design_read for ids`,
    )
  }

  const parentList = members[0].parent
  for (const member of members) {
    if (member.parent !== parentList) {
      return err(
        'bad-op',
        'layer.group needs layers that share one parent; move them into the same artboard, frame or group first',
      )
    }
  }
  if (op.artboardId !== undefined && op.artboardId !== null) {
    if (typeof op.artboardId !== 'string' || !op.artboardId) {
      return err('bad-id', 'artboardId must be a non-empty string')
    }
    if (op.artboardId !== members[0].artboard.id) {
      return err(
        'bad-id',
        `the selected layers are on artboard "${members[0].artboard.id}", not "${op.artboardId}"`,
      )
    }
  }
  const parentLayer = members[0].parentLayer
  if (parentLayer && isObject(parentLayer.layout)) {
    return err(
      'bad-op',
      `layer.group cannot group children of an auto-layout frame ("${parentLayer.id}"); set its layout to null or group them directly in the artboard`,
    )
  }
  if (members.length > MAX_CHILDREN_PER_FRAME) {
    return err('limit', `a group holds at most ${MAX_CHILDREN_PER_FRAME} layers (received ${members.length})`)
  }
  const depth = members[0].depth
  for (const member of members) {
    if (depth + subtreeHeight(member.layer) > MAX_FRAME_DEPTH) {
      return err(
        'limit',
        `grouping "${member.layer.id}" would exceed the ${MAX_FRAME_DEPTH}-level layer nesting limit`,
      )
    }
  }

  const nameResult = coerceOptionalName(op.name)
  if (!nameResult.ok) return nameResult

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const member of members) {
    const layer = member.layer
    const x = numberOr(layer.x, 0)
    const y = numberOr(layer.y, 0)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, extent(x, layer.width))
    maxY = Math.max(maxY, extent(y, layer.height))
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  const idResult = allocateFreshId(doc, new Set(), context, 'l')
  if (!idResult.ok) return idResult

  // Remove the members back-to-front so the remaining indices stay valid, and remember where the
  // group belongs (the slot of the topmost member).
  const ordered = [...members].sort((a, b) => a.index - b.index)
  const removed = new Set(ordered.map((member) => member.index))
  const topIndex = ordered[ordered.length - 1].index
  let insertAt = 0
  for (let index = 0; index < topIndex; index += 1) {
    if (!removed.has(index)) insertAt += 1
  }
  for (let offset = ordered.length - 1; offset >= 0; offset -= 1) {
    parentList.splice(ordered[offset].index, 1)
  }

  const group = {
    id: idResult.value,
    ...defaultLayer('group'),
    name: nameResult.value ?? 'Group',
    x: minX,
    y: minY,
    width,
    height,
  }
  for (const member of ordered) {
    const layer = member.layer
    layer.x = numberOr(layer.x, 0) - minX
    layer.y = numberOr(layer.y, 0) - minY
    group.children.push(layer)
  }
  parentList.splice(insertAt, 0, group)
  return { ok: true, id: group.id }
}

/** `layer.ungroup { layerId }`: dissolve a group, promoting its children in place. */
function ungroupLayer(doc, op, context) {
  const found = findLayer(doc, op.layerId)
  if (!found) return err('bad-id', `layer "${String(op.layerId)}" does not exist; call design_read for ids`)
  if (found.layer.type !== 'group') {
    const hint =
      found.layer.type === 'frame'
        ? '; a frame cannot be ungrouped, move its children out or delete it'
        : ''
    return err(
      'bad-op',
      `layer.ungroup only works on type "group"; "${found.layer.id}" is a ${found.layer.type}${hint}`,
    )
  }
  const children = (Array.isArray(found.layer.children) ? found.layer.children : []).filter(isObject)
  const limit = found.parentLayer ? MAX_CHILDREN_PER_FRAME : context.maxLayersPerArtboard
  if (found.parent.length - 1 + children.length > limit) {
    return err('limit', `ungrouping "${found.layer.id}" would exceed the ${limit}-layer parent limit`)
  }
  const originX = numberOr(found.layer.x, 0)
  const originY = numberOr(found.layer.y, 0)
  for (const child of children) {
    child.x = numberOr(child.x, 0) + originX
    child.y = numberOr(child.y, 0) + originY
  }
  found.parent.splice(found.index, 1, ...children)
  doc.comments = doc.comments.filter(
    (comment) => !isObject(comment) || comment.layerId !== found.layer.id,
  )
  return { ok: true, id: found.layer.id }
}

/** `comment.batch_update { commentIds, status }`: one op, one error listing every missing id. */
function batchUpdateComments(doc, op) {
  if (!Array.isArray(op.commentIds)) {
    return err('bad-request', 'comment.batch_update needs a `commentIds` array')
  }
  if (!COMMENT_STATUSES.includes(op.status)) {
    return err('bad-value', 'comment.batch_update needs `status` set to "open" or "resolved"')
  }
  const targets = []
  const missing = []
  const seen = new Set()
  for (const id of op.commentIds) {
    if (typeof id !== 'string' || !id) return err('bad-id', 'commentIds must be non-empty strings')
    if (seen.has(id)) continue
    seen.add(id)
    const comment = doc.comments.find((entry) => isObject(entry) && entry.id === id)
    if (comment) targets.push(comment)
    else missing.push(id)
  }
  if (missing.length) {
    const list = missing.map((id) => `"${id}"`).join(', ')
    return err(
      'bad-id',
      `comment${plural(missing.length)} ${list} ${missing.length === 1 ? 'does' : 'do'} not exist; no comment was updated`,
    )
  }
  for (const comment of targets) comment.status = op.status
  return { ok: true }
}

function addComment(doc, op, context) {
  if (op.text === undefined || op.text === null) {
    return err('bad-value', 'comment.add needs a `text` string')
  }
  let text
  if (typeof op.text === 'string') text = op.text.slice(0, MAX_COMMENT_TEXT)
  else if (isFiniteNumber(op.text) || typeof op.text === 'boolean') text = String(op.text)
  else return err('bad-value', 'comment text must be a string')
  if (!text.trim()) return err('bad-value', 'comment text must not be empty')
  if (doc.comments.length >= MAX_COMMENTS) {
    return err('limit', `the document already has ${MAX_COMMENTS} comments (maximum)`)
  }

  let artboardId
  if (op.artboardId !== undefined) {
    if (typeof op.artboardId !== 'string' || !op.artboardId) {
      return err('bad-id', 'artboardId must be a non-empty string')
    }
    const found = findArtboard(doc, op.artboardId)
    if (!found) return err('bad-id', `artboard "${op.artboardId}" does not exist; call design_read for ids`)
    artboardId = found.artboard.id
  }
  let layerId
  if (op.layerId !== undefined) {
    if (typeof op.layerId !== 'string' || !op.layerId) {
      return err('bad-id', 'layerId must be a non-empty string')
    }
    const found = findLayer(doc, op.layerId)
    if (!found) return err('bad-id', `layer "${op.layerId}" does not exist; call design_read for ids`)
    if (artboardId && found.artboard.id !== artboardId) {
      return err(
        'bad-id',
        `layer "${op.layerId}" is on artboard "${found.artboard.id}", not "${artboardId}"`,
      )
    }
    layerId = found.layer.id
    artboardId = found.artboard.id
  }

  const id = resolveId(doc, 'c', op.id, context.newId)
  if (typeof id !== 'string') return id

  const comment = { id, text, status: 'open', author: 'user', createdAt: context.nowIso }
  if (layerId) comment.layerId = layerId
  if (artboardId) comment.artboardId = artboardId
  doc.comments.push(comment)
  return { ok: true, id }
}

function updateComment(doc, op) {
  if (!COMMENT_STATUSES.includes(op.status)) {
    return err('bad-value', 'comment.update needs `status` set to "open" or "resolved"')
  }
  for (let index = 0; index < doc.comments.length; index += 1) {
    const comment = doc.comments[index]
    if (isObject(comment) && comment.id === op.commentId) {
      comment.status = op.status
      return { ok: true, id: comment.id }
    }
  }
  return err('bad-id', `comment "${String(op.commentId)}" does not exist; call design_read for ids`)
}

function deleteComment(doc, op) {
  for (let index = 0; index < doc.comments.length; index += 1) {
    const comment = doc.comments[index]
    if (isObject(comment) && comment.id === op.commentId) {
      doc.comments.splice(index, 1)
      return { ok: true, id: comment.id }
    }
  }
  return err('bad-id', `comment "${String(op.commentId)}" does not exist; call design_read for ids`)
}

function applyOne(doc, op, context) {
  if (!isObject(op)) return err('bad-op', 'each op must be an object with a `type`')
  const type = op.type
  const keys = typeof type === 'string' && hasOwn(OP_KEYS, type) ? OP_KEYS[type] : undefined
  if (!Array.isArray(keys)) {
    return err(
      'bad-op',
      `unknown op type ${JSON.stringify(type)}; expected one of: ${Object.keys(OP_KEYS).join(', ')}`,
    )
  }
  for (const key of Object.keys(op)) {
    if (!keys.includes(key)) {
      return err('bad-property', `unknown property "${key}" for op ${type}; allowed: ${keys.join(', ')}`)
    }
  }
  switch (type) {
    case 'board.update':
      return updateBoard(doc, op)
    case 'artboard.add':
      return addArtboard(doc, op, context)
    case 'artboard.update':
      return updateArtboard(doc, op)
    case 'artboard.delete':
      return deleteArtboard(doc, op)
    case 'artboard.duplicate':
      return duplicateArtboard(doc, op, context)
    case 'layer.add':
      return addLayer(doc, op, context)
    case 'layer.update':
      return updateLayer(doc, op)
    case 'layer.delete':
      return deleteLayer(doc, op)
    case 'layer.reorder':
      return reorderLayer(doc, op)
    case 'layer.move_to':
      return moveLayer(doc, op, context)
    case 'layer.duplicate':
      return duplicateLayer(doc, op, context)
    case 'layer.group':
      return groupLayers(doc, op, context)
    case 'layer.ungroup':
      return ungroupLayer(doc, op, context)
    case 'comment.add':
      return addComment(doc, op, context)
    case 'comment.update':
      return updateComment(doc, op)
    case 'comment.batch_update':
      return batchUpdateComments(doc, op)
    case 'comment.delete':
      return deleteComment(doc, op)
    default:
      return err('bad-op', `unknown op type ${JSON.stringify(type)}`)
  }
}

/* --------------------------------------------------------------------------------------------
 * applyOps
 * ------------------------------------------------------------------------------------------ */

/**
 * Apply an array of operations to a document clone.
 *
 * Bad input never throws: every problem is recorded in `errors` as `{ index, code, message }`.
 * Non-atomic mode applies ops independently and keeps the successful ones; atomic mode stops on
 * the first error and returns the input document unchanged.
 *
 * @param {object} doc
 * @param {unknown} ops
 * @param {{ atomic?: boolean, maxOpsPerCall?: number, maxLayersPerArtboard?: number,
 *           newId?: (prefix: string) => string, nowIso?: string }} [opts]
 * @returns {{ doc: object, applied: Array<{index:number,type:string,id?:string}>, errors: Array<{index:number,code:string,message:string}> }}
 */
export function applyOps(doc, ops, opts) {
  const options = isObject(opts) ? opts : {}
  const atomic = options.atomic === true
  const maxOpsPerCall = clampInt(options.maxOpsPerCall, 1, MAX_OPS_PER_CALL, 200)
  const maxLayersPerArtboard = clampInt(options.maxLayersPerArtboard, 1, 5000, 300)
  const context = {
    newId: typeof options.newId === 'function' ? options.newId : randomId,
    maxLayersPerArtboard,
    nowIso: nowIsoFrom(options),
  }

  const input = isObject(doc) ? doc : createStarterDoc(context.nowIso)
  const work = clone(input)
  if (!Array.isArray(work.artboards)) work.artboards = []
  if (!Array.isArray(work.comments)) work.comments = []

  if (!Array.isArray(ops)) {
    return {
      doc: work,
      applied: [],
      errors: [{ index: -1, code: 'bad-request', message: 'ops must be an array of operation objects' }],
    }
  }
  if (ops.length > maxOpsPerCall) {
    return {
      doc: work,
      applied: [],
      errors: [
        {
          index: -1,
          code: 'too-many-ops',
          message: `at most ${maxOpsPerCall} ops per call (received ${ops.length})`,
        },
      ],
    }
  }

  const applied = []
  const errors = []
  for (let index = 0; index < ops.length; index += 1) {
    const result = applyOne(work, ops[index], context)
    if (!result.ok) {
      errors.push({ index, code: result.code, message: result.message })
      if (atomic) return { doc: clone(input), applied: [], errors }
      continue
    }
    const entry = { index, type: ops[index].type }
    if (typeof result.id === 'string') entry.id = result.id
    applied.push(entry)
  }
  return { doc: work, applied, errors }
}

/* --------------------------------------------------------------------------------------------
 * normalizeDoc — rewrite a hand-edited / older file into a valid document without throwing
 * ------------------------------------------------------------------------------------------ */

function uniqueId(base, used) {
  let candidate = base
  let suffix = 2
  while (used.has(candidate) && suffix < 10000) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function normalizeArtboard(raw, index, limits, usedArtboardIds, usedLayerIds) {
  if (!isObject(raw)) return null
  const fallback = defaultArtboard()
  const name = typeof raw.name === 'string' && raw.name ? raw.name.slice(0, MAX_NAME) : fallback.name
  const baseId =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, MAX_NAME) : `ab-${index + 1}`

  const artboard = {
    id: uniqueId(baseId, usedArtboardIds),
    name,
    x: numberOr(raw.x, fallback.x),
    y: numberOr(raw.y, fallback.y),
    width: lengthOr(raw.width, fallback.width),
    height: lengthOr(raw.height, fallback.height),
    background: normalizePaint(raw.background, fallback.background),
    layers: [],
  }

  const rawLayers = Array.isArray(raw.layers) ? raw.layers.slice(0, limits.maxLayersPerArtboard) : []
  // Number missing ids by accepted depth-first position so repaired ids stay compact and any
  // comment that referenced the old deterministic id can still resolve.
  const counter = { value: 0 }
  for (let layerIndex = 0; layerIndex < rawLayers.length; layerIndex += 1) {
    const layer = normalizeLayer(rawLayers[layerIndex], counter, usedLayerIds, 1)
    if (layer) artboard.layers.push(layer)
  }
  return artboard
}

function normalizeLayer(raw, counter, usedLayerIds, depth) {
  if (!isObject(raw) || depth > MAX_FRAME_DEPTH) return null
  const type = LAYER_TYPES.includes(raw.type) ? raw.type : null
  if (!type) return null

  counter.value += 1
  const baseId =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, MAX_NAME) : `l-${counter.value}`
  const id = uniqueId(baseId, usedLayerIds)
  const layer = { id, ...defaultLayer(type) }

  const allowed = allowedLayerProps(type)
  for (const key of Object.keys(raw)) {
    if (key === 'id' || key === 'type' || key === 'children') continue
    if (key === 'layout') {
      if (type === 'frame') {
        const outcome = coerceLayout(raw.layout)
        layer.layout = outcome.ok ? outcome.value : null
      }
      continue
    }
    if (!hasOwn(LAYER_PROP_KINDS, key) || !allowed.has(key)) continue
    const result = coerceProp(key, LAYER_PROP_KINDS[key], raw[key])
    if (!result.ok) continue
    // Invalid/cleared optional props are dropped instead of inserting a default.
    if (CLEARABLE_KEYS.has(key) && result.value === null) continue
    layer[key] = result.value
  }
  // Repair an impossible min > max pair by dropping the conflicting bounds.
  if (isFiniteNumber(layer.minWidth) && isFiniteNumber(layer.maxWidth) && layer.minWidth > layer.maxWidth) {
    delete layer.minWidth
    delete layer.maxWidth
  }
  if (isFiniteNumber(layer.minHeight) && isFiniteNumber(layer.maxHeight) && layer.minHeight > layer.maxHeight) {
    delete layer.minHeight
    delete layer.maxHeight
  }

  if (CONTAINER_TYPES.includes(type)) {
    const rawChildren = Array.isArray(raw.children) ? raw.children.slice(0, MAX_CHILDREN_PER_FRAME) : []
    for (const rawChild of rawChildren) {
      const child = normalizeLayer(rawChild, counter, usedLayerIds, depth + 1)
      if (child) layer.children.push(child)
    }
  }
  return layer
}

/** Record every layer id (recursively) -> owning artboard id, for comment repair. */
function indexLayerArtboards(layers, artboardId, target) {
  if (!Array.isArray(layers)) return
  for (const layer of layers) {
    if (!isObject(layer)) continue
    if (typeof layer.id === 'string') target.set(layer.id, artboardId)
    if (isContainerLayer(layer)) {
      indexLayerArtboards(layer.children, artboardId, target)
    }
  }
}

function normalizeComment(raw, index, nowIso, usedCommentIds, layerArtboard) {
  if (!isObject(raw)) return null
  const text =
    typeof raw.text === 'string'
      ? raw.text.slice(0, MAX_COMMENT_TEXT)
      : raw.text === undefined || raw.text === null
        ? ''
        : String(raw.text).slice(0, MAX_COMMENT_TEXT)
  const baseId =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, MAX_NAME) : `c-${index + 1}`

  // A comment whose target layer no longer exists in the repaired tree is dropped (the layer may
  // have been deleted by a hand edit). A comment with only a dangling artboard reference stays
  // as a board-level comment.
  if (typeof raw.layerId === 'string' && raw.layerId && !layerArtboard.has(raw.layerId)) return null

  const comment = {
    id: uniqueId(baseId, usedCommentIds),
    text,
    status: COMMENT_STATUSES.includes(raw.status) ? raw.status : 'open',
    author: typeof raw.author === 'string' && raw.author ? raw.author.slice(0, MAX_NAME) : 'user',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso,
  }

  const layerId =
    typeof raw.layerId === 'string' && layerArtboard.has(raw.layerId) ? raw.layerId : undefined
  const artboardId =
    typeof raw.artboardId === 'string' && layerArtboard.artboardIds.has(raw.artboardId)
      ? raw.artboardId
      : undefined

  if (layerId) {
    comment.layerId = layerId
    comment.artboardId = layerArtboard.get(layerId)
  } else if (artboardId) {
    comment.artboardId = artboardId
  }
  return comment
}

/**
 * Repair and bound a raw parsed board file into a valid document. Never throws: worst case it
 * returns an empty valid document. Unknown properties are dropped, missing ids are filled with
 * deterministic ids, invalid numbers fall back to defaults, nested frame/group structures are
 * capped (including groups), invalid layouts become `null`, impossible min/max pairs are dropped,
 * and comments that point at missing layers are dropped.
 *
 * @param {unknown} raw
 * @param {{ maxLayersPerArtboard?: number, maxArtboards?: number, nowIso?: string }} [opts]
 * @returns {object}
 */
export function normalizeDoc(raw, opts) {
  const options = isObject(opts) ? opts : {}
  const limits = {
    maxLayersPerArtboard: clampInt(options.maxLayersPerArtboard, 1, 5000, 300),
    maxArtboards: clampInt(options.maxArtboards, 1, 200, MAX_ARTBOARDS),
    nowIso: nowIsoFrom(options),
  }
  try {
    const source = isObject(raw) ? raw : {}
    const doc = emptyDoc(limits.nowIso)
    doc.name =
      typeof source.name === 'string' && source.name
        ? source.name.slice(0, MAX_NAME)
        : doc.name
    doc.version = isFiniteNumber(source.version) ? Math.max(1, Math.floor(source.version)) : 1
    doc.updatedAt =
      typeof source.updatedAt === 'string' && source.updatedAt
        ? source.updatedAt
        : limits.nowIso

    const usedArtboardIds = new Set()
    const usedLayerIds = new Set()
    const rawArtboards = Array.isArray(source.artboards)
      ? source.artboards.slice(0, limits.maxArtboards)
      : []
    for (let index = 0; index < rawArtboards.length; index += 1) {
      const artboard = normalizeArtboard(rawArtboards[index], index, limits, usedArtboardIds, usedLayerIds)
      if (artboard) doc.artboards.push(artboard)
    }

    const layerArtboard = new Map()
    const artboardIds = new Set()
    for (const artboard of doc.artboards) {
      artboardIds.add(artboard.id)
      indexLayerArtboards(artboard.layers, artboard.id, layerArtboard)
    }

    const usedCommentIds = new Set()
    const rawComments = Array.isArray(source.comments) ? source.comments.slice(0, MAX_COMMENTS) : []
    for (let index = 0; index < rawComments.length; index += 1) {
      const comment = normalizeComment(rawComments[index], index, limits.nowIso, usedCommentIds, {
        get: (layerId) => layerArtboard.get(layerId),
        has: (layerId) => layerArtboard.has(layerId),
        artboardIds,
      })
      if (comment) doc.comments.push(comment)
    }
    return doc
  } catch {
    return emptyDoc(limits.nowIso)
  }
}

/* --------------------------------------------------------------------------------------------
 * summarizeDoc — compact textual outline for the model
 * ------------------------------------------------------------------------------------------ */

/** Render an auto-layout object as compact `layout=row gap=16 pad=16 align=center justify=...`. */
function layoutSummaryParts(layout) {
  if (!isObject(layout)) return []
  const parts = []
  parts.push(`layout=${LAYOUT_DIRECTIONS.includes(layout.direction) ? layout.direction : 'row'}`)
  parts.push(`gap=${fmt(numberOr(layout.gap, 0))}`)
  if (isFiniteNumber(layout.rowGap)) parts.push(`rgap=${fmt(layout.rowGap)}`)
  if (isFiniteNumber(layout.columnGap)) parts.push(`cgap=${fmt(layout.columnGap)}`)
  const padding = isObject(layout.padding) ? layout.padding : {}
  const top = fmt(numberOr(padding.top, 0))
  const right = fmt(numberOr(padding.right, 0))
  const bottom = fmt(numberOr(padding.bottom, 0))
  const left = fmt(numberOr(padding.left, 0))
  parts.push(
    top === right && right === bottom && bottom === left
      ? `pad=${top}`
      : `pad=${top}/${right}/${bottom}/${left}`,
  )
  parts.push(`align=${LAYOUT_ALIGNS.includes(layout.align) ? layout.align : 'stretch'}`)
  parts.push(`justify=${LAYOUT_JUSTIFIES.includes(layout.justify) ? layout.justify : 'start'}`)
  if (typeof layout.alignContent === 'string' && layout.alignContent !== 'stretch') {
    parts.push(`ac=${layout.alignContent}`)
  }
  if (layout.wrap === true) parts.push('wrap')
  return parts
}

function layerSummaryLine(layer, depth, commentCount) {
  const indent = '  '.repeat(Math.max(1, Math.min(depth, MAX_FRAME_DEPTH + 1)))
  const parts = [
    `${indent}${layer.id ?? '?'} ${layer.type ?? '?'} ${JSON.stringify(layer.name ?? '')} @${fmt(layer.x)},${fmt(layer.y)} ${fmt(layer.width)}x${fmt(layer.height)}`,
  ]
  const extras = []
  if (layer.type === 'frame') {
    extras.push(...layoutSummaryParts(layer.layout))
    if (!isObject(layer.layout)) extras.push('absolute')
    if (typeof layer.fill === 'string') extras.push(`fill=${short(layer.fill, 32)}`)
    if (isFiniteNumber(layer.radius) && layer.radius > 0) extras.push(`radius=${fmt(layer.radius)}`)
    if (layer.clip === true) extras.push('clip')
  } else if (layer.type === 'group') {
    if (layer.clip === true) extras.push('clip')
  } else if (layer.type === 'text') {
    if (typeof layer.text === 'string' && layer.text) extras.push(`text=${JSON.stringify(short(layer.text, 80))}`)
    if (isFiniteNumber(layer.fontSize)) extras.push(`font=${fmt(layer.fontSize)}/${fmt(layer.fontWeight)}`)
    if (typeof layer.align === 'string') extras.push(layer.align)
    if (typeof layer.color === 'string') extras.push(`color=${short(layer.color, 32)}`)
    if (isFiniteNumber(layer.letterSpacing) && layer.letterSpacing !== 0) extras.push(`ls=${fmt(layer.letterSpacing)}`)
    if (typeof layer.textTransform === 'string' && layer.textTransform !== 'none') {
      extras.push(`tt=${layer.textTransform}`)
    }
  } else if (layer.type === 'image') {
    if (typeof layer.src === 'string' && layer.src) extras.push(`src=${short(layer.src, 60)}`)
    if (typeof layer.fit === 'string') extras.push(`fit=${layer.fit}`)
  } else if (layer.type === 'line') {
    if (typeof layer.stroke === 'string') extras.push(`stroke=${short(layer.stroke, 32)}`)
    if (isFiniteNumber(layer.strokeWidth)) extras.push(`sw=${fmt(layer.strokeWidth)}`)
    if (typeof layer.orientation === 'string' && layer.orientation !== 'horizontal') {
      extras.push(layer.orientation)
    }
    if (layer.dashed === true) extras.push('dashed')
    if (layer.arrowStart === true) extras.push('arrowStart')
    if (layer.arrowEnd === true) extras.push('arrowEnd')
  } else if (typeof layer.fill === 'string') {
    extras.push(`fill=${short(layer.fill, 32)}`)
    if (isFiniteNumber(layer.radius) && layer.radius > 0) extras.push(`radius=${fmt(layer.radius)}`)
  }
  if (isFiniteNumber(layer.opacity) && layer.opacity !== 1) extras.push(`opacity=${fmt(layer.opacity)}`)
  if (layer.grow === true) extras.push('grow')
  if (typeof layer.alignSelf === 'string') extras.push(`alignSelf=${layer.alignSelf}`)
  if (layer.locked === true) extras.push('locked')
  const hug = []
  if (layer.hugWidth === true) hug.push('w')
  if (layer.hugHeight === true) hug.push('h')
  if (hug.length) extras.push(`hug=${hug.join('')}`)
  if (isFiniteNumber(layer.minWidth)) extras.push(`minW=${fmt(layer.minWidth)}`)
  if (isFiniteNumber(layer.minHeight)) extras.push(`minH=${fmt(layer.minHeight)}`)
  if (isFiniteNumber(layer.maxWidth)) extras.push(`maxW=${fmt(layer.maxWidth)}`)
  if (isFiniteNumber(layer.maxHeight)) extras.push(`maxH=${fmt(layer.maxHeight)}`)
  if (typeof layer.shadow === 'string' && layer.shadow) extras.push('shadow')
  if (layer.visible === false) extras.push('hidden')
  if (commentCount) extras.push(`${commentCount} comment${plural(commentCount)}`)
  if (extras.length) parts.push(extras.join(' '))
  return parts.join(' ')
}

/** Total number of layers in a layer array, following nested container children. */
function countLayerTree(layers) {
  let total = 0
  if (!Array.isArray(layers)) return total
  for (const layer of layers) {
    if (!isObject(layer)) continue
    total += 1
    if (isContainerLayer(layer)) total += countLayerTree(layer.children)
  }
  return total
}

/** Total number of layers of one type in a tree (used for the group count). */
function countLayersOfType(layers, type) {
  let total = 0
  if (!Array.isArray(layers)) return total
  for (const layer of layers) {
    if (!isObject(layer)) continue
    if (layer.type === type) total += 1
    if (isContainerLayer(layer)) total += countLayersOfType(layer.children, type)
  }
  return total
}

/** Total number of comments attached to any layer in a tree. */
function sumLayerCommentTree(layers, counts) {
  let total = 0
  if (!Array.isArray(layers)) return total
  for (const layer of layers) {
    if (!isObject(layer)) continue
    total += counts.get(layer.id) ?? 0
    if (isContainerLayer(layer)) total += sumLayerCommentTree(layer.children, counts)
  }
  return total
}

function pushLayerSummary(lines, layer, depth, commentCounts, state) {
  if (!isObject(layer) || state.truncated) return
  if (lines.length >= SUMMARY_LINE_BUDGET) {
    state.truncated = true
    return
  }
  lines.push(layerSummaryLine(layer, depth, commentCounts.get(layer.id) ?? 0))
  if (!isContainerLayer(layer)) return
  // Valid documents cannot nest below MAX_FRAME_DEPTH; the guard keeps a hand-edited file from
  // blowing the line budget through an unbounded walk.
  if (depth >= MAX_FRAME_DEPTH) return
  for (const child of layer.children) {
    if (state.truncated) return
    pushLayerSummary(lines, child, depth + 1, commentCounts, state)
  }
}

/**
 * Compact human/model readable outline of a document: artboards with size and layer count,
 * every layer as `id type name @x,y wxh` (plus useful props), nested frame children indented two
 * spaces per depth level, comment counts, and open comments. Bounded by SUMMARY_LINE_BUDGET.
 */
export function summarizeDoc(doc) {
  if (!isObject(doc)) return 'Design document: (invalid)'
  const artboards = Array.isArray(doc.artboards) ? doc.artboards.filter(isObject) : []
  const comments = Array.isArray(doc.comments) ? doc.comments.filter(isObject) : []

  const layerCommentCounts = new Map()
  const artboardDirectCommentCounts = new Map()
  for (const comment of comments) {
    if (typeof comment.layerId === 'string') {
      layerCommentCounts.set(comment.layerId, (layerCommentCounts.get(comment.layerId) ?? 0) + 1)
    } else if (typeof comment.artboardId === 'string') {
      artboardDirectCommentCounts.set(
        comment.artboardId,
        (artboardDirectCommentCounts.get(comment.artboardId) ?? 0) + 1,
      )
    }
  }

  let layerTotal = 0
  let groupTotal = 0
  for (const artboard of artboards) {
    const layers = Array.isArray(artboard.layers) ? artboard.layers : []
    layerTotal += countLayerTree(layers)
    groupTotal += countLayersOfType(layers, 'group')
  }
  const openComments = comments.filter((comment) => comment.status !== 'resolved')
  const name = typeof doc.name === 'string' && doc.name ? doc.name : 'Untitled design'

  const lines = [
    `"${name}" - ${artboards.length} artboard${plural(artboards.length)}, ${layerTotal} layer${plural(layerTotal)}${groupTotal ? ` (${groupTotal} group${plural(groupTotal)})` : ''}, ${comments.length} comment${plural(comments.length)} (${openComments.length} open)`,
  ]
  const state = { truncated: false }
  for (const artboard of artboards) {
    if (lines.length >= SUMMARY_LINE_BUDGET) {
      state.truncated = true
      break
    }
    const layers = Array.isArray(artboard.layers) ? artboard.layers.filter(isObject) : []
    const artboardComments =
      (artboardDirectCommentCounts.get(artboard.id) ?? 0) +
      sumLayerCommentTree(layers, layerCommentCounts)
    const artboardLayerCount = countLayerTree(layers)
    lines.push(
      `${artboard.id ?? '?'} ${JSON.stringify(artboard.name ?? '')} ${fmt(artboard.width)}x${fmt(artboard.height)} | ${artboardLayerCount} layer${plural(artboardLayerCount)}${artboardComments ? `, ${artboardComments} comment${plural(artboardComments)}` : ''}`,
    )
    for (const layer of layers) {
      if (state.truncated) break
      pushLayerSummary(lines, layer, 1, layerCommentCounts, state)
    }
    if (state.truncated) break
  }
  if (state.truncated) {
    lines.push('... more layers omitted; design_read with include:"all" for the full JSON')
  }

  if (openComments.length) {
    lines.push(`Open comments (${openComments.length}):`)
    for (const comment of openComments.slice(0, SUMMARY_OPEN_COMMENTS)) {
      const target =
        typeof comment.layerId === 'string'
          ? `layer ${comment.layerId}`
          : typeof comment.artboardId === 'string'
            ? `artboard ${comment.artboardId}`
            : 'the board'
      lines.push(`  ${comment.id ?? '?'} on ${target}: ${JSON.stringify(short(comment.text ?? '', 140))}`)
    }
    if (openComments.length > SUMMARY_OPEN_COMMENTS) {
      lines.push(`  ... ${openComments.length - SUMMARY_OPEN_COMMENTS} more open comments`)
    }
  }
  return lines.join('\n')
}
