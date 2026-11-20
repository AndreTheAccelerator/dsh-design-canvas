
    /* ------------------------------------------------------------------------------------------
     * Layout v2 vocabulary
     *
     * The Host validates the same lists (host/model.js) and stores a complete layout object, but
     * the renderer stays defensive: documents can be hand-edited or older than the client, so
     * every value is re-validated here. A v1 document (no alignContent / rowGap / columnGap)
     * keeps rendering exactly as it did before these fields existed.
     * ---------------------------------------------------------------------------------------- */

    const LAYOUT_JUSTIFY_VALUES = [
      'start',
      'center',
      'end',
      'space-between',
      'space-around',
      'space-evenly',
    ]
    const LAYOUT_ALIGN_CONTENT_VALUES = [
      'start',
      'center',
      'end',
      'stretch',
      'space-between',
      'space-around',
    ]
    const LINE_ORIENTATION_VALUES = ['horizontal', 'vertical', 'diagonal']
    const LINE_DEFAULT_STROKE = '#94a3b8'
    const LINE_DEFAULT_STROKE_WIDTH = 2
    const LINE_MIN_STROKE_WIDTH = 0.5
    const LINE_MAX_STROKE_WIDTH = 64
    // Arrow heads are proportional to `strokeWidth`; the exporter (43-export-code.js) uses the
    // same ratios so "exported SVG == canvas" holds.
    const LINE_ARROW_LENGTH_RATIO = 4.5
    const LINE_ARROW_HALF_WIDTH_RATIO = 2.25
    const LINE_DASH_ON_RATIO = 4
    const LINE_DASH_OFF_RATIO = 3
    const TEXT_WIDTH_CACHE_LIMIT = 800
    const TEXT_HEIGHT_CACHE_LIMIT = 400

    function defaultLayoutObject() {
      return {
        direction: 'row',
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        align: 'stretch',
        justify: 'start',
        wrap: false,
        alignContent: 'stretch',
      }
    }

    /**
     * Normalize a stored layout into a complete object (Host fills defaults; be defensive).
     * `rowGap`/`columnGap` are only present when authored, so a normalized object can be sent
     * straight back to the Host as a `layout` patch without inventing new properties.
     */
    function normalizeLayoutObject(layout) {
      if (!isObject(layout)) return null
      const base = defaultLayoutObject()
      const rawPadding = isObject(layout.padding) ? layout.padding : {}
      const padding = {}
      for (let index = 0; index < PADDING_SIDES.length; index += 1) {
        const side = PADDING_SIDES[index]
        padding[side] = Math.max(0, finiteNumber(rawPadding[side], 0))
      }
      const normalized = {
        direction: LAYOUT_DIRECTIONS.indexOf(layout.direction) >= 0 ? layout.direction : base.direction,
        gap: Math.max(0, finiteNumber(layout.gap, base.gap)),
        padding: padding,
        align: LAYOUT_ALIGNS.indexOf(layout.align) >= 0 ? layout.align : base.align,
        justify: LAYOUT_JUSTIFY_VALUES.indexOf(layout.justify) >= 0 ? layout.justify : base.justify,
        wrap: layout.wrap === true,
        alignContent:
          LAYOUT_ALIGN_CONTENT_VALUES.indexOf(layout.alignContent) >= 0
            ? layout.alignContent
            : base.alignContent,
      }
      if (typeof layout.rowGap === 'number' && Number.isFinite(layout.rowGap) && layout.rowGap >= 0) {
        normalized.rowGap = layout.rowGap
      }
      if (
        typeof layout.columnGap === 'number' &&
        Number.isFinite(layout.columnGap) &&
        layout.columnGap >= 0
      ) {
        normalized.columnGap = layout.columnGap
      }
      return normalized
    }

    /**
     * Resolved gap between two wrapped/adjacent items on an axis. `rowGap` overrides the
     * vertical gap and `columnGap` the horizontal one, each falling back to `gap`.
     */
    function resolveLayoutGap(layout, axis) {
      if (!isObject(layout)) return 0
      const explicit =
        axis === 'row'
          ? typeof layout.rowGap === 'number'
            ? layout.rowGap
            : null
          : typeof layout.columnGap === 'number'
            ? layout.columnGap
            : null
      if (explicit !== null && Number.isFinite(explicit) && explicit >= 0) return explicit
      return Math.max(0, finiteNumber(layout.gap, 0))
    }

    /** Main/cross gaps for a direction: rows accumulate horizontally, columns vertically. */
    function layoutAxisGaps(layout) {
      const isRow = layout.direction !== 'column'
      return {
        main: isRow ? resolveLayoutGap(layout, 'column') : resolveLayoutGap(layout, 'row'),
        cross: isRow ? resolveLayoutGap(layout, 'row') : resolveLayoutGap(layout, 'column'),
      }
    }

    function paddingSummary(padding) {
      const pad = isObject(padding) ? padding : {}
      const values = [
        roundTo(finiteNumber(pad.top, 0), 2),
        roundTo(finiteNumber(pad.right, 0), 2),
        roundTo(finiteNumber(pad.bottom, 0), 2),
        roundTo(finiteNumber(pad.left, 0), 2),
      ]
      const same =
        values[0] === values[1] && values[1] === values[2] && values[2] === values[3]
      return same ? String(values[0]) : values.join('/')
    }

    function layoutSummaryText(layout) {
      const normalized = normalizeLayoutObject(layout)
      if (!normalized) return 'absolute'
      const gaps = layoutAxisGaps(normalized)
      const gapText =
        normalized.rowGap === undefined && normalized.columnGap === undefined
          ? ' gap=' + roundTo(normalized.gap, 2)
          : ' gap=' + roundTo(gaps.main, 2) + '/' + roundTo(gaps.cross, 2)
      return (
        'layout=' +
        normalized.direction +
        gapText +
        ' pad=' +
        paddingSummary(normalized.padding) +
        ' align=' +
        normalized.align +
        ' justify=' +
        normalized.justify +
        (normalized.wrap ? ' wrap' : '') +
        (normalized.wrap && normalized.alignContent !== 'stretch'
          ? ' alignContent=' + normalized.alignContent
          : '')
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Box sizing v2: hug + min/max clamping + text measurement
     *
     * Every layer's rendered box goes through `layerEffectiveSize`, so hugging and clamping apply
     * uniformly to top-level layers, auto-layout children (the flex engine calls it for its base
     * sizes), text, images, frames and groups. The result is memoized per layer object: the doc
     * is replaced wholesale on every version bump, so a new object identity is a new measurement.
     * ---------------------------------------------------------------------------------------- */

    const LAYER_SIZE_CACHE = new WeakMap()
    const TEXT_MEASURE = {
      context: null,
      node: null,
      widthCache: new Map(),
      heightCache: new Map(),
    }

    /** Unset min/max are `0` (no constraint); the caller clamps a rendered box to `>= 1`. */
    function layerBoxBounds(layer) {
      return {
        minWidth: Math.max(0, finiteNumber(layer.minWidth, 0)),
        minHeight: Math.max(0, finiteNumber(layer.minHeight, 0)),
        maxWidth: Math.max(0, finiteNumber(layer.maxWidth, 0)),
        maxHeight: Math.max(0, finiteNumber(layer.maxHeight, 0)),
      }
    }

    /** Clamp a rendered box dimension: at least 1px, then min/max when authored. */
    function clampBoxValue(value, minimum, maximum) {
      let out = Math.max(1, finiteNumber(value, 1))
      const min = finiteNumber(minimum, 0)
      if (min > 0) out = Math.max(out, min)
      const max = finiteNumber(maximum, 0)
      if (max > 0) out = Math.min(out, max)
      return Math.max(1, out)
    }

    function resolvedTextLineHeight(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      // A value <= 4 is a CSS-like multiplier (1.4), above that it is an absolute px height.
      if (lineHeight > 4) return lineHeight
      return Math.max(1, lineHeight * fontSize)
    }

    function textDisplayValue(layer) {
      const raw = typeof layer.text === 'string' ? layer.text : ''
      if (layer.textTransform === 'uppercase') return raw.toUpperCase()
      if (layer.textTransform === 'lowercase') return raw.toLowerCase()
      return raw
    }

    function textFontString(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const weight = Math.round(finiteNumber(layer.fontWeight, 400))
      return String(weight) + ' ' + fontSize + 'px ' + (layer.fontFamily || DEFAULT_FONT)
    }

    function textMetricsContext() {
      if (TEXT_MEASURE.context) return TEXT_MEASURE.context
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const context = canvas.getContext('2d')
        if (!context) return null
        TEXT_MEASURE.context = context
        return context
      } catch (error) {
        return null
      }
    }

    function cachePut(cache, key, value, limit) {
      cache.set(key, value)
      if (cache.size > limit) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return value
    }

    /**
     * Single-line width of a text layer in authored px, with letter spacing applied the way CSS
     * does it (after every glyph, including the last one). Memoized per (text, font, spacing).
     */
    function measuredTextWidth(text, layer) {
      const value = String(text || '')
      if (!value) return 0
      const font = textFontString(layer)
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      const key = font + '|' + letterSpacing + '|' + value
      const cached = TEXT_MEASURE.widthCache.get(key)
      if (cached !== undefined) return cached
      const context = textMetricsContext()
      let width = 0
      if (context) {
        try {
          context.font = font
          width = context.measureText(value).width
        } catch (error) {
          width = 0
        }
      }
      if (!(width > 0)) {
        // No canvas (or an unparseable font): a conservative average advance keeps hug sizing
        // sane instead of collapsing to zero.
        width = value.length * Math.max(1, finiteNumber(layer.fontSize, 16)) * 0.55
      }
      width += letterSpacing * value.length
      return cachePut(TEXT_MEASURE.widthCache, key, width, TEXT_WIDTH_CACHE_LIMIT)
    }

    function textMeasureNode() {
      if (TEXT_MEASURE.node) return TEXT_MEASURE.node
      if (typeof document === 'undefined' || !document.body) return null
      try {
        const node = document.createElement('div')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('data-dc-measure', '1')
        node.style.position = 'fixed'
        node.style.left = '-10000px'
        node.style.top = '0'
        node.style.visibility = 'hidden'
        node.style.pointerEvents = 'none'
        node.style.boxSizing = 'border-box'
        node.style.margin = '0'
        node.style.padding = '0'
        node.style.overflow = 'hidden'
        // Mirror `.dc-layer-text` exactly so wrapping matches the real layer.
        node.style.whiteSpace = 'pre-wrap'
        node.style.wordBreak = 'break-word'
        document.body.appendChild(node)
        TEXT_MEASURE.node = node
        return node
      } catch (error) {
        return null
      }
    }

    /**
     * Rendered height of a text layer wrapped at `width`, measured in an off-screen DOM node so
     * it matches the browser's real line breaking (canvas `measureText` cannot wrap). Falls back
     * to an estimate when no document is available. Memoized per (text, font, width).
     */
    function measuredTextHeight(layer, width) {
      const value = textDisplayValue(layer)
      const boxWidth = Math.max(1, finiteNumber(width, 1))
      const font = textFontString(layer)
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      const lineHeight = resolvedTextLineHeight(layer)
      const key = font + '|' + letterSpacing + '|' + boxWidth + '|' + lineHeight + '|' + value
      const cached = TEXT_MEASURE.heightCache.get(key)
      if (cached !== undefined) return cached
      let height = 0
      const node = textMeasureNode()
      if (!value) {
        height = lineHeight
      } else if (node) {
        try {
          node.style.width = boxWidth + 'px'
          node.style.font = font
          node.style.letterSpacing = letterSpacing + 'px'
          node.style.lineHeight = lineHeight + 'px'
          node.textContent = value
          height = node.offsetHeight
        } catch (error) {
          height = 0
        }
      }
      if (!(height > 0)) {
        // Estimate: greedy word wrap using the measured single-line width.
        const single = measuredTextWidth(value, layer)
        const lines = Math.max(1, Math.ceil(single / Math.max(1, boxWidth)))
        height = lines * lineHeight
      }
      return cachePut(TEXT_MEASURE.heightCache, key, height, TEXT_HEIGHT_CACHE_LIMIT)
    }

    /**
     * Intrinsic content size of a layer, used by `hugWidth`/`hugHeight`:
     *   text            -> measured glyph box (one line for width, wrapped height for height)
     *   frame + layout  -> children sum on the main axis, tallest child on the cross axis + padding
     *   frame / group   -> union box of the children (absolute positioning) + padding
     * Anything else has no content and returns null (hug keeps the authored size).
     */
    function layerContentSize(layer, depth) {
      if (!isObject(layer)) return null
      const level = finiteNumber(depth, 0)
      if (level > FRAME_MAX_DEPTH + 1) return null
      if (layer.type === 'text') {
        const text = textDisplayValue(layer)
        const lineHeight = resolvedTextLineHeight(layer)
        const width = Math.ceil(measuredTextWidth(text, layer))
        const wrapWidth = layer.hugWidth === true ? Math.max(1, width) : Math.max(1, finiteNumber(layer.width, width))
        return {
          width: Math.max(1, width),
          height: Math.max(lineHeight, measuredTextHeight(layer, wrapWidth) || lineHeight),
        }
      }
      if (!isContainerLayer(layer)) return null
      const children = childrenOf(layer)
      const layout = layer.type === 'frame' ? normalizeLayoutObject(layer.layout) : null
      if (layout) {
        const padX = layout.padding.left + layout.padding.right
        const padY = layout.padding.top + layout.padding.bottom
        const gaps = layoutAxisGaps(layout)
        const isRow = layout.direction === 'row'
        let main = 0
        let cross = 0
        let count = 0
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index]
          if (!isObject(child) || child.visible === false) continue
          const size = layerEffectiveSize(child, level + 1)
          const childMain = isRow ? size.width : size.height
          const childCross = isRow ? size.height : size.width
          main += (count > 0 ? gaps.main : 0) + childMain
          if (childCross > cross) cross = childCross
          count += 1
        }
        return { width: main + padX, height: cross + padY }
      }
      // Absolute container (frame without layout, or a group): the union box of the children
      // (which `layer.group` guarantees starts at the origin).
      const padding = isObject(layer.padding) ? layer.padding : null
      const padX = padding
        ? Math.max(0, finiteNumber(padding.left, 0)) + Math.max(0, finiteNumber(padding.right, 0))
        : 0
      const padY = padding
        ? Math.max(0, finiteNumber(padding.top, 0)) + Math.max(0, finiteNumber(padding.bottom, 0))
        : 0
      let maxX = 0
      let maxY = 0
      let minX = 0
      let minY = 0
      let any = false
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (!isObject(child) || child.visible === false) continue
        const size = layerEffectiveSize(child, level + 1)
        const x = finiteNumber(child.x, 0)
        const y = finiteNumber(child.y, 0)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x + size.width > maxX) maxX = x + size.width
        if (y + size.height > maxY) maxY = y + size.height
        any = true
      }
      if (!any) return null
      return {
        width: Math.max(1, maxX - minX + padX),
        height: Math.max(1, maxY - minY + padY),
      }
    }

    /**
     * Final rendered box of a layer before its parent places it: hug sizing first, then the
     * min/max clamp (spec: "the clamp applies after hug sizing").
     */
    function layerEffectiveSize(layer, depth) {
      if (!isObject(layer)) return { width: 1, height: 1 }
      const cached = LAYER_SIZE_CACHE.get(layer)
      if (cached) return cached
      const bounds = layerBoxBounds(layer)
      let width = Math.max(1, finiteNumber(layer.width, 1))
      let height = Math.max(1, finiteNumber(layer.height, 1))
      if (layer.hugWidth === true || layer.hugHeight === true) {
        const content = layerContentSize(layer, depth)
        if (content) {
          if (layer.hugWidth === true) width = content.width
          if (layer.hugHeight === true) height = content.height
        }
      }
      const size = {
        width: clampBoxValue(width, bounds.minWidth, bounds.maxWidth),
        height: clampBoxValue(height, bounds.minHeight, bounds.maxHeight),
      }
      LAYER_SIZE_CACHE.set(layer, size)
      return size
    }

    /**
     * Pure CSS-like flex engine. Returns a Map from the authored child layer object to
     * `{ x, y, width, height }` relative to the frame's top-left (padding included), or null
     * when the frame is in absolute mode.
     */
    function computeFrameChildBoxes(layoutValue, frameWidthValue, frameHeightValue, children) {
      const layout = normalizeLayoutObject(layoutValue)
      if (!layout) return null
      const frameWidth = Math.max(1, finiteNumber(frameWidthValue, 1))
      const frameHeight = Math.max(1, finiteNumber(frameHeightValue, 1))
      const pad = layout.padding
      const contentWidth = Math.max(1, frameWidth - pad.left - pad.right)
      const contentHeight = Math.max(1, frameHeight - pad.top - pad.bottom)
      const isRow = layout.direction === 'row'
      const contentMain = isRow ? contentWidth : contentHeight
      const contentCross = isRow ? contentHeight : contentWidth
      const gaps = layoutAxisGaps(layout)
      const mainGap = gaps.main
      const crossGap = gaps.cross

      const items = []
      const list = Array.isArray(children) ? children : []
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        // Hidden layers behave like display:none: they neither render nor take layout space.
        if (!isObject(layer) || layer.visible === false) continue
        // Hug sizing and min/max clamping apply to auto-layout children too.
        const size = layerEffectiveSize(layer, 1)
        const baseWidth = size.width
        const baseHeight = size.height
        const bounds = layerBoxBounds(layer)
        items.push({
          layer: layer,
          bounds: bounds,
          baseMain: isRow ? baseWidth : baseHeight,
          baseCross: isRow ? baseHeight : baseWidth,
          main: isRow ? baseWidth : baseHeight,
          grow: layer.grow === true,
        })
      }

      // Split the children into flex lines (runs) when wrapping is enabled.
      const runs = []
      let run = null
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (layout.wrap && run && run.items.length > 0) {
          const needed = run.usedMain + mainGap + item.baseMain
          if (needed > contentMain) {
            runs.push(run)
            run = null
          }
        }
        if (!run) run = { items: [], usedMain: 0 }
        if (run.items.length > 0) run.usedMain += mainGap
        run.usedMain += item.baseMain
        run.items.push(item)
      }
      if (run && run.items.length > 0) runs.push(run)
      const boxes = new Map()
      if (runs.length === 0) return boxes

      // A single line fills the container's cross axis (CSS single-line flexbox behaviour, where
      // align-content has no effect); wrapped lines keep their own cross size (tallest child).
      const singleLine = runs.length === 1

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        const count = current.items.length
        const gapTotal = mainGap * Math.max(0, count - 1)
        const fixedMain = current.items.reduce(function (sum, item) {
          return sum + item.baseMain
        }, 0)
        const free = Math.max(0, contentMain - fixedMain - gapTotal)
        const growItems = current.items.filter(function (item) {
          return item.grow
        })
        if (growItems.length > 0 && free > 0) {
          // Boolean `grow` behaves like flex-grow: 1 — free main-axis space is shared equally.
          const share = free / growItems.length
          for (let growIndex = 0; growIndex < growItems.length; growIndex += 1) {
            const item = growItems[growIndex]
            const grown = item.baseMain + share
            item.main = isRow
              ? clampBoxValue(grown, item.bounds.minWidth, item.bounds.maxWidth)
              : clampBoxValue(grown, item.bounds.minHeight, item.bounds.maxHeight)
          }
        }
        current.usedMain =
          current.items.reduce(function (sum, item) {
            return sum + item.main
          }, 0) + gapTotal
        const leftover = Math.max(0, contentMain - current.usedMain)
        // Justify distributes the leftover space on the main axis: `extraGap` is added after
        // every item, `startOffset` shifts the whole run.
        let startOffset = 0
        let extraGap = 0
        if (layout.justify === 'center') {
          startOffset = leftover / 2
        } else if (layout.justify === 'end') {
          startOffset = leftover
        } else if (layout.justify === 'space-between' && count > 1) {
          extraGap = leftover / (count - 1)
        } else if (layout.justify === 'space-around') {
          extraGap = leftover / count
          startOffset = extraGap / 2
        } else if (layout.justify === 'space-evenly') {
          extraGap = leftover / (count + 1)
          startOffset = extraGap
        }
        current.startOffset = startOffset
        current.extraGap = extraGap
        let tallest = 0
        for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
          tallest = Math.max(tallest, current.items[itemIndex].baseCross)
        }
        current.crossSize = singleLine ? contentCross : Math.max(1, tallest)
      }

      // Wrapped runs sit on the cross axis according to `alignContent`; a single run always
      // fills the container (v1 behaviour, and CSS single-line flexbox).
      let runStart = 0
      let runExtraGap = 0
      if (!singleLine) {
        const totalCross =
          runs.reduce(function (sum, current) {
            return sum + current.crossSize
          }, 0) +
          crossGap * (runs.length - 1)
        const crossLeftover = contentCross - totalCross
        if (layout.alignContent === 'center') {
          runStart = crossLeftover / 2
        } else if (layout.alignContent === 'end') {
          runStart = crossLeftover
        } else if (layout.alignContent === 'space-between' && runs.length > 1) {
          runExtraGap = crossLeftover / (runs.length - 1)
        } else if (layout.alignContent === 'space-around') {
          runExtraGap = crossLeftover / runs.length
          runStart = runExtraGap / 2
        } else if (layout.alignContent === 'stretch' && crossLeftover > 0) {
          // Stretch: grow every line equally so the lines fill the container.
          const share = crossLeftover / runs.length
          for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
            runs[runIndex].crossSize += share
          }
        }
      }

      let crossCursor = runStart
      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        let mainCursor = current.startOffset
        for (let itemIndex = 0; itemIndex < current.items.length; itemIndex += 1) {
          const item = current.items[itemIndex]
          const alignSelfRaw = item.layer.alignSelf
          const crossAlign =
            LAYOUT_ALIGNS.indexOf(alignSelfRaw) >= 0 ? alignSelfRaw : layout.align
          let crossSize = crossAlign === 'stretch' ? current.crossSize : item.baseCross
          // Stretch/grow can push a child past its authored min/max.
          crossSize = isRow
            ? clampBoxValue(crossSize, item.bounds.minHeight, item.bounds.maxHeight)
            : clampBoxValue(crossSize, item.bounds.minWidth, item.bounds.maxWidth)
          let crossOffset = 0
          if (crossAlign === 'center') crossOffset = (current.crossSize - crossSize) / 2
          else if (crossAlign === 'end') crossOffset = current.crossSize - crossSize
          boxes.set(item.layer, {
            x: isRow ? pad.left + mainCursor : pad.left + crossCursor + crossOffset,
            y: isRow ? pad.top + crossCursor + crossOffset : pad.top + mainCursor,
            width: isRow ? item.main : crossSize,
            height: isRow ? crossSize : item.main,
          })
          mainCursor += item.main + mainGap + current.extraGap
        }
        crossCursor += current.crossSize + crossGap + runExtraGap
      }
      return boxes
    }

    /**
     * One immutable snapshot of the rendered document:
     *   { artboards: [{ artboard, layers: nodes }], byId: Map<layerId, node>, allNodes: node[] }
     * A node is { id, layer, type, artboard, parent, parentId, index, depth, x, y, width,
     * height, worldRect, autoParent, locked, children }. x/y are relative to the parent
     * (computed for auto-layout children); worldRect is relative to the artboard's top-left and
     * always stays in *authored* canvas units — the camera zoom is applied when styling, never
     * here, so hit-testing, drag math and every other consumer keep working in canvas units.
     */
    function buildComputedTree(doc) {
      const byId = new Map()
      const allNodes = []
      const artboards = []

      function buildList(list, context) {
        const nodes = []
        const layers = Array.isArray(list) ? list : []
        // Defensive cap: the Host enforces the depth limit, but never recurse forever
        // on a hand-edited/corrupt document.
        if (context.depth > FRAME_MAX_DEPTH + 1) return nodes
        for (let index = 0; index < layers.length; index += 1) {
          const layer = layers[index]
          if (!isObject(layer)) continue
          const box = context.parentAuto && context.boxes ? context.boxes.get(layer) || null : null
          const effective = layerEffectiveSize(layer, context.depth)
          const offsetX = box ? finiteNumber(box.x, 0) : finiteNumber(layer.x, 0)
          const offsetY = box ? finiteNumber(box.y, 0) : finiteNumber(layer.y, 0)
          // Auto-layout boxes already carry the clamped size; absolute layers use the
          // hug/clamp result from `layerEffectiveSize`.
          const width = box
            ? clampBoxValue(box.width, 0, 0)
            : effective.width
          const height = box
            ? clampBoxValue(box.height, 0, 0)
            : effective.height
          const worldRect = {
            x: context.parentX + offsetX,
            y: context.parentY + offsetY,
            width: width,
            height: height,
          }
          const node = {
            id: layer.id,
            layer: layer,
            type: layer.type,
            artboard: context.artboard,
            parent: context.parent,
            parentId: context.parent ? context.parent.id : null,
            index: index,
            depth: context.depth,
            x: offsetX,
            y: offsetY,
            width: width,
            height: height,
            worldRect: worldRect,
            autoParent: !!context.parentAuto,
            locked: layer.locked === true,
            children: null,
          }
          byId.set(node.id, node)
          allNodes.push(node)
          if (isContainerLayer(layer)) {
            // A group is always absolute; only a frame can own an auto-layout object.
            const layout = layer.type === 'frame' ? normalizeLayoutObject(layer.layout) : null
            let boxes = null
            if (layout) {
              boxes = computeFrameChildBoxes(layer.layout, width, height, childrenOf(layer))
            }
            node.children = buildList(childrenOf(layer), {
              artboard: context.artboard,
              parent: node,
              parentX: worldRect.x,
              parentY: worldRect.y,
              parentAuto: !!layout,
              depth: context.depth + 1,
              boxes: boxes,
            })
          }
          nodes.push(node)
        }
        return nodes
      }

      const boards = artboardsOf(doc)
      for (let index = 0; index < boards.length; index += 1) {
        const artboard = boards[index]
        if (!isObject(artboard)) continue
        artboards.push({
          artboard: artboard,
          layers: buildList(layersOf(artboard), {
            artboard: artboard,
            parent: null,
            parentX: 0,
            parentY: 0,
            parentAuto: false,
            depth: 1,
            boxes: null,
          }),
        })
      }
      return { artboards: artboards, byId: byId, allNodes: allNodes }
    }

    /* ------------------------------------------------------------------------------------------
     * Geometry helpers shared with the renderer
     * ---------------------------------------------------------------------------------------- */

    /** Normalized line props: the model stores them, but a hand-edited doc may omit any. */
    function lineLayerGeometry(layer, widthValue, heightValue) {
      const width = Math.max(1, finiteNumber(widthValue, 1))
      const height = Math.max(1, finiteNumber(heightValue, 1))
      const strokeWidth = clamp(
        finiteNumber(layer.strokeWidth, LINE_DEFAULT_STROKE_WIDTH),
        LINE_MIN_STROKE_WIDTH,
        LINE_MAX_STROKE_WIDTH,
      )
      const orientation =
        LINE_ORIENTATION_VALUES.indexOf(layer.orientation) >= 0 ? layer.orientation : 'horizontal'
      let x1 = 0
      let y1 = height / 2
      let x2 = width
      let y2 = height / 2
      if (orientation === 'vertical') {
        x1 = width / 2
        y1 = 0
        x2 = width / 2
        y2 = height
      } else if (orientation === 'diagonal') {
        x1 = 0
        y1 = 0
        x2 = width
        y2 = height
      }
      return {
        orientation: orientation,
        width: width,
        height: height,
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        stroke: typeof layer.stroke === 'string' && layer.stroke ? layer.stroke : LINE_DEFAULT_STROKE,
        strokeWidth: strokeWidth,
        dashed: layer.dashed === true,
        arrowStart: layer.arrowStart === true,
        arrowEnd: layer.arrowEnd === true,
      }
    }

    /** Arrow head triangle (tip, left corner, right corner) for a line endpoint. */
    function lineArrowPoints(geometry, atEnd) {
      const dx = geometry.x2 - geometry.x1
      const dy = geometry.y2 - geometry.y1
      const length = Math.sqrt(dx * dx + dy * dy)
      if (!(length > 0)) return null
      const ux = dx / length
      const uy = dy / length
      const headLength = Math.max(2, geometry.strokeWidth * LINE_ARROW_LENGTH_RATIO)
      const headHalf = Math.max(1, geometry.strokeWidth * LINE_ARROW_HALF_WIDTH_RATIO)
      // The end arrow points along the path, the start arrow points back at the start point.
      const tipX = atEnd ? geometry.x2 : geometry.x1
      const tipY = atEnd ? geometry.y2 : geometry.y1
      const dirX = atEnd ? ux : -ux
      const dirY = atEnd ? uy : -uy
      const baseX = tipX - dirX * headLength
      const baseY = tipY - dirY * headLength
      // Perpendicular of the direction, scaled to the head half width.
      const nx = -dirY
      const ny = dirX
      return (
        tipX +
        ',' +
        tipY +
        ' ' +
        (baseX + nx * headHalf) +
        ',' +
        (baseY + ny * headHalf) +
        ' ' +
        (baseX - nx * headHalf) +
        ',' +
        (baseY - ny * headHalf)
      )
    }

