    /* ------------------------------------------------------------------------------------------
     * Pure document helpers
     * ---------------------------------------------------------------------------------------- */

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function finiteNumber(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    function clamp(number, minimum, maximum) {
      return Math.min(Math.max(number, minimum), maximum)
    }

    function roundTo(number, decimals) {
      const factor = Math.pow(10, decimals || 0)
      return Math.round(number * factor) / factor
    }

    function makeId(prefix) {
      return prefix + '-' + Math.random().toString(36).slice(2, 10)
    }

    function artboardsOf(doc) {
      return doc && Array.isArray(doc.artboards) ? doc.artboards : []
    }

    function commentsOf(doc) {
      return doc && Array.isArray(doc.comments) ? doc.comments : []
    }

    function layersOf(artboard) {
      return artboard && Array.isArray(artboard.layers) ? artboard.layers : []
    }

    /** Children array of any container: an artboard (`layers`) or a frame (`children`). */
    function childrenOf(container) {
      if (!isObject(container)) return []
      if (container.type === 'frame') {
        return Array.isArray(container.children) ? container.children : []
      }
      return layersOf(container)
    }

    function findArtboardById(doc, artboardId) {
      if (!doc || typeof artboardId !== 'string' || !artboardId) return null
      const artboards = artboardsOf(doc)
      for (let index = 0; index < artboards.length; index += 1) {
        if (artboards[index] && artboards[index].id === artboardId) return artboards[index]
      }
      return null
    }

    function findLayerInList(list, layerId, artboard, parentLayer, depth) {
      if (!Array.isArray(list)) return null
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        if (!isObject(layer)) continue
        if (layer.id === layerId) {
          return {
            layer: layer,
            artboard: artboard,
            parent: parentLayer || null,
            parentId: parentLayer && typeof parentLayer.id === 'string' ? parentLayer.id : null,
            index: index,
            depth: depth,
          }
        }
        if (layer.type === 'frame') {
          const found = findLayerInList(childrenOf(layer), layerId, artboard, layer, depth + 1)
          if (found) return found
        }
      }
      return null
    }

    /** Recursive layer lookup: returns { layer, artboard, parent, parentId, index, depth } or null. */
    function findLayerById(doc, layerId) {
      if (!doc || typeof layerId !== 'string' || !layerId) return null
      const artboards = artboardsOf(doc)
      for (let artboardIndex = 0; artboardIndex < artboards.length; artboardIndex += 1) {
        const artboard = artboards[artboardIndex]
        if (!isObject(artboard)) continue
        const found = findLayerInList(layersOf(artboard), layerId, artboard, null, 1)
        if (found) return found
      }
      return null
    }

    function collectLayerIds(layer, target) {
      if (!isObject(layer) || !(target instanceof Set)) return target
      if (typeof layer.id === 'string' && layer.id) target.add(layer.id)
      if (layer.type === 'frame') {
        const kids = childrenOf(layer)
        for (let index = 0; index < kids.length; index += 1) collectLayerIds(kids[index], target)
      }
      return target
    }

    function subtreeContains(layer, layerId) {
      if (!isObject(layer) || typeof layerId !== 'string' || !layerId) return false
      if (layer.id === layerId) return true
      if (layer.type !== 'frame') return false
      const kids = childrenOf(layer)
      for (let index = 0; index < kids.length; index += 1) {
        if (subtreeContains(kids[index], layerId)) return true
      }
      return false
    }

    /** Nested-frame height of a subtree (a leaf layer is 1, matching Host depth rules). */
    function subtreeHeight(layer) {
      if (!isObject(layer) || layer.type !== 'frame') return 1
      let tallest = 0
      const kids = childrenOf(layer)
      for (let index = 0; index < kids.length; index += 1) {
        const childHeight = subtreeHeight(kids[index])
        if (childHeight > tallest) tallest = childHeight
      }
      return 1 + tallest
    }

    function countLayers(doc) {
      let total = 0
      function countList(list) {
        const layers = Array.isArray(list) ? list : []
        for (let index = 0; index < layers.length; index += 1) {
          const layer = layers[index]
          if (!isObject(layer)) continue
          total += 1
          if (layer.type === 'frame') countList(childrenOf(layer))
        }
      }
      const artboards = artboardsOf(doc)
      for (let index = 0; index < artboards.length; index += 1) countList(layersOf(artboards[index]))
      return total
    }

    /**
     * Map every layer of a tree through `mapper` (frames keep recursing into children after the
     * mapper runs). Returns the original array when nothing changed so callers can skip re-renders.
     */
    function mapLayerList(list, mapper) {
      const layers = Array.isArray(list) ? list : []
      let changed = false
      const next = layers.map(function (layer) {
        if (!isObject(layer)) return layer
        let result = mapper(layer)
        if (!isObject(result)) result = layer
        if (result.type === 'frame') {
          const kids = childrenOf(result)
          const nextKids = mapLayerList(kids, mapper)
          if (nextKids !== kids) result = Object.assign({}, result, { children: nextKids })
        }
        if (result !== layer) changed = true
        return result
      })
      return changed ? next : layers
    }

    function replaceLayerListIn(layers, parentId, nextChildren) {
      let changed = false
      const next = layers.map(function (layer) {
        if (!isObject(layer)) return layer
        if (layer.id === parentId) {
          changed = true
          return Object.assign({}, layer, { children: nextChildren })
        }
        if (layer.type === 'frame') {
          const kids = childrenOf(layer)
          const nextKids = replaceLayerListIn(kids, parentId, nextChildren)
          if (nextKids !== kids) {
            changed = true
            return Object.assign({}, layer, { children: nextKids })
          }
        }
        return layer
      })
      return changed ? next : layers
    }

    function docReplaceLayerList(doc, artboardId, parentId, nextChildren) {
      let changed = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard) || artboard.id !== artboardId) return artboard
        if (!parentId) {
          const layers = layersOf(artboard)
          if (layers === nextChildren) return artboard
          changed = true
          return Object.assign({}, artboard, { layers: nextChildren })
        }
        const layers = layersOf(artboard)
        const nextLayers = replaceLayerListIn(layers, parentId, nextChildren)
        if (nextLayers === layers) return artboard
        changed = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!changed) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    /** Replace one layer's own properties, producing a new document. */
    function docPatchLayer(doc, layerId, patch) {
      if (!doc) return doc
      function mapper(layer) {
        if (layer.id !== layerId) return layer
        return Object.assign({}, layer, patch)
      }
      let touched = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard)) return artboard
        const layers = layersOf(artboard)
        const nextLayers = mapLayerList(layers, mapper)
        if (nextLayers === layers) return artboard
        touched = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!touched) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    function docPatchArtboard(doc, artboardId, patch) {
      if (!doc) return doc
      let changed = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!artboard || artboard.id !== artboardId) return artboard
        changed = true
        return Object.assign({}, artboard, patch)
      })
      if (!changed) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    function docInsertArtboard(doc, artboard, index) {
      const artboards = artboardsOf(doc).slice()
      const position =
        typeof index === 'number' ? clamp(index, 0, artboards.length) : artboards.length
      artboards.splice(position, 0, artboard)
      return Object.assign({}, doc, { artboards: artboards })
    }

    /** Insert a layer into a destination: `{ artboardId }` (top level) or `{ parentId }` (frame). */
    function docInsertLayer(doc, destination, layer, index) {
      if (!doc || !isObject(destination) || !isObject(layer)) return doc
      const parentId =
        typeof destination.parentId === 'string' && destination.parentId
          ? destination.parentId
          : null
      const artboardId =
        typeof destination.artboardId === 'string' && destination.artboardId
          ? destination.artboardId
          : null
      if (!parentId && !artboardId) return doc
      if (parentId) {
        const parentFound = findLayerById(doc, parentId)
        if (!parentFound) return doc
        const list = childrenOf(parentFound.layer).slice()
        const position = typeof index === 'number' ? clamp(index, 0, list.length) : list.length
        list.splice(position, 0, layer)
        return docReplaceLayerList(doc, parentFound.artboard.id, parentId, list)
      }
      const artboard = findArtboardById(doc, artboardId)
      if (!artboard) return doc
      const list = layersOf(artboard).slice()
      const position = typeof index === 'number' ? clamp(index, 0, list.length) : list.length
      list.splice(position, 0, layer)
      return docReplaceLayerList(doc, artboardId, null, list)
    }

    /** Remove one layer (not its comments) from wherever it lives. */
    function removeLayerFromTree(doc, layerId) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const list = (found.parent ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
      if (found.index < 0 || found.index >= list.length) return doc
      list.splice(found.index, 1)
      return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
    }

    /** Remove a layer and its whole subtree, dropping comments that referenced any deleted layer. */
    function docRemoveLayer(doc, layerId) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const removedIds = collectLayerIds(found.layer, new Set())
      const next = removeLayerFromTree(doc, layerId)
      return Object.assign({}, next, {
        comments: commentsOf(next).filter(function (comment) {
          return (
            !isObject(comment) ||
            typeof comment.layerId !== 'string' ||
            !removedIds.has(comment.layerId)
          )
        }),
      })
    }

    /** Reorder a layer within its current parent (artboard or frame). Index is the final position. */
    function docReorderLayer(doc, layerId, targetIndex) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const list = (found.parent ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
      if (list.length === 0) return doc
      const to = clamp(finiteNumber(targetIndex, found.index), 0, list.length - 1)
      if (to === found.index) return doc
      const moved = list.splice(found.index, 1)[0]
      list.splice(to, 0, moved)
      return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
    }

    /** Move a layer to another parent (or reorder in place) in one document update. */
    function docMoveLayer(doc, layerId, destination, index) {
      if (!doc || !isObject(destination)) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const parentId =
        typeof destination.parentId === 'string' && destination.parentId
          ? destination.parentId
          : null
      const artboardId =
        typeof destination.artboardId === 'string' && destination.artboardId
          ? destination.artboardId
          : null
      if (!parentId && !artboardId) return doc
      const sameParent = parentId ? parentId === found.parentId : !found.parentId && artboardId === found.artboard.id
      if (sameParent) {
        const list = (parentId ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
        if (list.length === 0) return doc
        const to = clamp(
          typeof index === 'number' ? index : list.length - 1,
          0,
          list.length - 1,
        )
        if (to === found.index) return doc
        const moved = list.splice(found.index, 1)[0]
        list.splice(to, 0, moved)
        return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
      }
      let destArtboardId = artboardId
      let destList = null
      if (parentId) {
        const parentFound = findLayerById(doc, parentId)
        if (!parentFound) return doc
        destArtboardId = parentFound.artboard.id
        destList = childrenOf(parentFound.layer).slice()
      } else {
        const artboard = findArtboardById(doc, artboardId)
        if (!artboard) return doc
        destList = layersOf(artboard).slice()
      }
      const position = typeof index === 'number' ? clamp(index, 0, destList.length) : destList.length
      destList.splice(position, 0, found.layer)
      const removed = removeLayerFromTree(doc, layerId)
      return docReplaceLayerList(removed, destArtboardId, parentId, destList)
    }

    function docPatchComment(doc, commentId, patch) {
      if (!doc) return doc
      let changed = false
      const comments = commentsOf(doc).map(function (comment) {
        if (!comment || comment.id !== commentId) return comment
        changed = true
        return Object.assign({}, comment, patch)
      })
      if (!changed) return doc
      return Object.assign({}, doc, { comments: comments })
    }

    function docRemoveComment(doc, commentId) {
      if (!doc) return doc
      const comments = commentsOf(doc)
      const next = comments.filter(function (comment) { return !comment || comment.id !== commentId })
      if (next.length === comments.length) return doc
      return Object.assign({}, doc, { comments: next })
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas geometry: camera + artboard layout + image input helpers
     * ---------------------------------------------------------------------------------------- */
