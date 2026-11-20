/**
 * Browser-half tests that need no DOM: load the generated bundle in Node and exercise the pure
 * helpers it exposes through `plugin.__test()` (see src/client/80-boot.js).
 *
 * Why this exists: the browser half is ONE concatenated module scope, so a duplicated
 * declaration or a load-time reference to a later `const` breaks the whole plugin while
 * `node --check` stays green. Loading the bundle is the cheap end-to-end guard; the helper
 * assertions are contract-level (shapes the canvas and the agent-facing model agree on).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClientBundle } from './helpers/client-bundle.mjs'

const loaded = await loadClientBundle()
const plugin = loaded.plugin
const t = typeof plugin.__test === 'function' ? plugin.__test() : null

test('bundle loads and exposes the plugin contract', () => {
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject), 'inject must be a list of client services')
  assert.deepEqual(loaded.required, ['react'])
  assert.ok(
    loaded.beacons.some((src) => src.includes('m=factory')),
    'factory beacon fired',
  )
})

test('the internal test surface is complete', () => {
  assert.ok(t && typeof t === 'object', 'plugin.__test() is missing')
  for (const name of [
    'findLayerById',
    'docPatchLayer',
    'computeLayout',
    'computeFrameChildBoxes',
    'buildComputedTree',
    'buildCommentMessage',
    'createLayer',
    'defaultGeometryFor',
    'EXTENSIONS',
  ]) {
    assert.ok(t[name], `test surface is missing ${name}`)
  }
})

test('createLayer produces a valid layer for every documented type', () => {
  const artboard = { id: 'ab-1', width: 800, height: 600 }
  for (const type of ['rect', 'ellipse', 'text', 'image', 'frame', 'line', 'group']) {
    const layer = t.createLayer(type, artboard)
    assert.equal(layer.type, type, `${type}: wrong type`)
    assert.match(String(layer.id), /^l-/, `${type}: id must be l- prefixed`)
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.equal(typeof layer[key], 'number', `${type}: ${key} must be a number`)
      assert.ok(Number.isFinite(layer[key]), `${type}: ${key} must be finite`)
    }
    assert.ok(layer.width >= 1 && layer.height >= 1, `${type}: size must be >= 1`)
    if (type === 'frame' || type === 'group') {
      assert.ok(Array.isArray(layer.children), `${type}: containers need children`)
    }
  }
})

test('docPatchLayer is immutable and applies the patch by id', () => {
  const doc = {
    schemaVersion: 1,
    name: 'T',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'A',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        background: '#fff',
        layers: [
          { id: 'l-1', type: 'rect', name: 'R', x: 10, y: 10, width: 100, height: 50, fill: '#111' },
          {
            id: 'l-f',
            type: 'frame',
            name: 'F',
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            layout: null,
            children: [{ id: 'l-c', type: 'rect', name: 'C', x: 1, y: 2, width: 10, height: 10 }],
          },
        ],
      },
    ],
    comments: [],
  }

  const next = t.docPatchLayer(doc, 'l-c', { x: 42, name: 'Patched' })
  assert.notEqual(next, doc, 'patch must not mutate the input document')
  const found = t.findLayerById(next, 'l-c')
  assert.ok(found, 'patched layer must still resolve')
  assert.equal(found.layer.x, 42)
  assert.equal(found.layer.name, 'Patched')
  assert.equal(t.findLayerById(doc, 'l-c').layer.x, 1, 'the original document is untouched')
})

test('auto layout places children in a row with gap and padding', () => {
  const layout = {
    direction: 'row',
    gap: 10,
    padding: { top: 5, right: 5, bottom: 5, left: 20 },
    align: 'start',
    justify: 'start',
    wrap: false,
  }
  const children = [
    { id: 'l-a', type: 'rect', width: 100, height: 50 },
    { id: 'l-b', type: 'rect', width: 100, height: 50 },
  ]
  const boxes = t.computeFrameChildBoxes(layout, 400, 200, children)
  assert.ok(boxes, 'a row layout must produce boxes')

  const byId = new Map()
  if (typeof boxes.forEach === 'function') {
    boxes.forEach((box, key) => byId.set(key && key.id ? key.id : String(key), box))
  }
  const first = byId.get('l-a')
  const second = byId.get('l-b')
  assert.ok(first && second, 'both children get a box')
  assert.equal(first.x, 20, 'first child starts at the left padding')
  assert.equal(second.x, 20 + 100 + 10, 'second child follows the first plus the gap')
  assert.equal(first.y, 5, 'children start at the top padding for align=start')
})

test('computed tree exposes world rects for hit testing', () => {
  const doc = {
    schemaVersion: 1,
    name: 'T',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'A',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        background: '#fff',
        layers: [
          { id: 'l-1', type: 'rect', name: 'R', x: 10, y: 20, width: 100, height: 50 },
        ],
      },
    ],
    comments: [],
  }
  const tree = t.buildComputedTree(doc)
  const node = tree.byId.get('l-1')
  assert.ok(node, 'layer resolves in the computed tree')
  assert.equal(node.worldRect.x, 10)
  assert.equal(node.worldRect.y, 20)
  assert.equal(node.worldRect.width, 100)
})

test('the comment chat message opens with the revision-request marker', () => {
  const details = {
    boardPath: 'design-board.json',
    version: 7,
    artboard: { id: 'ab-1', name: 'Home', width: 1440, height: 900 },
    layer: { id: 'l-1', type: 'text', name: 'Title', x: 10, y: 20, width: 300, height: 40 },
    comment: { id: 'c-1', text: 'Make it bigger' },
    comments: [{ id: 'c-1', text: 'Make it bigger' }],
  }
  const message = t.buildCommentMessage(details, t.stringsFor('en'))
  assert.equal(typeof message, 'string')
  assert.ok(
    message.startsWith('Design canvas revision request'),
    'the system prompt matches on this opening line',
  )
  assert.ok(message.includes('design-board.json'), 'the board path is included')
  assert.ok(message.includes('Make it bigger'), 'the comment text is included')
})

test('extension registries accept entries and reject malformed ones', () => {
  const { EXTENSIONS, registerToolbar, registerAppPanel, registerInspectorSection } = t
  assert.ok(EXTENSIONS && Array.isArray(EXTENSIONS.toolbar), 'toolbar registry exists')
  const before = EXTENSIONS.toolbar.length
  const disposerless = { id: 'test-toolbar', render() {} }
  registerToolbar(disposerless)
  assert.equal(EXTENSIONS.toolbar.length, before + 1)
  registerToolbar({ id: 'broken' })
  assert.equal(EXTENSIONS.toolbar.length, before + 1, 'entries without render are ignored')
  EXTENSIONS.toolbar.pop()

  const panels = EXTENSIONS.appPanels.length
  registerAppPanel({ id: 'p', render() {} })
  assert.equal(EXTENSIONS.appPanels.length, panels + 1)
  EXTENSIONS.appPanels.pop()

  const sections = EXTENSIONS.inspector.length
  registerInspectorSection({ id: 's', render() {} })
  assert.equal(EXTENSIONS.inspector.length, sections + 1)
  EXTENSIONS.inspector.pop()
})

test('export generators are registered and produce non-empty output', () => {
  const doc = {
    schemaVersion: 1,
    name: 'Tiny',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'Board',
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        background: '#ffffff',
        layers: [
          { id: 'l-1', type: 'rect', name: 'Box', x: 16, y: 16, width: 120, height: 60, fill: '#2563eb', radius: 8 },
          { id: 'l-2', type: 'text', name: 'Label', x: 16, y: 100, width: 200, height: 28, text: 'Hello', fontSize: 20, color: '#111827' },
        ],
      },
    ],
    comments: [],
  }

  if (typeof t.renderHtml === 'function') {
    const html = t.renderHtml(doc, {})
    assert.ok(html.length > 100, 'html export is non-empty')
    assert.match(html, /<(!doctype|html)/i)
    assert.ok(html.includes('Hello'), 'text content survives the export')
  }
  if (typeof t.renderSvg === 'function') {
    const svg = t.renderSvg(doc, {})
    assert.match(svg, /<svg/i)
    assert.ok(svg.includes('320'), 'svg carries the artboard size')
  }
  if (typeof t.renderJson === 'function') {
    const json = t.renderJson(doc, {})
    assert.doesNotThrow(() => JSON.parse(json))
  }
})

test('export can target a selection (objects, not only artboards)', () => {
  const doc = {
    schemaVersion: 1,
    name: 'Tiny',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'Board',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        background: '#ffffff',
        layers: [
          { id: 'l-a', type: 'rect', name: 'A', x: 10, y: 20, width: 100, height: 40, fill: '#111827' },
          { id: 'l-b', type: 'rect', name: 'B', x: 210, y: 20, width: 100, height: 40, fill: '#2563eb' },
          { id: 'l-c', type: 'text', name: 'C', x: 10, y: 300, width: 300, height: 40, text: 'Outside', fontSize: 16 },
        ],
      },
    ],
    comments: [],
  }

  if (typeof t.renderExport !== 'function') return

  // Two layers 300 px apart, 100 px wide: the export is exactly their union box.
  const options = { scope: 'selection', layerIds: ['l-a', 'l-b'] }
  const json = JSON.parse(t.renderExport(doc, 'json', options))
  assert.equal(json.artboards.length, 1, 'the selection becomes its own document')
  assert.equal(json.artboards[0].width, 300, 'width is the union bounding box')
  assert.equal(json.artboards[0].height, 40)
  assert.deepEqual(
    json.artboards[0].layers.map((layer) => layer.name),
    ['A', 'B'],
    'only the selected layers are exported',
  )
  assert.equal(json.artboards[0].layers[0].x, 0, 'the first layer is re-based to the box origin')
  assert.equal(json.artboards[0].layers[1].x, 200, 'sibling offsets are preserved')

  const svg = t.renderExport(doc, 'svg', options)
  assert.match(svg, /<svg[^>]+width="300"/, 'svg carries the selection box width')
  assert.ok(svg.includes('viewBox="0 0 300 40"'), 'svg view box is the selection box')

  // A single layer exports its own box, and an empty selection falls back to the artboard.
  const one = JSON.parse(t.renderExport(doc, 'json', { scope: 'selection', layerIds: ['l-c'] }))
  assert.equal(one.artboards[0].width, 300)
  assert.equal(one.artboards[0].layers.length, 1)
  const fallback = JSON.parse(t.renderExport(doc, 'json', { scope: 'selection', layerIds: [] }))
  assert.equal(fallback.artboards[0].layers.length, 3, 'no selection falls back to the whole board')
})
