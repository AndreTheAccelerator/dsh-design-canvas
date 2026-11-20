
    function defaultLayoutObject() {
      return {
        direction: 'row',
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        align: 'stretch',
        justify: 'start',
        wrap: false,
      }
    }

    /** Normalize a stored layout into a complete object (Host fills defaults; be defensive). */
    function normalizeLayoutObject(layout) {
      if (!isObject(layout)) return null
      const base = defaultLayoutObject()
      const rawPadding = isObject(layout.padding) ? layout.padding : {}
      const padding = {}
      for (let index = 0; index < PADDING_SIDES.length; index += 1) {
        const side = PADDING_SIDES[index]
        padding[side] = Math.max(0, finiteNumber(rawPadding[side], 0))
      }
      return {
        direction: LAYOUT_DIRECTIONS.indexOf(layout.direction) >= 0 ? layout.direction : base.direction,
        gap: Math.max(0, finiteNumber(layout.gap, base.gap)),
        padding: padding,
        align: LAYOUT_ALIGNS.indexOf(layout.align) >= 0 ? layout.align : base.align,
        justify: LAYOUT_JUSTIFIES.indexOf(layout.justify) >= 0 ? layout.justify : base.justify,
        wrap: layout.wrap === true,
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
      return (
        'layout=' +
        normalized.direction +
        ' gap=' +
        roundTo(normalized.gap, 2) +
        ' pad=' +
        paddingSummary(normalized.padding) +
        ' align=' +
        normalized.align +
        ' justify=' +
        normalized.justify +
        (normalized.wrap ? ' wrap' : '')
      )
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

      const items = []
      const list = Array.isArray(children) ? children : []
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        // Hidden layers behave like display:none: they neither render nor take layout space.
        if (!isObject(layer) || layer.visible === false) continue
        const baseWidth = Math.max(1, finiteNumber(layer.width, CHILD_DEFAULT_WIDTH))
        const baseHeight = Math.max(1, finiteNumber(layer.height, CHILD_DEFAULT_HEIGHT))
        items.push({
          layer: layer,
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
          const needed = run.usedMain + layout.gap + item.baseMain
          if (needed > contentMain) {
            runs.push(run)
            run = null
          }
        }
        if (!run) run = { items: [], usedMain: 0 }
        if (run.items.length > 0) run.usedMain += layout.gap
        run.usedMain += item.baseMain
        run.items.push(item)
      }
      if (run && run.items.length > 0) runs.push(run)
      const boxes = new Map()
      if (runs.length === 0) return boxes

      // A single line fills the container's cross axis (CSS single-line flexbox behaviour);
      // wrapped lines keep their own cross size (tallest child of the line).
      const singleLine = runs.length === 1

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        const count = current.items.length
        const gapTotal = layout.gap * Math.max(0, count - 1)
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
            growItems[growIndex].main = growItems[growIndex].baseMain + share
          }
        }
        current.usedMain =
          current.items.reduce(function (sum, item) {
            return sum + item.main
          }, 0) + gapTotal
        const leftover = Math.max(0, contentMain - current.usedMain)
        current.startOffset =
          layout.justify === 'center' ? leftover / 2 : layout.justify === 'end' ? leftover : 0
        current.extraGap =
          layout.justify === 'space-between' && count > 1 ? leftover / (count - 1) : 0
        let tallest = 0
        for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
          tallest = Math.max(tallest, current.items[itemIndex].baseCross)
        }
        current.crossSize = singleLine ? contentCross : Math.max(1, tallest)
      }

      let crossCursor = 0
      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        let mainCursor = current.startOffset
        for (let itemIndex = 0; itemIndex < current.items.length; itemIndex += 1) {
          const item = current.items[itemIndex]
          const alignSelfRaw = item.layer.alignSelf
          const crossAlign =
            LAYOUT_ALIGNS.indexOf(alignSelfRaw) >= 0 ? alignSelfRaw : layout.align
          const crossSize = crossAlign === 'stretch' ? current.crossSize : item.baseCross
          let crossOffset = 0
          if (crossAlign === 'center') crossOffset = (current.crossSize - crossSize) / 2
          else if (crossAlign === 'end') crossOffset = current.crossSize - crossSize
          boxes.set(item.layer, {
            x: isRow ? pad.left + mainCursor : pad.left + crossCursor + crossOffset,
            y: isRow ? pad.top + crossCursor + crossOffset : pad.top + mainCursor,
            width: isRow ? item.main : crossSize,
            height: isRow ? crossSize : item.main,
          })
          mainCursor += item.main + layout.gap + current.extraGap
        }
        crossCursor += current.crossSize + layout.gap
      }
      return boxes
    }

    /**
     * One immutable snapshot of the rendered document:
     *   { artboards: [{ artboard, layers: nodes }], byId: Map<layerId, node>, allNodes: node[] }
     * A node is { id, layer, type, artboard, parent, parentId, index, depth, x, y, width,
     * height, worldRect, autoParent, children }. x/y are relative to the parent (computed for
     * auto-layout children); worldRect is relative to the artboard's top-left.
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
          const offsetX = box ? finiteNumber(box.x, 0) : finiteNumber(layer.x, 0)
          const offsetY = box ? finiteNumber(box.y, 0) : finiteNumber(layer.y, 0)
          const width = Math.max(1, finiteNumber(box ? box.width : layer.width, 1))
          const height = Math.max(1, finiteNumber(box ? box.height : layer.height, 1))
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
            children: null,
          }
          byId.set(node.id, node)
          allNodes.push(node)
          if (layer.type === 'frame') {
            const layout = normalizeLayoutObject(layer.layout)
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
