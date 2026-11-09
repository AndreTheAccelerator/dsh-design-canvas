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
  const problems = []
  const visit = (value, at) => {
    if (value === undefined) problems.push(`${at} undefined`)
    else if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) problems.push(`${at} non-finite`)
    } else if (typeof value !== 'object') problems.push(`${at} ${typeof value}`)
    else if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${at}[${index}]`))
    else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        problems.push(`${at} non-plain object`)
      }
      for (const key of Object.keys(value)) visit(value[key], `${at}.${key}`)
    }
  }
  visit(doc, '$')
  visit(summarizeDoc(doc), '$.summary')
  visit(applyOps(doc, [{ type: 'layer.update', layerId: 'l-title', patch: { x: 3 } }]), '$.result')
  assert.deepEqual(problems, [])
})
