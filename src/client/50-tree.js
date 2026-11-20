    /* ------------------------------------------------------------------------------------------
     * Layer tree (v2): multi-select, inline rename, lock, filter, drop indicators
     *
     * The tree is deliberately defensive: it reads the selection from a native
     * `selectedLayerIds` prop/editor field when the interaction update has landed, and otherwise
     * keeps a tiny module-level fallback selection (`SELECTION_FALLBACK`) that the inspector
     * (55-inspector.js) subscribes to as well. That keeps tree multi-select and multi-layer
     * editing working while the shell wiring (74-shell.js) and the editor hook (70-editor.js)
     * are still being upgraded in parallel.
     *
     * Every mutation is routed through a feature-detected chain (`renameLayer` -> `updateLayer`
     * -> `runOps` -> the v1 single-selection actions) so the tree never crashes on a missing
     * action; the report lists the actions the shell should pass down.
     * ---------------------------------------------------------------------------------------- */

    const TREE_COPY = {
      search: 'Filter…',
      searchAria: 'Filter layers by name or type',
      searchTitle: 'Filter by layer name, type or id — Esc clears',
      clearSearch: 'Clear filter',
      noMatch: 'No layers match this filter',
      empty: 'No layers yet — add one from the toolbar',
      renameLayer: 'Rename layer',
      renameArtboard: 'Rename artboard',
      renameHint: 'Double-click the name to rename',
      renameInInspector: 'Rename it in the inspector (the shell does not pass a rename action yet)',
      lock: 'Lock',
      unlock: 'Unlock',
      lockedHint: 'Locked — canvas drag/resize is disabled (the agent can still edit it)',
      unlockHint: 'Click to lock this layer (canvas drag/resize is disabled)',
      collapse: 'Collapse',
      expand: 'Expand',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      moveUp: 'Bring forward (Ctrl/Cmd+↑)',
      moveDown: 'Send backward (Ctrl/Cmd+↓)',
      openComment: 'Open this layer in the comment composer',
      countOne: '1 layer',
      matchesOne: '1 match',
      selectedOne: '1 selected',
    }

    const TREE_CSS = `
.dct { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.dct-tools { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 4px 5px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dct-search { position: relative; display: flex; align-items: center; gap: 3px; flex: 1 1 auto; min-width: 0; }
.dct-search-icon { position: absolute; left: 4px; display: inline-flex; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.dct-search-input { padding-left: 18px; height: 21px; }
.dct-clear { position: absolute; right: 2px; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dct-count { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dct-tree { display: flex; flex-direction: column; gap: 0; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 3px 3px 6px; }
.dct-row { display: flex; align-items: center; gap: 3px; min-height: 22px; padding: 1px 3px 1px 2px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-secondary); position: relative; }
.dct-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dct-row.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dct-row.dct-primary { box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dct-row.dic-drop-before::before, .dct-row.dic-drop-after::after { content: ''; position: absolute; left: 2px; right: 2px; height: 2px; background: var(--dsw-alias-brand-primary); border-radius: 1px; }
.dct-row.dic-drop-before::before { top: -1px; }
.dct-row.dic-drop-after::after { bottom: -1px; }
.dct-row.dc-drop-into, .dct-ab.dc-drop-into { outline: 1px dashed var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dct-caret { flex: 0 0 auto; }
.dct-icon { display: inline-flex; flex: 0 0 auto; width: 13px; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); }
.dct-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dct-name.dct-hidden { opacity: 0.55; font-style: italic; }
.dct-hit { background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-bg-base); border-radius: 2px; padding: 0 1px; }
.dct-rename { height: 19px; font-size: 11px; padding: 0 3px; }
.dct-mini { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dct-mini.dc-off { opacity: 0.45; }
.dct-mini.dct-locked { color: var(--dsw-alias-state-warn-primary); opacity: 1; }
.dct-badge { flex: 0 0 auto; min-width: 14px; height: 14px; padding: 0 3px; border: none; border-radius: 7px; background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-bg-base); font-size: 9px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
button.dct-badge { cursor: pointer; }
.dct-ab { display: flex; align-items: center; gap: 4px; min-height: 23px; padding: 2px 4px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; cursor: pointer; text-align: left; }
.dct-ab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dct-ab.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dct-ab-meta { flex: 0 0 auto; font-size: 9px; opacity: 0.75; font-variant-numeric: tabular-nums; }
.dct-group { display: flex; flex-direction: column; gap: 0; margin-bottom: 3px; }
.dct-foot { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 3px 4px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dct-foot-count { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-size: 9px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dct-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dct-empty-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); }
/* Hover affordances only where hovering is real: no sticky hover on touch screens. */
@media (hover: hover) and (pointer: fine) {
.dct-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dct-ab:hover { background: var(--dsw-alias-bg-layer-2); }
.dct-mini:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dct-clear:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
}
`

    /* Local glyphs for the v2 layer types and the lock toggle. `40-icons.js` owns the shared
     * glyph set; these stay here so the tree does not depend on another part's edit. */
    const TREE_EXTRA_GLYPHS = {
      line: ['M2.5 13.5L13.5 2.5'],
      group: ['M2.5 2.5h4v4h-4z', 'M9.5 2.5h4v4h-4z', 'M2.5 9.5h4v4h-4z', 'M9.5 9.5h4v4h-4z'],
      lock: ['M4 7.5h8v5.5h-8z', 'M6 7.5V5.8a2 2 0 1 1 4 0v1.7'],
      unlock: ['M4 7.5h8v5.5h-8z', 'M6 7.5V5.8a2 2 0 0 1 3.8-0.8'],
      search: ['M7.2 2.5a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4z', 'M10.6 10.6L13.5 13.5'],
      arrowUp: ['M8 13V4', 'M4.5 7.5L8 4l3.5 3.5'],
      arrowDown: ['M8 3v9', 'M4.5 8.5L8 12l3.5-3.5'],
    }

    /** Shared glyphs from 40-icons.js win; the local paths only cover names it does not have. */
    function TreeGlyph(props) {
      const name = props.name
      if (typeof glyphFits === 'function' && glyphFits(name)) {
        return h(Glyph, { name: name, size: props.size })
      }
      const paths = TREE_EXTRA_GLYPHS[name]
      if (!paths) return h(Glyph, { name: name, size: props.size })
      return h(
        'svg',
        {
          width: props.size || 14,
          height: props.size || 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: '0 0 auto', display: 'block' },
        },
        paths.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Selection: native first, tiny shared fallback second
     * ---------------------------------------------------------------------------------------- */

    const SELECTION_FALLBACK = { ids: [], listeners: [] }

    function fallbackSelectionIds() {
      return SELECTION_FALLBACK.ids.slice()
    }

    function setFallbackSelectionIds(ids) {
      const next = []
      const list = Array.isArray(ids) ? ids : []
      for (let index = 0; index < list.length; index += 1) {
        const id = list[index]
        if (typeof id === 'string' && id && next.indexOf(id) < 0) next.push(id)
      }
      const previous = SELECTION_FALLBACK.ids
      if (next.length === previous.length) {
        let same = true
        for (let index = 0; index < next.length; index += 1) {
          if (next[index] !== previous[index]) {
            same = false
            break
          }
        }
        if (same) return
      }
      SELECTION_FALLBACK.ids = next
      const listeners = SELECTION_FALLBACK.listeners.slice()
      for (let index = 0; index < listeners.length; index += 1) {
        try {
          listeners[index]()
        } catch (error) {
          /* a selection listener must never break the tree */
        }
      }
    }

    function subscribeFallbackSelection(listener) {
      if (typeof listener !== 'function') return function () {}
      SELECTION_FALLBACK.listeners.push(listener)
      return function () {
        const index = SELECTION_FALLBACK.listeners.indexOf(listener)
        if (index >= 0) SELECTION_FALLBACK.listeners.splice(index, 1)
      }
    }

    /** The editor hook, reachable through the extension context the shell passes to the inspector. */
    function editorFromProps(props) {
      const context = props && props.extensionContext
      if (!context) return null
      if (isObject(context.editor)) return context.editor
      if (typeof context.commitLayer === 'function') return context
      return null
    }

    /** Native multi-selection ids supplied by the shell or the editor hook, or null. */
    function nativeSelectionIds(props) {
      if (Array.isArray(props.selectedLayerIds) && props.selectedLayerIds.length > 1) {
        return props.selectedLayerIds.slice()
      }
      const context = props.extensionContext
      if (context && context.selection && Array.isArray(context.selection.layerIds)) {
        if (context.selection.layerIds.length > 1) return context.selection.layerIds.slice()
      }
      const editor = editorFromProps(props)
      if (editor && Array.isArray(editor.selectedLayerIds) && editor.selectedLayerIds.length > 1) {
        return editor.selectedLayerIds.slice()
      }
      return null
    }

    /**
     * Current selection as an id array: the native multi-selection wins, then the local fallback
     * group, then the single primary id. Pure: safe to call during render.
     */
    function resolvedSelectionIds(props) {
      const native = nativeSelectionIds(props)
      if (native) return native
      const fallback = fallbackSelectionIds()
      const primary = typeof props.selectedLayerId === 'string' ? props.selectedLayerId : ''
      if (fallback.length) {
        if (fallback.indexOf(primary) >= 0) return fallback
        // The canvas replaced the selection since this fallback group was built.
        return primary ? [primary] : fallback
      }
      return primary ? [primary] : []
    }

    /** Re-render when the fallback selection changes; returns the resolved selection ids. */
    function useSelectionIds(props) {
      const state = React.useState(0)
      const bump = state[1]
      React.useEffect(function () {
        return subscribeFallbackSelection(function () {
          bump(function (value) {
            return value + 1
          })
        })
      }, [])
      return resolvedSelectionIds(props)
    }

    /** Plain click: exactly the v1 behaviour (one layer, primary), clearing any fallback group. */
    function selectSingleLayer(props, layerId, artboardId) {
      setFallbackSelectionIds([])
      const actions = (props && props.actions) || {}
      if (typeof actions.selectLayer === 'function') {
        actions.selectLayer(layerId, artboardId || null)
        return
      }
      const editor = editorFromProps(props)
      if (editor && typeof editor.selectLayer === 'function') {
        editor.selectLayer(layerId, artboardId || null)
      }
    }

    /** Shift/Ctrl/Cmd click: extend or shrink the selection. */
    function writeSelectionIds(props, ids, artboardId) {
      const list = []
      const input = Array.isArray(ids) ? ids : []
      for (let index = 0; index < input.length; index += 1) {
        const id = input[index]
        if (typeof id === 'string' && id && list.indexOf(id) < 0) list.push(id)
      }
      if (list.length === 0) return
      const actions = (props && props.actions) || {}
      const editor = editorFromProps(props)
      if (typeof actions.selectLayers === 'function') {
        actions.selectLayers(list, artboardId || null)
        return
      }
      if (editor && typeof editor.selectLayers === 'function') {
        editor.selectLayers(list, artboardId || null)
        return
      }
      setFallbackSelectionIds(list)
      // Keep the single-selection API (canvas overlay, composer, ...) on the primary layer.
      const primary = list[list.length - 1]
      if (typeof actions.selectLayer === 'function') actions.selectLayer(primary, artboardId || null)
    }

    /* ------------------------------------------------------------------------------------------
     * Rename helpers (inline in the tree, reused by the inspector Name field)
     * ---------------------------------------------------------------------------------------- */

    function canRenameLayerById(props) {
      const actions = (props && props.actions) || {}
      if (typeof actions.renameLayer === 'function') return true
      if (typeof actions.updateLayer === 'function') return true
      if (typeof actions.runOps === 'function') return true
      if (typeof actions.commitLayer === 'function') return true
      const editor = editorFromProps(props)
      if (editor && (typeof editor.renameLayer === 'function' || typeof editor.runOps === 'function')) {
        return true
      }
      return false
    }

    /** True when a per-layer writer exists (so renaming one row never touches the selection). */
    function hasPerLayerWriter(props) {
      const actions = (props && props.actions) || {}
      if (typeof actions.renameLayer === 'function') return true
      if (typeof actions.updateLayer === 'function') return true
      const editor = editorFromProps(props)
      if (editor && (typeof editor.renameLayer === 'function' || typeof editor.updateLayer === 'function')) {
        return true
      }
      return false
    }

    function commitLayerName(props, layerId, artboardId, name) {
      const value = typeof name === 'string' ? name.trim() : ''
      if (!value || typeof layerId !== 'string') return
      const actions = (props && props.actions) || {}
      const editor = editorFromProps(props)
      if (typeof actions.renameLayer === 'function') {
        actions.renameLayer(layerId, value)
        return
      }
      if (typeof actions.updateLayer === 'function') {
        actions.updateLayer(layerId, { name: value })
        return
      }
      if (editor && typeof editor.renameLayer === 'function') {
        editor.renameLayer(layerId, value)
        return
      }
      if (editor && typeof editor.updateLayer === 'function') {
        editor.updateLayer(layerId, { name: value })
        return
      }
      // v2 editor: commitLayer applies the patch to the whole selection as one undo entry. The
      // rename flow collapses the selection to this row first, so this renames exactly one layer.
      if (typeof actions.commitLayer === 'function') {
        actions.commitLayer({ name: value })
        return
      }
      // Last resort: a raw op (not undoable) is still better than dropping the rename.
      if (typeof actions.runOps === 'function') {
        actions.runOps([{ type: 'layer.update', layerId: layerId, patch: { name: value } }])
      }
    }

    function canRenameArtboardById(props) {
      const actions = (props && props.actions) || {}
      if (typeof actions.renameArtboard === 'function') return true
      if (typeof actions.updateArtboard === 'function') return true
      if (typeof actions.runOps === 'function') return true
      if (typeof actions.commitArtboard === 'function') return true
      const editor = editorFromProps(props)
      if (editor && (typeof editor.renameArtboard === 'function' || typeof editor.commitArtboard === 'function')) {
        return true
      }
      return false
    }

    function commitArtboardName(props, artboardId, name) {
      const value = typeof name === 'string' ? name.trim() : ''
      if (!value || typeof artboardId !== 'string') return
      const actions = (props && props.actions) || {}
      if (typeof actions.renameArtboard === 'function') {
        actions.renameArtboard(artboardId, value)
        return
      }
      if (typeof actions.updateArtboard === 'function') {
        actions.updateArtboard(artboardId, { name: value })
        return
      }
      const editor = editorFromProps(props)
      if (editor && typeof editor.renameArtboard === 'function') {
        editor.renameArtboard(artboardId, value)
        return
      }
      // Undoable path: `commitArtboard` targets the selected artboard (the rename selects it).
      if (typeof actions.commitArtboard === 'function') {
        actions.commitArtboard({ name: value })
        return
      }
      if (typeof actions.runOps === 'function') {
        actions.runOps([{ type: 'artboard.update', artboardId: artboardId, patch: { name: value } }])
      }
    }

    /** Inline rename input: select-all on focus, Enter/blur commits, Esc cancels, empty = keep. */
    function TreeRenameInput(props) {
      const inputRef = React.useRef(null)
      const finishedRef = React.useRef(false)
      const draftState = React.useState(typeof props.value === 'string' ? props.value : '')
      const draft = draftState[0]
      const setDraft = draftState[1]

      React.useEffect(function () {
        const node = inputRef.current
        if (!node) return
        try {
          if (typeof node.focus === 'function') node.focus()
          if (typeof node.select === 'function') node.select()
        } catch (error) {
          /* focus is best-effort */
        }
      }, [])

      function finish(commit) {
        if (finishedRef.current) return
        finishedRef.current = true
        const trimmed = String(draft || '').trim()
        if (commit && trimmed && trimmed !== props.value) props.onCommit(trimmed)
        if (typeof props.onDone === 'function') props.onDone()
      }

      return h('input', {
        ref: inputRef,
        className: 'dc-input dct-rename',
        type: 'text',
        value: draft,
        spellCheck: false,
        'aria-label': props.label || 'Name',
        title: props.label || 'Name',
        onClick: function (event) {
          event.stopPropagation()
        },
        onDoubleClick: function (event) {
          event.stopPropagation()
        },
        onPointerDown: function (event) {
          event.stopPropagation()
        },
        onChange: function (event) {
          setDraft(event.target.value)
        },
        onBlur: function () {
          finish(true)
        },
        onKeyDown: function (event) {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        },
      })
    }

    /* ------------------------------------------------------------------------------------------
     * Tree row model helpers (tolerant of containers the layout pass has not built yet)
     * ---------------------------------------------------------------------------------------- */

    function treeIsContainerType(type) {
      return type === 'frame' || type === 'group'
    }

    function treeLayerChildren(layer) {
      if (!isObject(layer)) return []
      if (!treeIsContainerType(layer.type)) return []
      return Array.isArray(layer.children) ? layer.children : []
    }

    /** Children nodes of a computed node; falls back to the raw layer's children for groups. */
    function treeNodeChildren(node) {
      if (!node) return []
      if (Array.isArray(node.children)) return node.children
      const layer = node.layer
      const kids = treeLayerChildren(layer)
      if (kids.length === 0) return []
      const synthetic = []
      for (let index = 0; index < kids.length; index += 1) {
        const child = kids[index]
        if (!isObject(child)) continue
        synthetic.push({
          id: child.id,
          layer: child,
          type: child.type,
          artboard: node.artboard,
          parent: node,
          parentId: node.id,
          index: index,
          depth: finiteNumber(node.depth, 1) + 1,
          x: finiteNumber(child.x, 0),
          y: finiteNumber(child.y, 0),
          width: Math.max(1, finiteNumber(child.width, 1)),
          height: Math.max(1, finiteNumber(child.height, 1)),
          worldRect: {
            x: 0,
            y: 0,
            width: Math.max(1, finiteNumber(child.width, 1)),
            height: Math.max(1, finiteNumber(child.height, 1)),
          },
          autoParent: false,
          children: null,
        })
      }
      return synthetic
    }

    function siblingNodesOf(tree, node) {
      if (!node) return []
      if (node.parent) return treeNodeChildren(node.parent)
      const boards = tree && Array.isArray(tree.artboards) ? tree.artboards : []
      for (let index = 0; index < boards.length; index += 1) {
        const entry = boards[index]
        if (entry && entry.artboard && node.artboard && entry.artboard.id === node.artboard.id) {
          return Array.isArray(entry.layers) ? entry.layers : []
        }
      }
      return []
    }

    const TREE_TYPE_NAMES = {
      rect: 'Rectangle',
      ellipse: 'Ellipse',
      text: 'Text',
      image: 'Image',
      frame: 'Frame',
      line: 'Line',
      group: 'Group',
    }

    function treeTypeName(type) {
      return TREE_TYPE_NAMES[type] || String(type || 'Layer')
    }

    function treeGlyphName(type) {
      const shared = typeof layerTypeLabel === 'function' ? layerTypeLabel(type) : ''
      if (typeof glyphFits === 'function' && glyphFits(shared)) return shared
      if (TREE_TYPE_NAMES[type]) return type
      return 'dot'
    }

    function collectTreeNodeIds(nodes, target) {
      if (!(target instanceof Set)) return target
      const list = Array.isArray(nodes) ? nodes : []
      for (let index = 0; index < list.length; index += 1) {
        const node = list[index]
        if (!node || typeof node.id !== 'string') continue
        target.add(node.id)
        const kids = treeNodeChildren(node)
        if (kids.length) collectTreeNodeIds(kids, target)
      }
      return target
    }

    /** Match a row against the filter query (name, type label, raw type, id). */
    function nodeMatchesQuery(node, query) {
      if (!query) return false
      const layer = node && node.layer
      if (!isObject(layer)) return false
      const q = String(query).toLowerCase()
      if (String(layer.name || '').toLowerCase().indexOf(q) >= 0) return true
      if (String(treeTypeName(layer.type)).toLowerCase().indexOf(q) >= 0) return true
      if (String(layer.type || '').toLowerCase().indexOf(q) >= 0) return true
      if (String(layer.id || '').toLowerCase().indexOf(q) >= 0) return true
      return false
    }

    function searchHighlight(text, query) {
      const value = String(text || '')
      const q = typeof query === 'string' ? query : ''
      if (!q) return value
      const at = value.toLowerCase().indexOf(q.toLowerCase())
      if (at < 0) return value
      return [
        value.slice(0, at),
        h('mark', { key: 'hit', className: 'dct-hit' }, value.slice(at, at + q.length)),
        value.slice(at + q.length),
      ]
    }

    /* ------------------------------------------------------------------------------------------
     * Layer tree component
     * ---------------------------------------------------------------------------------------- */

    function LayerTree(props) {
      const strings = props.strings || currentStrings()
      const tree = props.tree
      const actions = props.actions || {}
      const openCounts = props.openCounts
      const selectedArtboardId = props.selectedArtboardId
      const selectedIds = useSelectionIds(props)
      const selectedSet = new Set(selectedIds)
      const primaryId = typeof props.selectedLayerId === 'string' ? props.selectedLayerId : selectedIds.length ? selectedIds[selectedIds.length - 1] : ''
      const computedArtboards = tree && Array.isArray(tree.artboards) ? tree.artboards : []

      const collapsedState = React.useState({})
      const collapsed = collapsedState[0]
      const setCollapsed = collapsedState[1]
      const dropState = React.useState(null)
      const drop = dropState[0]
      const setDrop = dropState[1]
      const editingState = React.useState(null)
      const editing = editingState[0]
      const setEditing = editingState[1]
      const queryState = React.useState('')
      const query = queryState[0]
      const setQuery = queryState[1]
      const dragRef = React.useRef(null)
      const trimmedQuery = query.trim()
      const renameLayersOk = canRenameLayerById(props)
      const renameArtboardsOk = canRenameArtboardById(props)
      const renameHintText = renameLayersOk ? TREE_COPY.renameHint : TREE_COPY.renameInInspector

      // Drop fallback-selection ids that no longer exist (deleted layers, external revisions).
      React.useEffect(
        function () {
          const ids = fallbackSelectionIds()
          if (!ids.length) return
          const byId = tree && tree.byId ? tree.byId : null
          if (!byId) return
          const alive = ids.filter(function (id) {
            return byId.has(id)
          })
          if (alive.length !== ids.length) setFallbackSelectionIds(alive)
        },
        [tree],
      )

      const filter = React.useMemo(
        function () {
          const state = {
            query: trimmedQuery,
            active: !!trimmedQuery,
            visible: new Set(),
            matched: new Set(),
            expand: new Set(),
          }
          if (!state.active) return state
          function walk(nodes) {
            let hit = false
            const list = Array.isArray(nodes) ? nodes : []
            for (let index = 0; index < list.length; index += 1) {
              const node = list[index]
              if (!node || typeof node.id !== 'string') continue
              const kids = treeNodeChildren(node)
              const childHit = kids.length ? walk(kids) : false
              const self = nodeMatchesQuery(node, state.query)
              if (childHit) state.expand.add(node.id)
              if (self) state.matched.add(node.id)
              if (self || childHit) {
                state.visible.add(node.id)
                hit = true
              }
            }
            return hit
          }
          for (let index = 0; index < computedArtboards.length; index += 1) {
            const entry = computedArtboards[index]
            if (!entry) continue
            const hit = walk(entry.layers)
            if (hit) state.visible.add(entry.artboard.id)
          }
          return state
        },
        [tree, trimmedQuery],
      )

      const totalLayers = React.useMemo(
        function () {
          const ids = new Set()
          for (let index = 0; index < computedArtboards.length; index += 1) {
            const entry = computedArtboards[index]
            if (entry) collectTreeNodeIds(entry.layers, ids)
          }
          return ids.size
        },
        [tree],
      )

      function toggleCollapsed(layerId) {
        setCollapsed(function (previous) {
          const next = Object.assign({}, previous)
          next[layerId] = previous[layerId] !== true
          return next
        })
      }

      function expandAll(expand) {
        const next = {}
        if (!expand) {
          for (let index = 0; index < computedArtboards.length; index += 1) {
            const entry = computedArtboards[index]
            const ids = collectTreeNodeIds(entry ? entry.layers : [], new Set())
            ids.forEach(function (id) {
              next[id] = true
            })
          }
        }
        setCollapsed(next)
      }

      /* ------------------------------------ drag & drop ------------------------------------ */

      function handleDragStart(layerId, event) {
        dragRef.current = layerId
        setEditing(null)
        try {
          if (event && event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            if (typeof event.dataTransfer.setData === 'function') {
              event.dataTransfer.setData('text/plain', layerId)
            }
          }
        } catch (error) {
          /* drag payload is best-effort */
        }
      }

      function clearDrag() {
        dragRef.current = null
        setDrop(null)
      }

      function stopEvent(event) {
        try {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
      }

      function zoneFor(event, target, canInto) {
        let rect = null
        try {
          rect = target && typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null
        } catch (error) {
          rect = null
        }
        if (!rect || !rect.height) return canInto ? 'into' : 'after'
        const offset = (finiteNumber(event && event.clientY, 0) - rect.top) / rect.height
        if (canInto) {
          if (offset < 0.28) return 'before'
          if (offset > 0.72) return 'after'
          return 'into'
        }
        return offset < 0.5 ? 'before' : 'after'
      }

      function dragOverRow(node, event, canInto) {
        stopEvent(event)
        try {
          if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        } catch (error) {
          /* ignore */
        }
        if (!dragRef.current) return
        if (dragRef.current === node.id) {
          setDrop(null)
          return
        }
        const zone = zoneFor(event, event && event.currentTarget, canInto)
        setDrop(function (previous) {
          if (previous && previous.kind === 'layer' && previous.id === node.id && previous.zone === zone) {
            return previous
          }
          return { kind: 'layer', id: node.id, zone: zone }
        })
      }

      function dragOverArtboard(artboardId, event) {
        stopEvent(event)
        try {
          if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        } catch (error) {
          /* ignore */
        }
        if (!dragRef.current) return
        setDrop(function (previous) {
          if (previous && previous.kind === 'artboard' && previous.id === artboardId) return previous
          return { kind: 'artboard', id: artboardId, zone: 'into' }
        })
      }

      function isAncestorOf(ancestorId, node) {
        let current = node ? node.parent : null
        while (current) {
          if (current.id === ancestorId) return true
          current = current.parent
        }
        return false
      }

      function destinationOf(node) {
        if (node && node.parentId) return { parentId: node.parentId, sameParent: false }
        if (node && node.artboard && node.artboard.id) {
          return { artboardId: node.artboard.id, sameParent: false }
        }
        return null
      }

      /** Move a layer to a destination, feature-detecting the available actions. */
      function moveLayerTo(layerId, destination, index) {
        if (!destination) return false
        if (typeof actions.moveLayer === 'function') {
          actions.moveLayer(layerId, destination, index)
          return true
        }
        if (typeof actions.runOps === 'function') {
          const op = { type: 'layer.move_to', layerId: layerId }
          if (typeof index === 'number') op.index = index
          if (destination.parentId) op.parentId = destination.parentId
          else if (destination.artboardId) op.artboardId = destination.artboardId
          actions.runOps([op])
          return true
        }
        if (destination.sameParent) {
          if (typeof actions.reorderLayer === 'function' && typeof index === 'number') {
            actions.reorderLayer(layerId, index)
            return true
          }
          if (typeof actions.reorder === 'function' && typeof index === 'number') {
            actions.reorder(layerId, index)
            return true
          }
          return false
        }
        if (typeof actions.reparent === 'function') {
          actions.reparent(
            layerId,
            destination.parentId
              ? { parentId: destination.parentId }
              : { artboardId: destination.artboardId },
          )
          return true
        }
        return false
      }

      function reorderIndexFor(siblings, draggedId, targetId, zone) {
        const ids = []
        for (let index = 0; index < siblings.length; index += 1) {
          const node = siblings[index]
          if (node && typeof node.id === 'string' && node.id !== draggedId) ids.push(node.id)
        }
        const position = ids.indexOf(targetId)
        if (position < 0) return null
        return zone === 'before' ? position + 1 : position
      }

      function dropOnRow(node, event, zone) {
        stopEvent(event)
        const draggedId = dragRef.current
        clearDrag()
        if (!draggedId || !node || draggedId === node.id) return
        const canInto = treeIsContainerType(node.layer && node.layer.type)
        if (zone === 'into' && canInto) {
          if (draggedId === node.id || isAncestorOf(draggedId, node)) return
          moveLayerTo(draggedId, { parentId: node.id }, null)
          return
        }
        const dropped = tree && tree.byId ? tree.byId.get(draggedId) || null : null
        const siblings = siblingNodesOf(tree, node)
        const targetParentId = node.parentId || null
        const sameParent = dropped
          ? (dropped.parentId || null) === targetParentId && node.artboard && dropped.artboard && node.artboard.id === dropped.artboard.id
          : false
        if (sameParent) {
          const index = reorderIndexFor(siblings, draggedId, node.id, zone)
          if (index === null) return
          moveLayerTo(draggedId, { sameParent: true, parentId: node.parentId || null, artboardId: node.parentId ? undefined : node.artboard.id }, index)
          return
        }
        if (node.parentId) {
          moveLayerTo(draggedId, { parentId: node.parentId }, null)
        } else if (node.artboard && node.artboard.id) {
          moveLayerTo(draggedId, { artboardId: node.artboard.id }, null)
        }
      }

      function dropOnArtboard(artboardId, event) {
        stopEvent(event)
        const draggedId = dragRef.current
        clearDrag()
        if (!draggedId || typeof actions.reparent !== 'function') return
        actions.reparent(draggedId, { artboardId: artboardId })
      }

      /* -------------------------------------- rename --------------------------------------- */

      function startLayerRename(node) {
        if (!node || !isObject(node.layer) || dragRef.current) return
        if (editing && editing.kind === 'layer' && editing.id === node.id) return
        const artboardId = node.artboard && node.artboard.id ? node.artboard.id : null
        if (!renameLayersOk) {
          selectSingleLayer(props, node.layer.id, artboardId)
          return
        }
        // Renaming is a per-row action: when only the batch `commitLayer` writer exists, make
        // this row the (single) selection first so the undoable commit hits exactly it.
        if (!hasPerLayerWriter(props) && !(selectedIds.length === 1 && selectedIds[0] === node.layer.id)) {
          selectSingleLayer(props, node.layer.id, artboardId)
        }
        setEditing({ kind: 'layer', id: node.id })
      }

      function startArtboardRename(artboard) {
        if (!artboard || typeof artboard.id !== 'string') return
        if (!renameArtboardsOk) {
          if (typeof actions.selectArtboard === 'function') actions.selectArtboard(artboard.id)
          return
        }
        // `commitArtboard` targets the selected artboard, so select it before the input opens.
        if (
          typeof actions.renameArtboard !== 'function' &&
          typeof actions.updateArtboard !== 'function' &&
          typeof actions.selectArtboard === 'function'
        ) {
          actions.selectArtboard(artboard.id)
        }
        setEditing({ kind: 'artboard', id: artboard.id })
      }

      function finishRename() {
        setEditing(null)
      }

      /* --------------------------------------- rows ---------------------------------------- */

      function handleRowClick(node, event) {
        if (!node || !isObject(node.layer)) return
        if (dragRef.current) return
        const additive = !!(event && (event.shiftKey || event.ctrlKey || event.metaKey))
        const artboardId = node.artboard && node.artboard.id ? node.artboard.id : null
        if (!additive) {
          selectSingleLayer(props, node.layer.id, artboardId)
          return
        }
        const current = selectedIds
        const next = current.indexOf(node.layer.id) >= 0
          ? current.filter(function (id) {
              return id !== node.layer.id
            })
          : current.concat([node.layer.id])
        if (next.length === 0) next.push(node.layer.id)
        if (next.length === 1) {
          selectSingleLayer(props, next[0], artboardId)
          return
        }
        writeSelectionIds(props, next, artboardId)
      }

      function handleRowKeyDown(node, event) {
        if (!event) return
        const modifier = event.ctrlKey || event.metaKey
        if (modifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          event.stopPropagation()
          if (typeof actions.moveSelected === 'function') {
            actions.moveSelected(event.key === 'ArrowUp' ? 'up' : 'down')
          }
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          startLayerRename(node)
          return
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          const kids = treeNodeChildren(node)
          if (kids.length) {
            event.preventDefault()
            event.stopPropagation()
            toggleCollapsed(node.id)
          }
          return
        }
        if (event.key === 'Escape' && filter.active) {
          event.preventDefault()
          event.stopPropagation()
          setQuery('')
        }
      }

      function renderLayerRows(nodes, depth) {
        if (!Array.isArray(nodes) || nodes.length === 0) return null
        return nodes
          .slice()
          .reverse()
          .map(function (node) {
            return renderLayerRow(node, depth)
          })
      }

      function renderLayerRow(node, depth) {
        if (!node || !isObject(node.layer)) return null
        if (filter.active && !filter.visible.has(node.id)) return null
        const layer = node.layer
        const childNodes = treeNodeChildren(node)
        const hasChildren = childNodes.length > 0
        const open = filter.active ? true : collapsed[layer.id] !== true
        const count = openCounts && typeof openCounts.get === 'function' ? openCounts.get(layer.id) || 0 : 0
        const isSelected = selectedSet.has(layer.id)
        const isPrimary = isSelected && primaryId === layer.id
        const locked = layer.locked === true
        const hidden = layer.visible === false
        const dropHere = drop && drop.kind === 'layer' && drop.id === layer.id ? drop.zone : null
        const isEditing = !!(editing && editing.kind === 'layer' && editing.id === layer.id)
        const typeName = treeTypeName(layer.type)
        const name = layer.name || layerFactoryName(layer.type)
        const row = h(
          'div',
          {
            key: String(layer.id),
            className:
              'dc-tree-row dct-row' +
              (isSelected ? ' dc-sel' : '') +
              (isPrimary ? ' dct-primary' : '') +
              (dropHere === 'into' ? ' dc-drop-into' : '') +
              (dropHere === 'before' ? ' dic-drop-before' : '') +
              (dropHere === 'after' ? ' dic-drop-after' : ''),
            style: { paddingLeft: 2 + depth * 11 },
            title: name + ' — ' + typeName + (locked ? ' · locked' : '') + ' · ' + TREE_COPY.renameHint,
            draggable: !isEditing,
            role: 'treeitem',
            tabIndex: 0,
            'aria-selected': isSelected ? 'true' : 'false',
            'aria-expanded': hasChildren ? (open ? 'true' : 'false') : undefined,
            'data-layer-id': layer.id,
            onDragStart: function (event) {
              handleDragStart(layer.id, event)
            },
            onDragEnd: clearDrag,
            onDragOver: function (event) {
              dragOverRow(node, event, hasChildren)
            },
            onDragLeave: function () {
              setDrop(function (previous) {
                return previous && previous.kind === 'layer' && previous.id === layer.id ? null : previous
              })
            },
            onDrop: function (event) {
              dropOnRow(node, event, drop && drop.id === layer.id ? drop.zone : 'after')
            },
            onClick: function (event) {
              handleRowClick(node, event)
            },
            onDoubleClick: function (event) {
              event.stopPropagation()
              startLayerRename(node)
            },
            onKeyDown: function (event) {
              handleRowKeyDown(node, event)
            },
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dc-tree-caret dct-caret',
              disabled: !hasChildren,
              title: hasChildren ? (open ? strings.collapse : strings.expand) : '',
              'aria-label': hasChildren ? (open ? strings.collapse : strings.expand) : name,
              onClick: function (event) {
                event.stopPropagation()
                if (hasChildren) toggleCollapsed(layer.id)
              },
            },
            h(TreeGlyph, { name: hasChildren && open ? 'chevronDown' : 'chevronRight', size: 10 }),
          ),
          h(
            'span',
            { className: 'dct-icon', title: typeName, 'aria-hidden': 'true' },
            h(TreeGlyph, { name: treeGlyphName(layer.type), size: 10 }),
          ),
          isEditing
            ? h(TreeRenameInput, {
                key: 'rename',
                value: name,
                label: TREE_COPY.renameLayer,
                onCommit: function (value) {
                  commitLayerName(props, layer.id, node.artboard ? node.artboard.id : null, value)
                },
                onDone: finishRename,
              })
            : h(
                'span',
                {
                  className: 'dct-name' + (hidden ? ' dct-hidden' : ''),
                  onDoubleClick: function (event) {
                    event.stopPropagation()
                    startLayerRename(node)
                  },
                },
                searchHighlight(name, trimmedQuery),
              ),
          count > 0
            ? typeof actions.openComposer === 'function'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dct-badge',
                    title: TREE_COPY.openComment,
                    'aria-label': TREE_COPY.openComment + ' (' + count + ')',
                    onClick: function (event) {
                      event.stopPropagation()
                      actions.openComposer(layer.id, node.artboard ? node.artboard.id : null)
                    },
                  },
                  String(count),
                )
              : h(
                  'span',
                  { className: 'dct-badge', title: strings.comments },
                  String(count),
                )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dct-mini' + (locked ? ' dct-locked' : ''),
              title: locked ? TREE_COPY.lockedHint : TREE_COPY.unlockHint,
              'aria-label': (locked ? TREE_COPY.unlock : TREE_COPY.lock) + ': ' + name,
              'aria-pressed': locked ? 'true' : 'false',
              onClick: function (event) {
                event.stopPropagation()
                toggleLayerLocked(props, node, locked)
              },
            },
            h(TreeGlyph, { name: locked ? 'lock' : 'unlock', size: 11 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-eye' + (hidden ? ' dc-off' : ''),
              title: hidden ? strings.show : strings.hide,
              'aria-label': (hidden ? strings.show : strings.hide) + ': ' + name,
              'aria-pressed': hidden ? 'false' : 'true',
              onClick: function (event) {
                event.stopPropagation()
                if (typeof actions.toggleVisible === 'function') actions.toggleVisible(layer.id)
              },
            },
            h(TreeGlyph, { name: hidden ? 'eyeOff' : 'eye', size: 11 }),
          ),
        )
        const rows = [row]
        if (hasChildren && open) rows.push(renderLayerRows(childNodes, depth + 1))
        return rows
      }

      function renderArtboard(entry) {
        const artboard = entry.artboard
        const artboardSelected = !selectedIds.length && selectedArtboardId === artboard.id
        const isDropTarget = !!(drop && drop.kind === 'artboard' && drop.id === artboard.id)
        const isEditing = !!(editing && editing.kind === 'artboard' && editing.id === artboard.id)
        const childRows = renderLayerRows(entry.layers, 0)
        if (filter.active && !filter.visible.has(artboard.id)) return null
        const layerCount = collectTreeNodeIds(entry.layers, new Set()).size
        return h(
          'div',
          { className: 'dc-tree-group dct-group', key: String(artboard.id) },
          h(
            'div',
            {
              className:
                'dc-tree-ab dct-ab' +
                (artboardSelected ? ' dc-sel' : '') +
                (isDropTarget ? ' dc-drop-into' : ''),
              title:
                (artboard.name || artboard.id) +
                ' — ' +
                (renameArtboardsOk ? TREE_COPY.renameArtboard + ' (double-click)' : TREE_COPY.renameInInspector),
              role: 'button',
              tabIndex: 0,
              'data-artboard-id': artboard.id,
              onClick: function () {
                if (typeof actions.selectArtboard === 'function') actions.selectArtboard(artboard.id)
              },
              onDoubleClick: function (event) {
                event.stopPropagation()
                startArtboardRename(artboard)
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  startArtboardRename(artboard)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.stopPropagation()
                  if (typeof actions.selectArtboard === 'function') actions.selectArtboard(artboard.id)
                }
              },
              onDragOver: function (event) {
                dragOverArtboard(artboard.id, event)
              },
              onDragLeave: function () {
                setDrop(function (previous) {
                  return previous && previous.kind === 'artboard' && previous.id === artboard.id ? null : previous
                })
              },
              onDrop: function (event) {
                dropOnArtboard(artboard.id, event)
              },
            },
            h(TreeGlyph, { name: 'frame', size: 11 }),
            isEditing
              ? h(TreeRenameInput, {
                  key: 'rename-ab',
                  value: artboard.name || '',
                  label: TREE_COPY.renameArtboard,
                  onCommit: function (value) {
                    commitArtboardName(props, artboard.id, value)
                  },
                  onDone: finishRename,
                })
              : h('span', { className: 'dct-name', style: { fontWeight: 600 } }, artboard.name || artboard.id),
            h('span', { className: 'dct-ab-meta' }, String(layerCount)),
          ),
          childRows,
        )
      }

      const hasArtboards = computedArtboards.length > 0
      const hasRows = hasArtboards && computedArtboards.some(function (entry) {
        return collectTreeNodeIds(entry ? entry.layers : [], new Set()).size > 0
      })
      const matchCount = filter.matched.size
      const countLabel = filter.active
        ? matchCount === 0
          ? '0'
          : matchCount === 1
            ? TREE_COPY.matchesOne
            : matchCount + ' matches'
        : totalLayers === 1
          ? TREE_COPY.countOne
          : totalLayers + ' layers'

      let body = null
      if (!hasArtboards) {
        body = h('div', { className: 'dct-empty' }, h('span', { className: 'dc-muted dc-pad' }, strings.noArtboards))
      } else if (filter.active && matchCount === 0) {
        body = h(
          'div',
          { className: 'dct-empty' },
          h('span', { className: 'dct-empty-title' }, TREE_COPY.noMatch),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-link',
              onClick: function () {
                setQuery('')
              },
            },
            TREE_COPY.clearSearch,
          ),
        )
      } else if (!hasRows) {
        body = h(
          'div',
          { className: 'dct-empty' },
          h('span', { className: 'dct-empty-title' }, TREE_COPY.empty),
        )
      } else {
        body = computedArtboards.map(renderArtboard)
      }

      return h(
        'aside',
        { className: 'dc-left', 'aria-label': strings.layers },
        h('style', { dangerouslySetInnerHTML: { __html: TREE_CSS } }),
        h(
          'div',
          { className: 'dc-panel-head' },
          h('span', null, strings.layers),
          h(IconButton, {
            title: TREE_COPY.expandAll,
            icon: 'chevronDown',
            size: 12,
            onClick: function () {
              expandAll(true)
            },
          }),
          h(IconButton, {
            title: TREE_COPY.collapseAll,
            icon: 'chevronRight',
            size: 12,
            onClick: function () {
              expandAll(false)
            },
          }),
          h(IconButton, {
            title: strings.hide,
            icon: 'chevronLeft',
            size: 12,
            onClick: actions.toggleTree,
          }),
        ),
        h(
          'div',
          { className: 'dct-tools' },
          h(
            'div',
            { className: 'dct-search' },
            h('span', { className: 'dct-search-icon' }, h(TreeGlyph, { name: 'search', size: 10 })),
            h('input', {
              className: 'dc-input dct-search-input',
              type: 'text',
              value: query,
              placeholder: TREE_COPY.search,
              title: TREE_COPY.searchTitle,
              'aria-label': TREE_COPY.searchAria,
              spellCheck: false,
              onChange: function (event) {
                setQuery(event.target.value)
              },
              onKeyDown: function (event) {
                event.stopPropagation()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setQuery('')
                }
              },
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dct-clear',
                    title: TREE_COPY.clearSearch,
                    'aria-label': TREE_COPY.clearSearch,
                    onClick: function () {
                      setQuery('')
                    },
                  },
                  h(TreeGlyph, { name: 'close', size: 9 }),
                )
              : null,
          ),
          h('span', { className: 'dct-count', title: countLabel }, countLabel),
        ),
        h('div', { className: 'dct-tree dc-tree', role: 'tree', 'aria-label': strings.layers, 'aria-multiselectable': 'true' }, body),
        h(
          'div',
          { className: 'dc-panel-foot dct-foot' },
          h(IconButton, {
            title: TREE_COPY.moveUp,
            icon: 'up',
            size: 13,
            disabled: !primaryId,
            onClick: function () {
              if (typeof actions.moveSelected === 'function') actions.moveSelected('up')
            },
          }),
          h(IconButton, {
            title: TREE_COPY.moveDown,
            icon: 'down',
            size: 13,
            disabled: !primaryId,
            onClick: function () {
              if (typeof actions.moveSelected === 'function') actions.moveSelected('down')
            },
          }),
          h(IconButton, {
            title: strings.delete,
            icon: 'trash',
            size: 13,
            disabled: !primaryId,
            onClick: function () {
              if (typeof actions.deleteSelected === 'function') actions.deleteSelected()
            },
          }),
          h(
            'span',
            { className: 'dct-foot-count' },
            selectedIds.length > 1 ? selectedIds.length + ' selected · ' : '',
            countLabel,
          ),
        ),
      )
    }

    /** Toggle `locked` on one layer, feature-detecting the available actions. */
    function toggleLayerLocked(props, node, locked) {
      const layer = node && node.layer
      if (!isObject(layer)) return
      const next = !locked
      const actions = (props && props.actions) || {}
      const editor = editorFromProps(props)
      const artboardId = node.artboard ? node.artboard.id : null
      const selection = resolvedSelectionIds(props)
      // Per-row affordance: a per-layer writer wins (undoable, and it never touches the
      // selection). `toggleLock()` only matches when this row is the whole selection.
      if (typeof actions.updateLayer === 'function') {
        actions.updateLayer(layer.id, { locked: next })
        return
      }
      if (editor && typeof editor.updateLayer === 'function') {
        editor.updateLayer(layer.id, { locked: next })
        return
      }
      if (
        typeof actions.toggleLock === 'function' &&
        selection.length === 1 &&
        selection[0] === layer.id
      ) {
        actions.toggleLock()
        return
      }
      if (editor && typeof editor.toggleLock === 'function' && selection.length === 1 && selection[0] === layer.id) {
        editor.toggleLock()
        return
      }
      if (typeof actions.runOps === 'function') {
        actions.runOps([{ type: 'layer.update', layerId: layer.id, patch: { locked: next } }])
        return
      }
      if (editor && typeof editor.runOps === 'function') {
        editor.runOps([{ type: 'layer.update', layerId: layer.id, patch: { locked: next } }])
        return
      }
      // v1 fallback: select the row first, then commit on the next task so the editor's
      // selection ref has caught up with the click.
      if (typeof actions.selectLayer === 'function' && typeof actions.commitLayer === 'function') {
        actions.selectLayer(layer.id, artboardId)
        setTimeout(function () {
          try {
            actions.commitLayer({ locked: next })
          } catch (error) {
            /* ignore: a missing selection must not throw from a timer */
          }
        }, 0)
      }
    }

    function layerFactoryName(type) {
      if (type === 'rect') return 'Rectangle'
      if (type === 'ellipse') return 'Ellipse'
      if (type === 'text') return 'Text'
      if (type === 'image') return 'Image'
      if (type === 'frame') return 'Frame'
      if (type === 'line') return 'Line'
      if (type === 'group') return 'Group'
      return 'Layer'
    }

    /* ------------------------------------------------------------------------------------------
     * Inspector
     * ---------------------------------------------------------------------------------------- */
