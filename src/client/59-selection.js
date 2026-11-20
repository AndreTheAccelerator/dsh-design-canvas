    /* ------------------------------------------------------------------------------------------
     * Selection tools (multi-select UI)
     *
     * Marquee overlay, measurement readout while dragging, and the selection bar buttons
     * (group / ungroup / align / distribute / arrange) registered through EXTENSIONS.selection.
     * The selection state itself lives in `useEditor` (70-editor.js); these entries read it from
     * the extension context and emit ops through `editor.actions`.
     * ---------------------------------------------------------------------------------------- */

    const SELECTION_CSS = `
.dc-selection-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-width: 0; }
.dc-selgrp { display: inline-flex; align-items: center; gap: 1px; }
.dc-seldiv { width: 1px; height: 14px; margin: 0 3px; background: var(--dsw-alias-border-l1); flex: 0 0 auto; }
.dc-seltool { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; flex: 0 0 auto; }
@media (hover: hover) and (pointer: fine) { .dc-seltool:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); } }
.dc-seltool.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-border-l1); }
.dc-seltool:disabled { opacity: 0.35; cursor: default; }
.dc-seltool:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dc-selcount { flex: 0 0 auto; height: 18px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 600; white-space: nowrap; }
`

    const SELECTION_OVERLAY_CSS = `
.dc-marquee { position: fixed; z-index: 40; pointer-events: none; box-sizing: border-box; border: 1px solid var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); border-radius: 1px; }
.dc-guide { position: fixed; z-index: 39; pointer-events: none; background: var(--dsw-alias-brand-primary); opacity: 0.9; }
.dc-guide-x { width: 1px; }
.dc-guide-y { height: 1px; }
`

    /** Small stroke icons local to the selection bar (40-icons.js is chrome-owned). */
    const SELECTION_ICON_PATHS = {
      'align-left': ['M3 3v10', 'M5 5.5h7', 'M5 10.5h4'],
      'align-center-h': ['M8 2.5v11', 'M4.5 5.5h7', 'M6 10.5h4'],
      'align-right': ['M13 3v10', 'M4 5.5h7', 'M7 10.5h4'],
      'align-top': ['M3 3h10', 'M5.5 5v7', 'M10.5 5v4'],
      'align-center-v': ['M2.5 8h11', 'M5.5 4.5v7', 'M10.5 6v4'],
      'align-bottom': ['M3 13h10', 'M5.5 4v7', 'M10.5 7v4'],
      'distribute-h': ['M3 3v10', 'M13 3v10', 'M8 5.5v5'],
      'distribute-v': ['M3 3h10', 'M3 13h10', 'M5.5 8h5'],
      group: ['M3 3h4v4H3z', 'M9 9h4v4H9z', 'M9 3h4v4H9z', 'M3 9h4v4H3z'],
      ungroup: ['M3 3h4v4H3z', 'M9 9h4v4H9z', 'M10 2.5l3 1', 'M2.5 10l1 3'],
      front: ['M8 2.5l4.5 2.6L8 7.7 3.5 5.1 8 2.5z', 'M3.5 8.5L8 11.1l4.5-2.6'],
      forward: ['M8 3v6', 'M5 6.5L8 9.5l3-3'],
      backward: ['M8 13V7', 'M5 9.5L8 6.5l3 3'],
      back: ['M8 13.5L3.5 10.9 8 8.3l4.5 2.6L8 13.5z', 'M3.5 7.5L8 4.9l4.5 2.6'],
      lock: ['M5 7.5V6a3 3 0 0 1 6 0v1.5', 'M4 7.5h8v6H4z'],
      unlock: ['M5 7.5V6a3 3 0 0 1 5.7-1.2', 'M4 7.5h8v6H4z'],
      'tidy-row': ['M2.5 6.5h3v3h-3z', 'M6.5 6.5h3v3h-3z', 'M10.5 6.5h3v3h-3z'],
      'tidy-column': ['M6.5 2.5h3v3h-3z', 'M6.5 6.5h3v3h-3z', 'M6.5 10.5h3v3h-3z'],
      magnet: ['M4 3v5a4 4 0 0 0 8 0V3', 'M4 3h3', 'M9 3h3'],
    }

    function SelectionGlyph(props) {
      const paths = SELECTION_ICON_PATHS[props.name] || SELECTION_ICON_PATHS.group
      const size = props.size || 13
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        paths.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /** Compact icon button for the selection bar (title + aria-label, constant 20px). */
    function SelectionToolButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-seltool' + (props.active ? ' dc-active' : ''),
          title: props.title,
          'aria-label': props.title,
          disabled: !!props.disabled,
          // Keep keyboard focus in the canvas so shortcuts keep working after a click.
          onPointerDown: function (event) {
            try {
              event.preventDefault()
            } catch (error) {
              /* ignore */
            }
          },
          onClick: function (event) {
            if (typeof props.onClick === 'function') props.onClick(event)
          },
        },
        h(SelectionGlyph, { name: props.icon, size: 13 }),
      )
    }

    function selectionCountLabel(count) {
      if (count === 1) return '1 layer'
      return String(count) + ' layers'
    }

    /**
     * The whole selection bar, rendered by the shell inside `.dc-selection-bar` through
     * EXTENSIONS.selection. Everything is icon+tooltip so it fits a ~440px sidebar.
     */
    function SelectionBarTools(props) {
      const editor = props.editor || {}
      const doc = props.doc || null
      const selection = props.selection || {}
      const layerIds = Array.isArray(selection.layerIds) ? selection.layerIds : []
      const count = layerIds.length
      const actions = props.actions || {}
      const strings = props.strings || {}

      function layerOf(layerId) {
        return doc && layerId ? findLayerById(doc, layerId) : null
      }

      let lockedAll = count > 0
      let groupCount = 0
      for (let index = 0; index < layerIds.length; index += 1) {
        const found = layerOf(layerIds[index])
        if (!found) continue
        if (found.layer.locked !== true) lockedAll = false
        if (found.layer.type === 'group') groupCount += 1
      }

      const alignButtons = [
        { id: 'left', icon: 'align-left', title: 'Align left' },
        { id: 'center-h', icon: 'align-center-h', title: 'Align horizontal centers' },
        { id: 'right', icon: 'align-right', title: 'Align right' },
        { id: 'top', icon: 'align-top', title: 'Align top' },
        { id: 'center-v', icon: 'align-center-v', title: 'Align vertical centers' },
        { id: 'bottom', icon: 'align-bottom', title: 'Align bottom' },
      ]
      const arrangeButtons = [
        { mode: 'front', icon: 'front', title: 'Bring to front (Ctrl/Cmd+Shift+])' },
        { mode: 'forward', icon: 'forward', title: 'Bring forward (Ctrl/Cmd+])' },
        { mode: 'backward', icon: 'backward', title: 'Send backward (Ctrl/Cmd+[)' },
        { mode: 'back', icon: 'back', title: 'Send to back (Ctrl/Cmd+Shift+[)' },
      ]

      const children = [
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: SELECTION_CSS } }),
        h('span', { key: 'count', className: 'dc-selcount', title: strings.layer || 'Selection' }, selectionCountLabel(count)),
        h('span', { key: 'div-count', className: 'dc-seldiv' }),
        h(
          'div',
          { key: 'align', className: 'dc-selgrp' },
          alignButtons.map(function (button) {
            return h(SelectionToolButton, {
              key: button.id,
              icon: button.icon,
              title: button.title,
              disabled: count < 2,
              onClick: function () {
                editor.alignSelection(button.id)
              },
            })
          }),
        ),
        h('span', { key: 'div-align', className: 'dc-seldiv' }),
        h(
          'div',
          { key: 'distribute', className: 'dc-selgrp' },
          h(SelectionToolButton, {
            icon: 'distribute-h',
            title: 'Distribute horizontally (Ctrl/Cmd+Shift+H)',
            disabled: count < 3,
            onClick: function () {
              editor.distributeSelection('x')
            },
          }),
          h(SelectionToolButton, {
            icon: 'distribute-v',
            title: 'Distribute vertically (Ctrl/Cmd+Shift+V)',
            disabled: count < 3,
            onClick: function () {
              editor.distributeSelection('y')
            },
          }),
        ),
        h('span', { key: 'div-distribute', className: 'dc-seldiv' }),
        h(
          'div',
          { key: 'group', className: 'dc-selgrp' },
          h(SelectionToolButton, {
            icon: 'group',
            title: 'Group (Ctrl/Cmd+G)',
            disabled: count < 2,
            onClick: function () {
              editor.groupSelection()
            },
          }),
          h(SelectionToolButton, {
            icon: 'ungroup',
            title: 'Ungroup (Ctrl/Cmd+Shift+G)',
            disabled: groupCount === 0,
            onClick: function () {
              editor.ungroupSelection()
            },
          }),
          h(SelectionToolButton, {
            icon: 'tidy-row',
            title: 'Tidy up as a row',
            disabled: count < 2,
            onClick: function () {
              editor.tidySelection('row')
            },
          }),
          h(SelectionToolButton, {
            icon: 'tidy-column',
            title: 'Tidy up as a column',
            disabled: count < 2,
            onClick: function () {
              editor.tidySelection('column')
            },
          }),
        ),
        h('span', { key: 'div-group', className: 'dc-seldiv' }),
        h(
          'div',
          { key: 'arrange', className: 'dc-selgrp' },
          arrangeButtons.map(function (button) {
            return h(SelectionToolButton, {
              key: button.mode,
              icon: button.icon,
              title: button.title,
              disabled: count === 0,
              onClick: function () {
                editor.arrangeSelection(button.mode)
              },
            })
          }),
        ),
        h('span', { key: 'div-arrange', className: 'dc-seldiv' }),
        h(
          'div',
          { key: 'lock', className: 'dc-selgrp' },
          h(SelectionToolButton, {
            icon: lockedAll ? 'lock' : 'unlock',
            title: lockedAll ? 'Unlock selection' : 'Lock selection',
            active: lockedAll,
            disabled: count === 0,
            onClick: function () {
              editor.toggleLock()
            },
          }),
          h(SelectionToolButton, {
            icon: 'magnet',
            title: editor.snapEnabled === false ? 'Snapping is off — click to enable' : 'Snapping is on — click to disable (hold Alt while dragging)',
            active: editor.snapEnabled !== false,
            onClick: function () {
              editor.toggleSnap()
            },
          }),
        ),
      ]
      return h('div', { className: 'dc-selection-tools' }, children)
    }

    registerSelectionTool({
      id: 'selection-bar',
      render: function (ctx) {
        if (!ctx || !ctx.selection || !Array.isArray(ctx.selection.layerIds)) return null
        // Layer tools only make sense with a layer selection; an artboard-only selection renders
        // nothing here (the shell's own bar handles that state).
        if (!ctx.selection.layerIds.length) return null
        return h(SelectionBarTools, ctx)
      },
    })

    /**
     * Marquee + snap-guide overlay. The canvas is renderer-owned, so this draws through the
     * full-app registry as `position: fixed` elements placed from the camera projection: the
     * renderer only needs the state (`marquee`, `snapGuides`) if it prefers to draw them itself.
     */
    function SelectionOverlayLayer(props) {
      const editor = props.editor || {}
      const marquee = editor.marquee || null
      const guides = Array.isArray(editor.snapGuides) ? editor.snapGuides : []
      if (!marquee && guides.length === 0) return null
      const canvas = editor.canvasRef ? editor.canvasRef.current : null
      if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null
      const artboardId = marquee ? marquee.artboardId : editor.snapGuidesArtboardId
      const layout = editor.layout
      const entry = layout && layout.entryById && artboardId ? layout.entryById.get(artboardId) : null
      if (!entry) return null
      let bounds = null
      try {
        bounds = canvas.getBoundingClientRect()
      } catch (error) {
        bounds = null
      }
      if (!bounds) return null
      const cam = editor.camera && typeof editor.camera.zoom === 'number' ? editor.camera : { zoom: 1 }
      const zoom = cam.zoom > 0 ? cam.zoom : 1
      const originX = bounds.left + (typeof cam.x === 'number' ? cam.x : 0) + entry.frameX * zoom
      const originY = bounds.top + (typeof cam.y === 'number' ? cam.y : 0) + entry.frameY * zoom
      const children = []
      if (marquee) {
        children.push(
          h('div', {
            key: 'marquee',
            className: 'dc-marquee',
            'aria-hidden': 'true',
            style: {
              position: 'fixed',
              left: Math.round(originX + finiteNumber(marquee.x, 0) * zoom),
              top: Math.round(originY + finiteNumber(marquee.y, 0) * zoom),
              width: Math.max(1, Math.round(finiteNumber(marquee.width, 1) * zoom)),
              height: Math.max(1, Math.round(finiteNumber(marquee.height, 1) * zoom)),
            },
          }),
        )
      }
      for (let index = 0; index < guides.length; index += 1) {
        const guide = guides[index]
        if (!guide || !Number.isFinite(guide.at)) continue
        if (guide.axis === 'x') {
          children.push(
            h('div', {
              key: 'guide-x-' + index,
              className: 'dc-guide dc-guide-x',
              'aria-hidden': 'true',
              style: {
                position: 'fixed',
                left: Math.round(originX + guide.at * zoom),
                top: Math.round(bounds.top),
                height: Math.max(1, Math.round(bounds.height)),
              },
            }),
          )
        } else {
          children.push(
            h('div', {
              key: 'guide-y-' + index,
              className: 'dc-guide dc-guide-y',
              'aria-hidden': 'true',
              style: {
                position: 'fixed',
                top: Math.round(originY + guide.at * zoom),
                left: Math.round(bounds.left),
                width: Math.max(1, Math.round(bounds.width)),
              },
            }),
          )
        }
      }
      if (children.length === 0) return null
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: SELECTION_OVERLAY_CSS } }),
        children,
      )
    }

    registerAppPanel({
      id: 'selection-overlay',
      render: function (ctx) {
        return h(SelectionOverlayLayer, ctx)
      },
    })

    /* ------------------------------------------------------------------------------------------
     * Selection shortcuts (registered here instead of growing the built-in key switch)
     * ---------------------------------------------------------------------------------------- */

    const ALIGN_SHORTCUTS = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'top',
      ArrowDown: 'bottom',
    }

    registerKeyHandler({
      id: 'selection-align-keys',
      match: function (event) {
        if (!event || event.altKey) return false
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false
        return !!(typeof event.key === 'string' && ALIGN_SHORTCUTS[event.key])
      },
      run: function (event, api) {
        if (!api || !api.selection || !Array.isArray(api.selection.layerIds)) return false
        if (api.selection.layerIds.length < 2) return false
        if (typeof api.alignSelection !== 'function') return false
        api.alignSelection(ALIGN_SHORTCUTS[event.key])
        return true
      },
    })

    registerKeyHandler({
      id: 'selection-distribute-keys',
      match: function (event) {
        if (!event || event.altKey) return false
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false
        const key = String(event.key || '').toLowerCase()
        return key === 'h' || key === 'v'
      },
      run: function (event, api) {
        if (!api || !api.selection || !Array.isArray(api.selection.layerIds)) return false
        if (api.selection.layerIds.length < 3) return false
        if (typeof api.distributeSelection !== 'function') return false
        api.distributeSelection(String(event.key || '').toLowerCase() === 'h' ? 'x' : 'y')
        return true
      },
    })
