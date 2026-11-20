    const HANDLES = [
      { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
      { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
      { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
      { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
      { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
      { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
      { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
      { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
    ]

    function textLineHeight(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      if (lineHeight > 4) return String(roundTo(lineHeight, 2)) + 'px'
      return String(roundTo(lineHeight, 2))
    }

    /**
     * Recursive layer renderer. Receives a computed node (see buildComputedTree) so nested
     * frame children paint at their derived positions; frame boxes clip when `clip` is true.
     * Unknown/future types fall through to a neutral transparent box.
     */
    function LayerView(props) {
      const node = props.node
      if (!node || !isObject(node.layer)) return null
      const layer = node.layer
      if (layer.visible === false) return null
      const strings = props.strings
      const handlers = props.handlers
      const style = {
        left: finiteNumber(node.x, 0),
        top: finiteNumber(node.y, 0),
        width: Math.max(0, finiteNumber(node.width, 1)),
        height: Math.max(0, finiteNumber(node.height, 1)),
        opacity: finiteNumber(layer.opacity, 1),
      }
      const radius = Math.max(0, finiteNumber(layer.radius, 0))
      let children = null
      switch (layer.type) {
        case 'rect': {
          style.background = layer.fill || 'transparent'
          style.borderRadius = radius + 'px'
          if (finiteNumber(layer.borderWidth, 0) > 0) {
            style.border =
              finiteNumber(layer.borderWidth, 0) + 'px solid ' + (layer.borderColor || 'transparent')
          }
          break
        }
        case 'ellipse': {
          style.background = layer.fill || 'transparent'
          style.borderRadius = '50%'
          if (finiteNumber(layer.borderWidth, 0) > 0) {
            style.border =
              finiteNumber(layer.borderWidth, 0) + 'px solid ' + (layer.borderColor || 'transparent')
          }
          break
        }
        case 'text': {
          style.color = layer.color || '#111827'
          style.fontSize = Math.max(1, finiteNumber(layer.fontSize, 16)) + 'px'
          style.fontWeight = finiteNumber(layer.fontWeight, 400)
          style.fontFamily = layer.fontFamily || DEFAULT_FONT
          style.textAlign = layer.align || 'left'
          style.lineHeight = textLineHeight(layer)
          const letterSpacing = finiteNumber(layer.letterSpacing, 0)
          if (letterSpacing !== 0) style.letterSpacing = letterSpacing + 'px'
          if (layer.textTransform === 'uppercase' || layer.textTransform === 'lowercase') {
            style.textTransform = layer.textTransform
          }
          if (typeof layer.fill === 'string' && layer.fill) style.background = layer.fill
          children = [String(layer.text || '')]
          break
        }
        case 'image': {
          style.background = '#f3f4f6'
          style.borderRadius = radius + 'px'
          children = [
            h('img', {
              src: layer.src || PLACEHOLDER_IMAGE,
              alt: layer.name || 'image',
              draggable: false,
              style: {
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: layer.fit || 'cover',
                borderRadius: radius + 'px',
                pointerEvents: 'none',
              },
              onError: function (event) {
                const imageNode = event.currentTarget
                if (imageNode && imageNode.src !== PLACEHOLDER_IMAGE) imageNode.src = PLACEHOLDER_IMAGE
              },
            }),
          ]
          break
        }
        case 'frame': {
          style.background = layer.fill || 'transparent'
          style.borderRadius = radius + 'px'
          if (finiteNumber(layer.borderWidth, 0) > 0) {
            style.border =
              finiteNumber(layer.borderWidth, 0) + 'px solid ' + (layer.borderColor || 'transparent')
          }
          style.overflow = layer.clip === true ? 'hidden' : 'visible'
          children = (node.children || []).map(function (child) {
            return h(LayerView, {
              key: String(child.id),
              node: child,
              strings: strings,
              handlers: handlers,
            })
          })
          break
        }
        default: {
          if (finiteNumber(layer.borderWidth, 0) > 0) {
            style.border =
              finiteNumber(layer.borderWidth, 0) + 'px solid ' + (layer.borderColor || 'transparent')
          }
          break
        }
      }
      // `shadow` is an optional CSS box-shadow string on every layer type (absent when unset).
      if (typeof layer.shadow === 'string' && layer.shadow) style.boxShadow = layer.shadow
      return h(
        'div',
        {
          className:
            'dc-layer dc-layer-' +
            String(layer.type) +
            (node.autoParent ? ' dc-layer-auto' : ''),
          'data-layer-id': layer.id,
          'data-parent-id': node.parentId || '',
          style: style,
          title: layer.name || layer.id,
          onPointerDown: function (event) {
            handlers.layerPointerDown(event, node)
          },
          onPointerMove: function (event) {
            handlers.gestureMove(event)
          },
          onPointerUp: function (event) {
            handlers.gestureUp(event)
          },
          onPointerCancel: function (event) {
            handlers.gestureCancel(event)
          },
        },
        children && children.length ? children : null,
      )
    }

    /** Selection outline + 8 handles for a world rect (canvas units relative to the artboard). */
    function SelectionOverlay(props) {
      const rect = isObject(props.rect) ? props.rect : {}
      const zoom = finiteNumber(props.zoom, 1) > 0 ? finiteNumber(props.zoom, 1) : 1
      const handlers = props.handlers
      // The overlay lives in canvas units inside the camera-scaled stage; sizes are
      // divided by the camera zoom so handles and the outline keep a constant
      // on-screen size (and stay usable at 10% just like at 400%).
      const inverse = 1 / zoom
      return h(
        'div',
        {
          className: 'dc-sel-box',
          style: {
            left: finiteNumber(rect.x, 0),
            top: finiteNumber(rect.y, 0),
            width: Math.max(1, finiteNumber(rect.width, 1)),
            height: Math.max(1, finiteNumber(rect.height, 1)),
            borderWidth: 1 * inverse,
          },
        },
        HANDLES.map(function (handle) {
          return h('div', {
            key: handle.id,
            className: 'dc-sel-handle',
            'data-handle': handle.id,
            style: {
              left: handle.fx * 100 + '%',
              top: handle.fy * 100 + '%',
              width: 8 * inverse,
              height: 8 * inverse,
              borderWidth: 1 * inverse,
              cursor: handle.cursor,
              transform: 'translate(-50%, -50%)',
            },
            onPointerDown: function (event) {
              handlers.handlePointerDown(event, handle.id)
            },
            onPointerMove: function (event) {
              handlers.gestureMove(event)
            },
            onPointerUp: function (event) {
              handlers.gestureUp(event)
            },
            onPointerCancel: function (event) {
              handlers.gestureCancel(event)
            },
          })
        }),
      )
    }

    function ArtboardView(props) {
      const artboard = props.artboard
      const entry = props.entry || null
      const zoom = finiteNumber(props.zoom, 1) > 0 ? finiteNumber(props.zoom, 1) : 1
      const strings = props.strings
      const handlers = props.handlers
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const selectedNode = props.selectedNode || null
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const pins = props.pins
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))
      // Everything inside the board frame is canvas units; only overlay chrome
      // (handles, pins) divides by the zoom to stay a constant screen size.
      const inverse = 1 / zoom
      const artboardSelected = !selectedLayerId && selectedArtboardId === artboard.id
      const selectionForThisBoard =
        selectedNode && selectedNode.artboard && selectedNode.artboard.id === artboard.id
          ? selectedNode.worldRect
          : null

      const children = [
        h(
          'div',
          { className: 'dc-board-label', key: 'label' },
          h('span', { className: 'dc-board-name' }, artboard.name || artboard.id),
          h(
            'span',
            { className: 'dc-board-size' },
            Math.round(width) + ' × ' + Math.round(height),
          ),
        ),
        h(
          'div',
          {
            className: 'dc-board-frame' + (artboardSelected ? ' dc-board-frame-selected' : ''),
            key: 'frame',
            style: { width: width, height: height, background: artboard.background || '#ffffff' },
            onPointerDown: function (event) {
              handlers.artboardPointerDown(event, artboard.id)
            },
          },
          h(
            'div',
            {
              className: 'dc-board-inner',
              style: {
                width: width,
                height: height,
              },
            },
            nodes.map(function (node) {
              return h(LayerView, {
                key: String(node.id),
                node: node,
                strings: strings,
                handlers: handlers,
              })
            }),
          ),
          selectionForThisBoard
            ? h(SelectionOverlay, {
                key: 'selection',
                rect: selectionForThisBoard,
                zoom: zoom,
                handlers: handlers,
              })
            : null,
          pins && pins.length
            ? pins.map(function (pin) {
                const pinNode = pin.node
                const rect = pinNode && pinNode.worldRect ? pinNode.worldRect : null
                if (!rect) return null
                const left = Math.max(2 * inverse, rect.x + rect.width - 9 * inverse)
                const top = Math.max(2 * inverse, rect.y - 9 * inverse)
                return h(
                  'button',
                  {
                    key: 'pin-' + String(pinNode.id),
                    type: 'button',
                    className: 'dc-pin',
                    style: {
                      left: left,
                      top: top,
                      width: 18 * inverse,
                      height: 18 * inverse,
                      minWidth: 18 * inverse,
                      padding: '0 ' + 4 * inverse + 'px',
                      borderRadius: 9 * inverse,
                      borderWidth: 1 * inverse,
                      fontSize: 10 * inverse,
                      lineHeight: 1,
                    },
                    title: strings.pinTitle,
                    'aria-label': strings.pinTitle,
                    onClick: function (event) {
                      event.stopPropagation()
                      handlers.pinClick(pinNode.layer.id, artboard.id)
                    },
                  },
                  String(pin.count),
                )
              })
            : null,
        ),
      ]

      // The inline comment composer is rendered by CanvasRoot in viewport space so
      // it never scales unreadably with the camera (see composerPlacement there).

      return h(
        'section',
        {
          className: 'dc-board-wrap',
          'data-artboard-id': artboard.id,
          style: { left: entry ? entry.x : 0, top: entry ? entry.y : 0, width: width },
        },
        children,
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Error boundary: render a panel instead of blanking the slot
     * ---------------------------------------------------------------------------------------- */

