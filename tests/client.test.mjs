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

// A pill button: CSS renders border-radius:999px as a stadium because it scales all radii down
// together; SVG clamps rx/ry independently, which used to turn these into ellipses ("buttons
// turn into ovals in the PNG", since the PNG is rasterised from this SVG).
test('svg export clamps a pill radius instead of emitting an ellipse', () => {
  const doc = {
    schemaVersion: 1,
    name: 'Pills',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [{
      id: 'ab-1', name: 'Board', x: 0, y: 0, width: 400, height: 200, background: '#ffffff',
      layers: [
        { id: 'l-btn', type: 'frame', name: 'Button', x: 10, y: 10, width: 116, height: 38, fill: '#0b1220', radius: 999 },
        { id: 'l-round', type: 'rect', name: 'Dot', x: 200, y: 10, width: 40, height: 40, fill: '#2563eb', radius: 999 },
      ],
    }],
    comments: [],
  }
  const svg = t.renderSvg(doc, {})
  assert.ok(!svg.includes('rx="999"'), 'no unclamped radius reaches the SVG')
  assert.ok(svg.includes('rx="19"') && svg.includes('ry="19"'), '116x38 pill uses half the short side (19)')
  assert.ok(svg.includes('rx="20"') && svg.includes('ry="20"'), '40x40 box is a circle (20)')
})

// A layout-less frame describes how its OWN children are placed. As a flex child it must stay in
// flow (and become the containing block for its absolute children), otherwise it is drawn at 0,0
// on top of its siblings -- which is how the exported HTML lost the hero copy.
test('html export keeps a layout-less flex child in flow', () => {
  const doc = {
    schemaVersion: 1,
    name: 'Flex',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [{
      id: 'ab-1', name: 'Board', x: 0, y: 0, width: 800, height: 400, background: '#ffffff',
      layers: [
        {
          id: 'l-row', type: 'frame', name: 'Row', x: 0, y: 0, width: 800, height: 400,
          layout: { direction: 'row', gap: 40, align: 'center', justify: 'space-between' },
          children: [
            { id: 'l-copy', type: 'text', name: 'Copy', x: 0, y: 0, width: 300, height: 60, text: 'Hello', fontSize: 40 },
            {
              id: 'l-art', type: 'frame', name: 'Art', x: 0, y: 0, width: 300, height: 300, fill: '#eef2ff',
              layout: null,
              children: [
                { id: 'l-card', type: 'rect', name: 'Card', x: 20, y: 30, width: 100, height: 50, fill: '#ffffff' },
              ],
            },
          ],
        },
      ],
    }],
    comments: [],
  }
  const html = t.renderHtml(doc, {})
  // the layout-less frame is a flex item: relative (containing block), never absolute at 0,0
  const artStyle = /<div style="([^"]*)"[^>]*>\s*<div style="[^"]*100px;height:50px/.exec(html)
  assert.ok(artStyle, 'the art frame is rendered')
  const style = artStyle[1]
  assert.ok(!style.includes('position:absolute'), 'a flex child is not absolutely positioned: ' + style)
  assert.ok(style.includes('position:relative'), 'a flex child with absolute children is a containing block: ' + style)
  // its absolute child keeps a parent-relative offset, not an artboard-scale one
  assert.match(html, /left:20px;top:30px/, 'the child keeps its authored offset inside the frame')
})

// The SVG text wrapper must use real glyph measurement when the platform can provide it, so a
// label is not split just because a crude character estimate says it does not fit.
test('svg text wraps with measured advances when a measurer is available', () => {
  if (typeof t.setExportTextMeasurer !== 'function' || typeof t.resetExportTextMetrics !== 'function') {
    return
  }
  const doc = {
    schemaVersion: 1,
    name: 'Text',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'Board',
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        background: '#ffffff',
        layers: [
          // 52 px wide: the real advance of "Sign in" at 15 px is ~48 px, so it fits on one line.
          { id: 'l-signin', type: 'text', name: 'Sign in', x: 0, y: 0, width: 52, height: 22, text: 'Sign in', fontSize: 15 },
          // far too narrow for its words: measured wrapping must still break it
          { id: 'l-long', type: 'text', name: 'Long', x: 0, y: 40, width: 40, height: 60, text: 'alpha beta', fontSize: 15 },
        ],
      },
    ],
    comments: [],
  }

  // A measurer that reports 0.46em per glyph — close to a real UI sans at 15 px.
  t.setExportTextMeasurer(function (value, font) {
    const size = font && Number.isFinite(font.size) ? font.size : 16
    return String(value).length * size * 0.46
  })
  let svg
  try {
    svg = t.renderSvg(doc, {})
  } finally {
    t.resetExportTextMetrics()
  }

  assert.ok(!svg.includes('>Sign</tspan>'), 'a label that fits is not split in two')
  assert.ok(svg.includes('>Sign in</tspan>'), 'the label stays on one line')
  assert.ok(svg.includes('>alpha</tspan>'), 'a genuinely too-wide label still wraps')

  // Without a measurer the renderer must not throw (pure Node / SSR path).
  assert.doesNotThrow(() => t.renderSvg(doc, {}))
})

// Font stacks contain quotes, and a raw quote inside style="..." ends the attribute early: the
// browser then silently drops every declaration after it (text-align, line-height, white-space).
// That is why exported buttons had their labels pushed to the left.
test('html export escapes quotes so declarations after the font stack survive', () => {
  const doc = {
    schemaVersion: 1,
    name: 'Quotes',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    artboards: [
      {
        id: 'ab-1',
        name: 'Board',
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        background: '#ffffff',
        layers: [
          {
            id: 'l-btn',
            type: 'frame',
            name: 'Button',
            x: 0,
            y: 0,
            width: 120,
            height: 40,
            fill: '#2563eb',
            radius: 20,
            layout: { direction: 'row', gap: 0, padding: { top: 10, right: 20, bottom: 10, left: 20 }, align: 'center', justify: 'center' },
            children: [
              { id: 'l-label', type: 'text', name: 'Label', x: 0, y: 0, width: 80, height: 20, text: 'Go now', fontSize: 14, align: 'center', lineHeight: 20 },
            ],
          },
        ],
      },
    ],
    comments: [],
  }

  const html = t.renderHtml(doc, {})
  // The label's style attribute must be parseable as a whole: no raw quote may appear inside it.
  const styleAttrs = [...html.matchAll(/style="([^"]*)"/g)].map((match) => match[1])
  assert.ok(styleAttrs.length > 0, 'the export emits style attributes')

  const labelStyle = styleAttrs.find((value) => value.includes('font-family'))
  assert.ok(labelStyle, 'a text layer emits a font-family')
  assert.ok(labelStyle.includes('&quot;'), 'quotes in the font stack are escaped: ' + labelStyle)
  assert.ok(!labelStyle.includes('"'), 'no raw quote ends the attribute early')
  assert.ok(labelStyle.includes('text-align:center'), 'alignment survives the escaped font stack')
  assert.ok(labelStyle.includes('white-space:pre-wrap'), 'white-space survives too')
  assert.ok(/line-height:\d/.test(labelStyle), 'line-height survives too')

  // And the page must not contain a truncated copy of that declaration list.
  assert.ok(!html.includes('font-family:system-ui, -apple-system, "Segoe UI"'), 'the raw stack is never emitted')
})
