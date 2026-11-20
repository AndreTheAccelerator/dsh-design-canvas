
    function defaultCamera() {
      return { x: CAMERA_DEFAULT_X, y: CAMERA_DEFAULT_Y, zoom: CAMERA_DEFAULT_ZOOM }
    }

    /** Coerce any candidate camera into {x, y, zoom}, clamped and finite. */
    function normalizeCamera(value, fallback) {
      const source = isObject(value) ? value : {}
      const base = isObject(fallback) ? fallback : defaultCamera()
      return {
        x: roundTo(finiteNumber(source.x, finiteNumber(base.x, CAMERA_DEFAULT_X)), 1),
        y: roundTo(finiteNumber(source.y, finiteNumber(base.y, CAMERA_DEFAULT_Y)), 1),
        zoom: clamp(
          roundTo(finiteNumber(source.zoom, finiteNumber(base.zoom, CAMERA_DEFAULT_ZOOM)), 3),
          MIN_ZOOM,
          MAX_ZOOM,
        ),
      }
    }

    /**
     * Vertical artboard stack in canvas units. Every artboard gets an entry with the
     * wrapper origin (x, y) and the board-frame origin (frameX, frameY); the label row
     * sits above the frame. This is the single source of truth for fit, hit-testing
     * and projecting layers into viewport space.
     */
    function computeLayout(doc) {
      const artboards = artboardsOf(doc)
      const entries = []
      const entryById = new Map()
      let cursor = 0
      let widest = 0
      for (let index = 0; index < artboards.length; index += 1) {
        const artboard = artboards[index]
        if (!isObject(artboard)) continue
        const width = Math.max(1, finiteNumber(artboard.width, 1))
        const height = Math.max(1, finiteNumber(artboard.height, 1))
        const entry = {
          artboard: artboard,
          id: artboard.id,
          x: 0,
          y: cursor,
          frameX: 0,
          frameY: cursor + BOARD_LABEL_HEIGHT,
          width: width,
          height: height,
        }
        entries.push(entry)
        if (typeof artboard.id === 'string' && artboard.id) entryById.set(artboard.id, entry)
        cursor += BOARD_LABEL_HEIGHT + height + STAGE_GAP
        if (width > widest) widest = width
      }
      if (entries.length === 0) {
        return { entries: entries, entryById: entryById, width: 0, height: 0 }
      }
      for (let index = 0; index < entries.length; index += 1) {
        const centered = Math.round((widest - entries[index].width) / 2)
        entries[index].x = centered
        entries[index].frameX = centered
      }
      return {
        entries: entries,
        entryById: entryById,
        width: widest,
        height: Math.max(0, cursor - STAGE_GAP),
      }
    }

    function layoutEntryAt(layout, x, y) {
      if (!layout || !Array.isArray(layout.entries)) return null
      const pointX = finiteNumber(x, 0)
      const pointY = finiteNumber(y, 0)
      for (let index = 0; index < layout.entries.length; index += 1) {
        const entry = layout.entries[index]
        if (!entry) continue
        if (
          pointX >= entry.frameX &&
          pointX <= entry.frameX + entry.width &&
          pointY >= entry.frameY &&
          pointY <= entry.frameY + entry.height
        ) {
          return entry
        }
      }
      return null
    }

    /** Screen delta -> canvas (document) delta: divide by the camera zoom. */
    function screenDeltaToCanvas(delta, zoom) {
      const scale = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      return finiteNumber(delta, 0) / scale
    }

    /* ------------------------------------------------------------------------------------------
     * Selection rectangles and snap guides
     *
     * All rects here are artboard-local canvas units (computed node worldRect), which is the space
     * the renderer draws the selection overlay and guide lines in.
     * ---------------------------------------------------------------------------------------- */

    function rectOf(x, y, width, height) {
      return {
        x: finiteNumber(x, 0),
        y: finiteNumber(y, 0),
        width: Math.max(0, finiteNumber(width, 0)),
        height: Math.max(0, finiteNumber(height, 0)),
      }
    }

    /** Union of several rects; null when the list is empty. */
    function unionRects(rects) {
      const list = Array.isArray(rects) ? rects : []
      let left = null
      let top = null
      let right = null
      let bottom = null
      for (let index = 0; index < list.length; index += 1) {
        const rect = list[index]
        if (!isObject(rect)) continue
        const x = finiteNumber(rect.x, 0)
        const y = finiteNumber(rect.y, 0)
        const width = Math.max(0, finiteNumber(rect.width, 0))
        const height = Math.max(0, finiteNumber(rect.height, 0))
        if (left === null || x < left) left = x
        if (top === null || y < top) top = y
        if (right === null || x + width > right) right = x + width
        if (bottom === null || y + height > bottom) bottom = y + height
      }
      if (left === null) return null
      return rectOf(left, top, right - left, bottom - top)
    }

    /** Rect from two corner points (a marquee drag in any direction). */
    function rectFromPoints(first, second) {
      const a = isObject(first) ? first : {}
      const b = isObject(second) ? second : {}
      const ax = finiteNumber(a.x, 0)
      const ay = finiteNumber(a.y, 0)
      const bx = finiteNumber(b.x, 0)
      const by = finiteNumber(b.y, 0)
      return rectOf(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
    }

    /** True when two rects overlap (touching edges count as an intersection). */
    function rectsIntersect(first, second) {
      if (!isObject(first) || !isObject(second)) return false
      const ax = finiteNumber(first.x, 0)
      const ay = finiteNumber(first.y, 0)
      const aw = Math.max(0, finiteNumber(first.width, 0))
      const ah = Math.max(0, finiteNumber(first.height, 0))
      const bx = finiteNumber(second.x, 0)
      const by = finiteNumber(second.y, 0)
      const bw = Math.max(0, finiteNumber(second.width, 0))
      const bh = Math.max(0, finiteNumber(second.height, 0))
      return ax <= bx + bw && bx <= ax + aw && ay <= by + bh && by <= ay + ah
    }

    /** True when `outer` fully contains `inner` (used by marquee container-vs-children rules). */
    function rectContainsRect(outer, inner) {
      if (!isObject(outer) || !isObject(inner)) return false
      const ox = finiteNumber(outer.x, 0)
      const oy = finiteNumber(outer.y, 0)
      const ow = Math.max(0, finiteNumber(outer.width, 0))
      const oh = Math.max(0, finiteNumber(outer.height, 0))
      const ix = finiteNumber(inner.x, 0)
      const iy = finiteNumber(inner.y, 0)
      const iw = Math.max(0, finiteNumber(inner.width, 0))
      const ih = Math.max(0, finiteNumber(inner.height, 0))
      return ix >= ox && iy >= oy && ix + iw <= ox + ow && iy + ih <= oy + oh
    }

    function rectContainsPoint(rect, point) {
      if (!isObject(rect) || !isObject(point)) return false
      const x = finiteNumber(point.x, 0)
      const y = finiteNumber(point.y, 0)
      return (
        x >= finiteNumber(rect.x, 0) &&
        x <= finiteNumber(rect.x, 0) + Math.max(0, finiteNumber(rect.width, 0)) &&
        y >= finiteNumber(rect.y, 0) &&
        y <= finiteNumber(rect.y, 0) + Math.max(0, finiteNumber(rect.height, 0))
      )
    }

    /** The three interesting positions of a box on one axis: start, center, end. */
    function boxAxisPoints(box, axis) {
      if (!isObject(box)) return []
      if (axis === 'y') {
        const top = finiteNumber(box.y, 0)
        const height = Math.max(0, finiteNumber(box.height, 0))
        return [top, top + height / 2, top + height]
      }
      const left = finiteNumber(box.x, 0)
      const width = Math.max(0, finiteNumber(box.width, 0))
      return [left, left + width / 2, left + width]
    }

    /** Snap lines (start/center/end) contributed by a list of static rects on one axis. */
    function axisSnapLines(rects, axis) {
      const lines = []
      const list = Array.isArray(rects) ? rects : []
      for (let index = 0; index < list.length; index += 1) {
        const points = boxAxisPoints(list[index], axis)
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          lines.push(roundTo(points[pointIndex], 2))
        }
      }
      return lines
    }

    /**
     * Snap a moving box to the nearest line on one axis.
     * Returns `{ delta, at }` — `delta` is the correction to add to the proposed offset so that
     * the closest box point lands exactly on the guide — or null when nothing is within
     * `threshold` canvas units.
     */
    function nearestSnap(box, axis, lines, threshold) {
      const limit = Math.max(0, finiteNumber(threshold, 0))
      if (!isObject(box) || !Array.isArray(lines) || lines.length === 0) return null
      const points = boxAxisPoints(box, axis)
      let best = null
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]
        if (!Number.isFinite(line)) continue
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          const distance = Math.abs(points[pointIndex] - line)
          if (distance > limit) continue
          if (best && distance >= best.distance) continue
          best = { delta: line - points[pointIndex], at: line, distance: distance }
        }
      }
      return best ? { delta: roundTo(best.delta, 2), at: best.at } : null
    }

    /**
     * Snap a drag preview. `movingBox` is the selection box at the proposed offset; `staticRects`
     * are sibling boxes; `frameRect` is the artboard/parent box (its edges and center also snap).
     * Returns `{ dx, dy, guides }` where guides are `[{ axis: 'x'|'y', at }]` in artboard-local
     * canvas units, ready for the renderer to draw as full-length lines.
     */
    function snapMovingBox(movingBox, staticRects, frameRect, dx, dy, threshold) {
      const shiftX = finiteNumber(dx, 0)
      const shiftY = finiteNumber(dy, 0)
      if (!isObject(movingBox)) return { dx: shiftX, dy: shiftY, guides: [] }
      const statics = Array.isArray(staticRects) ? staticRects.slice() : []
      if (isObject(frameRect)) statics.push(frameRect)
      const proposed = rectOf(
        movingBox.x + shiftX,
        movingBox.y + shiftY,
        movingBox.width,
        movingBox.height,
      )
      const xSnap = nearestSnap(proposed, 'x', axisSnapLines(statics, 'x'), threshold)
      const ySnap = nearestSnap(proposed, 'y', axisSnapLines(statics, 'y'), threshold)
      const guides = []
      let nextX = shiftX
      let nextY = shiftY
      if (xSnap) {
        nextX = shiftX + xSnap.delta
        guides.push({ axis: 'x', at: xSnap.at })
      }
      if (ySnap) {
        nextY = shiftY + ySnap.delta
        guides.push({ axis: 'y', at: ySnap.at })
      }
      return { dx: roundTo(nextX, 2), dy: roundTo(nextY, 2), guides: guides }
    }
