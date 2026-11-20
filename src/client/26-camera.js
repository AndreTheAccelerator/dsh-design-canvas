
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
