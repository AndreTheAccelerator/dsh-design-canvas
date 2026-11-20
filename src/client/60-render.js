    /* ------------------------------------------------------------------------------------------
     * Vector-crisp camera
     *
     * The canvas used to scale the whole stage with `transform: translate(x,y) scale(zoom)`.
     * Text, borders, radii and shadows were then rasterized ONCE at 100 % and stretched whenever
     * the zoom changed, which is exactly why glyphs go blurry at 200-400 %. Measured on the same
     * text band (mean |laplacian|, higher = crisper): 8.15 with the transform vs 27.37 with CSS
     * `zoom`, and the transform variant visibly softens as soon as the zoom changes after the
     * first paint (the stale composited raster, kept alive by `will-change: transform`).
     *
     * The stage therefore carries CSS `zoom` instead: layout happens at the final on-screen size,
     * so glyphs, borders, radii, shadows and SVG are rasterized at their final size at every zoom
     * step. Chromium is the target (the Host UI is Electron) and supports `zoom`, including SVG
     * and pointer hit-testing inside it. A side benefit: text is laid out at the zoomed size, so
     * line breaking and glyph advances match what an HTML export of the same document produces.
     *
     * `zoom` multiplies the element's own `left`/`top` as well, so the camera translation is
     * divided by the zoom here — the stage lands on exactly the pixel the v1 transform put it on.
     * That keeps `screenToCanvas`, `canvasViewport`, drag/resize and wheel-zoom-about-cursor
     * working unchanged (they only ever measure/transform through `.dc-canvas`, which is outside
     * the zoomed element, and they divide client deltas by `camera.zoom` already).
     *
     * Because the stage is no longer transformed, overlay chrome (selection outline, handles,
     * pins, marquee, measure badge, lock badge) keeps a constant *screen* size by dividing its px
     * values by the zoom — the same `inverse = 1 / zoom` math v1 used.
     *
     * `stageCameraStyle(camera)` is the one contract the shell needs (74-shell.js):
     *   style: Object.assign(stageCameraStyle(camera), { width: …, height: … })
     * Never ALSO put `transform` or `left`/`top`/`zoom` on `.dc-stage`: they would multiply.
     * ---------------------------------------------------------------------------------------- */

    const STAGE_MIN_ZOOM = 0.02
    const STAGE_MAX_ZOOM = 64

    /** Inline style for `.dc-stage`: camera translation + crisp `zoom` scale. */
    function stageCameraStyle(camera) {
      const cam = isObject(camera) ? camera : {}
      const rawZoom = finiteNumber(cam.zoom, 1)
      const zoom = clamp(rawZoom > 0 ? rawZoom : 1, STAGE_MIN_ZOOM, STAGE_MAX_ZOOM)
      return {
        left: finiteNumber(cam.x, 0) / zoom,
        top: finiteNumber(cam.y, 0) / zoom,
        zoom: String(zoom),
        transform: 'none',
      }
    }

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

    /* Overlay chrome sizes in *screen* pixels; every one of them is divided by the camera zoom
     * at render time so handles stay 8px and outlines stay 1px from 10 % to 400 %. */
    const SELECTION_BORDER_SCREEN = 1
    const SELECTION_HANDLE_SCREEN = 8
    const PIN_SCREEN = 18
    const LOCK_BADGE_SCREEN = 14
    const MEASURE_BADGE_HEIGHT_SCREEN = 18
    const MEASURE_BADGE_FONT_SCREEN = 11

    /** Camera zoom for overlay chrome: always a usable positive number. */
    function overlayZoom(value) {
      const zoom = finiteNumber(value, 1)
      return zoom > 0 ? zoom : 1
    }

    function textLineHeight(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      if (lineHeight > 4) return String(roundTo(lineHeight, 2)) + 'px'
      return String(roundTo(lineHeight, 2))
    }

    /**
     * True when `target` belongs to the element's own surface rather than to a nested layer.
     * Used so a group (which paints no background of its own) only reacts to clicks on its own
     * empty area — a child layer always wins the click, and a child's nested chrome (an <img>,
     * an <svg>) is still that child's surface.
     */
    function isLayerSurfaceTarget(target, element) {
      if (!target || !element) return false
      if (target === element) return true
      try {
        if (typeof target.closest === 'function') return target.closest('[data-layer-id]') === element
      } catch (error) {
        /* closest can throw on exotic nodes; fall through to "not mine" */
      }
      return false
    }

    /**
     * A `line` layer: a crisp vector stroke inside the layer box, drawn with inline SVG so it
     * stays sharp at every zoom (SVG is rasterized after the final scale). Deliberately NOT
     * `vector-effect="non-scaling-stroke"`: a stroke is authored in canvas px and must scale with
     * the canvas exactly like a border does. Arrow heads are proportional to `strokeWidth` and
     * may extend past the box, so the layer renders with `overflow: visible`.
     */
    function LineGlyph(props) {
      const geometry = props.geometry
      const strokeProps = {
        stroke: geometry.stroke,
        strokeWidth: geometry.strokeWidth,
        strokeLinecap: 'butt',
        strokeLinejoin: 'miter',
        fill: 'none',
      }
      if (geometry.dashed) {
        strokeProps.strokeDasharray =
          roundTo(LINE_DASH_ON_RATIO * geometry.strokeWidth, 2) +
          ' ' +
          roundTo(LINE_DASH_OFF_RATIO * geometry.strokeWidth, 2)
      }
      const shapes = [
        h('line', {
          key: 'stroke',
          x1: geometry.x1,
          y1: geometry.y1,
          x2: geometry.x2,
          y2: geometry.y2,
          ...strokeProps,
        }),
      ]
      if (geometry.arrowStart) {
        const points = lineArrowPoints(geometry, false)
        if (points) {
          shapes.push(h('polygon', { key: 'arrow-start', points: points, fill: geometry.stroke }))
        }
      }
      if (geometry.arrowEnd) {
        const points = lineArrowPoints(geometry, true)
        if (points) {
          shapes.push(h('polygon', { key: 'arrow-end', points: points, fill: geometry.stroke }))
        }
      }
      return h(
        'svg',
        {
          width: geometry.width,
          height: geometry.height,
          viewBox: '0 0 ' + geometry.width + ' ' + geometry.height,
          'aria-hidden': 'true',
          focusable: 'false',
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            display: 'block',
            overflow: 'visible',
            pointerEvents: 'none',
          },
        },
        shapes,
      )
    }

    /** Small lock affordance drawn at constant screen size for a selected locked layer. */
    function LockGlyph(props) {
      const size = Math.max(8, finiteNumber(props.size, LOCK_BADGE_SCREEN))
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', pointerEvents: 'none' },
        },
        [
          h('rect', { key: 'body', x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.6 }),
          h('path', { key: 'shackle', d: 'M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7' }),
        ],
      )
    }

    /**
     * Recursive layer renderer. Receives a computed node (see buildComputedTree) so nested
     * frame/group children paint at their derived positions; frame boxes clip when `clip` is
     * true, groups clip only when `clip` is true.
     *
     * Geometry is authored canvas px — the camera zoom is applied by the stage's CSS `zoom`, so
     * a layer never multiplies its own lengths (that is what keeps text crisp) and `locked`
     * layers only advertise their state; the interaction layer decides what to refuse.
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
              key: 'image',
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
        case 'line': {
          // The box itself paints nothing; the SVG carries the whole stroke and may overflow it
          // (arrow heads at either end).
          style.background = 'transparent'
          style.overflow = 'visible'
          children = [
            h(LineGlyph, {
              key: 'line-glyph',
              geometry: lineLayerGeometry(layer, node.width, node.height),
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
        case 'group': {
          // A group is a pure transform/selection unit: no fill, border or radius, children stay
          // absolutely positioned at their authored x/y relative to the group box.
          style.background = 'transparent'
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

      const locked = layer.locked === true
      const attributes = {
        className:
          'dc-layer dc-layer-' +
          String(layer.type) +
          (node.autoParent ? ' dc-layer-auto' : '') +
          (locked ? ' dc-locked' : ''),
        'data-layer-id': layer.id,
        'data-parent-id': node.parentId || '',
        style: style,
        title: layer.name || layer.id,
        onPointerDown: function (event) {
          // A group paints no background: only its own empty area selects it, so a child layer
          // (or the child's own chrome) keeps the click.
          if (layer.type === 'group' && !isLayerSurfaceTarget(event.target, event.currentTarget)) {
            return
          }
          if (handlers && typeof handlers.layerPointerDown === 'function') {
            handlers.layerPointerDown(event, node)
          }
        },
        onPointerMove: function (event) {
          if (handlers && typeof handlers.gestureMove === 'function') handlers.gestureMove(event)
        },
        onPointerUp: function (event) {
          if (handlers && typeof handlers.gestureUp === 'function') handlers.gestureUp(event)
        },
        onPointerCancel: function (event) {
          if (handlers && typeof handlers.gestureCancel === 'function') handlers.gestureCancel(event)
        },
      }
      // `locked` is exposed for the interaction layer (pointer handler) and for CSS hooks; the
      // event is deliberately NOT swallowed here.
      if (locked) attributes['data-locked'] = 'true'
      return h('div', attributes, children && children.length ? children : null)
    }

    /**
     * Selection outline for one world rect (canvas units relative to the artboard).
     * `showHandles` draws the 8 resize handles — the primary selection gets them, secondary
     * members of a multi-selection get the outline only. Everything is divided by the camera
     * zoom so the chrome keeps a constant on-screen size.
     */
    function SelectionOverlay(props) {
      const rect = isObject(props.rect) ? props.rect : {}
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      const handlers = props.handlers
      const showHandles = props.showHandles !== false
      const outlineStyle = {
        left: finiteNumber(rect.x, 0),
        top: finiteNumber(rect.y, 0),
        width: Math.max(1, finiteNumber(rect.width, 1)),
        height: Math.max(1, finiteNumber(rect.height, 1)),
        borderWidth: SELECTION_BORDER_SCREEN * inverse,
      }
      if (!showHandles) outlineStyle.borderStyle = 'dashed'
      return h(
        'div',
        {
          className: 'dc-sel-box' + (showHandles ? '' : ' dc-sel-box-secondary'),
          'data-primary': showHandles ? 'true' : 'false',
          style: outlineStyle,
        },
        showHandles
          ? HANDLES.map(function (handle) {
              return h('div', {
                key: handle.id,
                className: 'dc-sel-handle',
                'data-handle': handle.id,
                style: {
                  left: handle.fx * 100 + '%',
                  top: handle.fy * 100 + '%',
                  width: SELECTION_HANDLE_SCREEN * inverse,
                  height: SELECTION_HANDLE_SCREEN * inverse,
                  borderWidth: SELECTION_BORDER_SCREEN * inverse,
                  cursor: handle.cursor,
                  transform: 'translate(-50%, -50%)',
                },
                onPointerDown: function (event) {
                  if (handlers && typeof handlers.handlePointerDown === 'function') {
                    handlers.handlePointerDown(event, handle.id)
                  }
                },
                onPointerMove: function (event) {
                  if (handlers && typeof handlers.gestureMove === 'function') handlers.gestureMove(event)
                },
                onPointerUp: function (event) {
                  if (handlers && typeof handlers.gestureUp === 'function') handlers.gestureUp(event)
                },
                onPointerCancel: function (event) {
                  if (handlers && typeof handlers.gestureCancel === 'function') {
                    handlers.gestureCancel(event)
                  }
                },
              })
            })
          : null,
      )
    }

    /** Normalize a possibly negative drag rect (marquee, draft measure) into x/y/w/h. */
    function normalizeOverlayRect(value) {
      const rect = isObject(value) ? value : {}
      const x = finiteNumber(rect.x, 0)
      const y = finiteNumber(rect.y, 0)
      const width = finiteNumber(rect.width, 0)
      const height = finiteNumber(rect.height, 0)
      return {
        x: width < 0 ? x + width : x,
        y: height < 0 ? y + height : y,
        width: Math.abs(width),
        height: Math.abs(height),
      }
    }

    /**
     * Marquee (rubber-band) overlay for a drag-selection.
     *
     *   MarqueeOverlay({ rect, zoom })
     *     rect  { x, y, width, height } in canvas units relative to the artboard origin
     *           (negative width/height are normalized, so a drag in any direction works)
     *     zoom  camera zoom (px per canvas unit) — chrome stays 1px on screen at every zoom
     * Rendered by the interaction layer inside the same coordinate space as the layers.
     */
    function MarqueeOverlay(props) {
      const rect = normalizeOverlayRect(props.rect)
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      if (rect.width <= 0 || rect.height <= 0) return null
      return h('div', {
        className: 'dc-marquee',
        'data-marquee': 'true',
        style: {
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          border: SELECTION_BORDER_SCREEN * inverse + 'px solid var(--dsw-alias-brand-primary)',
          background: 'rgba(37, 99, 235, 0.08)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: 24,
        },
      })
    }

    /**
     * Live size readout shown while dragging/resizing, at a constant screen size.
     *
     *   MeasureBadge({ rect, zoom, label?, placement? })
     *     rect      { x, y, width, height } in canvas units (negative sizes normalized)
     *     zoom      camera zoom
     *     label     optional text; defaults to `W × H` of the rect (rounded canvas px)
     *     placement 'above' (default) or 'below' the rect
     */
    function MeasureBadge(props) {
      const rect = normalizeOverlayRect(props.rect)
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      const label =
        typeof props.label === 'string' && props.label
          ? props.label
          : Math.round(rect.width) + ' × ' + Math.round(rect.height)
      const height = MEASURE_BADGE_HEIGHT_SCREEN * inverse
      const below = props.placement === 'below'
      return h(
        'div',
        {
          className: 'dc-measure',
          'data-measure': 'true',
          style: {
            position: 'absolute',
            left: rect.x,
            top: below ? rect.y + rect.height + 6 * inverse : rect.y - height - 6 * inverse,
            height: height,
            padding: '0 ' + 6 * inverse + 'px',
            borderRadius: 4 * inverse,
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#f8fafc',
            fontSize: MEASURE_BADGE_FONT_SCREEN * inverse,
            lineHeight: height + 'px',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 26,
          },
        },
        label,
      )
    }

    function ArtboardView(props) {
      const artboard = props.artboard
      const entry = props.entry || null
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      const strings = props.strings
      const handlers = props.handlers
      const selectedLayerId = typeof props.selectedLayerId === 'string' ? props.selectedLayerId : null
      const selectedArtboardId = props.selectedArtboardId
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const pins = props.pins
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))

      // Multi-selection: the interaction layer passes `selectedNodes` (an array of computed
      // nodes); v1 callers only passed `selectedNode`. Both work. The primary entry — the node
      // matching `primaryLayerId`, else the last one — owns the 8 resize handles.
      let selectedNodes = []
      if (Array.isArray(props.selectedNodes)) {
        for (let index = 0; index < props.selectedNodes.length; index += 1) {
          if (props.selectedNodes[index]) selectedNodes.push(props.selectedNodes[index])
        }
      } else if (props.selectedNode) {
        selectedNodes = [props.selectedNode]
      }
      const primaryLayerId =
        typeof props.primaryLayerId === 'string' ? props.primaryLayerId : selectedLayerId
      const selectionHere = []
      for (let index = 0; index < selectedNodes.length; index += 1) {
        const candidate = selectedNodes[index]
        if (candidate && candidate.artboard && candidate.artboard.id === artboard.id) {
          selectionHere.push(candidate)
        }
      }
      let primaryNode = null
      if (selectionHere.length > 0) {
        primaryNode = selectionHere[selectionHere.length - 1]
        if (primaryLayerId) {
          for (let index = 0; index < selectionHere.length; index += 1) {
            if (selectionHere[index].id === primaryLayerId) {
              primaryNode = selectionHere[index]
              break
            }
          }
        }
      }

      const artboardSelected = selectionHere.length === 0 && selectedArtboardId === artboard.id

      const children = [
        h(
          'div',
          {
            className: 'dc-board-label',
            key: 'label',
            // The label lives inside the camera-zoomed stage. Counter-scale it so it stays a
            // constant, readable screen size at every zoom level (anchored bottom-left, just
            // above the board) instead of shrinking to a few blurry pixels at fit zoom.
            style: {
              transform: 'scale(' + (1 / zoom) + ')',
              transformOrigin: 'left bottom',
            },
          },
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
            // Diagnostic/agent hook: how many of this artboard's layers the renderer sees as
            // selected (the overlays drawn below), and which one owns the resize handles.
            'data-selected-count': selectionHere.length,
            'data-primary-layer-id': primaryNode ? primaryNode.id : '',
            style: { width: width, height: height, background: artboard.background || '#ffffff' },
            onPointerDown: function (event) {
              if (handlers && typeof handlers.artboardPointerDown === 'function') {
                handlers.artboardPointerDown(event, artboard.id)
              }
            },
          },
          h(
            'div',
            {
              className: 'dc-board-inner',
              'data-artboard-inner': artboard.id,
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
          // One outline per selected layer on this artboard; only the primary gets handles.
          selectionHere.map(function (node) {
            return h(SelectionOverlay, {
              key: 'selection-' + String(node.id),
              rect: node.worldRect,
              zoom: zoom,
              handlers: handlers,
              showHandles: node === primaryNode,
            })
          }),
          primaryNode && primaryNode.locked
            ? h(
                'div',
                {
                  key: 'lock-badge',
                  className: 'dc-lock-badge',
                  'data-lock-badge': 'true',
                  title: strings.lockedHint || 'Locked',
                  style: {
                    position: 'absolute',
                    left:
                      finiteNumber(primaryNode.worldRect.x, 0) +
                      Math.max(0, finiteNumber(primaryNode.worldRect.width, 1)) -
                      LOCK_BADGE_SCREEN * inverse -
                      4 * inverse,
                    top: finiteNumber(primaryNode.worldRect.y, 0) + 4 * inverse,
                    width: LOCK_BADGE_SCREEN * inverse,
                    height: LOCK_BADGE_SCREEN * inverse,
                    padding: 2 * inverse,
                    borderRadius: 4 * inverse,
                    background: 'rgba(15, 23, 42, 0.72)',
                    color: '#ffffff',
                    pointerEvents: 'none',
                    zIndex: 27,
                  },
                },
                h(LockGlyph, { size: (LOCK_BADGE_SCREEN - 4) * inverse }),
              )
            : null,
          // Optional drag-selection chrome driven by the interaction layer.
          props.marquee
            ? h(MarqueeOverlay, { key: 'marquee', rect: props.marquee, zoom: zoom })
            : null,
          props.measure
            ? h(MeasureBadge, {
                key: 'measure',
                rect: props.measure.rect || props.measure,
                zoom: zoom,
                label: props.measure.label,
                placement: props.measure.placement,
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
                      width: PIN_SCREEN * inverse,
                      height: PIN_SCREEN * inverse,
                      minWidth: PIN_SCREEN * inverse,
                      padding: '0 ' + 4 * inverse + 'px',
                      borderRadius: (PIN_SCREEN / 2) * inverse,
                      borderWidth: 1 * inverse,
                      fontSize: 10 * inverse,
                      lineHeight: 1,
                    },
                    title: strings.pinTitle,
                    'aria-label': strings.pinTitle,
                    onClick: function (event) {
                      event.stopPropagation()
                      if (handlers && typeof handlers.pinClick === 'function') {
                        handlers.pinClick(pinNode.layer.id, artboard.id)
                      }
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
