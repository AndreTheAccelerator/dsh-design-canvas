    /* ------------------------------------------------------------------------------------------
     * Context menu (right-click)
     *
     * One menu for everything on the canvas: layers, artboards and the empty canvas. Items follow
     * Figma's object menu (see the header of the menu builder for the list), grouped with
     * separators and showing their keyboard shortcut on the right.
     *
     * Self-contained: it attaches one `contextmenu` listener on the app root, resolves the target
     * from the DOM (`[data-layer-id]`, `[data-artboard-id]`, `.dc-canvas`) and renders through
     * EXTENSIONS.appPanels, so no other part needs a mount point.
     *
     * This part owns no document state: every action funnels into the editor API
     * (`ctx.editor`) and, when the editor does not expose a capability yet, the item is rendered
     * DISABLED with the reason in its `title` instead of silently disappearing.
     * ---------------------------------------------------------------------------------------- */

    /* ------------------------------------------------------------------------------------------
     * Copy + styles (feature copy; localized in the docs pass)
     * ---------------------------------------------------------------------------------------- */

    const CONTEXT_MENU_COPY = {
      menuLabel: 'Canvas menu',
      layerMenu: 'Object menu',
      artboardMenu: 'Artboard menu',
      canvasMenu: 'Canvas menu',
      canvas: 'Canvas',
      layer: 'Layer',
      layers: 'layers',
      selected: 'selected',
      renameUnavailable: 'Rename from the Layers panel',
      copyUnavailable: 'Selection copy is not available in this build — use Export selection…',
      exportUnavailable: 'Export is provided by the export extension',
      shortcutsUnavailable: 'Keyboard shortcuts are provided by the shortcuts extension',
      commentModeHint: 'Comment mode: click an element to add a comment',
      frameName: 'Frame',
      frameEmpty: 'Select layers to frame',
      framed: 'Framed the selection',
      artboardDuplicated: 'Artboard duplicated',
      copiedPng: 'Copied the selection as PNG',
      copiedSvg: 'Copied the selection as SVG',
      copiedArtboardPng: 'Copied the artboard as PNG',
      copiedArtboardSvg: 'Copied the artboard as SVG',
      copyFailed: 'Could not copy to the clipboard',
      actionFailed: 'That action failed',
      fitUnavailable: 'Fit to artboard needs the canvas layout',
      noArtboards: 'Add an artboard first',
      enterSelection: 'Enter selection',
      enterGroup: 'Enter group',
      enterDisabled: 'Only frames and groups with children can be entered',
    }

    const CONTEXT_MENU_CSS = `
.dc-ctxmenu { position: fixed; z-index: 80; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; min-width: min(200px, calc(100cqw - 12px)); max-width: min(280px, calc(100cqw - 12px)); padding: 4px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 6px rgba(15, 23, 42, 0.08); font-size: 12px; }
.dc-ctxmenu:focus { outline: none; }
.dc-ctxmenu:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: 2px; }
.dcm-head { flex: 0 0 auto; max-width: 100%; padding: 3px 8px 5px; margin-bottom: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-ctxmenu .dc-menu-item { flex: 0 0 auto; }
.dc-ctxmenu .dc-menu-sep { flex: 0 0 auto; }
.dc-ctxmenu .dc-menu-item[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.dc-ctxmenu .dc-menu-item[aria-disabled="true"]:hover { background: transparent; }
.dc-ctxmenu .dc-menu-item.dcm-active:not([aria-disabled="true"]) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
@media (prefers-reduced-motion: no-preference) {
  .dc-ctxmenu { animation: dcm-in 90ms ease-out; }
  @keyframes dcm-in { from { opacity: 0.55; } to { opacity: 1; } }
}
`

    /**
     * Latest extension context seen by the menu component. Menu rows are built when the menu
     * opens, but actions must run against the CURRENT editor context (the right-click applies a
     * selection first, and the shell re-renders with a fresh context object), so run-time helpers
     * read it from here instead of a captured open-time copy.
     */
    const CONTEXT_MENU_STATE = { liveCtx: null }

    function contextMenuLiveCtx(fallback) {
      return CONTEXT_MENU_STATE.liveCtx || fallback || null
    }

    /**
     * Glyphs the shared set does not have. Kept here on purpose: `40-icons.js` is another part's
     * file, so extra menu-only icons live in this file as inline paths on the same 16x16 grid.
     */
    const CONTEXT_MENU_ICON_PATHS = {
      scissors: ['M4.5 3.5l7 7', 'M11.5 3.5l-7 7', 'M3.5 11a1.8 1.8 0 1 0 0 .01', 'M12.5 11a1.8 1.8 0 1 0 0 .01'],
      clipboard: ['M5.5 3.5h5v-1h-5z', 'M4.5 3.5h-1v10h9v-10h-1', 'M6 7h4', 'M6 9.5h4'],
      pencil: ['M3 13l.8-2.9 7-7 2.1 2.1-7 7z', 'M9.9 4.1l2.1 2.1'],
      ungroup: ['M2.5 5.5V2.5h3', 'M13.5 10.5v3h-3', 'M7 7h2v2H7z'],
      front: ['M5 12.5V6.5', 'M5 12.5h6', 'M8 2.5l4 4', 'M8 2.5l-4 4'],
      back: ['M5 12.5V6.5', 'M5 12.5h6', 'M8 2.5l4 4', 'M8 2.5l-4 4'],
      selectAll: ['M2.5 5V2.5H5', 'M11 2.5h2.5V5', 'M13.5 11v2.5H11', 'M5 13.5H2.5V11', 'M5.5 5.5h5v5h-5z'],
      commentPlus: ['M2.5 3.5h11v7.5h-6l-3.5 2.5v-2.5h-1.5z', 'M8 5.8v3', 'M6.5 7.3h3'],
    }

    /** Render one menu glyph: the shared `Glyph` when the name exists, else a local inline SVG. */
    function ContextMenuGlyph(props) {
      const name = props && typeof props.name === 'string' ? props.name : ''
      const size = (props && props.size) || 14
      const extra = Object.prototype.hasOwnProperty.call(CONTEXT_MENU_ICON_PATHS, name)
        ? CONTEXT_MENU_ICON_PATHS[name]
        : null
      if (!extra && typeof Glyph === 'function') return h(Glyph, { name: name, size: size })
      const paths = extra || CONTEXT_MENU_ICON_PATHS.front
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { flex: '0 0 auto', display: 'block' },
        },
        paths.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Item model: declarative rows, so groups/separators/shortcuts/icons stay data
     * ---------------------------------------------------------------------------------------- */

    /** One actionable row: { id, label, shortcut?, icon?, disabled?, danger?, checked?, reason?, title?, run }. */
    function contextMenuItem(id, label, options) {
      const extra = isObject(options) ? options : {}
      return {
        id: String(id || ''),
        label: String(label || ''),
        shortcut: typeof extra.shortcut === 'string' ? extra.shortcut : '',
        icon: typeof extra.icon === 'string' ? extra.icon : '',
        disabled: extra.disabled === true,
        danger: extra.danger === true,
        checked: extra.checked === true,
        reason: typeof extra.reason === 'string' ? extra.reason : '',
        title: typeof extra.title === 'string' ? extra.title : '',
        run: typeof extra.run === 'function' ? extra.run : null,
      }
    }

    /** A separator row (never focusable, never hoverable). */
    function contextMenuSeparator(id) {
      return { id: String(id || ''), separator: true }
    }

    function contextMenuItemDomId(item, index) {
      const key = item && item.id ? String(item.id) : 'row'
      return 'dcm-item-' + key.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + String(index)
    }

    function contextMenuFirstEnabledIndex(items) {
      const list = Array.isArray(items) ? items : []
      for (let index = 0; index < list.length; index += 1) {
        const item = list[index]
        if (item && !item.separator && !item.disabled) return index
      }
      return -1
    }

    /* ------------------------------------------------------------------------------------------
     * DOM plumbing: app root, target resolution, focus helpers
     * ---------------------------------------------------------------------------------------- */

    function contextMenuAppNode(ctx) {
      const editor = ctx && ctx.editor ? ctx.editor : null
      const ref = editor && editor.appRef ? editor.appRef : null
      const node = ref && ref.current ? ref.current : null
      if (node && typeof node.getBoundingClientRect === 'function') return node
      if (typeof document !== 'undefined' && document.querySelector) {
        return document.querySelector('.dc-app')
      }
      return null
    }

    function contextMenuIsEditableTarget(node) {
      if (!node) return false
      const tag = String(node.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (node.isContentEditable === true) return true
      if (typeof node.closest === 'function') {
        return !!node.closest('input, textarea, select, [contenteditable="true"]')
      }
      return false
    }

    /**
     * Resolve the right-clicked element to a menu target:
     *   layer (`[data-layer-id]`) -> artboard (`[data-artboard-id]` / `.dc-board-frame`) -> canvas.
     * Layer ids are normalised to the editor's selection unit (a child of a group resolves to the
     * group unless the user drilled in), so the menu always acts on what a click would select.
     */
    function contextMenuResolveTarget(node, appNode, ctx) {
      if (!node || typeof node.closest !== 'function') return null
      if (appNode && typeof appNode.contains === 'function' && !appNode.contains(node)) return null
      const editor = ctx && ctx.editor ? ctx.editor : null
      const layerElement = node.closest('[data-layer-id]')
      if (layerElement) {
        const rawId = String(layerElement.getAttribute('data-layer-id') || '')
        if (!rawId) return null
        let layerId = rawId
        if (editor && typeof editor.nodeForLayer === 'function') {
          const layerNode = editor.nodeForLayer(rawId)
          const target =
            layerNode && typeof editor.selectionTargetForNode === 'function'
              ? editor.selectionTargetForNode(layerNode, editor.drillGroupId || null)
              : layerNode
          if (target && typeof target.id === 'string' && target.id) layerId = target.id
        }
        const boardElement = layerElement.closest('[data-artboard-id]')
        const artboardId = boardElement ? String(boardElement.getAttribute('data-artboard-id') || '') : ''
        return { kind: 'layer', layerId: layerId, rawLayerId: rawId, artboardId: artboardId }
      }
      const boardElement =
        node.closest('[data-artboard-id]') ||
        node.closest('.dc-board-frame') ||
        node.closest('.dc-board-wrap')
      if (boardElement) {
        const owner =
          typeof boardElement.getAttribute === 'function' &&
          boardElement.getAttribute('data-artboard-id')
            ? boardElement
            : boardElement.closest('[data-artboard-id]')
        const artboardId = owner ? String(owner.getAttribute('data-artboard-id') || '') : ''
        if (artboardId) return { kind: 'artboard', artboardId: artboardId }
      }
      if (node.closest('.dc-canvas')) return { kind: 'canvas' }
      return null
    }

    /** The tree row / artboard row element for an object (canvas layers are ignored on purpose). */
    function contextMenuFindRow(appNode, attribute, id) {
      if (!appNode || !id || typeof appNode.querySelectorAll !== 'function') return null
      let rows = []
      try {
        rows = appNode.querySelectorAll('[' + attribute + ']')
      } catch (error) {
        return null
      }
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        if (!row || typeof row.closest !== 'function') continue
        if (row.closest('.dc-canvas')) continue
        if (String(row.getAttribute(attribute) || '') === String(id)) return row
      }
      return null
    }

    /** The inspector's Name field for the current selection, when it is showing that name. */
    function contextMenuFindInspectorNameField(ctx, currentName) {
      const appNode = contextMenuAppNode(ctx)
      if (!appNode || typeof appNode.querySelector !== 'function') return null
      const strings = (ctx && ctx.strings) || {}
      const label = typeof strings.name === 'string' ? strings.name : ''
      if (!label) return null
      const scope =
        appNode.querySelector('.dc-drawer-right') ||
        appNode.querySelector('.dc-right') ||
        appNode.querySelector('.dc-drawer')
      if (!scope || typeof scope.querySelectorAll !== 'function') return null
      const inputs = scope.querySelectorAll('input.dc-input')
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index]
        if (!input) continue
        const title = String(input.getAttribute('title') || '')
        if (title.indexOf(label) !== 0) continue
        if (String(input.value || '') !== String(currentName || '')) continue
        return input
      }
      return null
    }

    /**
     * Open the app's REAL rename affordance instead of faking one: the tree row's double-click
     * (its inline rename input focuses itself), else the inspector's Name field, else a toast
     * pointing at the Layers panel.
     */
    function contextMenuStartRename(ctx, kind, id, currentName) {
      const editor = (ctx && ctx.editor) || {}
      const appNode = contextMenuAppNode(ctx)
      const attribute = kind === 'artboard' ? 'data-artboard-id' : 'data-layer-id'
      const row = contextMenuFindRow(appNode, attribute, id)
      if (row && typeof row.dispatchEvent === 'function' && typeof window !== 'undefined' && typeof window.MouseEvent === 'function') {
        try {
          if (typeof row.focus === 'function') row.focus({ preventScroll: true })
          row.dispatchEvent(
            new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }),
          )
          beacon('context-menu-rename', { kind: kind, source: 'tree' })
          return true
        } catch (error) {
          beacon('context-menu-rename-failed', { kind: kind, message: shortError(error) })
        }
      }
      const field = contextMenuFindInspectorNameField(ctx, currentName)
      if (field && typeof field.focus === 'function') {
        try {
          field.focus({ preventScroll: true })
          if (typeof field.select === 'function') field.select()
          beacon('context-menu-rename', { kind: kind, source: 'inspector' })
          return true
        } catch (error) {
          beacon('context-menu-rename-failed', { kind: kind, message: shortError(error) })
        }
      }
      if (typeof editor.setInlineError === 'function') editor.setInlineError(CONTEXT_MENU_COPY.renameUnavailable)
      beacon('context-menu-rename', { kind: kind, source: 'unavailable' })
      return false
    }

    /* ------------------------------------------------------------------------------------------
     * Editing actions (small wrappers so item rows stay declarative)
     * ---------------------------------------------------------------------------------------- */

    function contextMenuReport(ctx, message) {
      const text = String(message || '')
      const live = contextMenuLiveCtx(ctx) || {}
      const editor = (live && live.editor) || (ctx && ctx.editor) || {}
      if (text && typeof editor.setInlineError === 'function') {
        try {
          editor.setInlineError(text)
        } catch (error) {
          beacon('context-menu-report-failed', { message: shortError(error) })
        }
      }
      beacon('context-menu-info', { message: text.slice(0, 150) })
    }

    function contextMenuFindArtboard(ctx, artboardId) {
      const doc = ctx && ctx.doc
      const boards = doc && Array.isArray(doc.artboards) ? doc.artboards : []
      for (let index = 0; index < boards.length; index += 1) {
        const board = boards[index]
        if (board && board.id === artboardId) return board
      }
      return null
    }

    /** Layer type label from the defaults part, without depending on it being present. */
    function contextMenuTypeLabel(type) {
      if (typeof layerTypeLabel === 'function') return layerTypeLabel(type)
      return String(type || 'layer')
    }

    function contextMenuLayerNodes(ctx, ids) {
      const editor = (ctx && ctx.editor) || {}
      const list = Array.isArray(ids) ? ids : []
      const nodes = []
      for (let index = 0; index < list.length; index += 1) {
        if (typeof editor.nodeForLayer !== 'function') break
        const node = editor.nodeForLayer(list[index])
        if (node) nodes.push(node)
      }
      return nodes
    }

    /**
     * "Frame selection": create a frame at the union box of the selection and move each selected
     * root into it (one op batch, one undo entry). Moved children keep their visual position by
     * rewriting x/y relative to the new frame — `layer.move_to` does not convert coordinates.
     */
    function contextMenuFrameSelection(ctx) {
      const editor = (ctx && ctx.editor) || {}
      const selected = Array.isArray(editor.selectedLayerIds) ? editor.selectedLayerIds : []
      const roots =
        typeof editor.rootSelectionIds === 'function' ? editor.rootSelectionIds(selected) : selected.slice()
      if (!roots.length) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.frameEmpty)
        return false
      }
      const bounds = typeof editor.selectionBounds === 'function' ? editor.selectionBounds(roots) : null
      const nodes = contextMenuLayerNodes(ctx, roots)
      if (!bounds || !(bounds.width > 0) || !(bounds.height > 0) || !nodes.length) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.frameEmpty)
        return false
      }
      const artboardId =
        typeof editor.artboardIdForLayer === 'function' ? editor.artboardIdForLayer(nodes[0].id) : null
      if (!artboardId) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.frameEmpty)
        return false
      }
      const frameId = makeId('l')
      const baseX = Math.round(bounds.x)
      const baseY = Math.round(bounds.y)
      const ops = [
        {
          type: 'layer.add',
          artboardId: artboardId,
          layer: {
            id: frameId,
            type: 'frame',
            name: CONTEXT_MENU_COPY.frameName,
            x: baseX,
            y: baseY,
            width: Math.max(1, Math.round(bounds.width)),
            height: Math.max(1, Math.round(bounds.height)),
            fill: '#ffffff',
            radius: 0,
            clip: false,
          },
        },
      ]
      const inverse = []
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (!node || !node.id) continue
        ops.push({ type: 'layer.move_to', layerId: node.id, parentId: frameId })
        ops.push({
          type: 'layer.update',
          layerId: node.id,
          patch: {
            x: Math.round(node.worldRect.x) - baseX,
            y: Math.round(node.worldRect.y) - baseY,
          },
        })
        const restore = { type: 'layer.move_to', layerId: node.id, index: node.index }
        if (node.parentId) restore.parentId = node.parentId
        else restore.artboardId = node.artboard.id
        inverse.push(restore)
        inverse.push({
          type: 'layer.update',
          layerId: node.id,
          patch: { x: finiteNumber(node.x, 0), y: finiteNumber(node.y, 0) },
        })
      }
      inverse.push({ type: 'layer.delete', layerId: frameId })
      const done = function (result) {
        if (!result || result.ok === false) return
        if (typeof editor.selectLayer === 'function') editor.selectLayer(frameId, artboardId)
        contextMenuReport(ctx, CONTEXT_MENU_COPY.framed)
      }
      const pending =
        typeof editor.commitWithHistory === 'function'
          ? editor.commitWithHistory('frame-selection', ops, inverse)
          : typeof editor.runOps === 'function'
            ? editor.runOps(ops)
            : null
      if (!pending) return false
      if (typeof pending.then === 'function') pending.then(done)
      return true
    }

    /** Duplicate an artboard (no editor API yet: runOps + a history entry once the id is known). */
    function contextMenuDuplicateArtboard(ctx, artboardId) {
      const editor = (ctx && ctx.editor) || {}
      const op = { type: 'artboard.duplicate', artboardId: artboardId }
      if (typeof editor.runOps !== 'function') return false
      const done = function (result) {
        if (!result || result.ok === false) return
        const applied = Array.isArray(result.applied) ? result.applied : []
        let newId = ''
        for (let index = 0; index < applied.length; index += 1) {
          const entry = applied[index]
          if (entry && entry.type === 'artboard.duplicate' && typeof entry.id === 'string' && entry.id) {
            newId = entry.id
          }
        }
        if (newId && typeof editor.pushHistoryEntry === 'function') {
          editor.pushHistoryEntry('duplicate-artboard', [op], [
            { type: 'artboard.delete', artboardId: newId },
          ])
        }
        if (newId && typeof editor.selectArtboard === 'function') editor.selectArtboard(newId)
        contextMenuReport(ctx, CONTEXT_MENU_COPY.artboardDuplicated)
      }
      const pending = editor.runOps([op])
      if (pending && typeof pending.then === 'function') pending.then(done)
      return true
    }

    /** Frame one artboard in the viewport (camera math; falls back to select + fit). */
    function contextMenuFitArtboard(ctx, artboardId) {
      const editor = (ctx && ctx.editor) || {}
      const board = contextMenuFindArtboard(ctx, artboardId)
      const layout = (ctx && ctx.layout) || null
      const entry =
        layout && layout.entryById && typeof layout.entryById.get === 'function'
          ? layout.entryById.get(artboardId) || null
          : null
      const canCompute =
        !!board &&
        !!entry &&
        typeof editor.setCameraValue === 'function' &&
        typeof editor.canvasViewport === 'function'
      if (!canCompute) {
        if (typeof editor.selectArtboard === 'function') editor.selectArtboard(artboardId)
        if (typeof editor.fitCamera === 'function') {
          editor.fitCamera()
          return true
        }
        contextMenuReport(ctx, CONTEXT_MENU_COPY.fitUnavailable)
        return false
      }
      const viewport = editor.canvasViewport()
      const width = Math.max(1, finiteNumber(board.width, 1))
      const height = Math.max(1, finiteNumber(board.height, 1))
      const fitZoom = Math.min(
        Math.max(120, viewport.width - FIT_PADDING) / width,
        Math.max(120, viewport.height - FIT_PADDING) / height,
      )
      const zoom = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom)) * 100) / 100
      const centerX = finiteNumber(entry.frameX, 0) + width / 2
      const centerY = finiteNumber(entry.frameY, 0) + height / 2
      if (typeof editor.selectArtboard === 'function') editor.selectArtboard(artboardId)
      editor.setCameraValue({
        x: Math.round(viewport.width / 2 - centerX * zoom),
        y: Math.round(viewport.height / 2 - centerY * zoom),
        zoom: zoom,
      })
      beacon('context-menu-fit-artboard', { artboardId: artboardId, zoom: zoom })
      return true
    }

    /* ------------------------------------------------------------------------------------------
     * Export bridges (feature-detected: the export part owns the renderers)
     * ---------------------------------------------------------------------------------------- */

    function contextMenuSelectionCopyAvailable(ctx) {
      const editor = (ctx && ctx.editor) || (contextMenuLiveCtx(ctx) || {}).editor || {}
      return typeof editor.copySelectionAs === 'function' || typeof copySelectionAs === 'function'
    }

    function contextMenuArtboardCopyAvailable() {
      return typeof renderSvg === 'function' && typeof copyTextToClipboard === 'function'
    }

    function contextMenuExportAvailable() {
      return typeof openExportDialog === 'function'
    }

    function contextMenuOpenExport(ctx, patch) {
      if (!contextMenuExportAvailable()) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.exportUnavailable)
        return false
      }
      try {
        openExportDialog(patch || {})
        return true
      } catch (error) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.exportUnavailable)
        beacon('context-menu-export-failed', { message: shortError(error) })
        return false
      }
    }

    /** Decode a PNG data URL and put the image on the clipboard (no network involved). */
    function contextMenuWriteClipboardImage(dataUrl) {
      const text = String(dataUrl || '')
      const comma = text.indexOf(',')
      if (comma < 0) return Promise.reject(new Error('image data is not a data URL'))
      const header = text.slice(0, comma)
      const payload = text.slice(comma + 1)
      if (header.indexOf('base64') < 0) return Promise.reject(new Error('image data is not base64'))
      let bytes = null
      try {
        const binary = typeof atob === 'function' ? atob(payload) : ''
        bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      } catch (error) {
        return Promise.reject(error)
      }
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
      const ClipboardItemCtor = typeof window !== 'undefined' ? window.ClipboardItem : null
      if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
        return Promise.reject(new Error('this browser cannot put images on the clipboard'))
      }
      const blob = new Blob([bytes], { type: 'image/png' })
      return clipboard.write([new ClipboardItemCtor({ 'image/png': blob })])
    }

    /** Copy one artboard as SVG/PNG through the export renderers (artboard scope is exact). */
    function contextMenuCopyArtboard(ctx, artboardId, format) {
      const live = contextMenuLiveCtx(ctx) || {}
      const doc = live.doc
      if (!doc) return false
      if (format === 'png') {
        if (typeof renderPngDataUrl !== 'function') {
          contextMenuReport(ctx, CONTEXT_MENU_COPY.copyUnavailable)
          return false
        }
        const pending = Promise.resolve(
          renderPngDataUrl(doc, { scope: 'artboard', artboardId: artboardId, scale: 2 }),
        )
        pending
          .then(function (dataUrl) {
            return contextMenuWriteClipboardImage(dataUrl)
          })
          .then(function () {
            contextMenuReport(live, CONTEXT_MENU_COPY.copiedArtboardPng)
          })
          .catch(function (error) {
            contextMenuReport(ctx, CONTEXT_MENU_COPY.copyFailed + ': ' + shortError(error))
          })
        return true
      }
      if (!contextMenuArtboardCopyAvailable()) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.copyUnavailable)
        return false
      }
      try {
        const svg = renderSvg(doc, { scope: 'artboard', artboardId: artboardId })
        const pending = copyTextToClipboard(svg)
        if (pending && typeof pending.then === 'function') {
          pending.then(function (ok) {
            contextMenuReport(live, ok === false ? CONTEXT_MENU_COPY.copyFailed : CONTEXT_MENU_COPY.copiedArtboardSvg)
          })
        } else {
          contextMenuReport(live, CONTEXT_MENU_COPY.copiedArtboardSvg)
        }
        return true
      } catch (error) {
        contextMenuReport(ctx, CONTEXT_MENU_COPY.copyFailed + ': ' + shortError(error))
        return false
      }
    }

    /** Copy the CURRENT selection as PNG/SVG through the export part's `copySelectionAs`. */
    function contextMenuCopySelection(ctx, format) {
      const live = contextMenuLiveCtx(ctx) || {}
      const editor = live.editor || (ctx && ctx.editor) || {}
      const copy = typeof editor.copySelectionAs === 'function' ? editor.copySelectionAs : null
      const fallback = typeof copySelectionAs === 'function' ? copySelectionAs : null
      if (!copy && !fallback) {
        contextMenuReport(live, CONTEXT_MENU_COPY.copyUnavailable)
        return false
      }
      try {
        // Signature: copySelectionAs(format, api). It reads the CURRENT selection from the passed
        // context, so hand it the live extension context (the right-click selected the layer).
        const pending = copy ? copy.call(editor, format, live) : fallback(format, live)
        if (pending && typeof pending.then === 'function') {
          pending.catch(function (error) {
            contextMenuReport(live, CONTEXT_MENU_COPY.copyFailed + ': ' + shortError(error))
          })
        }
        return true
      } catch (error) {
        contextMenuReport(live, CONTEXT_MENU_COPY.copyFailed + ': ' + shortError(error))
        return false
      }
    }

    /** Open the keyboard-shortcuts sheet through whichever hook this build provides. */
    function contextMenuOpenShortcuts(ctx) {
      if (typeof openShortcutsSheet === 'function') {
        try {
          openShortcutsSheet()
          return true
        } catch (error) {
          beacon('context-menu-shortcuts-failed', { message: shortError(error) })
        }
      }
      if (Array.isArray(EXTENSIONS.commands)) {
        for (let index = 0; index < EXTENSIONS.commands.length; index += 1) {
          const entry = EXTENSIONS.commands[index]
          if (!entry || typeof entry.run !== 'function') continue
          const id = String(entry.id || '')
          if (id.indexOf('shortcut') < 0) continue
          try {
            if (entry.run((ctx && ctx.editor) || {}) !== false) return true
          } catch (error) {
            beacon('context-menu-shortcuts-failed', { message: shortError(error) })
          }
        }
      }
      contextMenuReport(ctx, CONTEXT_MENU_COPY.shortcutsUnavailable)
      return false
    }

    /* ------------------------------------------------------------------------------------------
     * Menu 1/3 — a layer (or a multi-layer selection)
     * ---------------------------------------------------------------------------------------- */

    function contextMenuLayerItems(ctx, info) {
      const editor = (ctx && ctx.editor) || {}
      const ids =
        Array.isArray(info.selectionIds) && info.selectionIds.length
          ? info.selectionIds
          : [info.layerId].filter(Boolean)
      const nodes = contextMenuLayerNodes(ctx, ids)
      const primaryNode =
        typeof editor.nodeForLayer === 'function' ? editor.nodeForLayer(info.layerId) : nodes[0] || null
      const layer = primaryNode && primaryNode.layer ? primaryNode.layer : null
      const artboardId =
        (primaryNode && primaryNode.artboard && primaryNode.artboard.id) || info.artboardId || ''
      const multi = ids.length > 1
      const locked = !!(layer && layer.locked === true)
      const hidden = !!(layer && layer.visible === false)
      const allLocked = nodes.length > 0 && nodes.every(function (node) {
        return !!(node && node.layer && node.layer.locked === true)
      })
      const hasGroup = nodes.some(function (node) {
        return !!(node && node.type === 'group')
      })
      const isContainer = !!(
        primaryNode &&
        (primaryNode.type === 'frame' || primaryNode.type === 'group') &&
        Array.isArray(primaryNode.children) &&
        primaryNode.children.length
      )
      const copyAvailable = contextMenuSelectionCopyAvailable(ctx)
      const exportAvailable = contextMenuExportAvailable()
      const canRun = function (fn) {
        return function () {
          try {
            return fn()
          } catch (error) {
            contextMenuReport(ctx, CONTEXT_MENU_COPY.actionFailed + ': ' + shortError(error))
            return false
          }
        }
      }
      const call = function (name) {
        return function () {
          if (typeof editor[name] === 'function') return editor[name]()
          return false
        }
      }

      const items = [
        contextMenuItem('copy', 'Copy', {
          shortcut: 'Ctrl/Cmd+C',
          icon: 'copy',
          disabled: !ids.length,
          run: call('copySelection'),
        }),
        contextMenuItem('cut', 'Cut', {
          shortcut: 'Ctrl/Cmd+X',
          icon: 'scissors',
          disabled: locked || !ids.length,
          reason: locked ? 'The layer is locked — unlock it first' : '',
          run: call('cutSelection'),
        }),
        contextMenuItem('paste', 'Paste', {
          shortcut: 'Ctrl/Cmd+V',
          icon: 'clipboard',
          run: call('pasteSelection'),
        }),
        contextMenuItem('duplicate', 'Duplicate', {
          shortcut: 'Ctrl/Cmd+D',
          icon: 'copy',
          disabled: locked,
          reason: locked ? 'The layer is locked — unlock it first' : '',
          run: call('duplicateSelected'),
        }),
        contextMenuItem('delete', 'Delete', {
          shortcut: 'Del',
          icon: 'trash',
          danger: true,
          disabled: locked,
          reason: locked ? 'The layer is locked — unlock it first' : '',
          run: call('deleteSelectedLayer'),
        }),
        contextMenuSeparator('sep-edit'),
        contextMenuItem('rename', 'Rename…', {
          icon: 'pencil',
          disabled: !layer,
          run: function () {
            return contextMenuStartRename(ctx, 'layer', info.layerId, layer ? layer.name : '')
          },
        }),
        contextMenuItem('comment', 'Add comment', {
          icon: 'comment',
          disabled: !primaryNode || typeof editor.openComposerFor !== 'function',
          reason: 'Comments need a layer target',
          run: function () {
            if (typeof editor.openComposerFor !== 'function' || !info.layerId) return false
            editor.openComposerFor(info.layerId, artboardId || null)
            return true
          },
        }),
        contextMenuItem(
          'enter',
          primaryNode && primaryNode.type === 'group' ? CONTEXT_MENU_COPY.enterGroup : CONTEXT_MENU_COPY.enterSelection,
          {
            shortcut: '↵',
            icon: 'chevronRight',
            disabled: !isContainer || typeof editor.drillIntoSelection !== 'function',
            reason: CONTEXT_MENU_COPY.enterDisabled,
            run: function () {
              if (typeof editor.drillIntoSelection !== 'function') return false
              return editor.drillIntoSelection()
            },
          },
        ),
        contextMenuSeparator('sep-structure'),
        contextMenuItem('group', 'Group selection', {
          shortcut: 'Ctrl/Cmd+G',
          icon: 'group',
          disabled: ids.length < 2 || locked || typeof editor.groupSelection !== 'function',
          reason: ids.length < 2 ? 'Select at least two layers' : locked ? 'The layer is locked' : '',
          run: canRun(function () {
            const pending = editor.groupSelection()
            if (pending && typeof pending.catch === 'function') {
              pending.catch(function (error) {
                contextMenuReport(ctx, shortError(error))
              })
            }
            return true
          }),
        }),
        contextMenuItem('ungroup', 'Ungroup', {
          shortcut: 'Ctrl/Cmd+Shift+G',
          icon: 'ungroup',
          disabled: !hasGroup || locked || typeof editor.ungroupSelection !== 'function',
          reason: hasGroup ? (locked ? 'The layer is locked' : '') : 'The selection has no group',
          run: call('ungroupSelection'),
        }),
        contextMenuItem('frame-selection', 'Frame selection', {
          icon: 'frame',
          disabled: !ids.length || locked || typeof editor.runOps !== 'function',
          reason: locked ? 'The layer is locked' : '',
          run: function () {
            return contextMenuFrameSelection(ctx)
          },
        }),
        contextMenuSeparator('sep-arrange'),
        contextMenuItem('bring-front', 'Bring to front', {
          shortcut: 'Ctrl/Cmd+Shift+]',
          icon: 'front',
          disabled: locked || typeof editor.arrangeSelection !== 'function',
          reason: locked ? 'The layer is locked' : '',
          run: function () {
            return typeof editor.arrangeSelection === 'function' ? editor.arrangeSelection('front') : false
          },
        }),
        contextMenuItem('bring-forward', 'Bring forward', {
          shortcut: 'Ctrl/Cmd+]',
          icon: 'up',
          disabled: locked || typeof editor.arrangeSelection !== 'function',
          reason: locked ? 'The layer is locked' : '',
          run: function () {
            return typeof editor.arrangeSelection === 'function'
              ? editor.arrangeSelection('forward')
              : false
          },
        }),
        contextMenuItem('send-backward', 'Send backward', {
          shortcut: 'Ctrl/Cmd+[',
          icon: 'down',
          disabled: locked || typeof editor.arrangeSelection !== 'function',
          reason: locked ? 'The layer is locked' : '',
          run: function () {
            return typeof editor.arrangeSelection === 'function'
              ? editor.arrangeSelection('backward')
              : false
          },
        }),
        contextMenuItem('send-back', 'Send to back', {
          shortcut: 'Ctrl/Cmd+Shift+[',
          icon: 'back',
          disabled: locked || typeof editor.arrangeSelection !== 'function',
          reason: locked ? 'The layer is locked' : '',
          run: function () {
            return typeof editor.arrangeSelection === 'function' ? editor.arrangeSelection('back') : false
          },
        }),
        contextMenuSeparator('sep-state'),
        contextMenuItem(allLocked ? 'unlock' : 'lock', allLocked ? 'Unlock' : 'Lock', {
          icon: allLocked ? 'unlock' : 'lock',
          disabled: !ids.length || typeof editor.toggleLock !== 'function',
          run: call('toggleLock'),
        }),
        contextMenuItem(hidden ? 'show' : 'hide', hidden ? 'Show' : 'Hide', {
          icon: hidden ? 'eyeOff' : 'eye',
          disabled: !ids.length || typeof editor.toggleVisible !== 'function',
          title: multi ? 'Applies to every selected layer' : '',
          run: function () {
            if (typeof editor.toggleVisible !== 'function') return false
            for (let index = 0; index < ids.length; index += 1) editor.toggleVisible(ids[index])
            return true
          },
        }),
        contextMenuSeparator('sep-copy'),
        contextMenuItem('copy-png', 'Copy as PNG', {
          icon: 'image',
          disabled: !copyAvailable,
          reason: CONTEXT_MENU_COPY.copyUnavailable,
          run: function () {
            return contextMenuCopySelection(ctx, 'png')
          },
        }),
        contextMenuItem('copy-svg', 'Copy as SVG', {
          icon: 'export',
          disabled: !copyAvailable,
          reason: CONTEXT_MENU_COPY.copyUnavailable,
          run: function () {
            return contextMenuCopySelection(ctx, 'svg')
          },
        }),
        contextMenuItem(multi ? 'export-selection' : 'export-layer', multi ? 'Export selection…' : 'Export layer…', {
          icon: 'export',
          disabled: !exportAvailable,
          reason: CONTEXT_MENU_COPY.exportUnavailable,
          run: function () {
            return contextMenuOpenExport(ctx, {
              scope: 'selection',
              artboardId: artboardId,
              layerIds: ids.slice(),
            })
          },
        }),
      ]
      if (info.rawLayerId && info.rawLayerId !== info.layerId) {
        // The element under the pointer belongs to a group: say which unit the menu acts on.
        items.push(contextMenuSeparator('sep-group-note'))
        items.push(
          contextMenuItem('select-child', 'Right-click again to pick the child', {
            icon: 'search',
            disabled: true,
            reason: 'Drill into the group (Enter) to target its children',
          }),
        )
      }
      const label = multi
        ? String(ids.length) + ' ' + CONTEXT_MENU_COPY.layers + ' ' + CONTEXT_MENU_COPY.selected
        : contextMenuTypeLabel(layer ? layer.type : primaryNode ? primaryNode.type : 'layer') +
          (layer && layer.name ? ' · ' + layer.name : '')
      return { label: label, items: items }
    }

    /* ------------------------------------------------------------------------------------------
     * Menu 2/3 — an artboard
     * ---------------------------------------------------------------------------------------- */

    function contextMenuArtboardItems(ctx, info) {
      const editor = (ctx && ctx.editor) || {}
      const board = contextMenuFindArtboard(ctx, info.artboardId)
      const artboardId = info.artboardId
      const copyAvailable = contextMenuArtboardCopyAvailable()
      const exportAvailable = contextMenuExportAvailable()
      const items = [
        contextMenuItem('rename-artboard', 'Rename artboard…', {
          icon: 'pencil',
          disabled: !board,
          run: function () {
            return contextMenuStartRename(ctx, 'artboard', artboardId, board ? board.name : '')
          },
        }),
        contextMenuItem('duplicate-artboard', 'Duplicate artboard', {
          icon: 'copy',
          disabled: !board || typeof editor.runOps !== 'function',
          reason: 'Duplicating needs the ops bridge',
          run: function () {
            return contextMenuDuplicateArtboard(ctx, artboardId)
          },
        }),
        contextMenuItem('delete-artboard', 'Delete artboard', {
          icon: 'trash',
          danger: true,
          disabled: !board || typeof editor.deleteArtboard !== 'function',
          reason: 'Deleting needs the editor bridge',
          run: function () {
            return typeof editor.deleteArtboard === 'function' ? editor.deleteArtboard(artboardId) : false
          },
        }),
        contextMenuSeparator('sep-comment'),
        contextMenuItem('comment-artboard', 'Add comment…', {
          icon: 'comment',
          disabled: typeof editor.setCommentMode !== 'function',
          reason: 'Comment mode is not available',
          run: function () {
            if (typeof editor.setCommentMode !== 'function') return false
            editor.setCommentMode(true)
            contextMenuReport(ctx, CONTEXT_MENU_COPY.commentModeHint)
            return true
          },
        }),
        contextMenuSeparator('sep-copy'),
        contextMenuItem('copy-artboard-png', 'Copy as PNG', {
          icon: 'image',
          disabled: !copyAvailable,
          reason: CONTEXT_MENU_COPY.copyUnavailable,
          run: function () {
            return contextMenuCopyArtboard(ctx, artboardId, 'png')
          },
        }),
        contextMenuItem('copy-artboard-svg', 'Copy as SVG', {
          icon: 'export',
          disabled: !copyAvailable,
          reason: CONTEXT_MENU_COPY.copyUnavailable,
          run: function () {
            return contextMenuCopyArtboard(ctx, artboardId, 'svg')
          },
        }),
        contextMenuItem('export-artboard', 'Export artboard…', {
          icon: 'export',
          disabled: !exportAvailable,
          reason: CONTEXT_MENU_COPY.exportUnavailable,
          run: function () {
            return contextMenuOpenExport(ctx, { scope: 'artboard', artboardId: artboardId })
          },
        }),
        contextMenuSeparator('sep-view'),
        contextMenuItem('fit-artboard', 'Fit to artboard', {
          icon: 'fit',
          disabled: !board,
          run: function () {
            return contextMenuFitArtboard(ctx, artboardId)
          },
        }),
        contextMenuItem('select-all-artboard', 'Select all in artboard', {
          shortcut: 'Ctrl/Cmd+A',
          icon: 'selectAll',
          disabled: typeof editor.selectAllInArtboard !== 'function',
          run: function () {
            if (typeof editor.selectAllInArtboard !== 'function') return false
            if (typeof editor.selectArtboard === 'function') editor.selectArtboard(artboardId)
            editor.selectAllInArtboard()
            return true
          },
        }),
      ]
      const label = (board && board.name ? String(board.name) : 'Artboard') + ' · artboard'
      return { label: label, items: items }
    }

    /* ------------------------------------------------------------------------------------------
     * Menu 3/3 — the empty canvas
     * ---------------------------------------------------------------------------------------- */

    function contextMenuCanvasItems(ctx, info) {
      const editor = (ctx && ctx.editor) || {}
      const doc = ctx && ctx.doc
      const boards = doc && Array.isArray(doc.artboards) ? doc.artboards : []
      const commentMode = editor.commentMode === true
      const shortcutsAvailable =
        typeof openShortcutsSheet === 'function' ||
        (Array.isArray(EXTENSIONS.commands) &&
          EXTENSIONS.commands.some(function (entry) {
            return !!(entry && typeof entry.run === 'function' && String(entry.id || '').indexOf('shortcut') >= 0)
          }))
      const items = [
        contextMenuItem('paste-here', 'Paste here', {
          shortcut: 'Ctrl/Cmd+V',
          icon: 'clipboard',
          run: function () {
            if (typeof editor.pasteSelection !== 'function') return false
            const pending = editor.pasteSelection()
            if (pending && typeof pending.catch === 'function') {
              pending.catch(function (error) {
                contextMenuReport(ctx, shortError(error))
              })
            }
            return true
          },
        }),
        contextMenuItem('select-all', 'Select all', {
          shortcut: 'Ctrl/Cmd+A',
          icon: 'selectAll',
          disabled: !boards.length || typeof editor.selectAllInArtboard !== 'function',
          reason: CONTEXT_MENU_COPY.noArtboards,
          run: function () {
            return typeof editor.selectAllInArtboard === 'function' ? editor.selectAllInArtboard() : false
          },
        }),
        contextMenuSeparator('sep-create'),
        contextMenuItem('add-artboard', 'Add artboard', {
          icon: 'plus',
          disabled: typeof editor.addArtboard !== 'function',
          run: function () {
            return typeof editor.addArtboard === 'function' ? editor.addArtboard() : false
          },
        }),
        contextMenuItem('comment-mode', 'Comment mode', {
          icon: 'comment',
          checked: commentMode,
          disabled: typeof editor.setCommentMode !== 'function',
          run: function () {
            if (typeof editor.setCommentMode !== 'function') return false
            editor.setCommentMode(!commentMode)
            return true
          },
        }),
        contextMenuSeparator('sep-view'),
        contextMenuItem('zoom-in', 'Zoom in', {
          icon: 'plus',
          disabled: typeof editor.zoomCameraBy !== 'function',
          run: function () {
            return typeof editor.zoomCameraBy === 'function' ? editor.zoomCameraBy(ZOOM_STEP) : false
          },
        }),
        contextMenuItem('zoom-out', 'Zoom out', {
          icon: 'minus',
          disabled: typeof editor.zoomCameraBy !== 'function',
          run: function () {
            return typeof editor.zoomCameraBy === 'function' ? editor.zoomCameraBy(-ZOOM_STEP) : false
          },
        }),
        contextMenuItem('fit-canvas', 'Fit canvas', {
          icon: 'fit',
          disabled: typeof editor.fitCamera !== 'function',
          run: function () {
            return typeof editor.fitCamera === 'function' ? editor.fitCamera() : false
          },
        }),
        contextMenuSeparator('sep-help'),
        contextMenuItem('shortcuts', 'Keyboard shortcuts…', {
          icon: 'keyboard',
          disabled: !shortcutsAvailable,
          reason: CONTEXT_MENU_COPY.shortcutsUnavailable,
          run: function () {
            return contextMenuOpenShortcuts(ctx)
          },
        }),
      ]
      const name = doc && typeof doc.name === 'string' && doc.name ? doc.name : CONTEXT_MENU_COPY.canvas
      return { label: name, items: items }
    }

    /** Build the whole menu for a resolved target (items are frozen at open time). */
    function contextMenuBuildMenu(ctx, info) {
      const target = info && info.kind ? info : { kind: 'canvas' }
      const model =
        target.kind === 'layer'
          ? contextMenuLayerItems(ctx, target)
          : target.kind === 'artboard'
            ? contextMenuArtboardItems(ctx, target)
            : contextMenuCanvasItems(ctx, target)
      const items = Array.isArray(model.items) ? model.items.filter(Boolean) : []
      const targetKey =
        target.kind === 'layer'
          ? 'layer:' + String(target.layerId || '')
          : target.kind === 'artboard'
            ? 'artboard:' + String(target.artboardId || '')
            : 'canvas'
      const ids = []
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (!item || item.separator || !item.id) continue
        ids.push(item.id + (item.disabled ? '(off)' : ''))
      }
      return {
        label:
          target.kind === 'layer'
            ? CONTEXT_MENU_COPY.layerMenu
            : target.kind === 'artboard'
              ? CONTEXT_MENU_COPY.artboardMenu
              : CONTEXT_MENU_COPY.canvasMenu,
        heading: model.label,
        items: items,
        beaconTarget: targetKey,
        beaconItems: ids.slice(0, 24).join(','),
      }
    }

    /* ------------------------------------------------------------------------------------------
     * Positioning: fixed at the pointer, flipped/clamped inside the panel, 6 px margins
     * ---------------------------------------------------------------------------------------- */

    function contextMenuPlaceMenu(node, pointX, pointY, appNode) {
      if (!node || typeof node.getBoundingClientRect !== 'function') return
      const margin = 6
      const viewportWidth =
        typeof window !== 'undefined' ? Math.max(1, window.innerWidth || 0) : 1024
      const viewportHeight =
        typeof window !== 'undefined' ? Math.max(1, window.innerHeight || 0) : 768
      let bounds = {
        left: margin,
        top: margin,
        right: viewportWidth - margin,
        bottom: viewportHeight - margin,
      }
      let panel = null
      try {
        panel = appNode && typeof appNode.getBoundingClientRect === 'function' ? appNode.getBoundingClientRect() : null
      } catch (error) {
        panel = null
      }
      if (panel && panel.width > 40 && panel.height > 40) {
        // Never leave the visible viewport, even when the panel itself is scrolled partly out.
        bounds = {
          left: Math.max(margin, panel.left + margin),
          top: Math.max(margin, panel.top + margin),
          right: Math.min(viewportWidth - margin, panel.right - margin),
          bottom: Math.min(viewportHeight - margin, panel.bottom - margin),
        }
      }
      if (bounds.right - bounds.left < 120 || bounds.bottom - bounds.top < 120) {
        bounds = {
          left: margin,
          top: margin,
          right: viewportWidth - margin,
          bottom: viewportHeight - margin,
        }
      }
      // 1) Park it at the pointer to learn how this containing block maps to the viewport
      //    (a `fixed` child of the panel can resolve against the panel itself).
      node.style.left = Math.round(pointX) + 'px'
      node.style.top = Math.round(pointY) + 'px'
      node.style.maxHeight = Math.max(120, Math.floor(bounds.bottom - bounds.top)) + 'px'
      let rect = null
      try {
        rect = node.getBoundingClientRect()
      } catch (error) {
        rect = null
      }
      const width = Math.max(1, Math.round(rect ? rect.width : 0))
      const height = Math.max(1, Math.round(rect ? rect.height : 0))
      const offsetX = rect ? rect.left - pointX : 0
      const offsetY = rect ? rect.top - pointY : 0
      // 2) Flip to the other side of the pointer when the preferred side overflows.
      let left = pointX
      let top = pointY
      if (left + width > bounds.right) left = pointX - width
      if (top + height > bounds.bottom) top = pointY - height
      // 3) Clamp inside the panel.
      left = Math.max(bounds.left, Math.min(left, bounds.right - width))
      top = Math.max(bounds.top, Math.min(top, bounds.bottom - height))
      node.style.left = Math.round(left - offsetX) + 'px'
      node.style.top = Math.round(top - offsetY) + 'px'
    }

    /* ------------------------------------------------------------------------------------------
     * The menu component (registered as an app panel; owns its listener and its CSS)
     * ---------------------------------------------------------------------------------------- */

    function ContextMenuLayer(props) {
      const ctx = (props && props.ctx) || {}
      const ctxRef = React.useRef(ctx)
      ctxRef.current = ctx
      // Actions run after the right-click applied its selection, so keep the newest context
      // reachable from the run-time helpers (`copySelectionAs` reads the live selection).
      CONTEXT_MENU_STATE.liveCtx = ctx
      const menuRef = React.useRef(null)
      const previousFocusRef = React.useRef(null)
      const activeRef = React.useRef(-1)
      const selectedState = React.useState(null)
      const menu = selectedState[0]
      const setMenu = selectedState[1]
      const selectedActive = React.useState(-1)
      const activeIndex = selectedActive[0]
      const setActiveIndex = selectedActive[1]
      activeRef.current = activeIndex

      const closeMenu = React.useCallback(function (restoreFocus, reason) {
        const previous = previousFocusRef.current
        previousFocusRef.current = null
        setMenu(null)
        setActiveIndex(-1)
        beacon('context-menu-close', { reason: String(reason || 'unknown') })
        if (restoreFocus === false || !previous) return
        try {
          if (previous.isConnected !== false && typeof previous.focus === 'function') {
            previous.focus({ preventScroll: true })
          }
        } catch (error) {
          try {
            if (typeof previous.focus === 'function') previous.focus()
          } catch (ignored) {
            /* focus restore is best effort */
          }
        }
      }, [])

      const runItem = React.useCallback(
        function (item) {
          if (!item || item.separator || item.disabled || typeof item.run !== 'function') return
          const run = item.run
          closeMenu(true, 'run:' + String(item.id || 'item'))
          let outcome = null
          try {
            outcome = run()
          } catch (error) {
            contextMenuReport(ctxRef.current, CONTEXT_MENU_COPY.actionFailed + ': ' + shortError(error))
            return
          }
          if (outcome && typeof outcome.catch === 'function') {
            outcome.catch(function (error) {
              contextMenuReport(ctxRef.current, CONTEXT_MENU_COPY.actionFailed + ': ' + shortError(error))
            })
          }
        },
        [closeMenu],
      )

      /** Resolve the target, apply click-selection semantics and open the menu at the pointer. */
      const openMenu = React.useCallback(function (currentCtx, info, event) {
        const editor = (currentCtx && currentCtx.editor) || {}
        const selectedIds = Array.isArray(editor.selectedLayerIds) ? editor.selectedLayerIds.slice() : []
        let selectionIds = selectedIds
        if (info.kind === 'layer') {
          if (selectedIds.indexOf(info.layerId) < 0) {
            // Right-click on an unselected object selects it first (single-click semantics);
            // right-click inside a multi-selection keeps the whole selection.
            selectionIds = [info.layerId]
            if (typeof editor.selectLayer === 'function') editor.selectLayer(info.layerId, info.artboardId || null)
          }
        } else if (info.kind === 'artboard') {
          if (editor.selectedArtboardId !== info.artboardId && typeof editor.selectArtboard === 'function') {
            editor.selectArtboard(info.artboardId)
          }
        }
        const model = contextMenuBuildMenu(currentCtx, Object.assign({}, info, { selectionIds: selectionIds }))
        if (!model || !model.items.length) return
        previousFocusRef.current =
          typeof document !== 'undefined' ? document.activeElement : null
        setActiveIndex(-1)
        setMenu({
          x: Math.round(finiteNumber(event.clientX, 0)),
          y: Math.round(finiteNumber(event.clientY, 0)),
          label: model.label,
          heading: model.heading,
          items: model.items,
          target: info,
        })
        beacon('context-menu', { target: model.beaconTarget, items: model.beaconItems })
      }, [])

      // ONE `contextmenu` listener for the whole panel: capture phase, so the surface's own
      // right-click handling (and the host app menu) never fires inside the canvas.
      React.useEffect(
        function () {
          function onContextMenu(event) {
            if (!event || !event.target) return
            const currentCtx = ctxRef.current || {}
            const appNode = contextMenuAppNode(currentCtx)
            const target = event.target
            if (appNode) {
              if (typeof appNode.contains !== 'function' || !appNode.contains(target)) return
            } else if (!(typeof target.closest === 'function' && target.closest('.dc-app'))) {
              return
            }
            // Text fields keep their native menu (rename / filter inputs).
            if (contextMenuIsEditableTarget(target)) return
            const info = contextMenuResolveTarget(target, appNode, currentCtx)
            if (!info) return
            if (typeof event.preventDefault === 'function') event.preventDefault()
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            try {
              openMenu(currentCtx, info, event)
            } catch (error) {
              beacon('context-menu-failed', { message: shortError(error) })
            }
          }
          document.addEventListener('contextmenu', onContextMenu, true)
          return function () {
            document.removeEventListener('contextmenu', onContextMenu, true)
          }
        },
        [openMenu],
      )

      // While open: close on outside pointerdown / Escape / wheel / scroll / blur / resize.
      React.useEffect(
        function () {
          if (!menu) return undefined
          function targetInside(event) {
            const node = menuRef.current
            const target = event ? event.target : null
            return !!(node && target && typeof node.contains === 'function' && node.contains(target))
          }
          function onPointerDown(event) {
            if (targetInside(event)) return
            closeMenu(true, 'outside-pointerdown')
          }
          function onWheel(event) {
            const node = menuRef.current
            // Let a long menu scroll its own list instead of closing on the first notch.
            if (targetInside(event) && node && node.scrollHeight > node.clientHeight + 1) return
            closeMenu(false, 'wheel')
          }
          function onScroll(event) {
            if (targetInside(event)) return
            closeMenu(false, 'scroll')
          }
          function onKeyDown(event) {
            if (!event || event.key !== 'Escape') return
            if (typeof event.preventDefault === 'function') event.preventDefault()
            // While the menu is open, Escape belongs to it: keep the shell (drawer) and the
            // editor (deselect) from also reacting to the same key press.
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            closeMenu(true, 'escape')
          }
          function onResize() {
            closeMenu(false, 'resize')
          }
          function onWindowBlur() {
            closeMenu(false, 'blur')
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('wheel', onWheel, { capture: true, passive: true })
          document.addEventListener('scroll', onScroll, true)
          document.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('resize', onResize)
          window.addEventListener('blur', onWindowBlur)
          return function () {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('wheel', onWheel, { capture: true, passive: true })
            document.removeEventListener('scroll', onScroll, true)
            document.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('resize', onResize)
            window.removeEventListener('blur', onWindowBlur)
          }
        },
        [menu, closeMenu],
      )

      // Place before paint (no jump from the raw pointer position) and focus the menu.
      React.useLayoutEffect(
        function () {
          if (!menu) return
          const node = menuRef.current
          if (!node) return
          contextMenuPlaceMenu(node, menu.x, menu.y, contextMenuAppNode(ctxRef.current))
          try {
            node.focus({ preventScroll: true })
          } catch (error) {
            try {
              node.focus()
            } catch (ignored) {
              /* focus is best effort */
            }
          }
        },
        [menu],
      )

      function moveActive(direction, key) {
        if (!menu) return
        const items = menu.items
        const selectable = []
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index]
          if (item && !item.separator && !item.disabled) selectable.push(index)
        }
        if (!selectable.length) return
        let next = -1
        if (key === 'Home') next = selectable[0]
        else if (key === 'End') next = selectable[selectable.length - 1]
        else {
          const at = selectable.indexOf(activeRef.current)
          if (at < 0) next = direction > 0 ? selectable[0] : selectable[selectable.length - 1]
          else next = selectable[(at + direction + selectable.length) % selectable.length]
        }
        setActiveIndex(next)
        const node = menuRef.current
        const row = node && typeof node.querySelector === 'function' ? node.querySelector('[data-dcm-index="' + next + '"]') : null
        if (row && typeof row.scrollIntoView === 'function') {
          try {
            row.scrollIntoView({ block: 'nearest' })
          } catch (error) {
            /* scrolling is best effort */
          }
        }
      }

      function onMenuKeyDown(event) {
        if (!event || !menu) return
        const key = event.key
        if (key === 'Escape' || key === 'Tab') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          closeMenu(true, key === 'Tab' ? 'tab' : 'escape-key')
          return
        }
        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          runItem(menu.items[activeRef.current])
          return
        }
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          moveActive(key === 'ArrowDown' || key === 'Home' ? 1 : -1, key)
          return
        }
        if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return
        // Swallow everything else: nothing may act on the canvas behind an open menu.
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
      }

      const styleTag = h('style', {
        key: 'dcm-style',
        dangerouslySetInnerHTML: { __html: CONTEXT_MENU_CSS },
      })
      if (!menu) return h(React.Fragment, null, styleTag)

      const rows = []
      if (menu.heading) {
        rows.push(
          h(
            'div',
            { key: 'head', className: 'dcm-head', role: 'presentation', title: menu.heading },
            menu.heading,
          ),
        )
      }
      for (let index = 0; index < menu.items.length; index += 1) {
        const item = menu.items[index]
        if (!item) continue
        if (item.separator) {
          rows.push(h('div', { key: 'sep-' + index, className: 'dc-menu-sep', role: 'separator' }))
          continue
        }
        const disabled = item.disabled === true
        const isActive = index === activeIndex
        const title = disabled
          ? item.reason || item.title || item.label
          : item.title || (item.shortcut ? item.label + ' (' + item.shortcut + ')' : item.label)
        rows.push(
          h(
            'button',
            {
              key: 'item-' + (item.id || index),
              type: 'button',
              role: 'menuitem',
              id: contextMenuItemDomId(item, index),
              'data-dcm-index': index,
              className:
                'dc-menu-item' + (item.danger ? ' dc-danger' : '') + (isActive ? ' dcm-active' : ''),
              'aria-disabled': disabled ? 'true' : 'false',
              tabIndex: -1,
              title: title,
              onPointerEnter: function () {
                if (!disabled) setActiveIndex(index)
              },
              onClick: function (event) {
                if (typeof event.preventDefault === 'function') event.preventDefault()
                if (typeof event.stopPropagation === 'function') event.stopPropagation()
                runItem(item)
              },
            },
            h('span', { className: 'dc-menu-item-icon' }, h(ContextMenuGlyph, { name: item.icon, size: 14 })),
            h('span', { className: 'dc-menu-item-label' }, item.label),
            item.shortcut ? h('span', { className: 'dc-menu-item-hint' }, item.shortcut) : null,
            item.checked
              ? h('span', { className: 'dc-menu-item-check' }, h(ContextMenuGlyph, { name: 'check', size: 12 }))
              : null,
          ),
        )
      }
      const activeItem = activeIndex >= 0 ? menu.items[activeIndex] : null

      return h(
        React.Fragment,
        null,
        styleTag,
        h(
          'div',
          {
            className: 'dc-ctxmenu',
            role: 'menu',
            'aria-label': menu.label,
            ref: menuRef,
            tabIndex: -1,
            'aria-activedescendant':
              activeItem && !activeItem.separator ? contextMenuItemDomId(activeItem, activeIndex) : undefined,
            style: { left: menu.x + 'px', top: menu.y + 'px' },
            // Gestures must never start underneath the menu.
            onPointerDown: function (event) {
              if (typeof event.stopPropagation === 'function') event.stopPropagation()
            },
            onPointerUp: function (event) {
              if (typeof event.stopPropagation === 'function') event.stopPropagation()
            },
            onContextMenu: function (event) {
              if (typeof event.preventDefault === 'function') event.preventDefault()
              if (typeof event.stopPropagation === 'function') event.stopPropagation()
            },
            onKeyDown: onMenuKeyDown,
          },
          rows,
        ),
      )
    }

    registerAppPanel({
      id: 'context-menu',
      render: function (ctx) {
        return h(ContextMenuLayer, { key: 'context-menu', ctx: ctx })
      },
    })
