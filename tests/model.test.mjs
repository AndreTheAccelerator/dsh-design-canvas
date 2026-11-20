import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createStarterDoc,
  applyOps,
  summarizeDoc,
  normalizeDoc,
  cloneDoc,
} from '../host/model.js'

const NOW = '2026-01-01T00:00:00.000Z'

function starter() {
  return createStarterDoc(NOW)
}

function apply(doc, ops, options) {
  const result = applyOps(doc, ops, options)
  assert.deepEqual(result.errors, [], `unexpected op errors: ${JSON.stringify(result.errors)}`)
  return result.doc
}

function layerById(doc, id) {
  const visit = (layers) => {
    for (const layer of layers) {
      if (layer.id === id) return layer
      if (Array.isArray(layer.children)) {
        const found = visit(layer.children)
        if (found) return found
      }
    }
    return null
  }
  for (const artboard of doc.artboards) {
    const found = visit(artboard.layers)
    if (found) return found
  }
  return null
}

/** Flat list of every layer with its owning list, parent container and depth. */
function layerIndex(doc) {
  const entries = []
  for (const artboard of doc.artboards) {
    const visit = (list, parentLayer, depth) => {
      for (const layer of list) {
        entries.push({ layer, parent: list, parentLayer, depth, artboard })
        if (Array.isArray(layer.children)) visit(layer.children, layer, depth + 1)
      }
    }
    visit(artboard.layers, null, 1)
  }
  return entries
}

function allLayerIds(doc) {
  const ids = []
  for (const artboard of doc.artboards) {
    ids.push(artboard.id)
    for (const entry of layerIndex({ artboards: [artboard], comments: [] })) ids.push(entry.layer.id)
  }
  for (const comment of doc.comments) ids.push(comment.id)
  return ids
}

/** Code of the single op error produced by `ops`, or null when the op succeeded. */
function errorCode(doc, ops) {
  const result = applyOps(doc, ops)
  assert.equal(result.errors.length, 1, `expected exactly one op error, got ${JSON.stringify(result.errors)}`)
  return result.errors[0].code
}

function errorMessage(doc, ops) {
  const result = applyOps(doc, ops)
  assert.equal(result.errors.length, 1, `expected exactly one op error, got ${JSON.stringify(result.errors)}`)
  return result.errors[0].message
}

/** Collect every lossless-JSON violation in a value. */
function losslessProblems(value) {
  const problems = []
  const visit = (entry, at) => {
    if (entry === undefined) problems.push(`${at} undefined`)
    else if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return
    else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) problems.push(`${at} non-finite`)
    } else if (typeof entry !== 'object') problems.push(`${at} ${typeof entry}`)
    else if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${at}[${index}]`))
    else {
      if (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) {
        problems.push(`${at} non-plain object`)
      }
      for (const key of Object.keys(entry)) visit(entry[key], `${at}.${key}`)
    }
  }
  visit(value, '$')
  return problems
}

/* --------------------------------------------------------------------------------------------
 * v1 behaviour (unchanged)
 * ------------------------------------------------------------------------------------------ */

test('starter document has deterministic artboard and layers', () => {
  const doc = starter()
  assert.equal(doc.schemaVersion, 1)
  assert.equal(doc.artboards.length, 1)
  assert.equal(doc.artboards[0].id, 'ab-landing')
  assert.ok(doc.artboards[0].layers.length >= 4)
  assert.deepEqual(starter(), doc)
})

test('flat layer ops: add, update, reorder, delete', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: { id: 'l-a', type: 'rect', name: 'A', x: 10, y: 20, width: 100, height: 50, fill: '#ff0000' },
    },
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: { id: 'l-b', type: 'text', name: 'B', x: 0, y: 0, width: 200, height: 40, text: 'hi', color: '#111111', fontSize: 16 },
    },
  ])
  assert.ok(layerById(doc, 'l-a'))
  assert.equal(layerById(doc, 'l-b').text, 'hi')

  doc = apply(doc, [
    { type: 'layer.update', layerId: 'l-a', patch: { x: 99, fill: '#00ff00', radius: 12 } },
    { type: 'layer.reorder', layerId: 'l-a', index: 0 },
  ])
  assert.equal(layerById(doc, 'l-a').x, 99)
  assert.equal(layerById(doc, 'l-a').fill, '#00ff00')
  assert.equal(doc.artboards[0].layers[0].id, 'l-a')

  doc = apply(doc, [{ type: 'layer.delete', layerId: 'l-b' }])
  assert.equal(layerById(doc, 'l-b'), null)
})

test('invalid ops are reported, not thrown, and atomic mode rolls back', () => {
  const doc = starter()
  const partial = applyOps(doc, [
    { type: 'layer.update', layerId: 'nope', patch: { x: 1 } },
    { type: 'layer.add', artboardId: 'nope', layer: { type: 'rect' } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { type: 'bogus' } },
    { type: 'layer.update', layerId: 'l-title', patch: { width: 'wide' } },
  ])
  assert.equal(partial.applied.length, 0)
  assert.ok(partial.errors.length >= 3)
  for (const error of partial.errors) {
    assert.equal(typeof error.index, 'number')
    assert.equal(typeof error.code, 'string')
    assert.equal(typeof error.message, 'string')
  }

  const atomic = applyOps(doc, [
    { type: 'layer.update', layerId: 'l-title', patch: { x: 5 } },
    { type: 'layer.update', layerId: 'missing', patch: { x: 5 } },
  ], { atomic: true })
  assert.ok(atomic.errors.length === 1)
  assert.equal(layerById(atomic.doc, 'l-title').x, layerById(doc, 'l-title').x)
})

test('frames: children are added by parentId, layout is validated and completed', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: {
        id: 'l-row',
        type: 'frame',
        name: 'Row',
        x: 96,
        y: 400,
        width: 1008,
        height: 180,
        layout: { gap: 16, padding: { top: 16, right: 16, bottom: 16, left: 16 }, align: 'stretch', justify: 'start' },
      },
    },
    { type: 'layer.add', parentId: 'l-row', layer: { id: 'l-c1', type: 'rect', name: 'C1', width: 320, height: 148, grow: true } },
    { type: 'layer.add', parentId: 'l-row', layer: { id: 'l-c2', type: 'rect', name: 'C2', width: 320, height: 148 } },
  ])

  const frame = layerById(doc, 'l-row')
  assert.equal(frame.children.length, 2)
  assert.equal(frame.layout.direction, 'row')
  assert.equal(frame.layout.gap, 16)
  assert.equal(frame.layout.padding.left, 16)
  assert.equal(frame.layout.wrap, false)
  assert.equal(layerById(doc, 'l-c1').grow, true)

  const summary = summarizeDoc(doc)
  assert.match(summary, /l-row frame "Row"/)
  assert.match(summary, /layout=row gap=16 pad=16/)
  assert.match(summary, /^ {4}l-c1 /m)

  const badLayout = applyOps(doc, [{ type: 'layer.update', layerId: 'l-row', patch: { layout: { direction: 'diagonal' } } }])
  assert.equal(badLayout.errors.length, 1)
  assert.equal(badLayout.errors[0].code, 'bad-value')

  const cleared = apply(doc, [{ type: 'layer.update', layerId: 'l-row', patch: { layout: null } }])
  assert.equal(layerById(cleared, 'l-row').layout, null)
})

test('frames: nested moves, subtree delete and comment cleanup', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-frame', type: 'frame', name: 'Box', width: 400, height: 300 } },
    { type: 'layer.add', parentId: 'l-frame', layer: { id: 'l-inner', type: 'rect', name: 'Inner', width: 100, height: 40 } },
    { type: 'comment.add', layerId: 'l-inner', text: 'needs work' },
  ])
  assert.equal(doc.comments.length, 1)

  doc = apply(doc, [{ type: 'layer.move_to', layerId: 'l-inner', artboardId: 'ab-landing', index: 0 }])
  assert.equal(layerById(doc, 'l-frame').children.length, 0)
  assert.equal(doc.artboards[0].layers[0].id, 'l-inner')

  doc = apply(doc, [{ type: 'layer.move_to', layerId: 'l-inner', parentId: 'l-frame', index: 0 }])
  assert.equal(layerById(doc, 'l-frame').children[0].id, 'l-inner')

  doc = apply(doc, [{ type: 'layer.delete', layerId: 'l-frame' }])
  assert.equal(layerById(doc, 'l-frame'), null)
  assert.equal(layerById(doc, 'l-inner'), null)
  assert.equal(doc.comments.length, 0)
})

test('styling: shadow, gradients, text styles', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.update',
      layerId: 'l-cta',
      patch: {
        fill: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
        shadow: '0 10px 24px rgba(37,99,235,0.28)',
        radius: 14,
      },
    },
    { type: 'layer.update', layerId: 'l-title', patch: { letterSpacing: 1.5, textTransform: 'uppercase' } },
  ])
  assert.match(layerById(doc, 'l-cta').fill, /^linear-gradient\(/)
  assert.equal(layerById(doc, 'l-cta').shadow, '0 10px 24px rgba(37,99,235,0.28)')
  assert.equal(layerById(doc, 'l-title').letterSpacing, 1.5)
  assert.equal(layerById(doc, 'l-title').textTransform, 'uppercase')

  const cleared = apply(doc, [{ type: 'layer.update', layerId: 'l-cta', patch: { shadow: null } }])
  assert.equal('shadow' in layerById(cleared, 'l-cta'), false)

  const unsafe = applyOps(doc, [{ type: 'layer.update', layerId: 'l-cta', patch: { shadow: '0 0 0 red; }' } }])
  assert.equal(unsafe.errors.length, 1)

  const gradientColor = applyOps(doc, [{ type: 'layer.update', layerId: 'l-title', patch: { color: 'linear-gradient(0deg,#000,#fff)' } }])
  assert.equal(gradientColor.errors.length, 1)
})

test('normalizeDoc repairs hand-edited files without throwing', () => {
  const broken = cloneDoc(starter())
  broken.artboards[0].layers.push({
    id: 'l-dup',
    type: 'rect',
    name: 'A',
    width: 10,
    height: 10,
    unknownProp: true,
    fill: '#fff',
  })
  broken.artboards[0].layers.push({ id: 'l-dup', type: 'rect', name: 'B', width: 5, height: 5 })
  broken.artboards.push({ id: 'ab-broken', name: 'Broken', width: 'wide', height: -4, layers: 'nope' })
  broken.comments = [{ id: 'c-1', layerId: 'missing-layer', text: 'orphan', status: 'weird' }]

  const normalized = normalizeDoc(broken)
  assert.ok(normalized.artboards.length >= 1)
  for (const artboard of normalized.artboards) {
    assert.ok(Array.isArray(artboard.layers))
    assert.equal(typeof artboard.width, 'number')
    assert.ok(artboard.width >= 1)
  }
  const ids = normalized.artboards.flatMap((artboard) => artboard.layers.map((layer) => layer.id))
  assert.equal(new Set(ids).size, ids.length, 'ids must stay unique after repair')
})

test('results stay lossless JSON', () => {
  const doc = starter()
  const result = applyOps(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-line', type: 'line', width: 300 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-g', type: 'group', width: 400, height: 200 } },
    { type: 'layer.update', layerId: 'l-title', patch: { x: 3, locked: true, maxWidth: 500 } },
  ])
  assert.deepEqual(losslessProblems(result), [])
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  assert.deepEqual(losslessProblems(summarizeDoc(result.doc)), [])
})

/* --------------------------------------------------------------------------------------------
 * v2 — line layers
 * ------------------------------------------------------------------------------------------ */

test('line: defaults, coercion and clamping', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: { id: 'l-line', type: 'line', x: 40, y: 500, width: 300, height: 2 },
    },
  ])
  let line = layerById(doc, 'l-line')
  assert.equal(line.type, 'line')
  assert.equal(line.stroke, '#94a3b8')
  assert.equal(line.strokeWidth, 2)
  assert.equal(line.orientation, 'horizontal')
  assert.equal(line.dashed, false)
  assert.equal(line.arrowStart, false)
  assert.equal(line.arrowEnd, false)
  assert.equal(line.x, 40)
  assert.equal(line.width, 300)

  doc = apply(doc, [
    {
      type: 'layer.update',
      layerId: 'l-line',
      patch: {
        stroke: '#ef4444',
        strokeWidth: 500,
        orientation: 'vertical',
        dashed: true,
        arrowStart: true,
        arrowEnd: true,
      },
    },
  ])
  line = layerById(doc, 'l-line')
  assert.equal(line.stroke, '#ef4444')
  assert.equal(line.strokeWidth, 64)
  assert.equal(line.orientation, 'vertical')
  assert.equal(line.dashed, true)
  assert.equal(line.arrowStart, true)
  assert.equal(line.arrowEnd, true)

  const tiny = apply(doc, [{ type: 'layer.update', layerId: 'l-line', patch: { strokeWidth: 0 } }])
  assert.equal(layerById(tiny, 'l-line').strokeWidth, 0.5)
})

test('line: rejects non-line props and invalid values', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-line', type: 'line', width: 300 } },
  ])

  for (const patch of [
    { fill: '#111827' },
    { radius: 4 },
    { borderWidth: 2 },
    { borderColor: '#000000' },
    { children: [] },
    { layout: null },
    { clip: true },
  ]) {
    assert.equal(
      errorCode(doc, [{ type: 'layer.update', layerId: 'l-line', patch }]),
      'bad-property',
      `expected ${JSON.stringify(patch)} to be rejected`,
    )
  }
  assert.equal(
    errorCode(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { type: 'line', fill: '#fff' } }]),
    'bad-property',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-line', patch: { orientation: 'diagonal-ish' } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-line', patch: { stroke: 'linear-gradient(0deg,#000,#fff)' } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-line', patch: { dashed: 'yes' } }]),
    'bad-value',
  )
})

/* --------------------------------------------------------------------------------------------
 * v2 — group layers
 * ------------------------------------------------------------------------------------------ */

test('group: children are added/moved/deleted like a frame, with a 5-level depth cap', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: { id: 'l-g', type: 'group', name: 'G', x: 100, y: 100, width: 200, height: 100, clip: true },
    },
    { type: 'layer.add', parentId: 'l-g', layer: { id: 'l-gc1', type: 'rect', name: 'C1', width: 50, height: 20 } },
    { type: 'layer.add', parentId: 'l-g', layer: { id: 'l-gc2', type: 'text', name: 'C2', width: 80, height: 20, text: 'inside' } },
  ])
  const group = layerById(doc, 'l-g')
  assert.equal(group.type, 'group')
  assert.equal(group.clip, true)
  assert.equal('layout' in group, false)
  assert.equal(group.children.length, 2)
  assert.deepEqual(group.children.map((child) => child.id), ['l-gc1', 'l-gc2'])

  // Moving out of the group and back in keeps the group's child z-order.
  doc = apply(doc, [{ type: 'layer.move_to', layerId: 'l-gc2', artboardId: 'ab-landing', index: 0 }])
  assert.equal(doc.artboards[0].layers[0].id, 'l-gc2')
  assert.deepEqual(layerById(doc, 'l-g').children.map((child) => child.id), ['l-gc1'])
  doc = apply(doc, [{ type: 'layer.move_to', layerId: 'l-gc2', parentId: 'l-g', index: 0 }])
  assert.deepEqual(layerById(doc, 'l-g').children.map((child) => child.id), ['l-gc2', 'l-gc1'])

  // Deleting the group deletes its subtree and its comments.
  doc = apply(doc, [{ type: 'comment.add', layerId: 'l-gc1', text: 'child note' }])
  doc = apply(doc, [{ type: 'layer.delete', layerId: 'l-g' }])
  assert.equal(layerById(doc, 'l-g'), null)
  assert.equal(layerById(doc, 'l-gc1'), null)
  assert.equal(doc.comments.length, 0)

  // Depth cap: a group chain five levels deep cannot take another child.
  const chain = []
  let parent = null
  for (let level = 1; level <= 5; level += 1) {
    const id = `l-n${level}`
    chain.push({
      type: 'layer.add',
      ...(parent ? { parentId: parent } : { artboardId: 'ab-landing' }),
      layer: { id, type: 'group', name: `N${level}` },
    })
    parent = id
  }
  const nested = apply(starter(), chain)
  assert.equal(layerIndex(nested).filter((entry) => entry.layer.type === 'group').length, 5)
  const tooDeep = applyOps(nested, [{ type: 'layer.add', parentId: 'l-n5', layer: { type: 'rect' } }])
  assert.equal(tooDeep.errors.length, 1)
  assert.equal(tooDeep.errors[0].code, 'limit')
})

test('group: rejects layout, fill, radius and border props', () => {
  let doc = starter()
  doc = apply(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-g', type: 'group' } }])
  for (const patch of [
    { layout: { direction: 'row' } },
    { fill: '#ffffff' },
    { radius: 8 },
    { borderWidth: 1 },
    { borderColor: '#000000' },
    { src: 'https://example.com/x.png' },
    { text: 'nope' },
  ]) {
    assert.equal(
      errorCode(doc, [{ type: 'layer.update', layerId: 'l-g', patch }]),
      'bad-property',
      `expected ${JSON.stringify(patch)} to be rejected on a group`,
    )
  }
  assert.equal(
    errorCode(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { type: 'group', layout: null } }]),
    'bad-property',
  )
})

/* --------------------------------------------------------------------------------------------
 * v2 — common props: locked, min/max sizes, hug
 * ------------------------------------------------------------------------------------------ */

test('common props: locked, hugWidth/hugHeight and min/max bounds', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-box', type: 'rect', x: 10, y: 10, width: 100, height: 60 } },
    {
      type: 'layer.update',
      layerId: 'l-box',
      patch: {
        locked: true,
        hugWidth: true,
        hugHeight: true,
        minWidth: 40,
        minHeight: 20,
        maxWidth: 400,
        maxHeight: 200,
      },
    },
  ])
  let box = layerById(doc, 'l-box')
  assert.equal(box.locked, true)
  assert.equal(box.hugWidth, true)
  assert.equal(box.hugHeight, true)
  assert.equal(box.minWidth, 40)
  assert.equal(box.maxWidth, 400)
  assert.equal(box.width, 100, 'the model must never rewrite width from min/max')

  // false / null clear the flags and bounds instead of storing them.
  doc = apply(doc, [{ type: 'layer.update', layerId: 'l-box', patch: { locked: false, hugWidth: false, maxWidth: null } }])
  box = layerById(doc, 'l-box')
  assert.equal('locked' in box, false)
  assert.equal('hugWidth' in box, false)
  assert.equal('maxWidth' in box, false)
  assert.equal(box.hugHeight, true, 'hugHeight stays set')
  assert.equal(box.maxHeight, 200)

  // Negative bounds clamp to 0.
  doc = apply(doc, [{ type: 'layer.update', layerId: 'l-box', patch: { minWidth: -20 } }])
  assert.equal(layerById(doc, 'l-box').minWidth, 0)

  // min > max is a bad-value error, and the rejected patch leaves the layer untouched.
  doc = apply(doc, [{ type: 'layer.update', layerId: 'l-box', patch: { maxWidth: 500 } }])
  const before = layerById(doc, 'l-box')
  const conflict = applyOps(doc, [{ type: 'layer.update', layerId: 'l-box', patch: { minWidth: 900 } }])
  assert.equal(conflict.errors.length, 1)
  assert.equal(conflict.errors[0].code, 'bad-value')
  assert.match(conflict.errors[0].message, /minWidth/)
  assert.deepEqual(layerById(conflict.doc, 'l-box'), before)

  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-box', patch: { minHeight: 500, maxHeight: 100 } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { type: 'rect', minWidth: 50, maxWidth: 10 } }]),
    'bad-value',
  )

  // Hints are accepted on every layer type, including containers and lines.
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-g', type: 'group', hugWidth: true, locked: true } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-line', type: 'line', minHeight: 2, hugHeight: true } },
  ])
  assert.equal(layerById(doc, 'l-g').locked, true)
  assert.equal(layerById(doc, 'l-line').hugHeight, true)
  assert.equal(layerById(doc, 'l-line').minHeight, 2)
})

/* --------------------------------------------------------------------------------------------
 * v2 — layout object extensions
 * ------------------------------------------------------------------------------------------ */

test('layout: alignContent, rowGap/columnGap and the new justify values', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: { id: 'l-f', type: 'frame', width: 400, height: 200, layout: { direction: 'row' } },
    },
  ])
  // Back-compat: an old layout normalizes to a complete object with the new defaults.
  let layout = layerById(doc, 'l-f').layout
  assert.deepEqual(layout.padding, { top: 0, right: 0, bottom: 0, left: 0 })
  assert.equal(layout.align, 'stretch')
  assert.equal(layout.alignContent, 'stretch')
  assert.equal(layout.justify, 'start')
  assert.equal(layout.wrap, false)
  assert.equal('rowGap' in layout, false)
  assert.equal('columnGap' in layout, false)

  doc = apply(doc, [
    {
      type: 'layer.update',
      layerId: 'l-f',
      patch: {
        layout: {
          direction: 'row',
          gap: 8,
          rowGap: 16,
          columnGap: 24,
          align: 'center',
          alignContent: 'space-between',
          justify: 'space-evenly',
          wrap: true,
        },
      },
    },
  ])
  layout = layerById(doc, 'l-f').layout
  assert.equal(layout.rowGap, 16)
  assert.equal(layout.columnGap, 24)
  assert.equal(layout.alignContent, 'space-between')
  assert.equal(layout.justify, 'space-evenly')

  const summary = summarizeDoc(doc)
  assert.match(summary, /justify=space-evenly/)
  assert.match(summary, /ac=space-between/)
  assert.match(summary, /rgap=16/)
  assert.match(summary, /cgap=24/)

  for (const justify of ['space-around', 'space-evenly']) {
    const posted = apply(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { justify } } }])
    assert.equal(layerById(posted, 'l-f').layout.justify, justify)
  }

  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { justify: 'space-out' } } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { alignContent: 'around' } } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { rowGap: -4 } } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { columnGap: 'wide' } } }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { unknown: 1 } } }]),
    'bad-property',
  )

  // Replacing the layout object drops the previously stored gaps.
  const replaced = apply(doc, [{ type: 'layer.update', layerId: 'l-f', patch: { layout: { gap: 4 } } }])
  const replacedLayout = layerById(replaced, 'l-f').layout
  assert.equal('rowGap' in replacedLayout, false)
  assert.equal(replacedLayout.alignContent, 'stretch')
})

/* --------------------------------------------------------------------------------------------
 * v2 — board.update
 * ------------------------------------------------------------------------------------------ */

test('board.update renames the design and rejects empty names', () => {
  let doc = starter()
  doc = apply(doc, [{ type: 'board.update', patch: { name: '  Landing revamp  ' } }])
  assert.equal(doc.name, 'Landing revamp')
  assert.match(summarizeDoc(doc), /"Landing revamp"/)

  assert.equal(errorCode(doc, [{ type: 'board.update', patch: { name: '   ' } }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'board.update', patch: { name: '' } }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'board.update', patch: { name: {} } }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'board.update', patch: { width: 10 } }]), 'bad-property')
  assert.equal(errorCode(doc, [{ type: 'board.update' }]), 'bad-request')
  assert.equal(errorCode(doc, [{ type: 'board.update', patch: {}, extra: 1 }]), 'bad-property')

  // An empty patch is a valid no-op, and board.update never bumps the version.
  const result = applyOps(doc, [{ type: 'board.update', patch: {} }])
  assert.deepEqual(result.errors, [])
  assert.equal(result.doc.version, doc.version)
})

/* --------------------------------------------------------------------------------------------
 * v2 — layer.duplicate
 * ------------------------------------------------------------------------------------------ */

test('layer.duplicate copies a subtree with fresh ids right after the source', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-card', type: 'rect', x: 100, y: 100, width: 80, height: 40, fill: '#111827' } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-after', type: 'rect', width: 10, height: 10 } },
    { type: 'comment.add', layerId: 'l-card', text: 'keep this one' },
  ])
  const sourceIndex = doc.artboards[0].layers.findIndex((layer) => layer.id === 'l-card')
  const result = applyOps(doc, [{ type: 'layer.duplicate', layerId: 'l-card' }])
  assert.deepEqual(result.errors, [])
  const copyId = result.applied[0].id
  assert.equal(typeof copyId, 'string')
  assert.notEqual(copyId, 'l-card')

  const copy = layerById(result.doc, copyId)
  assert.equal(copy.x, 116)
  assert.equal(copy.y, 116)
  assert.equal(copy.fill, '#111827')
  assert.equal(copy.type, 'rect')
  assert.equal(result.doc.artboards[0].layers[sourceIndex + 1].id, copyId, 'copy goes right after the source')
  assert.equal(result.doc.artboards[0].layers[sourceIndex + 2].id, 'l-after')
  assert.equal(result.doc.comments.length, 1, 'comments are not copied')
  assert.equal(result.doc.version, doc.version, 'applyOps never bumps the version')
  doc = result.doc

  // Custom offsets, including zero.
  const moved = applyOps(doc, [{ type: 'layer.duplicate', layerId: 'l-card', offsetX: 0, offsetY: 40 }])
  const movedCopy = layerById(moved.doc, moved.applied[0].id)
  assert.equal(movedCopy.x, 100)
  assert.equal(movedCopy.y, 140)

  // A duplicated frame gets fresh ids for its whole subtree and keeps relative child geometry.
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-f', type: 'frame', x: 300, y: 300, width: 200, height: 100 } },
    { type: 'layer.add', parentId: 'l-f', layer: { id: 'l-fc', type: 'rect', x: 10, y: 20, width: 50, height: 30 } },
  ])
  const frameDup = applyOps(doc, [{ type: 'layer.duplicate', layerId: 'l-f' }])
  assert.deepEqual(frameDup.errors, [])
  const frameCopy = layerById(frameDup.doc, frameDup.applied[0].id)
  assert.equal(frameCopy.type, 'frame')
  assert.equal(frameCopy.x, 316)
  assert.equal(frameCopy.y, 316)
  assert.equal(frameCopy.children.length, 1)
  assert.notEqual(frameCopy.children[0].id, 'l-fc')
  assert.equal(frameCopy.children[0].x, 10)
  assert.equal(frameCopy.children[0].y, 20)

  // Duplicate to an explicit destination with an index.
  const toArtboard = applyOps(doc, [
    { type: 'layer.duplicate', layerId: 'l-fc', artboardId: 'ab-landing', index: 0, offsetX: 0, offsetY: 0 },
  ])
  assert.deepEqual(toArtboard.errors, [])
  assert.equal(toArtboard.doc.artboards[0].layers[0].id, toArtboard.applied[0].id)

  // Duplicate into a group keeps the group as parent.
  doc = apply(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-g', type: 'group', width: 300, height: 300 } }])
  const intoGroup = applyOps(doc, [{ type: 'layer.duplicate', layerId: 'l-card', parentId: 'l-g' }])
  assert.deepEqual(intoGroup.errors, [])
  assert.equal(layerById(intoGroup.doc, 'l-g').children.length, 1)
})

test('layer.duplicate error paths', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-f', type: 'frame', width: 400, height: 300 } },
    { type: 'layer.add', parentId: 'l-f', layer: { id: 'l-c', type: 'frame', width: 100, height: 100 } },
    { type: 'layer.add', parentId: 'l-c', layer: { id: 'l-leaf', type: 'rect', width: 10, height: 10 } },
  ])

  assert.equal(errorCode(doc, [{ type: 'layer.duplicate', layerId: 'nope' }]), 'bad-id')
  // l-c is a frame nested inside l-f, so duplicating l-f into it lands inside its own subtree.
  assert.equal(
    errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', parentId: 'l-c' }]),
    'bad-op',
  )
  assert.equal(errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', parentId: 'l-f' }]), 'bad-op')
  assert.equal(
    errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', parentId: 'l-leaf' }]),
    'bad-value',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', artboardId: 'ab-landing', parentId: 'l-c' }]),
    'bad-request',
  )
  assert.equal(errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', offsetX: 'far' }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', offsetY: null }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'layer.duplicate', layerId: 'l-f', parentId: 'nope' }]), 'bad-id')

  // Depth: a 2-level subtree cannot go under a container at depth 4.
  let deep = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-d1', type: 'group' } },
    { type: 'layer.add', parentId: 'l-d1', layer: { id: 'l-d2', type: 'group' } },
    { type: 'layer.add', parentId: 'l-d2', layer: { id: 'l-d3', type: 'group' } },
    { type: 'layer.add', parentId: 'l-d3', layer: { id: 'l-d4', type: 'group' } },
  ])
  assert.equal(
    errorCode(deep, [{ type: 'layer.duplicate', layerId: 'l-f', parentId: 'l-d4' }]),
    'limit',
  )
})

/* --------------------------------------------------------------------------------------------
 * v2 — layer.group / layer.ungroup
 * ------------------------------------------------------------------------------------------ */

test('layer.group wraps siblings into an absolute group', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-a', type: 'rect', x: 100, y: 100, width: 50, height: 50 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-b', type: 'rect', x: 180, y: 120, width: 20, height: 20 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-c', type: 'rect', x: 300, y: 300, width: 40, height: 30 } },
  ])
  const result = applyOps(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-c'], name: 'Pair' }])
  assert.deepEqual(result.errors, [])
  const groupId = result.applied[0].id
  doc = result.doc

  const group = layerById(doc, groupId)
  assert.equal(group.type, 'group')
  assert.equal(group.name, 'Pair')
  // Union box of (100,100,50,50) and (300,300,40,30).
  assert.equal(group.x, 100)
  assert.equal(group.y, 100)
  assert.equal(group.width, 240)
  assert.equal(group.height, 230)
  assert.deepEqual(group.children.map((child) => child.id), ['l-a', 'l-c'], 'z-order preserved')
  assert.equal(group.children[0].x, 0)
  assert.equal(group.children[0].y, 0)
  assert.equal(group.children[1].x, 200)
  assert.equal(group.children[1].y, 200)

  // Group inserted at the slot of the topmost member; the sibling that was between them stays.
  const topLevel = doc.artboards[0].layers
  assert.equal(topLevel[topLevel.length - 1].id, groupId)
  assert.ok(topLevel.find((layer) => layer.id === 'l-b'))
  assert.equal(topLevel.some((layer) => layer.id === 'l-a' || layer.id === 'l-c'), false)

  // Default name.
  const unnamedResult = applyOps(doc, [{ type: 'layer.group', layerIds: ['l-b'] }])
  assert.deepEqual(unnamedResult.errors, [])
  const single = layerById(unnamedResult.doc, unnamedResult.applied[0].id)
  assert.equal(single.type, 'group')
  assert.equal(single.name, 'Group')
  assert.equal(single.width, 20)
  assert.equal(single.height, 20)
  assert.equal(single.children.length, 1)

  // Groups can be nested in frames and in other groups.
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-frame', type: 'frame', x: 0, y: 500, width: 200, height: 100 } },
    { type: 'layer.add', parentId: 'l-frame', layer: { id: 'l-fa', type: 'rect', x: 10, y: 10, width: 20, height: 20 } },
    { type: 'layer.add', parentId: 'l-frame', layer: { id: 'l-fb', type: 'rect', x: 40, y: 40, width: 20, height: 20 } },
  ])
  const nested = apply(doc, [{ type: 'layer.group', layerIds: ['l-fa', 'l-fb'] }])
  const nestedFrame = nested.artboards[0].layers.find((layer) => layer.id === 'l-frame')
  const nestedGroup = nestedFrame.children[0]
  assert.equal(nestedGroup.type, 'group')
  assert.equal(nestedGroup.x, 10)
  assert.equal(nestedGroup.y, 10)
  assert.equal(nestedGroup.width, 50)
  assert.equal(nestedGroup.height, 50)
  assert.deepEqual(nestedGroup.children.map((child) => [child.id, child.x, child.y]), [
    ['l-fa', 0, 0],
    ['l-fb', 30, 30],
  ])
})

test('layer.group error paths', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-a', type: 'rect', x: 10, y: 10, width: 10, height: 10 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-b', type: 'rect', x: 30, y: 30, width: 10, height: 10 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-row', type: 'frame', layout: { direction: 'row' } } },
    { type: 'layer.add', parentId: 'l-row', layer: { id: 'l-r1', type: 'rect', width: 50, height: 20 } },
    { type: 'layer.add', parentId: 'l-row', layer: { id: 'l-r2', type: 'rect', width: 50, height: 20 } },
  ])
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: [] }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: 'l-a' }]), 'bad-request')
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-a'] }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-missing'] }]), 'bad-id')
  assert.match(errorMessage(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-missing'] }]), /l-missing/)
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-r1'] }]), 'bad-op')
  assert.equal(errorCode(doc, [{ type: 'layer.group', layerIds: ['l-r1', 'l-r2'] }]), 'bad-op')
  assert.match(
    errorMessage(doc, [{ type: 'layer.group', layerIds: ['l-r1', 'l-r2'] }]),
    /auto-layout/,
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.group', layerIds: ['l-a', 'l-b'], artboardId: 'ab-other' }]),
    'bad-id',
  )
  assert.equal(
    errorCode(doc, [{ type: 'layer.group', layerIds: ['l-a'], name: '   ' }]),
    'bad-value',
  )
})

test('layer.ungroup promotes children in place and rejects non-groups', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-a', type: 'rect', x: 100, y: 100, width: 50, height: 50 } },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-b', type: 'rect', x: 200, y: 160, width: 60, height: 20 } },
  ])
  doc = apply(doc, [
    { type: 'layer.group', layerIds: ['l-a', 'l-b'] },
    { type: 'comment.add', layerId: 'l-a', text: 'on child' },
  ])
  const group = doc.artboards[0].layers.find((layer) => layer.type === 'group')
  doc = apply(doc, [{ type: 'comment.add', layerId: group.id, text: 'on group' }])
  assert.equal(doc.comments.length, 2)

  const ungrouped = applyOps(doc, [{ type: 'layer.ungroup', layerId: group.id }])
  assert.deepEqual(ungrouped.errors, [])
  doc = ungrouped.doc
  assert.equal(layerById(doc, group.id), null)
  assert.equal(layerById(doc, 'l-a').x, 100)
  assert.equal(layerById(doc, 'l-a').y, 100)
  assert.equal(layerById(doc, 'l-b').x, 200)
  assert.equal(layerById(doc, 'l-b').y, 160)
  assert.equal(doc.comments.length, 1, 'comments on the group are dropped, comments on children stay')
  assert.equal(doc.comments[0].layerId, 'l-a')
  // Children keep their z-order and land at the group's slot.
  const ids = doc.artboards[0].layers.map((layer) => layer.id)
  assert.ok(ids.indexOf('l-a') < ids.indexOf('l-b'))

  // Ungrouping a frame (or a leaf) is a clear bad-op.
  doc = apply(doc, [{ type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-f', type: 'frame' } }])
  assert.equal(errorCode(doc, [{ type: 'layer.ungroup', layerId: 'l-f' }]), 'bad-op')
  assert.match(errorMessage(doc, [{ type: 'layer.ungroup', layerId: 'l-f' }]), /frame/)
  assert.equal(errorCode(doc, [{ type: 'layer.ungroup', layerId: 'l-a' }]), 'bad-op')
  assert.equal(errorCode(doc, [{ type: 'layer.ungroup', layerId: 'nope' }]), 'bad-id')
})

/* --------------------------------------------------------------------------------------------
 * v2 — artboard.duplicate
 * ------------------------------------------------------------------------------------------ */

test('artboard.duplicate clones ids, offsets the copy and names it', () => {
  const doc = starter()
  const result = applyOps(doc, [{ type: 'artboard.duplicate', artboardId: 'ab-landing' }])
  assert.deepEqual(result.errors, [])
  const newId = result.applied[0].id
  assert.match(newId, /^ab-/)
  assert.notEqual(newId, 'ab-landing')
  assert.equal(result.doc.artboards.length, 2)
  assert.equal(result.doc.artboards[1].id, newId)
  assert.equal(result.doc.artboards[1].name, 'Landing copy')
  assert.equal(result.doc.artboards[1].x, 80)
  assert.equal(result.doc.artboards[1].y, 80)
  assert.equal(result.doc.artboards[1].width, 1200)
  assert.equal(result.doc.artboards[1].layers.length, doc.artboards[0].layers.length)
  assert.notEqual(result.doc.artboards[1].layers[0].id, 'l-title')
  assert.equal(result.doc.artboards[1].layers[0].text, doc.artboards[0].layers[0].text)

  const ids = allLayerIds(result.doc)
  assert.equal(new Set(ids).size, ids.length, 'every duplicated id must be globally unique')

  const renamed = applyOps(result.doc, [{ type: 'artboard.duplicate', artboardId: 'ab-landing', name: 'Second', offsetX: 0, offsetY: 900 }])
  assert.deepEqual(renamed.errors, [])
  assert.equal(renamed.doc.artboards[1].name, 'Second')
  assert.equal(renamed.doc.artboards[1].x, 0)
  assert.equal(renamed.doc.artboards[1].y, 900)

  assert.equal(errorCode(result.doc, [{ type: 'artboard.duplicate', artboardId: 'nope' }]), 'bad-id')
  assert.equal(errorCode(result.doc, [{ type: 'artboard.duplicate', artboardId: 'ab-landing', name: '  ' }]), 'bad-value')
  assert.equal(errorCode(result.doc, [{ type: 'artboard.duplicate', artboardId: 'ab-landing', offsetX: 'x' }]), 'bad-value')
})

/* --------------------------------------------------------------------------------------------
 * v2 — comment.batch_update
 * ------------------------------------------------------------------------------------------ */

test('comment.batch_update updates every listed comment and names missing ids', () => {
  let doc = starter()
  doc = apply(doc, [
    { type: 'comment.add', layerId: 'l-title', text: 'one' },
    { type: 'comment.add', layerId: 'l-subtitle', text: 'two' },
    { type: 'comment.add', artboardId: 'ab-landing', text: 'three' },
  ])
  assert.equal(doc.comments.length, 3)
  const ids = doc.comments.map((comment) => comment.id)

  doc = apply(doc, [{ type: 'comment.batch_update', commentIds: ids, status: 'resolved' }])
  assert.deepEqual(doc.comments.map((comment) => comment.status), ['resolved', 'resolved', 'resolved'])
  assert.equal(summarizeDoc(doc).includes('0 open'), true)

  const reopened = apply(doc, [{ type: 'comment.batch_update', commentIds: [ids[0], ids[0]], status: 'open' }])
  assert.equal(reopened.comments[0].status, 'open', 'duplicate ids are applied once')

  const missing = applyOps(doc, [
    { type: 'comment.batch_update', commentIds: [ids[0], 'c-gone', ids[1], 'c-also-gone'], status: 'open' },
  ])
  assert.equal(missing.errors.length, 1)
  assert.equal(missing.errors[0].code, 'bad-id')
  assert.match(missing.errors[0].message, /c-gone/)
  assert.match(missing.errors[0].message, /c-also-gone/)
  assert.deepEqual(missing.doc.comments.map((comment) => comment.status), ['resolved', 'resolved', 'resolved'], 'nothing is half-applied')

  assert.equal(errorCode(doc, [{ type: 'comment.batch_update', commentIds: ids, status: 'done' }]), 'bad-value')
  assert.equal(errorCode(doc, [{ type: 'comment.batch_update', commentIds: 'c-1', status: 'open' }]), 'bad-request')
  assert.equal(errorCode(doc, [{ type: 'comment.batch_update', commentIds: [42], status: 'open' }]), 'bad-id')

  // An empty batch is a valid no-op.
  const empty = applyOps(doc, [{ type: 'comment.batch_update', commentIds: [], status: 'open' }])
  assert.deepEqual(empty.errors, [])
})

/* --------------------------------------------------------------------------------------------
 * v2 — normalizeDoc / summarizeDoc for the new vocabulary
 * ------------------------------------------------------------------------------------------ */

test('normalizeDoc repairs hand-written line and group layers', () => {
  const raw = {
    schemaVersion: 1,
    name: 'Raw',
    version: 4,
    updatedAt: NOW,
    artboards: [
      {
        id: 'ab-raw',
        name: 'Raw board',
        width: 600,
        height: 400,
        layers: [
          {
            id: 'l-g',
            type: 'group',
            name: 'Hand written',
            x: 10,
            y: 20,
            width: 300,
            height: 200,
            fill: '#ffffff', // not a group prop: dropped
            radius: 8, // dropped
            layout: { direction: 'row' }, // dropped: groups are absolute
            clip: 'yes', // invalid: dropped
            locked: 'true', // invalid: dropped
            minWidth: 500,
            maxWidth: 100, // impossible pair: both dropped
            children: [
              {
                id: 'l-line',
                type: 'line',
                name: 'Divider',
                x: 0,
                y: 100,
                width: 200,
                height: 1,
                stroke: 'linear-gradient(0deg,#000,#fff)', // color-only prop: dropped
                strokeWidth: 1000, // clamped to 64
                orientation: 'sideways', // dropped, default horizontal kept
                dashed: 'nope', // dropped
                fill: '#000000', // dropped
                hugWidth: true,
                unknownProp: 1, // dropped
              },
              { id: 'l-line', type: 'line', name: 'Same id', width: 50, height: 1 },
            ],
          },
          // Nesting deeper than the cap is truncated.
          {
            id: 'l-d1',
            type: 'group',
            children: [
              { id: 'l-d2', type: 'group', children: [
                { id: 'l-d3', type: 'group', children: [
                  { id: 'l-d4', type: 'group', children: [
                    { id: 'l-d5', type: 'group', children: [
                      { id: 'l-d6', type: 'group', children: [] },
                    ] },
                  ] },
                ] },
              ] },
            ],
          },
        ],
      },
    ],
    comments: [
      { id: 'c-ok', layerId: 'l-line', text: 'still here' },
      { id: 'c-gone', layerId: 'l-missing', text: 'drop me' },
    ],
  }

  const doc = normalizeDoc(raw)
  const group = layerById(doc, 'l-g')
  assert.ok(group)
  assert.equal(group.type, 'group')
  assert.equal('fill' in group, false)
  assert.equal('radius' in group, false)
  assert.equal('layout' in group, false)
  assert.equal(group.clip, false, 'invalid clip falls back to the default')
  assert.equal('locked' in group, false)
  assert.equal('minWidth' in group, false)
  assert.equal('maxWidth' in group, false)
  assert.equal(group.children.length, 2)

  const line = group.children[0]
  assert.equal(line.type, 'line')
  assert.equal(line.stroke, '#94a3b8')
  assert.equal(line.strokeWidth, 64)
  assert.equal(line.orientation, 'horizontal')
  assert.equal(line.dashed, false)
  assert.equal('fill' in line, false)
  assert.equal(line.hugWidth, true)
  assert.equal('unknownProp' in line, false)
  assert.notEqual(group.children[1].id, 'l-line', 'colliding ids are regenerated')

  const ids = allLayerIds(doc)
  assert.equal(new Set(ids).size, ids.length)

  // Depth cap: at most five group levels survive.
  let depth = 0
  let cursor = layerById(doc, 'l-d1')
  while (cursor && Array.isArray(cursor.children) && cursor.children.length) {
    depth += 1
    cursor = cursor.children[0]
  }
  assert.equal(depth, 4, 'l-d6 is cut off at depth 5')

  assert.equal(doc.comments.length, 1)
  assert.equal(doc.comments[0].id, 'c-ok')

  // A hand-written group cannot exceed the 200-children cap, and comments on cut children are dropped.
  const overflow = {
    schemaVersion: 1,
    name: 'Overflow',
    version: 1,
    updatedAt: NOW,
    artboards: [
      {
        id: 'ab-overflow',
        name: 'Overflow',
        width: 800,
        height: 600,
        layers: [
          {
            id: 'l-big',
            type: 'group',
            name: 'Big',
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            children: Array.from({ length: 205 }, (unused, index) => ({
              id: `l-c${index}`,
              type: 'rect',
              x: index,
              y: index,
              width: 10,
              height: 10,
            })),
          },
        ],
      },
    ],
    comments: [
      { id: 'c-in', layerId: 'l-c199', text: 'kept' },
      { id: 'c-out', layerId: 'l-c204', text: 'cut' },
    ],
  }
  const repaired = normalizeDoc(overflow)
  assert.equal(repaired.artboards[0].layers[0].children.length, 200)
  assert.equal(repaired.comments.length, 1)
  assert.equal(repaired.comments[0].id, 'c-in')
})

test('summarizeDoc shows locked, hug, min/max, line and layout markers', () => {
  let doc = starter()
  doc = apply(doc, [
    {
      type: 'layer.update',
      layerId: 'l-cta',
      patch: { locked: true, hugWidth: true, minWidth: 120, maxWidth: 400 },
    },
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: {
        id: 'l-line',
        type: 'line',
        name: 'Divider',
        x: 96,
        y: 600,
        width: 400,
        height: 1,
        stroke: '#94a3b8',
        strokeWidth: 3,
        dashed: true,
        arrowEnd: true,
      },
    },
    {
      type: 'layer.add',
      artboardId: 'ab-landing',
      layer: {
        id: 'l-f',
        type: 'frame',
        name: 'Wrap row',
        x: 96,
        y: 700,
        width: 600,
        height: 120,
        layout: { direction: 'row', justify: 'space-between', alignContent: 'center', rowGap: 8, wrap: true },
      },
    },
    { type: 'layer.add', artboardId: 'ab-landing', layer: { id: 'l-g', type: 'group', name: 'Cluster' } },
  ])
  const summary = summarizeDoc(doc)
  assert.match(summary, /locked/)
  assert.match(summary, /hug=w/)
  assert.match(summary, /minW=120/)
  assert.match(summary, /maxW=400/)
  assert.match(summary, /l-line line "Divider"/)
  assert.match(summary, /sw=3/)
  assert.match(summary, /dashed/)
  assert.match(summary, /arrowEnd/)
  assert.match(summary, /ac=center/)
  assert.match(summary, /rgap=8/)
  assert.match(summary, /justify=space-between/)
  assert.match(summary, /l-g group "Cluster"/)
  assert.match(summary, /\(1 group\)/)
})

/* --------------------------------------------------------------------------------------------
 * v2 — fuzz: every op result stays a normalizable, lossless document
 * ------------------------------------------------------------------------------------------ */

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

test('fuzz: 200 random valid ops keep ids unique and the document normalizable', () => {
  const random = mulberry32(0xc0ffee)
  const between = (min, max) => min + Math.floor(random() * (max - min + 1))
  const pick = (list) => list[between(0, list.length - 1)]
  const TYPES = ['rect', 'ellipse', 'text', 'line', 'image', 'frame', 'group']

  let doc = starter()
  for (let step = 0; step < 200; step += 1) {
    const entries = layerIndex(doc)
    const containers = entries.filter(
      (entry) => Array.isArray(entry.layer.children) && entry.depth < 5 && entry.layer.children.length < 120,
    )
    const targets = [
      ...doc.artboards
        .filter((artboard) => artboard.layers.length < 240)
        .map((artboard) => ({ artboardId: artboard.id, depth: 0 })),
      ...containers.map((entry) => ({ parentId: entry.layer.id, depth: entry.depth })),
    ]
    const choice = random()
    let op
    if (choice < 0.42 && targets.length) {
      const target = pick(targets)
      const type = pick(TYPES)
      const layer = {
        type,
        name: `${type} ${step}`,
        x: between(0, 400),
        y: between(0, 400),
        width: between(20, 120),
        height: type === 'line' ? 1 : between(20, 120),
      }
      if (type === 'text') {
        layer.text = `text ${step}`
        layer.color = '#111827'
        layer.fontSize = between(12, 32)
      }
      if (type === 'line') {
        layer.stroke = '#111827'
        layer.orientation = pick(['horizontal', 'vertical', 'diagonal'])
      }
      if (type === 'ellipse') layer.fill = 'radial-gradient(circle,#fff,#e5e7eb)'
      if (type === 'frame') layer.layout = { direction: pick(['row', 'column']), gap: between(0, 24) }
      op = {
        type: 'layer.add',
        ...(target.parentId ? { parentId: target.parentId } : { artboardId: target.artboardId }),
        layer,
      }
    } else if (choice < 0.62 && entries.length) {
      const entry = pick(entries)
      op = {
        type: 'layer.update',
        layerId: entry.layer.id,
        patch: {
          name: `renamed ${step}`,
          x: between(0, 500),
          y: between(0, 500),
          width: between(10, 200),
          height: between(10, 200),
          opacity: between(20, 100) / 100,
          ...(random() < 0.4 ? { locked: random() < 0.5 } : {}),
          ...(random() < 0.4 ? { shadow: '0 2px 8px rgba(0,0,0,0.2)' } : {}),
        },
      }
    } else if (choice < 0.72 && entries.length) {
      const entry = pick(entries)
      op = {
        type: 'layer.reorder',
        layerId: entry.layer.id,
        index: between(0, entry.parent.length - 1),
      }
    } else if (choice < 0.83 && entries.length && targets.length) {
      const leaves = entries.filter((entry) => !Array.isArray(entry.layer.children))
      const moveTargets = targets.filter((target) => target.depth < 5)
      if (!leaves.length || !moveTargets.length) continue
      const entry = pick(leaves)
      const target = pick(moveTargets)
      op = {
        type: 'layer.move_to',
        layerId: entry.layer.id,
        ...(target.parentId ? { parentId: target.parentId } : { artboardId: target.artboardId }),
      }
    } else if (choice < 0.92) {
      // Group two leaf siblings that are not children of an auto-layout frame.
      const groupable = entries.filter(
        (entry) =>
          !Array.isArray(entry.layer.children) &&
          entry.depth <= 4 &&
          entry.parent.length >= 2 &&
          !(entry.parentLayer && entry.parentLayer.layout),
      )
      const first = groupable.length ? pick(groupable) : null
      const second = first
        ? groupable.filter((entry) => entry.parent === first.parent && entry.layer.id !== first.layer.id)
        : []
      if (!first || !second.length) continue
      op = { type: 'layer.group', layerIds: [first.layer.id, pick(second).layer.id] }
    } else if (choice < 0.96) {
      const groups = entries.filter((entry) => entry.layer.type === 'group' && entry.parent.length < 120)
      if (!groups.length) continue
      op = { type: 'layer.ungroup', layerId: pick(groups).layer.id }
    } else if (entries.length) {
      const entry = pick(entries.filter((candidate) => candidate.parent.length < 150))
      if (!entry) continue
      op = { type: 'layer.duplicate', layerId: entry.layer.id }
    } else {
      continue
    }

    const result = applyOps(doc, [op])
    assert.deepEqual(result.errors, [], `step ${step}: ${JSON.stringify(op)} -> ${JSON.stringify(result.errors)}`)
    assert.equal(result.applied.length, 1)
    doc = result.doc
  }

  assert.ok(doc.artboards[0].layers.length > 5, 'the fuzz loop actually added layers')
  assert.ok(layerIndex(doc).some((entry) => Array.isArray(entry.layer.children)), 'the fuzz loop created containers')

  const ids = allLayerIds(doc)
  assert.equal(new Set(ids).size, ids.length, 'ids stay globally unique')

  assert.deepEqual(normalizeDoc(doc), doc, 'normalizeDoc must be a no-op on a model-built document')
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc, 'the document must be lossless JSON')
  assert.deepEqual(losslessProblems(doc), [])
  assert.match(summarizeDoc(doc), /^".*" - 1 artboard/)
})
