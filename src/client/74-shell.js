    /* ------------------------------------------------------------------------------------------
     * Chrome constants: panel geometry, artboard presets, shortcuts, local copy
     * ---------------------------------------------------------------------------------------- */

    const PANELS_STORAGE_KEY = 'dsh-design-canvas:panels'
    const PANEL_MIN = 120
    const PANEL_MAX = 420
    const PANEL_CANVAS_MIN = 160
    const PANEL_DEFAULT_LEFT = 148
    const PANEL_DEFAULT_RIGHT = 208
    const NARROW_BREAKPOINT = 640
    const CANVAS_REFIT_MS = 120
    const MENU_WIDTH = 236
    const ARTBOARD_LIMIT = 50
    const IS_MAC =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/.test(String((navigator && navigator.platform) || ''))
    const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'
    const SHIFT_LABEL = IS_MAC ? '⇧' : 'Shift'
    const COPY = {
      line: 'Line',
      button: 'Button',
      moreCommands: 'More commands',
      moreTools: 'More tools',
      exportItem: 'Export…',
      exportUnavailable: 'Export is provided by the export extension',
      shortcuts: 'Keyboard shortcuts',
      resetZoom: 'Reset zoom to 100%',
      fitSelection: 'Fit selection',
      zoomHeading: 'Zoom',
      closePanel: 'Close panel',
      duplicateArtboard: 'Duplicate artboard',
      deleteArtboard: 'Delete artboard',
      customSize: 'Custom size',
      width: 'Width',
      height: 'Height',
      create: 'Create',
      selectPreset: 'Add artboard',
      emptyArtboardHint: 'Pick a size to start a new artboard.',
      clearSelection: 'Clear selection',
      resizePanel: 'Drag to resize · double-click to reset',
      layerPanel: 'Layers panel',
      inspectorPanel: 'Inspector panel',
      documentVersion: 'Document version',
      selected: 'selected',
      extensions: 'Extensions',
      undo: 'Undo',
      redo: 'Redo',
      noUndo: 'Nothing to undo',
      noRedo: 'Nothing to redo',
      nameHint: 'Double-click to rename',
    }
    const ARTBOARD_PRESETS = [
      { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
      { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
      { id: 'square', label: 'Square', width: 1080, height: 1080 },
    ]
    const SHORTCUT_ROWS = [
      { id: 'undo', label: 'Undo', keys: [MOD_LABEL, 'Z'] },
      { id: 'redo', label: 'Redo', keys: [MOD_LABEL, SHIFT_LABEL, 'Z'] },
      { id: 'duplicate', label: 'Duplicate selection', keys: [MOD_LABEL, 'D'] },
      { id: 'nudge', label: 'Nudge 1 px', keys: ['←', '↑', '→', '↓'] },
      { id: 'nudge-big', label: 'Nudge 10 px', keys: [SHIFT_LABEL, '↑'] },
      { id: 'delete', label: 'Delete selection', keys: ['Del'] },
      { id: 'comment', label: 'Comment on layer', keys: ['C'] },
      { id: 'pan', label: 'Pan canvas', keys: ['Space', 'drag'] },
      { id: 'zoom', label: 'Zoom canvas', keys: [MOD_LABEL, 'wheel'] },
      { id: 'escape', label: 'Deselect / cancel', keys: ['Esc'] },
      { id: 'send', label: 'Send comment', keys: [MOD_LABEL, 'Enter'] },
    ]

    /* ------------------------------------------------------------------------------------------
     * Panel state (persisted in localStorage, restored on mount)
     * ---------------------------------------------------------------------------------------- */

    function readPanelState() {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(PANELS_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null
        return {
          left: Number.isFinite(parsed.left) ? parsed.left : null,
          right: Number.isFinite(parsed.right) ? parsed.right : null,
          treeOpen: typeof parsed.treeOpen === 'boolean' ? parsed.treeOpen : null,
          inspectorOpen: typeof parsed.inspectorOpen === 'boolean' ? parsed.inspectorOpen : null,
        }
      } catch (error) {
        beacon('panels-read-failed', { message: shortError(error) })
        return null
      }
    }

    function writePanelState(value) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        /* storage can be unavailable (private mode, quota); panels still resize in memory */
      }
    }

    function clampPanelWidth(value, fallback) {
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
      const ceiling = Math.max(PANEL_MIN, Math.min(PANEL_MAX, fallback))
      return Math.round(Math.max(PANEL_MIN, Math.min(ceiling, numeric)))
    }

    /** Friendly layer-type label for chips ("Rectangle", "Text", "Group", …). */
    function layerChipLabel(type) {
      const value = String(type || 'layer')
      if (value === 'rect') return 'Rectangle'
      if (value === 'image') return 'Image'
      if (value === 'frame') return 'Frame'
      if (value === 'ellipse') return 'Ellipse'
      if (value === 'text') return 'Text'
      if (value === 'line') return 'Line'
      if (value === 'group') return 'Group'
      return value.charAt(0).toUpperCase() + value.slice(1)
    }

    function uniqueArtboardName(doc, base) {
      const taken = {}
      artboardsOf(doc).forEach(function (artboard) {
        if (artboard && typeof artboard.name === 'string') taken[artboard.name] = true
      })
      const root = String(base || 'Artboard')
      if (!taken[root]) return root
      let index = 2
      while (taken[root + ' ' + index] && index < 1000) index += 1
      return root + ' ' + index
    }

    /* ------------------------------------------------------------------------------------------
     * Local chrome components (small functions, all inside the composition root's file)
     * ---------------------------------------------------------------------------------------- */

    /** Editable design name: double-click (or F2) to edit, Enter commits, Escape cancels. */
    function ProjectName(props) {
      const editingState = React.useState(false)
      const editing = editingState[0]
      const setEditing = editingState[1]
      const draftState = React.useState('')
      const draft = draftState[0]
      const setDraft = draftState[1]
      const inputRef = React.useRef(null)
      const cancelledRef = React.useRef(false)
      const doneRef = React.useRef(false)

      React.useEffect(
        function () {
          if (!editing) return
          const node = inputRef.current
          if (node && typeof node.focus === 'function') {
            node.focus()
            if (typeof node.select === 'function') node.select()
          }
        },
        [editing],
      )

      function begin() {
        cancelledRef.current = false
        doneRef.current = false
        setDraft(props.value || '')
        setEditing(true)
      }

      function commit() {
        if (!editing || doneRef.current) return
        doneRef.current = true
        setEditing(false)
        if (cancelledRef.current) return
        props.onCommit(draft)
      }

      function cancel() {
        cancelledRef.current = true
        doneRef.current = true
        setEditing(false)
      }

      if (editing) {
        return h('input', {
          ref: inputRef,
          type: 'text',
          className: 'dc-name dc-name-input',
          value: draft,
          spellCheck: false,
          maxLength: 120,
          'aria-label': props.label,
          title: props.title,
          onChange: function (event) {
            setDraft(event.target.value)
          },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }
          },
        })
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'dc-name',
          title: props.title,
          'aria-label': props.label + ': ' + (props.value || props.fallback),
          onDoubleClick: begin,
          onKeyDown: function (event) {
            if (event.key === 'F2') {
              event.preventDefault()
              begin()
            }
          },
        },
        props.value || props.fallback,
      )
    }

    function StatusIndicator(props) {
      return h(
        'span',
        { className: 'dc-status dc-status-' + props.status, title: props.title },
        h('span', { className: 'dc-dot dc-dot-' + props.status, 'aria-hidden': 'true' }),
        h('span', { className: 'dc-status-label' }, props.label),
        props.onRetry
          ? h(
              'button',
              { type: 'button', className: 'dc-retry', onClick: props.onRetry },
              props.retryLabel,
            )
          : null,
      )
    }

    function ZoomControls(props) {
      return h(
        'div',
        { className: 'dc-zoom-group', role: 'group', 'aria-label': props.label },
        h(IconButton, {
          icon: 'minus',
          size: 12,
          title: tooltipText(props.zoomOut, MOD_LABEL + ' + wheel'),
          disabled: props.atMin,
          onClick: props.onZoomOut,
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'dc-zoom-label',
            title: tooltipText(props.zoomFit, 'double-click for 100%'),
            'aria-label': props.label + ': ' + props.percent,
            onClick: props.onFit,
            onDoubleClick: props.onReset,
          },
          props.percent,
        ),
        h(IconButton, {
          icon: 'plus',
          size: 12,
          title: tooltipText(props.zoomIn, MOD_LABEL + ' + wheel'),
          disabled: props.atMax,
          onClick: props.onZoomIn,
        }),
      )
    }

    /** Artboard preset list + custom size form, rendered inside the popover menu. */
    function ArtboardPresets(props) {
      const widthState = React.useState('1200')
      const customWidth = widthState[0]
      const setCustomWidth = widthState[1]
      const heightState = React.useState('800')
      const customHeight = heightState[0]
      const setCustomHeight = heightState[1]

      function createCustom() {
        const width = clamp(Math.round(Number(customWidth) || 0), 1, 8000)
        const height = clamp(Math.round(Number(customHeight) || 0), 1, 8000)
        props.onCreate({ label: 'Artboard', width: width, height: height })
      }

      function submitOnEnter(event) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        createCustom()
      }

      return h(
        React.Fragment,
        null,
        h(MenuLabel, { label: COPY.selectPreset }),
        ARTBOARD_PRESETS.map(function (preset) {
          return h(MenuItem, {
            key: preset.id,
            icon: 'artboard',
            label: preset.label,
            hint: preset.width + ' × ' + preset.height,
            onSelect: function () {
              props.onCreate(preset)
            },
          })
        }),
        h(MenuSeparator),
        h(MenuLabel, { label: COPY.customSize }),
        h(
          'div',
          { className: 'dc-menu-form' },
          h(
            'label',
            { className: 'dc-menu-field' },
            COPY.width,
            h('input', {
              type: 'number',
              className: 'dc-menu-input',
              value: customWidth,
              min: 1,
              max: 8000,
              'aria-label': COPY.width,
              onChange: function (event) {
                setCustomWidth(event.target.value)
              },
              onKeyDown: submitOnEnter,
            }),
          ),
          h(
            'label',
            { className: 'dc-menu-field' },
            COPY.height,
            h('input', {
              type: 'number',
              className: 'dc-menu-input',
              value: customHeight,
              min: 1,
              max: 8000,
              'aria-label': COPY.height,
              onChange: function (event) {
                setCustomHeight(event.target.value)
              },
              onKeyDown: submitOnEnter,
            }),
          ),
          h(
            'button',
            { type: 'button', className: 'dc-btn dc-btn-sm dc-btn-primary', onClick: createCustom },
            COPY.create,
          ),
        ),
      )
    }

    function ShortcutsDialog(props) {
      return h(
        ModalDialog,
        { title: props.title, closeLabel: props.closeLabel, onClose: props.onClose },
        h(
          'div',
          { className: 'dc-shortcut-list' },
          SHORTCUT_ROWS.map(function (row) {
            return h(
              'div',
              { className: 'dc-shortcut-row', key: row.id },
              h('span', null, row.label),
              h(
                'span',
                { className: 'dc-shortcut-keys' },
                row.keys.map(function (key, index) {
                  return h('kbd', { className: 'dc-kbd', key: key + '-' + index }, key)
                }),
              ),
            )
          }),
        ),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas root
     * ---------------------------------------------------------------------------------------- */

    /**
     * Canvas shell: header, toolbar, panels (tree / inspector / comments), splitter-friendly
     * layout, the camera stage and the inline comment composer. All behaviour lives in
     * `useEditor` (70-editor.js); this component only composes and positions UI.
     */
    function CanvasRoot(props) {
      const editor = useEditor(props.sessionId)
      const {
        strings,
        doc,
        version,
        boardPath,
        loading,
        loadError,
        status,
        inlineError,
        setInlineError,
        selectedLayerId,
        selectedArtboardId,
        selectedLayerIds: editorSelectedLayerIds,
        selectLayers,
        toggleLock,
        groupSelection,
        ungroupSelection,
        alignSelection,
        distributeSelection,
        arrangeSelection,
        camera,
        panning,
        spaceHeld,
        dragOver,
        commentMode,
        setCommentMode,
        composer,
        setComposer,
        commentBusy,
        commentError,
        gestureActive,
        treeOpen,
        setTreeOpen,
        inspectorOpen,
        setInspectorOpen,
        imageInputRef,
        selectedLayerIdRef,
        canvasRef,
        appRef,
        canvasHoverRef,
        zoomCameraBy,
        fitCamera,
        retryNow,
        selectLayer,
        selectArtboard,
        clearSelection,
        openComposerFor,
        commitLayer,
        commitArtboard,
        toggleVisible,
        deleteSelectedLayer,
        moveSelected,
        addLayer,
        duplicateSelected,
        commitShadow,
        clearShadow,
        reparentLayer,
        setFrameAutoLayout,
        patchFrameLayout,
        addArtboard,
        deleteArtboard,
        setCommentStatus,
        deleteCommentById,
        canvasPointerDown,
        canvasPointerMove,
        canvasPointerUp,
        canvasPointerCancel,
        openImagePicker,
        onImageInputChange,
        canvasDragOver,
        canvasDragLeave,
        canvasDrop,
        tree,
        selectedNode,
        commentIndex,
        selectedComments,
        layout,
        composerPlacement,
        handlers,
        statusLabels,
        runOps,
        undoOnce,
        redoOnce,
        sendCommentChat,
      } = editor

      /* ------------------------------- shell state (hooks: before any early return) ------------ */

      const storedPanelsRef = React.useRef(null)
      if (storedPanelsRef.current === null) storedPanelsRef.current = readPanelState() || {}

      const panelWidthState = React.useState({
        left:
          storedPanelsRef.current.left !== null && storedPanelsRef.current.left !== undefined
            ? storedPanelsRef.current.left
            : PANEL_DEFAULT_LEFT,
        right:
          storedPanelsRef.current.right !== null && storedPanelsRef.current.right !== undefined
            ? storedPanelsRef.current.right
            : PANEL_DEFAULT_RIGHT,
      })
      const panelWidths = panelWidthState[0]
      const setPanelWidths = panelWidthState[1]

      const bodyWidthState = React.useState(0)
      const bodyWidth = bodyWidthState[0]
      const setBodyWidth = bodyWidthState[1]
      const narrow = bodyWidth > 0 && bodyWidth < NARROW_BREAKPOINT

      const panelDragState = React.useState(null)
      const panelDrag = panelDragState[0]
      const setPanelDrag = panelDragState[1]

      const menuState = React.useState(null)
      const menu = menuState[0]
      const setMenu = menuState[1]

      const shortcutsState = React.useState(false)
      const shortcutsOpen = shortcutsState[0]
      const setShortcutsOpen = shortcutsState[1]

      // Narrow sidebars (< NARROW_BREAKPOINT px) turn the panels into overlay drawers so the
      // canvas keeps the full width instead of shrinking to a postage stamp.
      const drawerState = React.useState(null)
      const drawer = drawerState[0]
      const setDrawer = drawerState[1]

      const bodyRef = React.useRef(null)
      const restoredRef = React.useRef(false)
      const refitRef = React.useRef(false)
      // Camera refit bookkeeping: resize-driven framing is only allowed while the user has
      // not panned or zoomed the canvas since the last explicit fit.
      const userAdjustedCameraRef = React.useRef(false)
      const refitTimerRef = React.useRef(null)
      const spaceHeldMirrorRef = React.useRef(spaceHeld)
      spaceHeldMirrorRef.current = spaceHeld

      // Track the live body width so panel clamps react to the sidebar being resized.
      React.useLayoutEffect(
        function () {
          const node = bodyRef.current
          if (!node || typeof node.getBoundingClientRect !== 'function') return undefined
          function measure() {
            const rect = node.getBoundingClientRect()
            setBodyWidth(Math.max(0, Math.round(rect.width)))
          }
          measure()
          if (typeof ResizeObserver !== 'function') return undefined
          const observer = new ResizeObserver(measure)
          observer.observe(node)
          return function () {
            observer.disconnect()
          }
        },
        [doc],
      )

      // Restore the persisted panel layout once the sidebar has a measurable width.
      React.useEffect(
        function () {
          if (restoredRef.current || bodyWidth <= 0) return
          restoredRef.current = true
          const stored = storedPanelsRef.current
          if (stored && typeof stored.treeOpen === 'boolean') setTreeOpen(stored.treeOpen)
          if (stored && typeof stored.inspectorOpen === 'boolean') {
            setInspectorOpen(stored.inspectorOpen)
          }
          // Frame the artboards once the restored layout has settled: the editor can fit
          // before the canvas has a size on a cold start.
          refitRef.current = true
        },
        [bodyWidth, setTreeOpen, setInspectorOpen],
      )

      // One framing pass after the restored layout settles.
      React.useLayoutEffect(
        function () {
          if (!refitRef.current || !doc) return
          const node = canvasRef.current
          if (!node || typeof node.getBoundingClientRect !== 'function') return
          const viewport = node.getBoundingClientRect()
          if (viewport.width < 40 || viewport.height < 40) return
          refitRef.current = false
          fitCanvasNow()
        },
        [doc, treeOpen, inspectorOpen, bodyWidth, narrow, canvasRef],
      )

      // Debounced refit when the canvas container changes size (splitters, sidebar resize,
      // narrow <-> wide switch) — unless the user has framed the view themselves.
      React.useEffect(
        function () {
          const node = canvasRef.current
          if (!node || typeof ResizeObserver !== 'function') return undefined
          function onResize() {
            if (refitTimerRef.current) clearTimeout(refitTimerRef.current)
            refitTimerRef.current = setTimeout(function () {
              refitTimerRef.current = null
              if (userAdjustedCameraRef.current) return
              const current = canvasRef.current
              if (!current) return
              const rect = current.getBoundingClientRect()
              if (rect.width < 40 || rect.height < 40) return
              fitCanvasNow()
            }, CANVAS_REFIT_MS)
          }
          const observer = new ResizeObserver(onResize)
          observer.observe(node)
          return function () {
            observer.disconnect()
            if (refitTimerRef.current) {
              clearTimeout(refitTimerRef.current)
              refitTimerRef.current = null
            }
          }
        },
        [doc, canvasRef],
      )

      // The canvas signals user intent: wheel zoom/pan and middle/space drag mark the camera
      // as user-framed so a later resize does not yank the view.
      React.useEffect(
        function () {
          const node = canvasRef.current
          if (!node || typeof node.addEventListener !== 'function') return undefined
          function mark() {
            userAdjustedCameraRef.current = true
          }
          function onPointerDown(event) {
            if (event.button === 1 || spaceHeldMirrorRef.current) mark()
          }
          node.addEventListener('wheel', mark, { passive: true })
          node.addEventListener('pointerdown', onPointerDown, true)
          return function () {
            node.removeEventListener('wheel', mark)
            node.removeEventListener('pointerdown', onPointerDown, true)
          }
        },
        [doc, canvasRef],
      )

      // Shift+1 frames every artboard, Shift+2 frames the selection.
      React.useEffect(
        function () {
          function onKeyDown(event) {
            if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
            const target = event.target
            const tag = target ? String(target.tagName || '').toUpperCase() : ''
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            if (target && target.isContentEditable) return
            if (event.code === 'Digit1') {
              event.preventDefault()
              fitCanvasNow()
            } else if (event.code === 'Digit2') {
              event.preventDefault()
              fitSelectionNow()
            }
          }
          document.addEventListener('keydown', onKeyDown)
          return function () {
            document.removeEventListener('keydown', onKeyDown)
          }
        },
        [doc, selectedLayerId],
      )

      // A drawer only exists in the narrow layout; close it when the sidebar grows.
      React.useEffect(
        function () {
          if (!narrow && drawer) setDrawer(null)
        },
        [narrow, drawer],
      )

      // Escape closes an open drawer before it reaches the canvas shortcuts.
      React.useEffect(
        function () {
          if (!drawer) return undefined
          function onKeyDown(event) {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (typeof event.preventDefault === 'function') event.preventDefault()
            setDrawer(null)
          }
          document.addEventListener('keydown', onKeyDown, true)
          return function () {
            document.removeEventListener('keydown', onKeyDown, true)
          }
        },
        [drawer],
      )

      // Persist panel geometry, collapse state and the layout mode after the restore pass.
      React.useEffect(
        function () {
          if (!restoredRef.current) return
          writePanelState({
            left: panelWidths.left,
            right: panelWidths.right,
            treeOpen: treeOpen,
            inspectorOpen: inspectorOpen,
            narrow: narrow,
          })
        },
        [panelWidths.left, panelWidths.right, treeOpen, inspectorOpen, narrow],
      )

      /* ------------------------------- early states ------------------------------- */

      if (!doc) {
        const failed = !!loadError
        return h(
          'div',
          { className: 'dc-app', ref: appRef },
          h(StyleTag, { key: 'style' }),
          h(
            'div',
            { className: 'dc-center' },
            failed
              ? h(
                  'span',
                  { className: 'dc-center-icon' },
                  h(Glyph, { name: 'alert', size: 20 }),
                )
              : h('div', { className: 'dc-spinner' }),
            h(
              'div',
              { className: 'dc-center-text' },
              failed ? strings.loadFailed : strings.loading,
            ),
            failed
              ? h('div', { className: 'dc-center-hint' }, loadError || strings.retryHint)
              : null,
            h(
              'div',
              { className: 'dc-center-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: failed ? 'dc-btn dc-btn-primary' : 'dc-btn',
                  onClick: retryNow,
                },
                strings.retry,
              ),
            ),
          ),
        )
      }

      /* ------------------------------- derived values ------------------------------- */

      const artboards = artboardsOf(doc)
      const computedByArtboard = new Map()
      if (tree && Array.isArray(tree.artboards)) {
        tree.artboards.forEach(function (entry) {
          if (entry && entry.artboard) computedByArtboard.set(entry.artboard.id, entry)
        })
      }

      const selectedLayerIds = Array.isArray(editorSelectedLayerIds)
        ? editorSelectedLayerIds.slice()
        : selectedLayerId
          ? [selectedLayerId]
          : []
      const selectionCount = selectedLayerIds.length
      const selectedNodes = []
      if (tree && tree.byId) {
        selectedLayerIds.forEach(function (layerId) {
          const node = tree.byId.get(layerId)
          if (node) selectedNodes.push(node)
        })
      }
      const primaryNode =
        selectedNode ||
        (selectedNodes.length && selectedNodes[0] ? selectedNodes[0] : null)
      const activeArtboardId =
        selectedArtboardId ||
        (primaryNode && primaryNode.artboard ? primaryNode.artboard.id : null)
      const activeArtboard = activeArtboardId ? findArtboardById(doc, activeArtboardId) : null
      const hasArtboards = artboards.length > 0
      const canUndo = typeof editor.canUndo === 'function' ? !!editor.canUndo() : true
      const canRedo = typeof editor.canRedo === 'function' ? !!editor.canRedo() : true
      const zoom = camera && typeof camera.zoom === 'number' ? camera.zoom : 1
      const selectionLabel =
        selectionCount > 1
          ? String(selectionCount) + ' ' + COPY.selected
          : selectionCount === 1 && primaryNode && primaryNode.layer
            ? primaryNode.layer.name || primaryNode.layer.id
            : activeArtboard
              ? activeArtboard.name || activeArtboard.id
              : strings.artboard

      /* ------------------------------- panel geometry + dragging ------------------------------- */

      function allowedMax(side) {
        if (bodyWidth <= 0) return PANEL_MAX
        const otherOpen = side === 'left' ? inspectorOpen : treeOpen
        const otherPref = side === 'left' ? panelWidths.right : panelWidths.left
        const otherWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, otherPref))
        const room =
          bodyWidth - 7 - (otherOpen ? otherWidth : 0) - PANEL_CANVAS_MIN
        return Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(room)))
      }

      const leftWidth = clampPanelWidth(panelWidths.left, allowedMax('left'))
      const rightWidth = clampPanelWidth(panelWidths.right, allowedMax('right'))

      function applyPanelWidth(side, nextWidth) {
        const max = allowedMax(side)
        const clamped = Math.round(Math.max(PANEL_MIN, Math.min(max, nextWidth)))
        setPanelWidths(function (previous) {
          if (previous[side] === clamped) return previous
          const next = Object.assign({}, previous)
          next[side] = clamped
          return next
        })
      }

      function beginPanelDrag(side, event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const startWidth = side === 'left' ? leftWidth : rightWidth
        setPanelDrag({ side: side, startX: event.clientX, startWidth: startWidth })
        try {
          if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId)
          }
        } catch (error) {
          /* pointer capture is best-effort */
        }
      }

      function movePanelDrag(event) {
        if (!panelDrag) return
        const delta = event.clientX - panelDrag.startX
        const raw = panelDrag.side === 'left' ? panelDrag.startWidth + delta : panelDrag.startWidth - delta
        applyPanelWidth(panelDrag.side, raw)
      }

      function endPanelDrag() {
        if (!panelDrag) return
        setPanelDrag(null)
      }

      function resetPanelWidth(side) {
        applyPanelWidth(side, side === 'left' ? PANEL_DEFAULT_LEFT : PANEL_DEFAULT_RIGHT)
        setPanelDrag(null)
      }

      function panelKeyDown(side, event) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          const current = side === 'left' ? leftWidth : rightWidth
          const step = event.key === 'ArrowLeft' ? -8 : 8
          applyPanelWidth(side, side === 'left' ? current + step : current - step)
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          resetPanelWidth(side)
        }
      }

      /* ------------------------------- menu + command plumbing ------------------------------- */

      function openMenu(kind, event) {
        if (!event || !event.currentTarget || !appRef.current) return
        const target = event.currentTarget
        const appNode = appRef.current
        const rect = target.getBoundingClientRect()
        const appRect = appNode.getBoundingClientRect()
        const top = Math.max(0, Math.round(rect.bottom - appRect.top + 6))
        const left = Math.round(rect.left - appRect.left)
        const right = Math.round(appRect.right - rect.right)
        const useRight = left + MENU_WIDTH > appRect.width - 8
        const placement = {
          kind: kind,
          top: top,
          left: useRight ? null : Math.max(8, left),
          right: useRight ? Math.max(8, right) : null,
        }
        setMenu(function (previous) {
          if (previous && previous.kind === kind && previous.top === top) return null
          return placement
        })
      }

      function closeMenu() {
        setMenu(null)
      }

      function openShortcuts() {
        setMenu(null)
        // The shortcuts registry (47-shortcuts.js) owns the one shortcuts sheet; the legacy
        // dialog below only remains for a bundle that predates it.
        if (typeof openShortcutsSheet === 'function') {
          openShortcutsSheet()
          return
        }
        setShortcutsOpen(true)
      }

      const exportCommand =
        (EXTENSIONS.commands || []).find(function (entry) {
          return /export/i.test(String(entry.id || '') + ' ' + String(entry.label || ''))
        }) || null

      function runCommandEntry(entry) {
        if (!entry || typeof entry.run !== 'function') return
        try {
          entry.run(editorApi)
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('command-failed', { id: String(entry.id || ''), message: shortError(error) })
        }
      }

      const extensionCommandItems = (EXTENSIONS.commands || [])
        .filter(function (entry) {
          return entry !== exportCommand
        })
        .map(function (entry, index) {
          return {
            id: 'command-' + String(entry.id || index),
            label: entry.label || entry.id || 'Command',
            onSelect: function () {
              runCommandEntry(entry)
            },
          }
        })

      /* ------------------------------- chrome actions ------------------------------- */

      function commitBoardName(nextName) {
        const name = String(nextName || '').trim()
        if (!name) return
        if (name === String((doc && doc.name) || '')) return
        runOps([{ type: 'board.update', patch: { name: name } }])
      }

      function resetZoom() {
        const delta = 1 - zoom
        if (!delta) return
        markUserAdjusted()
        zoomCameraBy(delta)
      }

      function markUserAdjusted() {
        userAdjustedCameraRef.current = true
      }

      /** Frame every artboard; also re-arms resize-driven auto-framing. */
      function fitCanvasNow() {
        userAdjustedCameraRef.current = false
        fitCamera()
      }

      /** Frame the selected layer(s) with a little breathing room around the box. */
      function fitSelectionNow() {
        const node = primaryNode
        const current = canvasRef.current
        const entry = node && layout && layout.entryById ? layout.entryById.get(node.artboard.id) : null
        if (!node || !current || !entry || typeof node.worldRect !== 'object') {
          fitCanvasNow()
          return
        }
        const viewport = current.getBoundingClientRect()
        if (viewport.width < 40 || viewport.height < 40) return
        const width = Math.max(1, finiteNumber(node.worldRect.width, 1))
        const height = Math.max(1, finiteNumber(node.worldRect.height, 1))
        const padding = Math.min(FIT_PADDING, Math.min(viewport.width, viewport.height) * 0.25)
        // Frame the layer without blowing a tiny element up to the hard zoom ceiling.
        const nextZoom = clamp(
          Math.min((viewport.width - padding) / width, (viewport.height - padding) / height),
          MIN_ZOOM,
          Math.min(MAX_ZOOM, 2),
        )
        const centerX = entry.frameX + node.worldRect.x + width / 2
        const centerY = entry.frameY + node.worldRect.y + height / 2
        const nextCamera = {
          x: Math.round(viewport.width / 2 - centerX * nextZoom),
          y: Math.round(viewport.height / 2 - centerY * nextZoom),
          zoom: nextZoom,
        }
        userAdjustedCameraRef.current = false
        if (typeof editor.setCameraValue === 'function') {
          editor.setCameraValue(nextCamera)
        } else if (typeof editor.setCamera === 'function') {
          editor.setCamera(nextCamera)
        }
      }

      function toggleCommentMode() {
        const next = !commentMode
        setCommentMode(next)
        if (!next) setComposer(null)
      }

      function toggleTreePanel() {
        if (narrow) {
          setDrawer(drawer === 'tree' ? null : 'tree')
          return
        }
        setTreeOpen(!treeOpen)
      }

      function toggleInspectorPanel() {
        if (narrow) {
          setDrawer(drawer === 'inspector' ? null : 'inspector')
          return
        }
        setInspectorOpen(!inspectorOpen)
      }

      function closeTreePanel() {
        if (narrow) setDrawer(null)
        else setTreeOpen(false)
      }

      function closeInspectorPanel() {
        if (narrow) setDrawer(null)
        else setInspectorOpen(false)
      }

      const treePanelVisible = narrow ? drawer === 'tree' : treeOpen
      const inspectorPanelVisible = narrow ? drawer === 'inspector' : inspectorOpen

      function clearAllSelection() {
        clearSelection()
        if (selectedArtboardId) selectArtboard(null)
      }

      function commentSelected() {
        if (selectedLayerId) openComposerFor(selectedLayerId, null)
      }

      function createArtboardFromPreset(options) {
        const width = clamp(Math.round(Number(options && options.width) || 0), 1, 8000)
        const height = clamp(Math.round(Number(options && options.height) || 0), 1, 8000)
        const current = doc
        if (!current) return
        if (artboardsOf(current).length >= ARTBOARD_LIMIT) {
          setMenu(null)
          setInlineError(strings.noArtboards)
          return
        }
        const artboard = {
          id: makeId('ab'),
          name: uniqueArtboardName(current, (options && options.label) || 'Artboard'),
          x: 0,
          y: 0,
          width: width,
          height: height,
          background: '#ffffff',
        }
        setMenu(null)
        const pending = runOps([{ type: 'artboard.add', artboard: artboard }])
        if (pending && typeof pending.then === 'function') {
          pending.then(function (result) {
            if (result && result.ok === false) return
            selectArtboard(artboard.id)
            fitCamera()
          })
        }
      }

      function duplicateActiveArtboard() {
        if (!activeArtboardId) return
        runOps([{ type: 'artboard.duplicate', artboardId: activeArtboardId }])
      }

      function deleteActiveArtboard() {
        if (!activeArtboardId) return
        runOps([{ type: 'artboard.delete', artboardId: activeArtboardId }])
        if (selectedArtboardId === activeArtboardId) clearAllSelection()
      }

      function addLineLayer() {
        if (!hasArtboards) return
        if (typeof editor.addLayer === 'function') {
          editor.addLayer('line')
          return
        }
        if (!activeArtboard) return
        runOps([
          {
            type: 'layer.add',
            artboardId: activeArtboard.id,
            layer: {
              id: makeId('l'),
              type: 'line',
              name: 'Line',
              x: Math.round(activeArtboard.width * 0.15),
              y: Math.round(activeArtboard.height * 0.5),
              width: Math.round(activeArtboard.width * 0.7),
              height: 1,
              stroke: '#111827',
              strokeWidth: 2,
              orientation: 'horizontal',
            },
          },
        ])
      }

      function addButtonPresetLayer() {
        if (!hasArtboards) return
        if (typeof editor.addButtonPreset === 'function') {
          editor.addButtonPreset()
          return
        }
        if (!activeArtboard) return
        const width = 168
        const height = 44
        const x = Math.round((activeArtboard.width - width) / 2)
        const y = Math.round((activeArtboard.height - height) / 2)
        const fill = '#3b82f6'
        runOps([
          {
            type: 'layer.add',
            artboardId: activeArtboard.id,
            layer: {
              id: makeId('l'),
              type: 'rect',
              name: 'Button',
              x: x,
              y: y,
              width: width,
              height: height,
              fill: fill,
              radius: 8,
              borderWidth: 0,
              borderColor: fill,
            },
          },
          {
            type: 'layer.add',
            artboardId: activeArtboard.id,
            layer: {
              id: makeId('l'),
              type: 'text',
              name: 'Button label',
              text: 'Button',
              x: x,
              y: y + Math.round((height - 20) / 2),
              width: width,
              height: 20,
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: DEFAULT_FONT,
              align: 'center',
              lineHeight: 20,
            },
          },
        ])
      }

      /* ------------------------------- stage ------------------------------- */

      // The renderer owns the crisp-zoom technique: `stageCameraStyle` (60-render.js) turns the
      // camera into a CSS `zoom` style so glyphs rasterize at their final size. The guarded
      // fallback keeps the stage on screen while that part is not loaded yet.
      const stageStyle =
        typeof stageCameraStyle === 'function'
          ? stageCameraStyle(camera)
          : {
              transform:
                'translate(' + camera.x + 'px, ' + camera.y + 'px) scale(' + zoom + ')',
              transformOrigin: '0 0',
            }

      /* ------------------------------- extension context ------------------------------- */

      const editorApi = {
        editor: editor,
        strings: strings,
        doc: doc,
        tree: tree,
        layout: layout,
        version: version,
        boardPath: boardPath,
        sessionId: props.sessionId,
        camera: camera,
        zoom: zoom,
        selection: {
          layerIds: selectedLayerIds,
          primaryLayerId: selectedLayerId,
          artboardId: selectedArtboardId,
        },
        selectedLayerId: selectedLayerId,
        selectedLayerIds: selectedLayerIds,
        selectedArtboardId: selectedArtboardId,
        selectedNode: primaryNode,
        comments: selectedComments,
        commentIndex: commentIndex,
        actions: Object.assign({}, handlers, {
          commitLayer: commitLayer,
          commitArtboard: commitArtboard,
          addLayer: addLayer,
          addButtonPreset: addButtonPresetLayer,
          deleteSelected: deleteSelectedLayer,
          duplicateSelected: duplicateSelected,
          selectLayer: selectLayer,
          selectLayers: selectLayers,
          selectArtboard: selectArtboard,
          clearSelection: clearAllSelection,
          toggleLock: toggleLock,
          groupSelection: groupSelection,
          ungroupSelection: ungroupSelection,
          alignSelection: alignSelection,
          distributeSelection: distributeSelection,
          arrangeSelection: arrangeSelection,
          updateLayer: editor.updateLayer,
          renameLayer: editor.renameLayer,
          renameArtboard: editor.renameArtboard,
          reorderLayer: editor.reorderLayer,
          setInlineError: setInlineError,
          setCommentStatus: setCommentStatus,
          deleteComment: deleteCommentById,
          openComposerFor: openComposerFor,
          sendCommentChat: sendCommentChat,
          runOps: runOps,
          undo: undoOnce,
          redo: redoOnce,
          fitCamera: fitCamera,
          zoomCameraBy: zoomCameraBy,
          openExport: exportCommand
            ? function () {
                runCommandEntry(exportCommand)
              }
            : null,
        }),
      }

      /* ------------------------------- menus ------------------------------- */

      const headerMenuItems = [
        {
          id: 'export',
          icon: 'export',
          label: COPY.exportItem,
          hint: MOD_LABEL + ' ' + SHIFT_LABEL + ' E',
          disabled: !exportCommand,
          title: exportCommand ? undefined : COPY.exportUnavailable,
          onSelect: function () {
            if (exportCommand) runCommandEntry(exportCommand)
          },
        },
        { id: 'shortcuts', icon: 'keyboard', label: COPY.shortcuts, onSelect: openShortcuts },
        { separator: true },
        { heading: COPY.zoomHeading + ' ' + Math.round(zoom * 100) + '%' },
        {
          id: 'fit',
          icon: 'fit',
          label: strings.zoomFit,
          hint: SHIFT_LABEL + ' 1',
          onSelect: fitCanvasNow,
        },
        {
          id: 'fit-selection',
          icon: 'search',
          label: COPY.fitSelection,
          hint: SHIFT_LABEL + ' 2',
          disabled: selectionCount === 0,
          onSelect: fitSelectionNow,
        },
        { id: 'reset-zoom', icon: 'zoomReset', label: COPY.resetZoom, onSelect: resetZoom },
        { separator: true },
        {
          id: 'duplicate-artboard',
          icon: 'copy',
          label: COPY.duplicateArtboard,
          disabled: !activeArtboardId,
          onSelect: duplicateActiveArtboard,
        },
        {
          id: 'delete-artboard',
          icon: 'trash',
          label: COPY.deleteArtboard,
          danger: true,
          disabled: !activeArtboardId,
          onSelect: deleteActiveArtboard,
        },
        { separator: true },
        {
          id: 'toggle-layers',
          icon: 'layers',
          label: strings.layers,
          checked: treePanelVisible,
          onSelect: toggleTreePanel,
        },
        {
          id: 'toggle-inspector',
          icon: 'inspector',
          label: strings.inspector,
          checked: inspectorPanelVisible,
          onSelect: toggleInspectorPanel,
        },
      ]
      if (extensionCommandItems.length) {
        headerMenuItems.push({ separator: true })
        headerMenuItems.push({ heading: COPY.extensions })
        extensionCommandItems.forEach(function (item) {
          headerMenuItems.push(item)
        })
      }

      const toolsMenuItems = [
        {
          id: 'undo',
          icon: 'undo',
          label: strings.undo,
          hint: MOD_LABEL + ' Z',
          disabled: !canUndo,
          title: canUndo ? undefined : COPY.noUndo,
          onSelect: undoOnce,
        },
        {
          id: 'redo',
          icon: 'redo',
          label: strings.redo,
          hint: MOD_LABEL + ' ' + SHIFT_LABEL + ' Z',
          disabled: !canRedo,
          title: canRedo ? undefined : COPY.noRedo,
          onSelect: redoOnce,
        },
        { separator: true },
        {
          id: 'comment-mode',
          icon: 'comment',
          label: strings.commentMode,
          checked: commentMode,
          onSelect: toggleCommentMode,
        },
        { separator: true },
        { heading: COPY.zoomHeading + ' ' + Math.round(zoom * 100) + '%' },
        {
          id: 'fit',
          icon: 'fit',
          label: strings.zoomFit,
          hint: SHIFT_LABEL + ' 1',
          onSelect: fitCanvasNow,
        },
        {
          id: 'fit-selection',
          icon: 'search',
          label: COPY.fitSelection,
          hint: SHIFT_LABEL + ' 2',
          disabled: selectionCount === 0,
          onSelect: fitSelectionNow,
        },
        { id: 'reset-zoom', icon: 'zoomReset', label: COPY.resetZoom, onSelect: resetZoom },
        { separator: true },
        {
          id: 'add-artboard',
          icon: 'artboard',
          label: strings.addArtboard,
          onSelect: addArtboard,
        },
        { id: 'shortcuts', icon: 'keyboard', label: COPY.shortcuts, onSelect: openShortcuts },
      ]

      const menuLabel =
        menu && menu.kind === 'presets'
          ? strings.addArtboard
          : menu && menu.kind === 'header'
            ? COPY.moreCommands
            : COPY.moreTools
      const menuStyle = menu
        ? menu.right !== null && menu.right !== undefined
          ? { top: menu.top, right: menu.right }
          : { top: menu.top, left: menu.left }
        : null

      /* ------------------------------- toolbar helpers ------------------------------- */

      function createTool(icon, title) {
        return h(ToolButton, {
          key: 'create-' + icon,
          icon: icon,
          title: title,
          iconOnly: true,
          disabled: !hasArtboards,
          onClick: function () {
            addLayer(icon)
          },
        })
      }

      const selectionGlyph =
        selectionCount > 1
          ? 'group'
          : primaryNode && glyphFits(primaryNode.type)
            ? primaryNode.type
            : 'artboard'

      /* ------------------------------- panels ------------------------------- */

      // One tree + one inspector element, reused verbatim by the wide layout and the narrow
      // overlay drawers so the two modes can never drift apart.
      const treePanelElement = h(LayerTree, {
        tree: tree,
        strings: strings,
        selectedLayerId: selectedLayerId,
        selectedLayerIds: selectedLayerIds,
        selectedArtboardId: selectedArtboardId,
        openCounts: commentIndex.openCounts,
        extensionContext: editorApi,
        actions: {
          selectLayer: selectLayer,
          selectLayers: selectLayers,
          selectArtboard: selectArtboard,
          toggleVisible: toggleVisible,
          toggleLock: toggleLock,
          moveSelected: moveSelected,
          deleteSelected: deleteSelectedLayer,
          reparent: reparentLayer,
          commitLayer: commitLayer,
          commitArtboard: commitArtboard,
          openComposer: openComposerFor,
          runOps: runOps,
          deleteArtboard: deleteArtboard,
          toggleTree: closeTreePanel,
        },
      })

      const inspectorPanelElement = h(Inspector, {
        doc: doc,
        tree: tree,
        strings: strings,
        selectedLayerId: selectedLayerId,
        selectedLayerIds: selectedLayerIds,
        selectedArtboardId: selectedArtboardId,
        comments: selectedComments,
        extensionContext: editorApi,
        actions: {
          commitLayer: commitLayer,
          commitArtboard: commitArtboard,
          enableLayout: function () {
            setFrameAutoLayout(true)
          },
          disableLayout: function () {
            setFrameAutoLayout(false)
          },
          patchLayout: patchFrameLayout,
          reparent: reparentLayer,
          commitShadow: commitShadow,
          clearShadow: clearShadow,
          selectLayer: selectLayer,
          selectLayers: selectLayers,
          selectArtboard: selectArtboard,
          toggleLock: toggleLock,
          deleteSelected: deleteSelectedLayer,
          groupSelection: groupSelection,
          ungroupSelection: ungroupSelection,
          alignSelection: alignSelection,
          distributeSelection: distributeSelection,
          arrangeSelection: arrangeSelection,
          runOps: runOps,
          resolveComment: function (commentId) {
            setCommentStatus(commentId, 'resolved')
          },
          reopenComment: function (commentId) {
            setCommentStatus(commentId, 'open')
          },
          deleteComment: deleteCommentById,
          openComposer: function () {
            const composedLayerId = selectedLayerIdRef.current
            if (composedLayerId) openComposerFor(composedLayerId, null)
          },
          chooseImageFile: function () {
            openImagePicker('inspector')
          },
          toggleInspector: closeInspectorPanel,
        },
      })

      const drawerWidth = narrow
        ? Math.min(
            Math.max(
              220,
              drawer === 'tree'
                ? Math.max(PANEL_MIN, panelWidths.left)
                : Math.max(260, panelWidths.right),
            ),
            Math.max(200, bodyWidth - 56),
          )
        : 0

      /* ------------------------------- render ------------------------------- */

      return h(
        'div',
        {
          className:
            'dc-app' +
            (narrow ? ' dc-narrow' : '') +
            (panelDrag ? ' dc-splitting' : ''),
          ref: appRef,
        },
        h(StyleTag, { key: 'style' }),
        h('input', {
          key: 'image-input',
          ref: imageInputRef,
          type: 'file',
          accept: IMAGE_ACCEPT,
          className: 'dc-file-input',
          style: { display: 'none' },
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onImageInputChange,
        }),
        h(
          'header',
          { className: 'dc-header' },
          h(
            'div',
            { className: 'dc-head-main' },
            h(ProjectName, {
              value: doc.name || '',
              fallback: strings.untitled,
              label: strings.name,
              title:
                (doc.name || strings.untitled) +
                ' — ' +
                boardPath +
                ' (' +
                COPY.nameHint +
                ')',
              onCommit: commitBoardName,
            }),
            h(StatusIndicator, {
              status: status,
              label: statusLabels[status] || strings.synced,
              title: status === 'offline' ? boardPath + ' — ' + strings.retryHint : boardPath,
              retryLabel: strings.retry,
              onRetry: status === 'offline' ? retryNow : null,
            }),
            h(
              'span',
              { className: 'dc-version', title: COPY.documentVersion + ' ' + String(version) },
              'v' + String(version),
            ),
          ),
          h(
            'div',
            { className: 'dc-head-actions' },
            h(ZoomControls, {
              label: strings.zoomFit,
              percent: Math.round(zoom * 100) + '%',
              zoomOut: strings.zoomOut,
              zoomIn: strings.zoomIn,
              zoomFit: strings.zoomFit,
              atMin: zoom <= MIN_ZOOM,
              atMax: zoom >= MAX_ZOOM,
              onZoomOut: function () {
                markUserAdjusted()
                zoomCameraBy(-ZOOM_STEP)
              },
              onZoomIn: function () {
                markUserAdjusted()
                zoomCameraBy(ZOOM_STEP)
              },
              onFit: fitCanvasNow,
              onReset: resetZoom,
            }),
            h(ToolButton, {
              icon: 'comment',
              title: strings.commentMode,
              iconOnly: true,
              active: commentMode,
              onClick: toggleCommentMode,
            }),
            h(ToolButton, {
              icon: 'more',
              title: COPY.moreCommands,
              iconOnly: true,
              menuToggle: true,
              onClick: function (event) {
                openMenu('header', event)
              },
            }),
          ),
        ),
        h(
          'div',
          { className: 'dc-toolbar', role: 'toolbar', 'aria-label': strings.pluginTitle },
          h(
            'div',
            { className: 'dc-tool-group' },
            h(ToolButton, {
              key: 'add-artboard',
              icon: 'artboard',
              title: strings.addArtboard,
              iconOnly: true,
              caret: true,
              menuToggle: true,
              disabled: artboards.length >= ARTBOARD_LIMIT,
              onClick: function (event) {
                openMenu('presets', event)
              },
            }),
            h('span', { className: 'dc-toolbar-divider', 'aria-hidden': 'true' }),
            createTool('rect', strings.rect),
            createTool('ellipse', strings.ellipse),
            createTool('text', strings.text),
            createTool('frame', strings.frame),
            h(ToolButton, {
              key: 'create-line',
              icon: 'line',
              title: COPY.line,
              iconOnly: true,
              disabled: !hasArtboards,
              onClick: addLineLayer,
            }),
            h(ToolButton, {
              key: 'create-button',
              icon: 'button',
              title: COPY.button,
              iconOnly: true,
              disabled: !hasArtboards,
              onClick: addButtonPresetLayer,
            }),
            h(ToolButton, {
              key: 'create-image',
              icon: 'image',
              title: strings.addImage,
              iconOnly: true,
              disabled: !hasArtboards,
              onClick: function () {
                openImagePicker('toolbar')
              },
            }),
            h('span', { className: 'dc-toolbar-divider', 'aria-hidden': 'true' }),
            h(ToolButton, {
              key: 'comment-selection',
              icon: 'comment',
              title: strings.comment,
              iconOnly: true,
              className: 'dc-toolbar-secondary',
              disabled: !selectedLayerId,
              onClick: commentSelected,
            }),
            h(ToolButton, {
              key: 'duplicate-selection',
              icon: 'copy',
              title: strings.duplicate,
              hint: MOD_LABEL + ' D',
              iconOnly: true,
              className: 'dc-toolbar-secondary',
              disabled: selectionCount === 0 && !selectedLayerId,
              onClick: duplicateSelected,
            }),
            // Feature parts add their own tool buttons here (line, button preset, export, …).
            renderExtensions(EXTENSIONS.toolbar, editorApi),
          ),
          h('span', { className: 'dc-spacer' }),
          h(
            'div',
            { className: 'dc-tool-group dc-toolbar-secondary' },
            h(IconButton, {
              icon: 'undo',
              title: strings.undo,
              disabled: !canUndo,
              onClick: undoOnce,
            }),
            h(IconButton, {
              icon: 'redo',
              title: strings.redo,
              disabled: !canRedo,
              onClick: redoOnce,
            }),
            h('span', { className: 'dc-toolbar-divider', 'aria-hidden': 'true' }),
          ),
          h(
            'div',
            { className: 'dc-tool-group dc-toolbar-view' },
            h(IconButton, {
              icon: 'layers',
              title: strings.layers,
              active: treePanelVisible,
              onClick: toggleTreePanel,
            }),
            h(IconButton, {
              icon: 'inspector',
              title: strings.inspector,
              active: inspectorPanelVisible,
              onClick: toggleInspectorPanel,
            }),
            h(IconButton, {
              icon: 'more',
              title: COPY.moreTools,
              menuToggle: true,
              onClick: function (event) {
                openMenu('tools', event)
              },
            }),
          ),
        ),
        // Selection tools (align/distribute/group/…) appear while something is selected.
        // The count chip is a fallback only: when the selection extensions are registered they
        // own the count, so the bar never shows two "N selected" chips.
        selectionCount > 0 || selectedArtboardId
          ? h(
              'div',
              { className: 'dc-selection-bar', key: 'selection-bar' },
              EXTENSIONS.selection.length
                ? null
                : h(
                    React.Fragment,
                    null,
                    h(
                      'span',
                      { className: 'dc-sel-chip', title: selectionLabel },
                      h(Glyph, { name: selectionGlyph, size: 12 }),
                      h('span', { className: 'dc-sel-chip-text' }, selectionLabel),
                    ),
                    h('span', { className: 'dc-sel-sep', 'aria-hidden': 'true' }),
                  ),
              renderExtensions(EXTENSIONS.selection, editorApi),
              h('span', { className: 'dc-spacer' }),
              h(IconButton, {
                icon: 'close',
                title: COPY.clearSelection,
                onClick: clearAllSelection,
              }),
            )
          : null,
        h(
          'div',
          { className: 'dc-body', ref: bodyRef },
          !narrow && treeOpen
            ? h(
                'div',
                {
                  key: 'tree',
                  className: 'dc-panel-slot dc-panel-left',
                  style: { width: leftWidth },
                  'aria-label': COPY.layerPanel,
                },
                treePanelElement,
              )
            : !narrow
              ? h(
                  'div',
                  { key: 'rail-tree', className: 'dc-rail dc-rail-left' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dc-rail-btn',
                      title: strings.layers,
                      'aria-label': strings.layers,
                      onClick: toggleTreePanel,
                    },
                    h(Glyph, { name: 'panelLeft', size: 14 }),
                  ),
                )
              : null,
          !narrow && treeOpen
            ? h(Splitter, {
                key: 'split-left',
                value: leftWidth,
                min: PANEL_MIN,
                max: allowedMax('left'),
                active: !!(panelDrag && panelDrag.side === 'left'),
                title: COPY.resizePanel,
                onPointerDown: function (event) {
                  beginPanelDrag('left', event)
                },
                onPointerMove: movePanelDrag,
                onPointerUp: endPanelDrag,
                onPointerCancel: endPanelDrag,
                onDoubleClick: function () {
                  resetPanelWidth('left')
                },
                onKeyDown: function (event) {
                  panelKeyDown('left', event)
                },
              })
            : null,
          h(
            'div',
            {
              key: 'canvas',
              className:
                'dc-canvas' +
                (commentMode ? ' dc-comment-mode' : '') +
                (gestureActive ? ' dc-gesture-active' : '') +
                (panning ? ' dc-panning' : '') +
                (spaceHeld && !panning ? ' dc-space-pan' : '') +
                (dragOver ? ' dc-drag-over' : ''),
              ref: canvasRef,
              title: dragOver ? strings.imageHint : undefined,
              onPointerDown: canvasPointerDown,
              onPointerMove: canvasPointerMove,
              onPointerUp: canvasPointerUp,
              onPointerCancel: canvasPointerCancel,
              onPointerEnter: function () {
                canvasHoverRef.current = true
              },
              onPointerLeave: function () {
                canvasHoverRef.current = false
              },
              onDragOver: canvasDragOver,
              onDragLeave: canvasDragLeave,
              onDrop: canvasDrop,
            },
            artboards.length === 0
              ? h(
                  'div',
                  { className: 'dc-center' },
                  h('span', { className: 'dc-center-icon' }, h(Glyph, { name: 'artboard', size: 20 })),
                  h('div', { className: 'dc-center-text' }, strings.noArtboards),
                  h('div', { className: 'dc-center-hint' }, COPY.emptyArtboardHint),
                  h(
                    'div',
                    { className: 'dc-center-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dc-btn dc-btn-primary',
                        'data-dc-menu-toggle': '',
                        onClick: function (event) {
                          openMenu('presets', event)
                        },
                      },
                      strings.addArtboard,
                    ),
                  ),
                )
              : h(
                  'div',
                  {
                    className: 'dc-stage',
                    style: Object.assign({}, stageStyle, {
                      width: Math.max(1, layout.width),
                      height: Math.max(1, layout.height),
                    }),
                  },
                  artboards.map(function (artboard) {
                    if (!isObject(artboard)) return null
                    const computedEntry = computedByArtboard.get(artboard.id) || null
                    return h(ArtboardView, {
                      key: String(artboard.id),
                      artboard: artboard,
                      entry: layout.entryById.get(artboard.id) || null,
                      nodes: computedEntry ? computedEntry.layers : [],
                      selectedNode: selectedNode,
                      selectedNodes: selectedNodes,
                      selectedLayerIds: selectedLayerIds,
                      zoom: zoom,
                      strings: strings,
                      handlers: handlers,
                      selectedLayerId: selectedLayerId,
                      selectedArtboardId: selectedArtboardId,
                      pins: commentIndex.pinsByArtboard.get(artboard.id) || [],
                    })
                  }),
                ),
            composerPlacement
              ? h(
                  'div',
                  {
                    className: 'dc-composer',
                    key: 'composer',
                    style: { left: composerPlacement.left, top: composerPlacement.top },
                    onPointerDown: function (event) {
                      event.stopPropagation()
                    },
                  },
                  h(
                    'div',
                    { className: 'dc-composer-title' },
                    strings.commentOn +
                      ': ' +
                      (composerPlacement.target.name || composerPlacement.target.id),
                  ),
                  h(
                    'div',
                    { className: 'dc-cmt-chip-target', title: composerPlacement.target.id || '' },
                    layerChipLabel(composerPlacement.target.type),
                  ),
                  h('textarea', {
                    className: 'dc-textarea dc-composer-text',
                    rows: 3,
                    maxLength: 2000,
                    autoFocus: true,
                    value: composer && composer.text,
                    placeholder: strings.commentPlaceholder,
                    onChange: function (event) {
                      handlers.composerChange(event.target.value)
                    },
                    onKeyDown: function (event) {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        handlers.composerCancel()
                      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        handlers.composerSend()
                      }
                    },
                  }),
                  commentError ? h('div', { className: 'dc-composer-error' }, commentError) : null,
                  h(
                    'div',
                    { className: 'dc-composer-actions' },
                    h(
                      'span',
                      {
                        className:
                          'dc-cmt-counter' +
                          (composer && String(composer.text || '').length > 1600
                            ? ' dc-cmt-counter-warn'
                            : ''),
                        title: 'Max 2000 characters',
                      },
                      String(composer && composer.text ? String(composer.text).length : 0) +
                        '/2000',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dc-btn',
                        disabled: commentBusy,
                        onClick: handlers.composerCancel,
                      },
                      strings.cancel,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dc-btn dc-btn-primary',
                        disabled: commentBusy || !String((composer && composer.text) || '').trim(),
                        onClick: handlers.composerSend,
                      },
                      commentBusy ? strings.sending : strings.send,
                    ),
                  ),
                )
              : null,
          ),
          !narrow && inspectorOpen
            ? h(Splitter, {
                key: 'split-right',
                value: rightWidth,
                min: PANEL_MIN,
                max: allowedMax('right'),
                active: !!(panelDrag && panelDrag.side === 'right'),
                title: COPY.resizePanel,
                onPointerDown: function (event) {
                  beginPanelDrag('right', event)
                },
                onPointerMove: movePanelDrag,
                onPointerUp: endPanelDrag,
                onPointerCancel: endPanelDrag,
                onDoubleClick: function () {
                  resetPanelWidth('right')
                },
                onKeyDown: function (event) {
                  panelKeyDown('right', event)
                },
              })
            : null,
          !narrow && inspectorOpen
            ? h(
                'div',
                {
                  key: 'inspector',
                  className: 'dc-panel-slot dc-panel-right',
                  style: { width: rightWidth },
                  'aria-label': COPY.inspectorPanel,
                },
                inspectorPanelElement,
              )
            : !narrow
              ? h(
                  'div',
                  { key: 'rail-inspector', className: 'dc-rail dc-rail-right' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dc-rail-btn',
                      title: strings.inspector,
                      'aria-label': strings.inspector,
                      onClick: toggleInspectorPanel,
                    },
                    h(Glyph, { name: 'panelRight', size: 14 }),
                  ),
                )
              : null,
          // Narrow layout: the active panel floats over the canvas as a dismissible drawer.
          narrow && drawer
            ? h(
                'button',
                {
                  key: 'drawer-scrim',
                  type: 'button',
                  className: 'dc-drawer-scrim',
                  title: COPY.closePanel,
                  'aria-label': COPY.closePanel,
                  onClick: function () {
                    setDrawer(null)
                  },
                },
              )
            : null,
          narrow && drawer
            ? h(
                'div',
                {
                  key: 'drawer',
                  className: 'dc-drawer dc-drawer-' + drawer,
                  style: { width: drawerWidth },
                  role: 'dialog',
                  'aria-label': drawer === 'tree' ? COPY.layerPanel : COPY.inspectorPanel,
                },
                drawer === 'tree' ? treePanelElement : inspectorPanelElement,
              )
            : null,
        ),
        menu
          ? h(
              MenuPanel,
              { key: 'menu', label: menuLabel, style: menuStyle, onClose: closeMenu },
              menu.kind === 'presets'
                ? h(ArtboardPresets, { onCreate: createArtboardFromPreset })
                : h(MenuList, {
                    items: menu.kind === 'header' ? headerMenuItems : toolsMenuItems,
                    onClose: closeMenu,
                  }),
            )
          : null,
        shortcutsOpen
          ? h(ShortcutsDialog, {
              key: 'shortcuts',
              title: COPY.shortcuts,
              closeLabel: strings.dismiss,
              onClose: function () {
                setShortcutsOpen(false)
              },
            })
          : null,
        // Full-app overlays registered by feature parts (export dialog, shortcuts sheet, …).
        renderExtensions(EXTENSIONS.appPanels, editorApi),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Body entry + conversation-row button
     * ---------------------------------------------------------------------------------------- */
