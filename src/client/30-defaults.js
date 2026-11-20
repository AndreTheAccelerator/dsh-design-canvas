    /* ------------------------------------------------------------------------------------------
     * Layer defaults
     * ---------------------------------------------------------------------------------------- */

    const LAYER_TYPE_LABELS = {
      // The value doubles as the Glyph name used by the layer tree and the inspector.
      rect: 'rect',
      ellipse: 'ellipse',
      text: 'text',
      image: 'image',
      frame: 'frame',
      line: 'minus',
      group: 'layers',
    }

    const BUTTON_PRESET = {
      label: 'Button',
      height: 44,
      width: 136,
      fontSize: 15,
      lineHeight: 20,
      fill: '#2563eb',
      color: '#ffffff',
      gap: 8,
      paddingY: 12,
      paddingX: 20,
      radius: 10,
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
      if (type === 'line') {
        // A thin horizontal rule at ~40% height, wide enough to read at fit zoom.
        return {
          x: Math.round((width - 160) / 2),
          y: Math.round(height * 0.4),
          width: 160,
          height: 2,
        }
      }
      if (type === 'group') {
        return {
          x: Math.round((width - 240) / 2),
          y: Math.round((height - 160) / 2),
          width: 240,
          height: 160,
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
                    : type === 'line'
                      ? 'Line'
                      : type === 'group'
                        ? 'Group'
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
      } else if (type === 'line') {
        base.stroke = '#111827'
        base.strokeWidth = 2
        base.orientation = 'horizontal'
      } else if (type === 'frame') {
        base.fill = '#f3f4f6'
        base.radius = 8
        base.borderWidth = 1
        base.borderColor = '#d1d5db'
        base.clip = false
        base.layout = null
        base.children = []
      } else if (type === 'group') {
        // Groups are normally created from a selection (`layer.group`); this only has to be a
        // structurally valid container when a caller asks for one directly.
        base.clip = false
        base.children = []
      }
      return base
    }

    /**
     * The two layers of the button preset: an auto-layout frame (row, gap 8, padding 12/20,
     * radius 10, brand fill) with a centred white label. The editor turns these into two
     * `layer.add` ops (a frame cannot be added with children in one op).
     */
    function createButtonPresetLayers(container) {
      const box = isObject(container) ? container : {}
      const width = Math.max(1, finiteNumber(box.width, 1200))
      const height = Math.max(1, finiteNumber(box.height, 800))
      const preset = BUTTON_PRESET
      const frame = createLayer('frame', box)
      frame.name = preset.label
      frame.width = preset.width
      frame.height = preset.height
      frame.x = Math.round((width - preset.width) / 2)
      frame.y = Math.round((height - preset.height) / 2)
      frame.fill = preset.fill
      frame.radius = preset.radius
      frame.borderWidth = 0
      frame.borderColor = preset.fill
      frame.clip = false
      frame.layout = {
        direction: 'row',
        gap: preset.gap,
        padding: {
          top: preset.paddingY,
          right: preset.paddingX,
          bottom: preset.paddingY,
          left: preset.paddingX,
        },
        align: 'center',
        justify: 'center',
        wrap: false,
      }
      const label = createLayer('text', frame)
      label.name = 'Button label'
      label.text = preset.label
      label.color = preset.color
      label.fontSize = preset.fontSize
      label.fontWeight = 600
      label.fontFamily = DEFAULT_FONT
      label.align = 'center'
      label.lineHeight = preset.lineHeight
      label.width = 56
      label.height = preset.lineHeight
      label.x = 0
      label.y = 0
      return { frame: frame, text: label }
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
     * Frames / layout helpers continue in 28-layout.js; this part owns layer defaults only.
     * ---------------------------------------------------------------------------------------- */
