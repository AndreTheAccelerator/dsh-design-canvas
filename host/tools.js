/**
 * Agent-facing tools and system-prompt section for the design canvas.
 *
 * `registerDesignTools` registers `design_read` and `design_apply` and returns one disposer that
 * unregisters both. `registerDesignPrompt` registers the `design-canvas` prompt section and
 * returns the section's disposer. index.js owns the `ctx.effect(...)` wrapping.
 *
 * Both tools only ever return lossless JSON: defined fields, finite numbers, plain objects/arrays
 * and null. Op failures are reported through `errors`, never thrown (except for malformed tool
 * input, which the framework turns into a tool error).
 */
import { summarizeDoc } from './model.js'

const READ_PARAMETERS = {
  type: 'object',
  properties: {
    artboardId: {
      type: 'string',
      description:
        'Artboard id from a previous design_read; limits the result to that artboard. Omit to read the whole document.',
    },
    include: {
      type: 'string',
      enum: ['all', 'summary'],
      description:
        '`all` (default) returns the full JSON document; `summary` returns a compact text outline instead.',
    },
  },
  additionalProperties: false,
}

const APPLY_PARAMETERS = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      description: 'Operations to apply in order. Vocabulary is in the tool description.',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['type'],
        properties: {
          type: { type: 'string', description: 'Operation name, e.g. "layer.update".' },
        },
      },
      maxItems: 200,
    },
    atomic: {
      type: 'boolean',
      description:
        'When true, roll back every op if one fails. Default false: each op applies or fails independently.',
    },
    note: {
      type: 'string',
      description: 'Short description of the change for the user (not stored in the document).',
    },
  },
  required: ['ops'],
  additionalProperties: false,
}

const READ_DESCRIPTION =
  'Read the design canvas document for the current session before changing it: artboards, their ' +
  'layers (nested inside `frame` layers) and element comments, plus the board path, version and ' +
  'canvas UI state. Geometry is in px, colors are CSS strings, and a layer\'s position in its ' +
  'parent\'s array (an artboard\'s `layers` or a frame\'s `children`) is its z-order (later paints ' +
  'on top). Use `include:"summary"` for a compact indented text outline (frames show their ' +
  '`layout=...` extras) instead of the full JSON document.'

const APPLY_DESCRIPTION = [
  'Apply visual operations to the design canvas (the right-sidebar board the user also edits). ' +
    'Call design_read first and use the ids it returns; never hand-edit the board JSON file. ' +
    'Geometry is in px, colors are CSS strings, and a layer\'s z-order is its array position ' +
    '(later = front). Op errors are reported in `errors` and do not fail the other ops unless ' +
    'atomic:true. Ops:',
  '- artboard.add {artboard:{name?,width?,height?,background?,x?,y?}, index?}; artboard.update {artboardId, patch:{name?,width?,height?,background?,x?,y?}}; artboard.delete {artboardId}',
  '- layer.add {artboardId?|parentId?, layer:{type, name?, x?, y?, width?, height?, ...props}, index?}; layer.update {layerId, patch:{...props}}; layer.delete {layerId}',
  '- layer.reorder {layerId, index}; layer.move_to {layerId, artboardId?|parentId?, index?}',
  '- comment.add {artboardId?, layerId?, text}; comment.update {commentId, status:"open"|"resolved"}; comment.delete {commentId}',
  'Layer props. All layers: name, x, y, width, height, opacity (0..1), visible, grow, alignSelf, shadow (CSS box-shadow string, max 200 chars). ' +
    'rect: fill, radius, borderWidth, borderColor. ellipse: fill, borderWidth, borderColor. ' +
    'text: text, color, fontSize, fontWeight (400|500|600|700), fontFamily, align (left|center|right), lineHeight (px), fill (background), letterSpacing (-20..40 px), textTransform (none|uppercase|lowercase). ' +
    'image: src (http(s) or data: URL), fit (cover|contain|fill), radius. ' +
    'frame: fill, radius, borderWidth, borderColor, clip (bool), layout (object or null). ' +
    'width/height are >= 1; unknown ids, properties and enum values are rejected.',
  'Styling: `shadow` is a CSS box-shadow string on any layer (null or "" clears it); fill and artboard background accept any CSS color or gradient string such as "linear-gradient(135deg,#2563eb,#1d4ed8)" or "radial-gradient(circle,#fff,#e5e7eb)" (text color and borderColor are plain colors only); text also accepts letterSpacing (-20..40 px) and textTransform (none|uppercase|lowercase).',
  'Frames and auto layout. Pass exactly one of `artboardId` (top level) or `parentId` (a frame ' +
    'id) to layer.add/layer.move_to; parentId derives the artboard. Frames nest up to 5 levels ' +
    '(top-level layers are depth 1) and hold up to 200 children; ids stay globally unique. ' +
    '`layout:null` (a frame\'s default) means children use absolute x/y relative to the frame. A ' +
    'layout object is {direction:"row"|"column", gap >= 0, padding:{top,right,bottom,left} each >= 0, ' +
    'align:"start"|"center"|"end"|"stretch" (cross axis), justify:"start"|"center"|"end"|"space-between" ' +
    '(main axis), wrap:bool}; missing fields default to row / gap 0 / padding 0 / stretch / start / false. ' +
    'Inside an auto-layout frame the renderer computes each child\'s x/y from the layout, so authored ' +
    'child x/y are ignored: set width/height and the optional child props grow:true (fill free ' +
    'main-axis space) and alignSelf:"start"|"center"|"end"|"stretch"|null. Children are created, moved ' +
    'and deleted with layer ops (`children` is not patchable); deleting a frame deletes its subtree ' +
    'and every comment on it.',
  'Example (one row frame + two cards in a single design_apply call; caller-supplied ids make the ' +
    'parentId references resolvable in the same call): ops:[{type:"layer.add", artboardId:"ab-landing", ' +
    'layer:{id:"l-row", type:"frame", name:"Feature row", x:96, y:420, width:1008, height:180, ' +
    'layout:{direction:"row", gap:16, padding:{top:16,right:16,bottom:16,left:16}, align:"center", ' +
    'justify:"space-between"}}},{type:"layer.add", parentId:"l-row", layer:{id:"l-card-a", type:"rect", ' +
    'name:"Card A", width:480, height:148, fill:"#f3f4f6", radius:12}},{type:"layer.add", ' +
    'parentId:"l-row", layer:{type:"text", name:"Card B", width:480, height:148, text:"Second card"}}]',
].join('\n')

const PROMPT_TEXT = [
  'The user has a Design canvas: a right-sidebar board paired with this chat, which the user also edits directly by dragging, resizing, typing, and leaving element comments.',
  'When a request concerns the canvas, call design_read first (include:"summary" gives a compact outline) and then express changes as visual operations through design_apply, using geometry in px, colors as CSS strings, and array position as z-order.',
  'Use only ids that design_read returned, never guess them, and read the `errors` array to correct a rejected op instead of retrying the whole call.',
  'For layout work prefer `frame` layers with a CSS-like `layout` (row/column, gap, padding, align/justify, wrap) and nest children with layer.add `parentId` instead of hand-placing them: inside an auto-layout frame the renderer computes child x/y from the layout, so set sizes (and optional grow/alignSelf), not coordinates.',
  'A user message that starts with "Design canvas revision request" is an element comment the user left on the board: act on it immediately and turn it into ops. The message already carries the board id, artboard size, target layer id, its geometry and its current props, so skip design_read when that is enough, design_apply the minimal styling/geometry ops (layer.update first, layer.add only when the comment asks for something new), keep unrelated layers untouched, then design_apply comment.update with the given commentId and status "resolved".',
  'For those revision requests do not ask clarifying questions and do not deliberate over visual taste: pick a reasonable interpretation that satisfies the comment and reply with one short sentence about what changed.',
  'Never hand-edit the design-board JSON file: the Host store owns it, and outside edits bypass the canvas.',
].join(' ')

function textBlock(text) {
  return [{ type: 'text', text: typeof text === 'string' ? text : String(text) }]
}

/** Collect every layer id in a tree (artboard top level + nested frame children). */
function collectLayerIds(layers, target) {
  if (!Array.isArray(layers)) return
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue
    if (typeof layer.id === 'string') target.add(layer.id)
    if (layer.type === 'frame') collectLayerIds(layer.children, target)
  }
}

function resolvePromptOrder(ctx) {
  try {
    const base = ctx?.systemPrompt?.getSectionOrder?.('tools')
    if (typeof base === 'number' && Number.isFinite(base)) return base + 1
  } catch {
    /* Older/newer builds may not expose this name; fall back to a stable slot near the tools. */
  }
  return 900
}

function renderRead(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return textBlock(JSON.stringify(value))
  }
  if (value.ok === false && value.error) {
    return textBlock(`design_read failed (${value.error.code}): ${value.error.message}`)
  }

  const lines = [`Design canvas | ${value.path ?? 'design-board.json'} | version ${value.version ?? '?'}`]
  if (typeof value.summary === 'string' && value.summary) lines.push(value.summary)
  if (value.doc !== null && value.doc !== undefined) {
    lines.push('', 'Full document JSON (geometry px; artboard layers and frame children are back-to-front):', JSON.stringify(value.doc))
  } else {
    lines.push('', 'Full document omitted (include:"all" to receive the JSON).')
  }
  if (value.ui && value.ui.lastReport) {
    const report = value.ui.lastReport
    lines.push('', `Canvas UI last reported: ${String(report.kind ?? 'report')} at ${String(report.time ?? '?')}`)
  }
  return textBlock(lines.join('\n'))
}

function renderApply(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return textBlock(JSON.stringify(value))
  }
  const applied = Array.isArray(value.applied) ? value.applied : []
  const errors = Array.isArray(value.errors) ? value.errors : []
  const lines = [`Applied ${applied.length} op${applied.length === 1 ? '' : 's'} to the design canvas | version ${value.version ?? '?'}.`]
  if (errors.length) {
    lines.push(`${errors.length} op error${errors.length === 1 ? '' : 's'}:`)
    for (const error of errors) {
      lines.push(`- op ${error.index} (${error.code}): ${error.message}`)
    }
  }
  if (typeof value.summary === 'string' && value.summary) lines.push('', value.summary)
  return textBlock(lines.join('\n'))
}

export function registerDesignTools(ctx, store) {
  const readTool = ctx.tools.register({
    name: 'design_read',
    description: READ_DESCRIPTION,
    parameters: READ_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return renderRead(value === undefined ? null : value)
      },
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id ?? ''
      const state = await store.read(sessionId)
      const include = args?.include === 'summary' ? 'summary' : 'all'
      const artboardId =
        typeof args?.artboardId === 'string' && args.artboardId.trim() ? args.artboardId.trim() : null

      let doc = state.doc
      if (artboardId) {
        const artboards = Array.isArray(doc.artboards) ? doc.artboards : []
        const artboard = artboards.find((entry) => entry && entry.id === artboardId)
        if (!artboard) {
          return {
            ok: false,
            error: {
              code: 'not-found',
              message: `artboard ${JSON.stringify(artboardId)} does not exist; call design_read without artboardId to list ids`,
            },
          }
        }
        const layerIds = new Set()
        collectLayerIds(artboard.layers, layerIds)
        const comments = Array.isArray(doc.comments) ? doc.comments : []
        doc = {
          ...doc,
          artboards: [artboard],
          comments: comments.filter(
            (comment) =>
              comment &&
              (comment.artboardId === artboardId ||
                (typeof comment.layerId === 'string' && layerIds.has(comment.layerId))),
          ),
        }
      }

      return {
        ok: true,
        path: state.path,
        version: state.version,
        doc: include === 'summary' ? null : doc,
        summary: summarizeDoc(doc),
        ui: state.ui,
      }
    },
  })

  const applyTool = ctx.tools.register({
    name: 'design_apply',
    description: APPLY_DESCRIPTION,
    parameters: APPLY_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return renderApply(value === undefined ? null : value)
      },
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id ?? ''
      const ops = args && Array.isArray(args.ops) ? args.ops : null
      if (!ops) throw new Error('design_apply requires an `ops` array')
      const result = await store.applyOps(sessionId, ops, {
        atomic: args.atomic === true,
        origin: 'agent',
      })
      return {
        ok: result.errors.length === 0,
        version: result.version,
        applied: result.applied,
        errors: result.errors,
        summary: summarizeDoc(result.doc),
      }
    },
  })

  return () => {
    try {
      readTool()
    } catch {
      /* disposal is best effort; the owning effect will drop the scope anyway */
    }
    try {
      applyTool()
    } catch {
      /* best effort */
    }
  }
}

export function registerDesignPrompt(ctx) {
  return ctx.systemPrompt.section({
    name: 'design-canvas',
    order: resolvePromptOrder(ctx),
    text: PROMPT_TEXT,
  })
}
