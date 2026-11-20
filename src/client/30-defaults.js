     * Layer defaults
     * ---------------------------------------------------------------------------------------- */

    const LAYER_TYPE_LABELS = {
      rect: 'rect',
      ellipse: 'ellipse',
      text: 'text',
      image: 'image',
      frame: 'frame',
    }

    function layerTypeLabel(type) {
      return LAYER_TYPE_LABELS[type] || String(type || 'layer')
    }

    function defaultGeometryFor(type, artboard) {
      const width = Math.max(200, finiteNumber(artboard && artboard.width, 1200))
      const height = Math.max(200, finiteNumber(artboard && artboard.height, 800))
      if (type === 'text') {
        return {
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.15),
          width: Math.min(360, Math.round(width * 0.6)),
          height: 48,
        }
      }
      if (type === 'image') {
        return {
          x: Math.round((width - 320) / 2),
          y: Math.round((height - 200) / 2),
          width: 320,
          height: 200,
        }
      }
      if (type === 'ellipse') {
        return {
          x: Math.round((width - 160) / 2),
          y: Math.round((height - 160) / 2),
          width: 160,
          height: 160,
        }
      }
      if (type === 'frame') {
        const frameWidth = Math.min(FRAME_DEFAULT_WIDTH, Math.max(160, Math.round(width * 0.5)))
        const frameHeight = Math.min(FRAME_DEFAULT_HEIGHT, Math.max(120, Math.round(height * 0.5)))
        return {
          x: Math.round((width - frameWidth) / 2),
          y: Math.round((height - frameHeight) / 2),
          width: frameWidth,
          height: frameHeight,
        }
      }
      return {
        x: Math.round((width - 240) / 2),
        y: Math.round((height - 160) / 2),
        width: 240,
        height: 160,
      }
    }

    function createLayer(type, container) {
      const box = isObject(container) ? container : {}
      const geometry = defaultGeometryFor(type, box)
      const siblings = childrenOf(box)
      const sameType = siblings.filter(function (layer) { return layer && layer.type === type }).length
      const base = {
        id: makeId('l'),
        type: type,
        name:
          type === 'rect'
            ? 'Rectangle'
            : type === 'ellipse'
              ? 'Ellipse'
              : type === 'text'
                ? 'Text'
                : type === 'image'
                  ? 'Image'
                  : type === 'frame'
                    ? 'Frame'
                    : 'Layer',
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }
      if (sameType > 0) base.name = base.name + ' ' + (sameType + 1)
      if (type === 'rect') {
        base.fill = '#e5e7eb'
        base.radius = 8
        base.borderWidth = 0
        base.borderColor = '#9ca3af'
      } else if (type === 'ellipse') {
        base.fill = '#dbeafe'
        base.borderWidth = 0
        base.borderColor = '#9ca3af'
      } else if (type === 'text') {
        base.text = 'New text'
        base.color = '#111827'
        base.fontSize = 24
        base.fontWeight = 600
        base.fontFamily = DEFAULT_FONT
        base.align = 'left'
        base.lineHeight = 32
      } else if (type === 'image') {
        base.src = ''
        base.fit = 'cover'
        base.radius = 0
      } else if (type === 'frame') {
        base.fill = '#f3f4f6'
        base.radius = 8
        base.borderWidth = 1
        base.borderColor = '#d1d5db'
        base.clip = false
        base.layout = null
        base.children = []
      }
      return base
    }

    function createArtboard(doc) {
      const existing = artboardsOf(doc)
      const base = existing.find(function (artboard) { return isObject(artboard) })
      return {
        id: makeId('ab'),
        name: 'Artboard ' + (existing.length + 1),
        x: 0,
        y: 0,
        width: finiteNumber(base && base.width, 1200),
        height: finiteNumber(base && base.height, 800),
        background: '#ffffff',
      }
    }

    /* ------------------------------------------------------------------------------------------
