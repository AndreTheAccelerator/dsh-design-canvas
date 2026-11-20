
    function imageFileType(file) {
      if (!file || typeof file !== 'object') return ''
      const type = typeof file.type === 'string' ? file.type.toLowerCase() : ''
      if (IMAGE_TYPES.indexOf(type) >= 0) return type
      const name = typeof file.name === 'string' ? file.name.toLowerCase() : ''
      const dot = name.lastIndexOf('.')
      const extension = dot >= 0 ? name.slice(dot + 1) : ''
      if (extension === 'png') return 'image/png'
      if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
      if (extension === 'webp') return 'image/webp'
      if (extension === 'gif') return 'image/gif'
      if (extension === 'svg') return 'image/svg+xml'
      return ''
    }

    function readFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof FileReader !== 'function') {
            reject(new Error('FileReader is unavailable'))
            return
          }
          const reader = new FileReader()
          let settled = false
          reader.onload = function () {
            if (settled) return
            settled = true
            const result = reader.result
            if (typeof result === 'string' && result.indexOf('data:') === 0) resolve(result)
            else reject(new Error('image file produced no data URL'))
          }
          reader.onerror = function () {
            if (settled) return
            settled = true
            reject(reader.error || new Error('image file could not be read'))
          }
          reader.readAsDataURL(file)
        } catch (error) {
          reject(error)
        }
      })
    }

    /** Natural pixel size of a data: URL; resolves 0×0 when the browser cannot decode it. */
    function measureImageSize(dataUrl) {
      return new Promise(function (resolve) {
        try {
          const ImageCtor =
            typeof window !== 'undefined' && typeof window.Image === 'function' ? window.Image : null
          if (!ImageCtor) {
            resolve({ width: 0, height: 0 })
            return
          }
          const image = new ImageCtor()
          let settled = false
          function finish(width, height) {
            if (settled) return
            settled = true
            image.onload = null
            image.onerror = null
            resolve({ width: width, height: height })
          }
          image.onload = function () {
            finish(finiteNumber(image.naturalWidth, 0), finiteNumber(image.naturalHeight, 0))
          }
          image.onerror = function () {
            finish(0, 0)
          }
          image.src = dataUrl
        } catch (error) {
          resolve({ width: 0, height: 0 })
        }
      })
    }

    /**
     * Deepest group/frame under an artboard-local canvas point, so an image dropped on a group
     * lands inside that group instead of on the artboard behind it. Returns
     * `{ node, localPoint }` (localPoint relative to the container's top-left) or null.
     */
    function imageDropContainerAt(tree, artboardId, point) {
      if (!tree || !Array.isArray(tree.artboards) || !isObject(point)) return null
      const entry = tree.artboards.find(function (item) {
        return item && item.artboard && item.artboard.id === artboardId
      })
      if (!entry) return null
      function visit(nodes) {
        const list = Array.isArray(nodes) ? nodes : []
        // Front-to-back: later siblings paint on top, so visit the last child first.
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const node = list[index]
          if (!node || !node.layer) continue
          const rect = node.worldRect
          if (!rectContainsPoint(rect, point)) continue
          if (!isContainerLayer(node.layer)) continue
          // Frames and groups are containers: the innermost one under the pointer wins, so an
          // image dropped over a group's children still lands in the group.
          const deeper = visit(node.children)
          if (deeper) return deeper
          return {
            node: node,
            localPoint: {
              x: finiteNumber(point.x, 0) - finiteNumber(rect.x, 0),
              y: finiteNumber(point.y, 0) - finiteNumber(rect.y, 0),
            },
          }
        }
        return null
      }
      return visit(entry.layers)
    }

    /* ------------------------------------------------------------------------------------------
     * Frames, CSS-like flex layout and the computed render tree
     *
     * The Host only stores authored geometry; the Client is the single source of truth for
     * rendered positions. `computeFrameChildBoxes` is the pure flex engine (row/column, gap,
     * padding, grow, justify, align/alignSelf, wrap) returning child boxes relative to the
     * frame's top-left. `buildComputedTree` walks the whole document once per version and
     * produces nodes with world rects used by the renderer, selection overlay, pins and the
     * comment composer. The layer tree and the inspector reuse the same nodes.
     * ---------------------------------------------------------------------------------------- */
