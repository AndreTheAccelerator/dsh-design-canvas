    /* ------------------------------------------------------------------------------------------
     * Inspector (v2)
     *
     * Sibling of the layer tree: reads the selection through the shared helpers in
     * `50-tree.js` (`useSelectionIds`, `editorFromProps`, `writeSelectionIds`, `TreeGlyph`), so it
     * supports multi-selection even before the shell passes `selectedLayerIds` down.
     *
     * Multi-selection rules:
     *   - every editable control writes ONE batch: forward + inverse `layer.update` ops for all
     *     selected layers, applied locally once, so the whole edit is a single undo entry;
     *   - a patch key is only sent to layer types that declare it (`PROP_SUPPORT`), so a mixed
     *     selection does not produce Host op errors;
     *   - values that differ across the selection render as an empty/mixed field: typing a value
     *     applies it to every selected layer.
     *
     * Feature detection: every mutation prefers an explicit action from `props.actions`
     * (`commitLayers`, `toggleLock`, `selectLayers`, `alignSelection`, `groupSelection`, …) and
     * falls back to the editor hook (`props.extensionContext.editor`) or the v1 actions.
     * ---------------------------------------------------------------------------------------- */

    const INSPECTOR_COPY = {
      selectionSection: 'Selection',
      selectionManySuffix: ' layers selected',
      multiHint: 'one undo step',
      multiHintMixed: 'Mixed values are blank — type a value to set it on all of them',
      mixed: 'Mixed',
      sizeLimits: 'Size limits',
      sizeLimitsHint: 'px · clear a limit to remove it',
      min: 'Min',
      max: 'Max',
      hug: 'Hug content',
      hugWidth: 'Hug width',
      hugHeight: 'Hug height',
      hugHint: 'Sizes the layer to its content; size limits still clamp it',
      hugDisabledHint: 'Sized by its auto-layout parent — hug is not used here',
      locked: 'Locked',
      lock: 'Lock',
      lockHint: 'Locked blocks canvas drag/resize and click-selection; the agent can still edit it.',
      unlockHint: 'Lock this layer to stop accidental canvas edits (the agent can still edit it).',
      line: 'Line',
      stroke: 'Stroke',
      strokeWidth: 'Width',
      orientation: 'Orientation',
      horizontal: 'Horizontal',
      vertical: 'Vertical',
      diagonal: 'Diagonal',
      dashed: 'Dashed',
      arrowStart: 'Arrow start',
      arrowEnd: 'Arrow end',
      groupSection: 'Group',
      children: 'Children',
      ungroup: 'Ungroup',
      selectChildren: 'Select children',
      selectParent: 'Select parent',
      arrange: 'Arrange',
      bringFront: 'Bring to front',
      bringForward: 'Bring forward',
      sendBackward: 'Send backward',
      sendBack: 'Send to back',
      front: 'Front',
      forward: 'Forward',
      backward: 'Backward',
      back: 'Back',
      align: 'Align',
      distribute: 'Distribute',
      alignLeftH: 'Left edges',
      alignCenterH: 'Centers',
      alignRightH: 'Right edges',
      alignTopV: 'Top edges',
      alignCenterV: 'Middle',
      alignBottomV: 'Bottom edges',
      leftShort: 'Left',
      centerShort: 'Center',
      rightShort: 'Right',
      topShort: 'Top',
      middleShort: 'Middle',
      bottomShort: 'Bottom',
      distributeH: 'Horizontal spacing',
      distributeV: 'Vertical spacing',
      groupSelection: 'Group',
      ungroupSelection: 'Ungroup',
      deleteSelection: 'Delete',
      autoHeight: 'Auto height',
      autoHeightHint: 'Grow the height to fit the text',
      rowGap: 'Row gap',
      columnGap: 'Column gap',
      gapOverrides: 'Gap overrides',
      inheritedGap: 'Inherited from Gap — type a value to override it',
      mixedGaps: 'Mixed gaps',
      wrapAlign: 'Wrap align',
      wrapHint: 'Only applies with wrap on',
      arrangeHint: 'Z-order inside the parent',
      alignHint: 'Aligns selected layers inside their bounding box',
      distributeHint: 'Needs 3+ layers to space them evenly',
      noActionHint: 'Not available in this build',
      autoLayout: 'Auto layout',
      justify: 'Justify',
      actions: 'Actions',
      selectionActions: 'Selection actions',
      ungroupHint: 'Ungroup replaces the group with its children',
      groupHint: 'Group needs 2 or more selected layers',
      typeMixed: 'Mixed types',
      visibility: 'Visibility',
      visible: 'Visible',
      hidden: 'Hidden',
      shadowHint: 'Any CSS box-shadow value',
    }

    const INSPECTOR_CSS = `
.dci-section { gap: 5px; }
.dci-subtitle { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dci-note { font-size: 9px; line-height: 1.35; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dci-warn { color: var(--dsw-alias-state-warn-primary); }
.dci-multi-head { display: flex; flex-direction: column; gap: 2px; padding: 6px 7px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.dci-multi-title { font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-primary); }
.dci-multi-sub { font-size: 9px; line-height: 1.35; color: var(--dsw-alias-label-secondary); }
.dci-btnrow { display: flex; flex-wrap: wrap; gap: 3px; }
.dci-btnrow > .dc-btn, .dci-btnrow > .dc-link { flex: 1 1 auto; min-width: 0; justify-content: center; }
.dci-btnrow-compact > .dc-btn { flex: 1 1 0; padding: 0 3px; font-size: 10px; }
.dci-mini-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; height: 19px; padding: 0 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; }
.dci-mini-btn:disabled { opacity: 0.4; cursor: default; }
.dci-limit { display: flex; align-items: center; gap: 2px; min-width: 0; }
.dci-limit > .dc-field { min-width: 0; }
.dci-clear { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dci-clear:disabled { opacity: 0.3; cursor: default; }
.dci-toggle-row { display: flex; align-items: center; gap: 4px; }
.dci-inline-link { padding: 0; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 10px; cursor: pointer; text-align: left; }
.dci-inline-link:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
.dci-count { font-variant-numeric: tabular-nums; }
/* Hover affordances only where hovering is real: no sticky hover on touch screens. */
@media (hover: hover) and (pointer: fine) {
.dci-mini-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dci-clear:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dci-inline-link:hover:not(:disabled) { text-decoration: underline; }
}
`

    /* Which layer types accept which patch key (multi-selection writes are filtered by this so a
     * mixed selection never sends an unsupported property to the Host). Unknown keys pass. */
    const INSPECTOR_PROP_SUPPORT = {
      fill: ['rect', 'ellipse', 'frame', 'text'],
      radius: ['rect', 'image', 'frame'],
      borderWidth: ['rect', 'ellipse', 'frame'],
      borderColor: ['rect', 'ellipse', 'frame'],
      clip: ['frame', 'group'],
      color: ['text'],
      text: ['text'],
      fontSize: ['text'],
      fontWeight: ['text'],
      fontFamily: ['text'],
      align: ['text'],
      lineHeight: ['text'],
      letterSpacing: ['text'],
      textTransform: ['text'],
      stroke: ['line'],
      strokeWidth: ['line'],
      orientation: ['line'],
      dashed: ['line'],
      arrowStart: ['line'],
      arrowEnd: ['line'],
      fit: ['image'],
      src: ['image'],
    }

    const INSPECTOR_ALIGN_VALUES = ['start', 'center', 'end', 'stretch']
    const INSPECTOR_JUSTIFY_VALUES = [
      'start',
      'center',
      'end',
      'space-between',
      'space-around',
      'space-evenly',
    ]
    const INSPECTOR_ALIGN_CONTENT_VALUES = [
      'start',
      'center',
      'end',
      'stretch',
      'space-between',
      'space-around',
    ]

    function inspectorSupportsProp(type, key) {
      const list = INSPECTOR_PROP_SUPPORT[key]
      if (!list) return true
      return list.indexOf(type) >= 0
    }

    function filterPatchForType(patch, type) {
      const out = {}
      const keys = Object.keys(patch || {})
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        if (inspectorSupportsProp(type, key)) out[key] = patch[key]
      }
      return out
    }

    /** Inverse of a patch for one stored layer, including the "clear to default" cases. */
    function inversePatchForLayer(layer, patch) {
      const inverse = {}
      const keys = Object.keys(patch || {})
      const nullable = [
        'shadow',
        'layout',
        'alignSelf',
        'minWidth',
        'minHeight',
        'maxWidth',
        'maxHeight',
      ]
      const booleanDefaults = [
        'visible',
        'locked',
        'grow',
        'clip',
        'hugWidth',
        'hugHeight',
        'dashed',
        'arrowStart',
        'arrowEnd',
      ]
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        const previous = isObject(layer) ? layer[key] : undefined
        if (previous !== undefined) {
          inverse[key] = previous
          continue
        }
        if (nullable.indexOf(key) >= 0) inverse[key] = null
        else if (booleanDefaults.indexOf(key) >= 0) inverse[key] = key === 'visible' ? true : false
        else if (key === 'opacity') inverse[key] = 1
        else if (key === 'letterSpacing') inverse[key] = 0
        else if (key === 'textTransform') inverse[key] = 'none'
      }
      return inverse
    }

    /**
     * Per-layer filtered patches for the whole selection; drops layers that are gone and drops
     * keys whose value would not change (so a no-op control press records no undo entry).
     */
    function selectionPatchEntries(doc, ids, patch) {
      const entries = []
      const list = Array.isArray(ids) ? ids : []
      for (let index = 0; index < list.length; index += 1) {
        const found = findLayerById(doc, list[index])
        if (!found) continue
        const filtered = filterPatchForType(patch, found.layer.type)
        const changed = {}
        const keys = Object.keys(filtered)
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const key = keys[keyIndex]
          if (found.layer[key] !== filtered[key]) changed[key] = filtered[key]
        }
        if (Object.keys(changed).length === 0) continue
        entries.push({ layerId: list[index], layer: found.layer, patch: changed })
      }
      return entries
    }

    function samePatch(list) {
      if (!list.length) return null
      const first = list[0].patch
      for (let index = 1; index < list.length; index += 1) {
        const keys = Object.keys(first)
        const other = list[index].patch
        if (Object.keys(other).length !== keys.length) return null
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          if (other[keys[keyIndex]] !== first[keys[keyIndex]]) return null
        }
      }
      return first
    }

    /**
     * Commit one patch to the whole selection as one undoable batch.
     *
     * The inspector builds its own forward/inverse op batch through the editor hook when it can
     * (`commitWithHistory` + `applyDocLocal`): that path knows the undo default for every v2 prop
     * (`inversePatchForLayer`) and writes per-type filtered patches, so a mixed selection never
     * sends an unsupported property and clearing a limit/hug/lock is undoable.
     * Explicit batch actions from the shell win when present; the v1 single action is last.
     */
    function commitSelectionPatch(props, ids, patch) {
      const actions = props.actions || {}
      const list = Array.isArray(ids) ? ids : []
      if (list.length === 0) return
      const entries = selectionPatchEntries(props.doc, list, patch)
      if (entries.length === 0) return
      const common = samePatch(entries)
      const editor = editorFromProps(props)

      if (common && typeof actions.commitLayers === 'function') {
        actions.commitLayers(
          common,
          entries.map(function (entry) {
            return entry.layerId
          }),
        )
        return
      }
      if (common && typeof actions.updateLayers === 'function') {
        actions.updateLayers(
          entries.map(function (entry) {
            return entry.layerId
          }),
          common,
        )
        return
      }
      if (
        editor &&
        typeof editor.commitWithHistory === 'function' &&
        typeof editor.applyDocLocal === 'function'
      ) {
        let nextDoc = props.doc
        const forward = []
        const inverse = []
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]
          nextDoc = docPatchLayer(nextDoc, entry.layerId, entry.patch)
          forward.push({ type: 'layer.update', layerId: entry.layerId, patch: entry.patch })
          const inversePatch = inversePatchForLayer(entry.layer, entry.patch)
          if (Object.keys(inversePatch).length > 0) {
            inverse.push({ type: 'layer.update', layerId: entry.layerId, patch: inversePatch })
          }
        }
        if (forward.length === 0) return
        editor.applyDocLocal(nextDoc)
        editor.commitWithHistory(
          entries.length > 1 ? 'update-selection' : 'update',
          forward,
          inverse,
        )
        return
      }
      if (editor && typeof editor.commitLayers === 'function' && common) {
        editor.commitLayers(
          common,
          entries.map(function (entry) {
            return entry.layerId
          }),
        )
        return
      }
      // v2 editor semantics: `commitLayer` applies to the whole selection (CONTRACT §6).
      if (list.length === 1 && typeof actions.commitLayer === 'function') {
        actions.commitLayer(entries[0].patch)
        return
      }
      if (typeof actions.commitLayer === 'function') {
        actions.commitLayer(patch)
        return
      }
      if (typeof actions.runOps === 'function') {
        actions.runOps(
          entries.map(function (entry) {
            return { type: 'layer.update', layerId: entry.layerId, patch: entry.patch }
          }),
        )
      }
    }

    /** Kind names the interaction update uses for `alignSelection` (a guess kept harmless: the
     * editor returns `false` for an unknown kind and the inspector falls back to its own math). */
    const INSPECTOR_ALIGN_EDITOR_KINDS = {
      left: 'left',
      'center-h': 'hcenter',
      right: 'right',
      top: 'top',
      'center-v': 'vcenter',
      bottom: 'bottom',
    }

    /**
     * Call a selection-based editor action when one exists. Returns true when it handled the
     * command, false when it declined, null when nothing could handle it. Never throws: the
     * interaction update may be mid-landing, and a broken action must not break the panel.
     */
    function tryEditorAction(props, name, argument) {
      const actions = (props && props.actions) || {}
      const editor = editorFromProps(props)
      const candidates = [
        { owner: actions, fn: actions[name] },
        { owner: editor, fn: editor ? editor[name] : null },
      ]
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        if (typeof candidate.fn !== 'function') continue
        try {
          const result = candidate.fn.call(candidate.owner, argument)
          if (result && typeof result.then === 'function') {
            // Async action (group/ungroup): swallow a rejection so it cannot become an
            // unhandled rejection in the page console.
            result.catch(function () {})
            return true
          }
          if (result === false) return false
          return true
        } catch (error) {
          /* try the next owner / the local implementation */
        }
      }
      return null
    }

    /** Run an op batch with history when the editor hook exposes it; never throws. */
    function runInspectorOps(props, label, forward, inverse) {
      const actions = props.actions || {}
      const editor = editorFromProps(props)
      if (!Array.isArray(forward) || forward.length === 0) return false
      if (editor && typeof editor.commitWithHistory === 'function') {
        try {
          editor.commitWithHistory(label, forward, Array.isArray(inverse) ? inverse : [])
          return true
        } catch (error) {
          /* fall through to the plain op bridge */
        }
      }
      if (editor && typeof editor.runOps === 'function') {
        editor.runOps(forward)
        return true
      }
      if (typeof actions.runOps === 'function') {
        actions.runOps(forward)
        return true
      }
      return false
    }

    function setInspectorSelection(props, ids, artboardId) {
      const list = (Array.isArray(ids) ? ids : []).filter(function (id) {
        return typeof id === 'string' && id
      })
      if (!list.length) return
      if (list.length === 1) {
        selectSingleLayer(props, list[0], artboardId)
        return
      }
      writeSelectionIds(props, list, artboardId)
    }

    function hasNumberProp(layers, key) {
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        if (isObject(layer) && typeof layer[key] === 'number' && Number.isFinite(layer[key])) return true
      }
      return false
    }

    function numberFor(layers, key, fallback) {
      let first
      let seen = false
      let mixed = false
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        const value = isObject(layer) ? layer[key] : undefined
        if (!seen) {
          first = value
          seen = true
        } else if (value !== first) {
          mixed = true
        }
      }
      if (mixed) return NaN
      if (typeof first === 'number' && Number.isFinite(first)) return first
      if (first === undefined) return fallback
      return NaN
    }

    function boolFor(layers, key, fallback) {
      let first
      let seen = false
      let mixed = false
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        const raw = isObject(layer) ? layer[key] : undefined
        const value = typeof raw === 'boolean' ? raw : fallback
        if (!seen) {
          first = value
          seen = true
        } else if (value !== first) {
          mixed = true
        }
      }
      if (mixed) return NaN
      return seen ? first : fallback
    }

    function stringFor(layers, key, fallback) {
      let first
      let seen = false
      let mixed = false
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        const value = isObject(layer) && typeof layer[key] === 'string' ? layer[key] : ''
        if (!seen) {
          first = value
          seen = true
        } else if (value !== first) {
          mixed = true
        }
      }
      if (mixed) return ''
      if (seen && first) return first
      return fallback
    }

    function enumsFor(layers, key, allowed, fallback) {
      const value = stringFor(layers, key, fallback)
      return allowed.indexOf(value) >= 0 ? value : fallback
    }

    /* ------------------------------------ layout helpers ------------------------------------ */

    function optionalSize(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    }

    /** The stored layout plus the v2 extras that `normalizeLayoutObject` does not know about. */
    function inspectorLayoutOf(layer) {
      const raw = isObject(layer) && isObject(layer.layout) ? layer.layout : null
      if (!raw) return null
      const normalized = normalizeLayoutObject(raw)
      const rawPadding = isObject(raw.padding) ? raw.padding : {}
      return {
        direction: raw.direction === 'column' ? 'column' : 'row',
        gap: Math.max(0, finiteNumber(raw.gap, normalized ? normalized.gap : 0)),
        rowGap: optionalSize(raw.rowGap),
        columnGap: optionalSize(raw.columnGap),
        padding: {
          top: Math.max(0, finiteNumber(rawPadding.top, 0)),
          right: Math.max(0, finiteNumber(rawPadding.right, 0)),
          bottom: Math.max(0, finiteNumber(rawPadding.bottom, 0)),
          left: Math.max(0, finiteNumber(rawPadding.left, 0)),
        },
        align:
          normalized && INSPECTOR_ALIGN_VALUES.indexOf(normalized.align) >= 0
            ? normalized.align
            : 'stretch',
        justify:
          INSPECTOR_JUSTIFY_VALUES.indexOf(raw.justify) >= 0
            ? raw.justify
            : normalized
              ? normalized.justify
              : 'start',
        wrap: raw.wrap === true,
        alignContent:
          INSPECTOR_ALIGN_CONTENT_VALUES.indexOf(raw.alignContent) >= 0
            ? raw.alignContent
            : 'stretch',
      }
    }

    /** Build the complete layout object the Host stores (a layout patch replaces it wholesale). */
    function layoutObjectFrom(base, patch) {
      const next = {
        direction: base.direction === 'column' ? 'column' : 'row',
        gap: Math.max(0, finiteNumber(base.gap, 0)),
        padding: {
          top: Math.max(0, finiteNumber(base.padding.top, 0)),
          right: Math.max(0, finiteNumber(base.padding.right, 0)),
          bottom: Math.max(0, finiteNumber(base.padding.bottom, 0)),
          left: Math.max(0, finiteNumber(base.padding.left, 0)),
        },
        align: INSPECTOR_ALIGN_VALUES.indexOf(base.align) >= 0 ? base.align : 'stretch',
        justify:
          INSPECTOR_JUSTIFY_VALUES.indexOf(base.justify) >= 0 ? base.justify : 'start',
        wrap: base.wrap === true,
        alignContent:
          INSPECTOR_ALIGN_CONTENT_VALUES.indexOf(base.alignContent) >= 0
            ? base.alignContent
            : 'stretch',
      }
      if (optionalSize(base.rowGap) !== null) next.rowGap = base.rowGap
      if (optionalSize(base.columnGap) !== null) next.columnGap = base.columnGap
      const source = isObject(patch) ? patch : {}
      const keys = Object.keys(source)
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        if (key === 'rowGap' || key === 'columnGap') {
          if (optionalSize(source[key]) !== null) next[key] = Math.max(0, source[key])
          else delete next[key]
        } else if (key === 'padding') {
          next.padding = Object.assign({}, next.padding, isObject(source.padding) ? source.padding : {})
        } else if (key === 'wrap') {
          next.wrap = source.wrap === true
        } else {
          next[key] = source[key]
        }
      }
      return next
    }

    /* ------------------------------------ small controls ------------------------------------ */

    /** A row of actions (align/distribute/arrange): plain buttons, never a fake toggle state. */
    function InspectorActionRow(props) {
      const options = Array.isArray(props.options) ? props.options : []
      return h(
        'div',
        { className: 'dci-btnrow' + (props.compact ? ' dci-btnrow-compact' : '') },
        options.map(function (option) {
          return h(
            'button',
            {
              key: option.key,
              type: 'button',
              className: 'dc-btn',
              title: option.title || option.label,
              'aria-label': option.title || option.label,
              disabled: !!option.disabled,
              onClick: option.onClick,
            },
            option.label,
          )
        }),
      )
    }

    /**
     * `Segmented` in 45-primitives.js now honours `disabled`; this wrapper only adds the
     * explanatory title/`aria-disabled` group so a disabled toggle still says why it is inert.
     */
    function SegmentedGuarded(props) {
      const child = h(Segmented, props)
      if (!props.disabled) return child
      return h(
        'div',
        {
          className: 'dci-disabled',
          title: props.disabledTitle || props.title || props.label,
          'aria-disabled': 'true',
        },
        child,
      )
    }

    function InspectorClearButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dci-clear',
          title: props.title || 'Clear',
          'aria-label': props.title || 'Clear',
          disabled: !!props.disabled,
          onClick: props.onClick,
        },
        h(TreeGlyph, { name: 'close', size: 9 }),
      )
    }

    /* ------------------------------------- alignment math ----------------------------------- */

    function selectedComputedNodes(tree, ids) {
      const nodes = []
      const byId = tree && tree.byId ? tree.byId : null
      if (!byId) return nodes
      for (let index = 0; index < ids.length; index += 1) {
        const node = byId.get(ids[index]) || null
        if (node && node.layer) nodes.push(node)
      }
      return nodes
    }

    function selectionBounds(nodes) {
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (let index = 0; index < nodes.length; index += 1) {
        const rect = nodes[index].worldRect
        if (!isObject(rect)) continue
        left = Math.min(left, rect.x)
        top = Math.min(top, rect.y)
        right = Math.max(right, rect.x + rect.width)
        bottom = Math.max(bottom, rect.y + rect.height)
      }
      if (!Number.isFinite(left) || !Number.isFinite(right)) return null
      return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top }
    }

    /** layer.update ops (plus their inverses) that align the selection to its bounding box. */
    function alignOps(nodes, kind) {
      const bounds = selectionBounds(nodes)
      const forward = []
      const inverse = []
      if (!bounds) return { forward: forward, inverse: inverse }
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        // Auto-layout children are positioned by their parent; never rewrite their x/y.
        if (node.autoParent) continue
        const rect = node.worldRect
        let dx = 0
        let dy = 0
        if (kind === 'left') dx = bounds.left - rect.x
        else if (kind === 'center-h') dx = bounds.left + bounds.width / 2 - (rect.x + rect.width / 2)
        else if (kind === 'right') dx = bounds.right - (rect.x + rect.width)
        else if (kind === 'top') dy = bounds.top - rect.y
        else if (kind === 'center-v') dy = bounds.top + bounds.height / 2 - (rect.y + rect.height / 2)
        else if (kind === 'bottom') dy = bounds.bottom - (rect.y + rect.height)
        const nextX = Math.round(finiteNumber(node.layer.x, 0) + dx)
        const nextY = Math.round(finiteNumber(node.layer.y, 0) + dy)
        if (nextX === finiteNumber(node.layer.x, 0) && nextY === finiteNumber(node.layer.y, 0)) continue
        const patch = { x: nextX, y: nextY }
        forward.push({ type: 'layer.update', layerId: node.layer.id, patch: patch })
        inverse.push({
          type: 'layer.update',
          layerId: node.layer.id,
          patch: {
            x: Math.round(finiteNumber(node.layer.x, 0)),
            y: Math.round(finiteNumber(node.layer.y, 0)),
          },
        })
      }
      return { forward: forward, inverse: inverse }
    }

    function distributeOps(nodes, axis) {
      const forward = []
      const inverse = []
      const list = nodes.filter(function (node) {
        return !node.autoParent
      })
      if (list.length < 3) return { forward: forward, inverse: inverse }
      const horizontal = axis !== 'vertical'
      list.sort(function (first, second) {
        const a = horizontal ? first.worldRect.x + first.worldRect.width / 2 : first.worldRect.y + first.worldRect.height / 2
        const b = horizontal ? second.worldRect.x + second.worldRect.width / 2 : second.worldRect.y + second.worldRect.height / 2
        return a - b
      })
      const firstNode = list[0]
      const lastNode = list[list.length - 1]
      const firstCenter = horizontal
        ? firstNode.worldRect.x + firstNode.worldRect.width / 2
        : firstNode.worldRect.y + firstNode.worldRect.height / 2
      const lastCenter = horizontal
        ? lastNode.worldRect.x + lastNode.worldRect.width / 2
        : lastNode.worldRect.y + lastNode.worldRect.height / 2
      const step = (lastCenter - firstCenter) / (list.length - 1)
      for (let index = 1; index < list.length - 1; index += 1) {
        const node = list[index]
        const center = horizontal
          ? node.worldRect.x + node.worldRect.width / 2
          : node.worldRect.y + node.worldRect.height / 2
        const delta = Math.round(firstCenter + step * index - center)
        if (delta === 0) continue
        const previousX = Math.round(finiteNumber(node.layer.x, 0))
        const previousY = Math.round(finiteNumber(node.layer.y, 0))
        const patch = horizontal ? { x: previousX + delta } : { y: previousY + delta }
        forward.push({ type: 'layer.update', layerId: node.layer.id, patch: patch })
        inverse.push({
          type: 'layer.update',
          layerId: node.layer.id,
          patch: { x: previousX, y: previousY },
        })
      }
      return { forward: forward, inverse: inverse }
    }

    /* ------------------------------------------ Inspector ----------------------------------- */

    function Inspector(props) {
      const strings = props.strings || currentStrings()
      const doc = props.doc
      const tree = props.tree
      const comments = props.comments
      const actions = props.actions || {}
      const extensionContext = props.extensionContext || null

      const selectionIds = useSelectionIds(props)
      const existingIds = []
      for (let index = 0; index < selectionIds.length; index += 1) {
        if (findLayerById(doc, selectionIds[index])) existingIds.push(selectionIds[index])
      }
      const primaryId =
        typeof props.selectedLayerId === 'string' && existingIds.indexOf(props.selectedLayerId) >= 0
          ? props.selectedLayerId
          : existingIds.length
            ? existingIds[existingIds.length - 1]
            : ''
      const found = primaryId ? findLayerById(doc, primaryId) : null
      const layer = found ? found.layer : null
      const selectedNode =
        primaryId && tree && tree.byId ? tree.byId.get(primaryId) || null : null
      const artboard = found
        ? found.artboard
        : props.selectedArtboardId
          ? findArtboardById(doc, props.selectedArtboardId)
          : null
      const layers = []
      for (let index = 0; index < existingIds.length; index += 1) {
        const entry = findLayerById(doc, existingIds[index])
        if (entry && entry.layer) layers.push(entry.layer)
      }
      const multi = existingIds.length > 1
      const selectionNodes = multi ? selectedComputedNodes(tree, existingIds) : []

      const headerTitle = multi
        ? String(existingIds.length) + INSPECTOR_COPY.selectionManySuffix
        : layer
          ? strings.layer
          : artboard
            ? strings.artboard
            : strings.inspector
      const header = h(
        'div',
        { className: 'dc-panel-head' },
        h('span', null, headerTitle),
        h(IconButton, {
          title: strings.hide,
          icon: 'chevronRight',
          size: 12,
          onClick: actions.toggleInspector,
        }),
      )

      const noSelection = h(
        'aside',
        { className: 'dc-right', 'aria-label': strings.inspector },
        h('style', { dangerouslySetInnerHTML: { __html: INSPECTOR_CSS } }),
        header,
        h(
          'div',
          { className: 'dc-section dci-section' },
          h('div', { className: 'dc-muted' }, strings.selectHint),
        ),
      )

      if (!layer && !artboard) return noSelection

      /* ----------------------------------- shared helpers ---------------------------------- */

      function commit(patch) {
        commitSelectionPatch(props, existingIds.length ? existingIds : primaryId ? [primaryId] : [], patch)
      }

      function commitArtboard(patch) {
        if (typeof actions.commitArtboard === 'function') actions.commitArtboard(patch)
      }

      function commitLayout(nextLayout) {
        if (typeof actions.patchLayout === 'function') {
          actions.patchLayout(nextLayout)
          return
        }
        if (typeof actions.commitLayer === 'function') actions.commitLayer({ layout: nextLayout })
      }

      function toggleLocked() {
        if (typeof actions.toggleLock === 'function') {
          actions.toggleLock()
          return
        }
        const editor = editorFromProps(props)
        if (editor && typeof editor.toggleLock === 'function') {
          editor.toggleLock()
          return
        }
        const locked = boolFor(layers, 'locked', false) === true
        commit({ locked: !locked })
      }

      function toggleVisible() {
        const hidden = boolFor(layers, 'visible', true) === false
        commit({ visible: hidden })
      }

      function arrange(kind) {
        const applied = tryEditorAction(props, 'arrangeSelection', kind)
        if (applied === true) return
        const ids = existingIds.length ? existingIds : [primaryId]
        const ops = []
        for (let index = 0; index < ids.length; index += 1) {
          const entry = findLayerById(doc, ids[index])
          if (!entry) continue
          const siblings = entry.parent ? childrenOf(entry.parent) : layersOf(entry.artboard)
          const last = siblings.length - 1
          let target = entry.index
          if (kind === 'front') target = last
          else if (kind === 'back') target = 0
          else if (kind === 'forward') target = Math.min(last, entry.index + 1)
          else target = Math.max(0, entry.index - 1)
          if (target !== entry.index) ops.push({ type: 'layer.reorder', layerId: ids[index], index: target })
        }
        if (ops.length) runInspectorOps(props, 'arrange', ops, [])
      }

      function alignSelection(kind) {
        const editorKind = INSPECTOR_ALIGN_EDITOR_KINDS[kind] || kind
        if (tryEditorAction(props, 'alignSelection', editorKind) === true) return
        const result = alignOps(selectionNodes, kind)
        if (result.forward.length) runInspectorOps(props, 'align', result.forward, result.inverse)
      }

      function distributeSelection(axis) {
        if (tryEditorAction(props, 'distributeSelection', axis) === true) return
        const result = distributeOps(selectionNodes, axis)
        if (result.forward.length) runInspectorOps(props, 'distribute', result.forward, result.inverse)
      }

      function groupSelection() {
        if (tryEditorAction(props, 'groupSelection') === true) return
        const ids = existingIds.filter(function (id) {
          return !!findLayerById(doc, id)
        })
        if (ids.length < 2) return
        const primary = findLayerById(doc, primaryId)
        const op = { type: 'layer.group', layerIds: ids }
        if (primary) op.artboardId = primary.artboard.id
        runInspectorOps(props, 'group', [op], [])
      }

      function ungroupLayer(layerId) {
        if (tryEditorAction(props, 'ungroupSelection') === true) return
        runInspectorOps(props, 'ungroup', [{ type: 'layer.ungroup', layerId: layerId }], [])
      }

      function selectParent() {
        if (typeof actions.selectParent === 'function') {
          actions.selectParent()
          return
        }
        if (!found) return
        if (found.parentId) {
          setInspectorSelection(props, [found.parentId], found.artboard.id)
          return
        }
        if (typeof actions.selectArtboard === 'function') actions.selectArtboard(found.artboard.id)
      }

      function selectChildren() {
        if (!found) return
        if (typeof actions.selectChildren === 'function') {
          actions.selectChildren(primaryId)
          return
        }
        const kids = treeLayerChildren(found.layer)
        if (kids.length === 0) return
        const ids = kids.map(function (child) {
          return child && child.id
        }).filter(function (id) {
          return typeof id === 'string' && id
        })
        if (ids.length) setInspectorSelection(props, ids, found.artboard.id)
      }

      function deleteSelection() {
        if (typeof actions.deleteSelected === 'function') {
          actions.deleteSelected()
          return
        }
        const editor = editorFromProps(props)
        if (editor && typeof editor.deleteSelectedLayer === 'function') {
          editor.deleteSelectedLayer()
          return
        }
        if (editor && typeof editor.deleteSelected === 'function') editor.deleteSelected()
      }

      const canArrange = typeof actions.arrangeSelection === 'function' || typeof actions.moveSelected === 'function' || typeof actions.runOps === 'function' || !!editorFromProps(props)
      const canAlign = typeof actions.alignSelection === 'function' || selectionNodes.length > 1
      const canDistribute = typeof actions.distributeSelection === 'function' || selectionNodes.length > 2
      const canGroup = typeof actions.groupSelection === 'function' || typeof actions.runOps === 'function' || !!editorFromProps(props)
      const onOffOptions = [
        { value: false, label: strings.off },
        { value: true, label: strings.on },
      ]
      const alignOptions = [
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
      ]
      const justifyOptions = [
        { value: 'start', label: strings.justifyStart },
        { value: 'center', label: strings.justifyCenter },
        { value: 'end', label: strings.justifyEnd },
        { value: 'space-between', label: strings.justifySpaceBetween },
        { value: 'space-around', label: 'Space around' },
        { value: 'space-evenly', label: 'Space evenly' },
      ]
      const alignContentOptions = [
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
        { value: 'space-between', label: strings.justifySpaceBetween },
        { value: 'space-around', label: 'Space around' },
      ]
      const alignSelfOptions = [
        { value: 'inherit', label: strings.inherit },
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
      ]

      /* ------------------------------------ artboard mode ----------------------------------- */

      if (!layer) {
        return h(
          'aside',
          { className: 'dc-right', 'aria-label': strings.inspector },
          h('style', { dangerouslySetInnerHTML: { __html: INSPECTOR_CSS } }),
          header,
          h(
            'div',
            { className: 'dc-section dci-section' },
            h('div', { className: 'dc-section-title' }, strings.artboard),
            h(TextField, {
              label: strings.name,
              title: strings.name + ' — press Enter to rename the artboard',
              value: artboard.name || '',
              onCommit: function (value) {
                commitArtboard({ name: value })
              },
            }),
            h('div', { className: 'dc-row' }, h('span', { className: 'dc-field-label' }, artboard.id || '')),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.width,
                title: strings.width + ' (px)',
                value: finiteNumber(artboard.width, 1),
                min: 1,
                onCommit: function (value) {
                  commitArtboard({ width: value })
                },
              }),
              h(NumField, {
                label: strings.height,
                title: strings.height + ' (px)',
                value: finiteNumber(artboard.height, 1),
                min: 1,
                onCommit: function (value) {
                  commitArtboard({ height: value })
                },
              }),
            ),
            h(SwatchField, {
              label: strings.background,
              title: strings.background + ' — ' + strings.gradientHint,
              value: artboard.background || '#ffffff',
              onCommit: function (value) {
                commitArtboard({ background: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
          ),
        )
      }

      /* -------------------------------------- sections ------------------------------------- */

      const sections = []
      const types = {}
      for (let index = 0; index < layers.length; index += 1) {
        if (isObject(layers[index])) types[layers[index].type] = true
      }
      const typeList = Object.keys(types)
      const singleType = typeList.length === 1 ? typeList[0] : ''
      const allOf = function (list) {
        if (!typeList.length) return false
        for (let index = 0; index < typeList.length; index += 1) {
          if (list.indexOf(typeList[index]) < 0) return false
        }
        return true
      }
      const hasType = function (type) {
        return typeList.indexOf(type) >= 0
      }
      const lockedValue = boolFor(layers, 'locked', false)
      const hiddenValue = boolFor(layers, 'visible', true) === false
      const opacityValue = numberFor(layers, 'opacity', 1)

      /* Element: type + name + geometry (position/size where meaningful for a multi-selection) */
      const geometryChildren = []
      if (multi) {
        geometryChildren.push(
          h(
            'div',
            { key: 'multi-geo', className: 'dc-grid2' },
            h(NumField, {
              key: 'x',
              label: strings.x,
              title: strings.x + ' (px) — sets the same X on every selected layer',
              value: numberFor(layers, 'x', 0),
              onCommit: function (value) {
                commit({ x: value })
              },
            }),
            h(NumField, {
              key: 'y',
              label: strings.y,
              title: strings.y + ' (px) — sets the same Y on every selected layer',
              value: numberFor(layers, 'y', 0),
              onCommit: function (value) {
                commit({ y: value })
              },
            }),
            h(NumField, {
              key: 'w',
              label: strings.width,
              title: strings.width + ' (px) — sets the same width on every selected layer',
              value: numberFor(layers, 'width', 1),
              min: 1,
              onCommit: function (value) {
                commit({ width: value })
              },
            }),
            h(NumField, {
              key: 'h',
              label: strings.height,
              title: strings.height + ' (px) — sets the same height on every selected layer',
              value: numberFor(layers, 'height', 1),
              min: 1,
              onCommit: function (value) {
                commit({ height: value })
              },
            }),
          ),
        )
      } else if (selectedNode && selectedNode.autoParent) {
        geometryChildren.push(
          h(
            'div',
            { key: 'auto-geo', className: 'dc-grid2' },
            h(NumField, {
              key: 'aw',
              label: strings.width,
              title: strings.width + ' (px)',
              value: finiteNumber(layer.width, 1),
              min: 1,
              onCommit: function (value) {
                commit({ width: value })
              },
            }),
            h(NumField, {
              key: 'ah',
              label: strings.height,
              title: strings.height + ' (px)',
              value: finiteNumber(layer.height, 1),
              min: 1,
              onCommit: function (value) {
                commit({ height: value })
              },
            }),
          ),
        )
      } else {
        geometryChildren.push(
          h(
            'div',
            { key: 'geo', className: 'dc-grid2' },
            h(NumField, {
              key: 'x',
              label: strings.x,
              title: strings.x + ' (px)',
              value: numberFor(layers, 'x', 0),
              onCommit: function (value) {
                commit({ x: value })
              },
            }),
            h(NumField, {
              key: 'y',
              label: strings.y,
              title: strings.y + ' (px)',
              value: numberFor(layers, 'y', 0),
              onCommit: function (value) {
                commit({ y: value })
              },
            }),
            h(NumField, {
              key: 'w',
              label: strings.width,
              title: strings.width + ' (px)',
              value: numberFor(layers, 'width', 1),
              min: 1,
              onCommit: function (value) {
                commit({ width: value })
              },
            }),
            h(NumField, {
              key: 'h',
              label: strings.height,
              title: strings.height + ' (px)',
              value: numberFor(layers, 'height', 1),
              min: 1,
              onCommit: function (value) {
                commit({ height: value })
              },
            }),
          ),
        )
      }

      if (selectedNode && selectedNode.autoParent) {
        geometryChildren.push(
          h(
            'div',
            { key: 'derived', className: 'dc-geo-note' },
            strings.derivedGeometry +
              ': x=' +
              Math.round(selectedNode.x) +
              ' y=' +
              Math.round(selectedNode.y) +
              ' w=' +
              Math.round(selectedNode.width) +
              ' h=' +
              Math.round(selectedNode.height),
          ),
        )
      }

      sections.push(
        h(
          'div',
          { className: 'dc-section dci-section', key: 'element' },
          h('div', { className: 'dc-section-title' }, multi ? INSPECTOR_COPY.selectionSection : strings.element),
          multi
            ? h(
                'div',
                { className: 'dc-row', title: existingIds.join(', ') },
                h(TreeGlyph, { name: 'layers', size: 12 }),
                h(
                  'span',
                  { className: 'dc-muted' },
                  singleType ? treeTypeName(singleType) + ' × ' + String(existingIds.length) : INSPECTOR_COPY.typeMixed + ' × ' + String(existingIds.length),
                ),
              )
            : h(
                'div',
                { className: 'dc-row', title: layer.id },
                h(TreeGlyph, { name: treeGlyphName(layer.type), size: 12 }),
                h('span', { className: 'dc-muted' }, treeTypeName(layer.type) + ' · ' + String(layer.id)),
              ),
          h(TextField, {
            label: strings.name,
            title: multi
              ? strings.name +
                ' — applies to all ' +
                String(existingIds.length) +
                ' selected layers as one undo step (the layer tree renames one row inline)'
              : strings.name + ' — the layer tree renames the same name inline',
            value: layer.name || '',
            onCommit: function (value) {
              commit({ name: value })
            },
          }),
          multi
            ? h(
                'div',
                { className: 'dci-note' },
                String(existingIds.length) +
                  INSPECTOR_COPY.selectionManySuffix +
                  ' · ' +
                  INSPECTOR_COPY.multiHint +
                  ' · ' +
                  INSPECTOR_COPY.multiHintMixed,
              )
            : null,
          geometryChildren,
          h(NumField, {
            label: strings.opacity,
            title: strings.opacity + ' (0–1)',
            value: opacityValue,
            min: 0,
            max: 1,
            step: 0.05,
            decimals: 2,
            integer: false,
            onCommit: function (value) {
              commit({ opacity: value })
            },
          }),
          h(
            'div',
            { className: 'dc-grid2' },
            h(
              'div',
              { className: 'dci-toggle-row' },
              h(TreeGlyph, { name: lockedValue === true ? 'lock' : 'unlock', size: 11 }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dci-inline-link',
                  title: lockedValue === true ? INSPECTOR_COPY.lockHint : INSPECTOR_COPY.unlockHint,
                  'aria-pressed': lockedValue === true ? 'true' : 'false',
                  onClick: toggleLocked,
                },
                lockedValue === true ? INSPECTOR_COPY.locked : INSPECTOR_COPY.lock,
              ),
            ),
            h(
              'div',
              { className: 'dci-toggle-row' },
              h(TreeGlyph, { name: hiddenValue ? 'eyeOff' : 'eye', size: 11 }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dci-inline-link',
                  title: hiddenValue ? strings.show : strings.hide,
                  'aria-pressed': hiddenValue ? 'false' : 'true',
                  onClick: toggleVisible,
                },
                hiddenValue ? strings.show : strings.hide,
              ),
            ),
          ),
          h('div', { className: 'dci-note' }, INSPECTOR_COPY.lockHint),
        ),
      )

      /* Size limits + hug */
      sections.push(
        h(
          'div',
          { className: 'dc-section dci-section', key: 'limits' },
          h('div', { className: 'dc-section-title' }, INSPECTOR_COPY.sizeLimits),
          h('div', { className: 'dci-note' }, INSPECTOR_COPY.sizeLimitsHint),
          h(
            'div',
            { className: 'dc-grid2' },
            h(
              'div',
              { className: 'dci-limit' },
              h(NumField, {
                label: INSPECTOR_COPY.min + ' ' + strings.width,
                title: INSPECTOR_COPY.min + ' ' + strings.width + ' (px)',
                value: numberFor(layers, 'minWidth', NaN),
                min: 0,
                onCommit: function (value) {
                  commit({ minWidth: value })
                },
              }),
              h(InspectorClearButton, {
                title: 'Clear min width',
                disabled: !hasNumberProp(layers, 'minWidth'),
                onClick: function () {
                  commit({ minWidth: null })
                },
              }),
            ),
            h(
              'div',
              { className: 'dci-limit' },
              h(NumField, {
                label: INSPECTOR_COPY.min + ' ' + strings.height,
                title: INSPECTOR_COPY.min + ' ' + strings.height + ' (px)',
                value: numberFor(layers, 'minHeight', NaN),
                min: 0,
                onCommit: function (value) {
                  commit({ minHeight: value })
                },
              }),
              h(InspectorClearButton, {
                title: 'Clear min height',
                disabled: !hasNumberProp(layers, 'minHeight'),
                onClick: function () {
                  commit({ minHeight: null })
                },
              }),
            ),
            h(
              'div',
              { className: 'dci-limit' },
              h(NumField, {
                label: INSPECTOR_COPY.max + ' ' + strings.width,
                title: INSPECTOR_COPY.max + ' ' + strings.width + ' (px)',
                value: numberFor(layers, 'maxWidth', NaN),
                min: 0,
                onCommit: function (value) {
                  commit({ maxWidth: value })
                },
              }),
              h(InspectorClearButton, {
                title: 'Clear max width',
                disabled: !hasNumberProp(layers, 'maxWidth'),
                onClick: function () {
                  commit({ maxWidth: null })
                },
              }),
            ),
            h(
              'div',
              { className: 'dci-limit' },
              h(NumField, {
                label: INSPECTOR_COPY.max + ' ' + strings.height,
                title: INSPECTOR_COPY.max + ' ' + strings.height + ' (px)',
                value: numberFor(layers, 'maxHeight', NaN),
                min: 0,
                onCommit: function (value) {
                  commit({ maxHeight: value })
                },
              }),
              h(InspectorClearButton, {
                title: 'Clear max height',
                disabled: !hasNumberProp(layers, 'maxHeight'),
                onClick: function () {
                  commit({ maxHeight: null })
                },
              }),
            ),
          ),
          h('div', { className: 'dci-subtitle' }, INSPECTOR_COPY.hug),
          h(
            'div',
            { className: 'dc-grid2' },
            h(SegmentedGuarded, {
              label: INSPECTOR_COPY.hugWidth,
              title: INSPECTOR_COPY.hugHint,
              disabledTitle: INSPECTOR_COPY.hugDisabledHint,
              value: boolFor(layers, 'hugWidth', false),
              options: onOffOptions,
              disabled: !!(selectedNode && selectedNode.autoParent),
              onCommit: function (value) {
                commit({ hugWidth: !!value })
              },
            }),
            h(SegmentedGuarded, {
              label: INSPECTOR_COPY.hugHeight,
              title: INSPECTOR_COPY.hugHint,
              disabledTitle: INSPECTOR_COPY.hugDisabledHint,
              value: boolFor(layers, 'hugHeight', false),
              options: onOffOptions,
              disabled: !!(selectedNode && selectedNode.autoParent),
              onCommit: function (value) {
                commit({ hugHeight: !!value })
              },
            }),
          ),
          h(
            'div',
            { className: 'dci-note' + (selectedNode && selectedNode.autoParent ? ' dci-warn' : '') },
            selectedNode && selectedNode.autoParent ? INSPECTOR_COPY.hugDisabledHint : INSPECTOR_COPY.hugHint,
          ),
        ),
      )

      /* Per-type appearance */
      if (allOf(['rect', 'ellipse', 'frame'])) {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'appearance' },
            h('div', { className: 'dc-section-title' }, strings.appearance),
            h(SwatchField, {
              label: strings.fill,
              title: strings.fill + ' — ' + strings.gradientHint,
              value: stringFor(layers, 'fill', '#e5e7eb'),
              onCommit: function (value) {
                commit({ fill: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
            allOf(['rect', 'frame'])
              ? h(NumField, {
                  label: strings.radius,
                  title: strings.radius + ' (px)',
                  value: numberFor(layers, 'radius', 0),
                  min: 0,
                  onCommit: function (value) {
                    commit({ radius: value })
                  },
                })
              : null,
            h(NumField, {
              label: strings.borderWidth,
              title: strings.borderWidth + ' (px)',
              value: numberFor(layers, 'borderWidth', 0),
              min: 0,
              onCommit: function (value) {
                commit({ borderWidth: value })
              },
            }),
            h(SwatchField, {
              label: strings.borderColor,
              title: strings.borderColor + ' — solid color only',
              value: stringFor(layers, 'borderColor', '#9ca3af'),
              onCommit: function (value) {
                commit({ borderColor: value })
              },
            }),
            hasType('frame')
              ? h(Segmented, {
                  label: strings.clip,
                  title: strings.clip + ' — clips children to the frame box',
                  value: boolFor(layers, 'clip', false),
                  options: onOffOptions,
                  onCommit: function (value) {
                    commit({ clip: !!value })
                  },
                })
              : null,
          ),
        )
      }

      if (singleType === 'text' || (multi && allOf(['text']))) {
        const textRows = (function () {
          const content = stringFor(layers, 'text', '')
          const lines = String(content || '').split('\n').length
          return Math.max(3, Math.min(12, lines + 1))
        })()
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'text' },
            h('div', { className: 'dc-section-title' }, strings.textSection),
            h(TextAreaField, {
              label: strings.content,
              title: strings.content + ' — the textarea grows with the content',
              value: stringFor(layers, 'text', ''),
              rows: textRows,
              onCommit: function (value) {
                commit({ text: value })
              },
            }),
            h(SwatchField, {
              label: strings.color,
              title: strings.color + ' — solid color only',
              value: stringFor(layers, 'color', '#111827'),
              onCommit: function (value) {
                commit({ color: value })
              },
            }),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.fontSize,
                title: strings.fontSize + ' (px)',
                value: numberFor(layers, 'fontSize', 16),
                min: 1,
                onCommit: function (value) {
                  commit({ fontSize: value })
                },
              }),
              h(NumField, {
                label: strings.lineHeight,
                title: strings.lineHeight + ' (px)',
                value: numberFor(layers, 'lineHeight', finiteNumber(layer.fontSize, 16) * 1.4),
                min: 1,
                onCommit: function (value) {
                  commit({ lineHeight: value })
                },
              }),
            ),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.letterSpacing,
                title: strings.letterSpacing + ' (-20..40 px)',
                value: numberFor(layers, 'letterSpacing', 0),
                min: -20,
                max: 40,
                step: 0.5,
                decimals: 1,
                integer: false,
                onCommit: function (value) {
                  commit({ letterSpacing: value })
                },
              }),
              h(SelectField, {
                label: strings.textTransform,
                title: strings.textTransform,
                value: enumsFor(layers, 'textTransform', ['none', 'uppercase', 'lowercase'], 'none'),
                options: [
                  { value: 'none', label: strings.none },
                  { value: 'uppercase', label: strings.uppercase },
                  { value: 'lowercase', label: strings.lowercase },
                ],
                onCommit: function (value) {
                  commit({ textTransform: value })
                },
              }),
            ),
            h(SelectField, {
              label: strings.fontWeight,
              title: strings.fontWeight,
              value: numberFor(layers, 'fontWeight', 400),
              numeric: true,
              options: [
                { value: 400, label: '400' },
                { value: 500, label: '500' },
                { value: 600, label: '600' },
                { value: 700, label: '700' },
              ],
              onCommit: function (value) {
                commit({ fontWeight: value })
              },
            }),
            h(Segmented, {
              label: strings.align,
              title: strings.align,
              value: enumsFor(layers, 'align', ['left', 'center', 'right'], 'left'),
              options: [
                { value: 'left', label: strings.left },
                { value: 'center', label: strings.center },
                { value: 'right', label: strings.right },
              ],
              onCommit: function (value) {
                commit({ align: value })
              },
            }),
            h(TextField, {
              label: strings.fontFamily,
              title: strings.fontFamily,
              value: stringFor(layers, 'fontFamily', DEFAULT_FONT),
              onCommit: function (value) {
                commit({ fontFamily: value })
              },
            }),
            h(SwatchField, {
              label: strings.fill,
              title: strings.fill + ' background — ' + strings.gradientHint,
              value: stringFor(layers, 'fill', ''),
              onCommit: function (value) {
                commit({ fill: value })
              },
            }),
            h(Segmented, {
              label: INSPECTOR_COPY.autoHeight,
              title: INSPECTOR_COPY.autoHeightHint,
              value: boolFor(layers, 'hugHeight', false),
              options: onOffOptions,
              onCommit: function (value) {
                commit({ hugHeight: !!value })
              },
            }),
            h('div', { className: 'dci-note' }, INSPECTOR_COPY.autoHeightHint),
          ),
        )
      }

      if (singleType === 'line' || (multi && allOf(['line']))) {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'line' },
            h('div', { className: 'dc-section-title' }, INSPECTOR_COPY.line),
            h(SwatchField, {
              label: INSPECTOR_COPY.stroke,
              title: INSPECTOR_COPY.stroke + ' — solid color only',
              value: stringFor(layers, 'stroke', '#111827'),
              onCommit: function (value) {
                commit({ stroke: value })
              },
            }),
            h(NumField, {
              label: INSPECTOR_COPY.strokeWidth,
              title: INSPECTOR_COPY.strokeWidth + ' (px, 0.5–64)',
              value: numberFor(layers, 'strokeWidth', 2),
              min: 0.5,
              max: 64,
              step: 0.5,
              decimals: 1,
              integer: false,
              onCommit: function (value) {
                commit({ strokeWidth: value })
              },
            }),
            h(Segmented, {
              label: INSPECTOR_COPY.orientation,
              title: INSPECTOR_COPY.orientation,
              value: enumsFor(layers, 'orientation', ['horizontal', 'vertical', 'diagonal'], 'horizontal'),
              options: [
                { value: 'horizontal', label: INSPECTOR_COPY.horizontal },
                { value: 'vertical', label: INSPECTOR_COPY.vertical },
                { value: 'diagonal', label: INSPECTOR_COPY.diagonal },
              ],
              onCommit: function (value) {
                commit({ orientation: value })
              },
            }),
            h(Segmented, {
              label: INSPECTOR_COPY.dashed,
              title: INSPECTOR_COPY.dashed,
              value: boolFor(layers, 'dashed', false),
              options: onOffOptions,
              onCommit: function (value) {
                commit({ dashed: !!value })
              },
            }),
            h(
              'div',
              { className: 'dc-grid2' },
              h(Segmented, {
                label: INSPECTOR_COPY.arrowStart,
                title: INSPECTOR_COPY.arrowStart,
                value: boolFor(layers, 'arrowStart', false),
                options: onOffOptions,
                onCommit: function (value) {
                  commit({ arrowStart: !!value })
                },
              }),
              h(Segmented, {
                label: INSPECTOR_COPY.arrowEnd,
                title: INSPECTOR_COPY.arrowEnd,
                value: boolFor(layers, 'arrowEnd', false),
                options: onOffOptions,
                onCommit: function (value) {
                  commit({ arrowEnd: !!value })
                },
              }),
            ),
          ),
        )
      }

      if (singleType === 'image' || (multi && allOf(['image']))) {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'image' },
            h('div', { className: 'dc-section-title' }, strings.imageSection),
            h(TextField, {
              label: strings.src,
              title: strings.src,
              value: stringFor(layers, 'src', ''),
              placeholder: 'https://…',
              onCommit: function (value) {
                commit({ src: value })
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.chooseFile,
                disabled: multi,
                onClick: function () {
                  if (typeof actions.chooseImageFile === 'function') actions.chooseImageFile()
                },
              },
              strings.chooseFile,
            ),
            h(SelectField, {
              label: strings.fit,
              title: strings.fit,
              value: enumsFor(layers, 'fit', ['cover', 'contain', 'fill'], 'cover'),
              options: [
                { value: 'cover', label: strings.cover },
                { value: 'contain', label: strings.contain },
                { value: 'fill', label: strings.fillFit },
              ],
              onCommit: function (value) {
                commit({ fit: value })
              },
            }),
            h(NumField, {
              label: strings.radius,
              title: strings.radius + ' (px)',
              value: numberFor(layers, 'radius', 0),
              min: 0,
              onCommit: function (value) {
                commit({ radius: value })
              },
            }),
          ),
        )
      }

      if (hasType('group')) {
        const groupLayer = singleType === 'group' ? layer : null
        const childCount = groupLayer ? treeLayerChildren(groupLayer).length : 0
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'group' },
            h('div', { className: 'dc-section-title' }, INSPECTOR_COPY.groupSection),
            h(
              'div',
              { className: 'dc-row' },
              h('span', { className: 'dc-field-label' }, INSPECTOR_COPY.children),
              h('span', { className: 'dc-muted dci-count' }, String(childCount)),
            ),
            h(Segmented, {
              label: strings.clip,
              title: strings.clip,
              value: boolFor(layers, 'clip', false),
              options: onOffOptions,
              onCommit: function (value) {
                commit({ clip: !!value })
              },
            }),
            h(
              'div',
              { className: 'dci-btnrow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn',
                  title: INSPECTOR_COPY.selectChildren,
                  disabled: !groupLayer || childCount === 0,
                  onClick: selectChildren,
                },
                INSPECTOR_COPY.selectChildren,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn',
                  title: INSPECTOR_COPY.ungroupHint,
                  disabled: !groupLayer,
                  onClick: function () {
                    if (groupLayer) ungroupLayer(groupLayer.id)
                  },
                },
                INSPECTOR_COPY.ungroup,
              ),
            ),
          ),
        )
      }

      /* Frame layout (auto layout + v2 extras) */
      if (!multi && layer.type === 'frame') {
        const layoutValue = inspectorLayoutOf(layer)
        const layoutChildren = []
        if (layoutValue) {
          const mixedGaps =
            optionalSize(layoutValue.rowGap) !== null &&
            optionalSize(layoutValue.columnGap) !== null &&
            layoutValue.rowGap !== layoutValue.columnGap
          layoutChildren.push(
            h('div', { key: 'summary', className: 'dc-geo-note' }, layoutSummaryText(layer.layout)),
            h(Segmented, {
              key: 'direction',
              label: strings.direction,
              title: strings.direction,
              value: layoutValue.direction,
              options: [
                { value: 'row', label: strings.row },
                { value: 'column', label: strings.column },
              ],
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { direction: value }))
              },
            }),
            h(NumField, {
              key: 'gap',
              label: strings.gap,
              title: strings.gap + ' (px) — fallback for both axes',
              value: layoutValue.gap,
              min: 0,
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { gap: value }))
              },
            }),
            h('div', { key: 'gap-title', className: 'dci-subtitle' }, INSPECTOR_COPY.gapOverrides),
            h(
              'div',
              { key: 'gap-row', className: 'dc-grid2' },
              h(
                'div',
                { className: 'dci-limit' },
                h(NumField, {
                  label: INSPECTOR_COPY.rowGap,
                  title: INSPECTOR_COPY.inheritedGap,
                  value:
                    optionalSize(layoutValue.rowGap) !== null ? layoutValue.rowGap : layoutValue.gap,
                  min: 0,
                  onCommit: function (value) {
                    commitLayout(layoutObjectFrom(layoutValue, { rowGap: value }))
                  },
                }),
                h(InspectorClearButton, {
                  title: 'Clear row gap override',
                  disabled: optionalSize(layoutValue.rowGap) === null,
                  onClick: function () {
                    commitLayout(layoutObjectFrom(layoutValue, { rowGap: null }))
                  },
                }),
              ),
              h(
                'div',
                { className: 'dci-limit' },
                h(NumField, {
                  label: INSPECTOR_COPY.columnGap,
                  title: INSPECTOR_COPY.inheritedGap,
                  value:
                    optionalSize(layoutValue.columnGap) !== null
                      ? layoutValue.columnGap
                      : layoutValue.gap,
                  min: 0,
                  onCommit: function (value) {
                    commitLayout(layoutObjectFrom(layoutValue, { columnGap: value }))
                  },
                }),
                h(InspectorClearButton, {
                  title: 'Clear column gap override',
                  disabled: optionalSize(layoutValue.columnGap) === null,
                  onClick: function () {
                    commitLayout(layoutObjectFrom(layoutValue, { columnGap: null }))
                  },
                }),
              ),
            ),
            mixedGaps
              ? h(
                  'div',
                  { key: 'mixed-gaps', className: 'dci-note dci-warn' },
                  INSPECTOR_COPY.mixedGaps +
                    ': ' +
                    INSPECTOR_COPY.rowGap +
                    ' ' +
                    String(layoutValue.rowGap) +
                    ' · ' +
                    INSPECTOR_COPY.columnGap +
                    ' ' +
                    String(layoutValue.columnGap),
                )
              : null,
            h('div', { key: 'pad-title', className: 'dci-subtitle' }, strings.padding),
            h(
              'div',
              { key: 'pad-top-left', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-top',
                label: strings.paddingTop,
                title: strings.padding + ' top (px)',
                value: layoutValue.padding.top,
                min: 0,
                onCommit: function (value) {
                  commitLayout(layoutObjectFrom(layoutValue, { padding: { top: value } }))
                },
              }),
              h(NumField, {
                key: 'pad-right',
                label: strings.paddingRight,
                title: strings.padding + ' right (px)',
                value: layoutValue.padding.right,
                min: 0,
                onCommit: function (value) {
                  commitLayout(layoutObjectFrom(layoutValue, { padding: { right: value } }))
                },
              }),
            ),
            h(
              'div',
              { key: 'pad-bottom-left', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-bottom',
                label: strings.paddingBottom,
                title: strings.padding + ' bottom (px)',
                value: layoutValue.padding.bottom,
                min: 0,
                onCommit: function (value) {
                  commitLayout(layoutObjectFrom(layoutValue, { padding: { bottom: value } }))
                },
              }),
              h(NumField, {
                key: 'pad-left',
                label: strings.paddingLeft,
                title: strings.padding + ' left (px)',
                value: layoutValue.padding.left,
                min: 0,
                onCommit: function (value) {
                  commitLayout(layoutObjectFrom(layoutValue, { padding: { left: value } }))
                },
              }),
            ),
            h(SelectField, {
              key: 'align',
              label: strings.align,
              title: strings.align + ' (cross axis)',
              value: layoutValue.align,
              options: alignOptions,
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { align: value }))
              },
            }),
            h(SelectField, {
              key: 'justify',
              label: INSPECTOR_COPY.justify,
              title: INSPECTOR_COPY.justify + ' (main axis)',
              value: layoutValue.justify,
              options: justifyOptions,
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { justify: value }))
              },
            }),
            h(Segmented, {
              key: 'wrap',
              label: strings.wrap,
              title: strings.wrap,
              value: layoutValue.wrap === true,
              options: onOffOptions,
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { wrap: !!value }))
              },
            }),
            h(SelectField, {
              key: 'align-content',
              label: INSPECTOR_COPY.wrapAlign,
              title: INSPECTOR_COPY.wrapAlign + ' — ' + INSPECTOR_COPY.wrapHint,
              value: layoutValue.alignContent,
              disabled: layoutValue.wrap !== true,
              options: alignContentOptions,
              onCommit: function (value) {
                commitLayout(layoutObjectFrom(layoutValue, { alignContent: value }))
              },
            }),
            layoutValue.wrap !== true
              ? h('div', { key: 'wrap-hint', className: 'dci-note' }, INSPECTOR_COPY.wrapHint)
              : null,
            h(
              'button',
              {
                key: 'disable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.disableAutoLayout,
                onClick: function () {
                  if (typeof actions.disableLayout === 'function') actions.disableLayout()
                },
              },
              strings.disableAutoLayout,
            ),
          )
        } else {
          layoutChildren.push(
            h('div', { key: 'absolute-note', className: 'dc-geo-note' }, strings.absoluteMode),
            h(
              'button',
              {
                key: 'enable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.enableAutoLayout,
                onClick: function () {
                  if (typeof actions.enableLayout === 'function') actions.enableLayout()
                },
              },
              strings.enableAutoLayout,
            ),
          )
        }
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'layout' },
            h('div', { className: 'dc-section-title' }, strings.layout),
            layoutChildren,
          ),
        )
      }

      /* Auto-layout child controls */
      if (!multi && selectedNode && selectedNode.autoParent) {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'autolayout-child' },
            h('div', { className: 'dc-section-title' }, strings.inAutoLayout),
            h(Segmented, {
              label: strings.grow,
              title: strings.grow + ' — consume free space on the main axis',
              value: layer.grow === true,
              options: onOffOptions,
              onCommit: function (value) {
                commit({ grow: !!value })
              },
            }),
            h(SelectField, {
              label: strings.alignSelf,
              title: strings.alignSelf,
              value: typeof layer.alignSelf === 'string' ? layer.alignSelf : 'inherit',
              options: alignSelfOptions,
              onCommit: function (value) {
                commit({ alignSelf: value === 'inherit' ? null : value })
              },
            }),
          ),
        )
      }

      /* Effects */
      sections.push(
        h(
          'div',
          { className: 'dc-section dci-section', key: 'effects' },
          h('div', { className: 'dc-section-title' }, strings.effects),
          h(
            'div',
            { className: 'dc-row' },
            h(TextField, {
              label: strings.shadow,
              title: strings.shadow + ' — ' + INSPECTOR_COPY.shadowHint,
              value: stringFor(layers, 'shadow', ''),
              placeholder: strings.shadowPlaceholder,
              onCommit: function (value) {
                if (typeof actions.commitShadow === 'function' && !multi) actions.commitShadow(value)
                else commit({ shadow: value ? value : null })
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                title: strings.clear,
                disabled: !layers.some(function (item) {
                  return isObject(item) && typeof item.shadow === 'string'
                }),
                onClick: function () {
                  if (typeof actions.clearShadow === 'function' && !multi) actions.clearShadow()
                  else commit({ shadow: null })
                },
              },
              strings.clear,
            ),
          ),
        ),
      )

      /* Structure: parent picker, parent/children links, z-order */
      const parentOptions = buildParentOptionsFor(props, doc, tree, layer)
      const parentName = found.parentId
        ? (function () {
            const parentEntry = findLayerById(doc, found.parentId)
            return parentEntry && parentEntry.layer
              ? parentEntry.layer.name || parentEntry.layer.id
              : found.parentId
          })()
        : found.artboard.name || found.artboard.id
      const structureChildren = [
        h('div', { key: 'parent-note', className: 'dc-geo-note' }, strings.parent + ': ' + parentName),
        parentOptions.length > 0
          ? h(SelectField, {
              key: 'move-into',
              label: strings.moveInto,
              title: strings.moveInto,
              value: found.parentId ? 'frame:' + found.parentId : 'artboard:' + found.artboard.id,
              options: parentOptions,
              onCommit: function (value) {
                handleMoveInto(props, layer, value)
              },
            })
          : null,
        h(
          'div',
          { key: 'parent-links', className: 'dci-btnrow' },
          h(
            'button',
            {
              type: 'button',
              className: 'dc-btn',
              title: INSPECTOR_COPY.selectParent,
              onClick: selectParent,
            },
            INSPECTOR_COPY.selectParent,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-btn',
              title: INSPECTOR_COPY.selectChildren,
              disabled: treeLayerChildren(layer).length === 0,
              onClick: selectChildren,
            },
            INSPECTOR_COPY.selectChildren + (treeLayerChildren(layer).length ? ' (' + treeLayerChildren(layer).length + ')' : ''),
          ),
        ),
        h('div', { key: 'arrange-title', className: 'dci-subtitle' }, INSPECTOR_COPY.arrange),
        h(InspectorActionRow, {
          key: 'arrange',
          compact: true,
          options: [
            { key: 'back', label: INSPECTOR_COPY.back, title: INSPECTOR_COPY.sendBack, onClick: function () { arrange('back') }, disabled: !canArrange },
            { key: 'backward', label: INSPECTOR_COPY.backward, title: INSPECTOR_COPY.sendBackward, onClick: function () { arrange('backward') }, disabled: !canArrange },
            { key: 'forward', label: INSPECTOR_COPY.forward, title: INSPECTOR_COPY.bringForward, onClick: function () { arrange('forward') }, disabled: !canArrange },
            { key: 'front', label: INSPECTOR_COPY.front, title: INSPECTOR_COPY.bringFront, onClick: function () { arrange('front') }, disabled: !canArrange },
          ],
        }),
        h('div', { key: 'arrange-note', className: 'dci-note' }, INSPECTOR_COPY.arrangeHint),
      ]
      sections.push(
        h(
          'div',
          { className: 'dc-section dci-section', key: 'structure' },
          h('div', { className: 'dc-section-title' }, strings.structure),
          structureChildren,
        ),
      )

      /* Arrange / align / group / delete — the action surface of a multi-selection */
      if (multi) {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'selection-actions' },
            h('div', { className: 'dc-section-title' }, INSPECTOR_COPY.selectionActions),
            h('div', { className: 'dci-note' }, INSPECTOR_COPY.alignHint),
            h(
              'div',
              { className: 'dci-btnrow' },
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignLeftH, disabled: !canAlign, onClick: function () { alignSelection('left') } },
                INSPECTOR_COPY.leftShort,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignCenterH, disabled: !canAlign, onClick: function () { alignSelection('center-h') } },
                INSPECTOR_COPY.centerShort,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignRightH, disabled: !canAlign, onClick: function () { alignSelection('right') } },
                INSPECTOR_COPY.rightShort,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignTopV, disabled: !canAlign, onClick: function () { alignSelection('top') } },
                INSPECTOR_COPY.topShort,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignCenterV, disabled: !canAlign, onClick: function () { alignSelection('center-v') } },
                INSPECTOR_COPY.middleShort,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.alignBottomV, disabled: !canAlign, onClick: function () { alignSelection('bottom') } },
                INSPECTOR_COPY.bottomShort,
              ),
            ),
            h('div', { className: 'dci-subtitle' }, INSPECTOR_COPY.distribute),
            h(
              'div',
              { className: 'dci-btnrow' },
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.distributeH, disabled: !canDistribute, onClick: function () { distributeSelection('horizontal') } },
                INSPECTOR_COPY.distributeH,
              ),
              h(
                'button',
                { type: 'button', className: 'dc-btn', title: INSPECTOR_COPY.distributeV, disabled: !canDistribute, onClick: function () { distributeSelection('vertical') } },
                INSPECTOR_COPY.distributeV,
              ),
            ),
            h('div', { className: 'dci-subtitle' }, INSPECTOR_COPY.groupSection),
            h(
              'div',
              { className: 'dci-btnrow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn',
                  title: INSPECTOR_COPY.groupHint,
                  disabled: !canGroup || existingIds.length < 2,
                  onClick: groupSelection,
                },
                INSPECTOR_COPY.groupSelection,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn',
                  title: INSPECTOR_COPY.ungroupHint,
                  disabled: !layers.some(function (item) {
                    return isObject(item) && item.type === 'group'
                  }),
                  onClick: function () {
                    for (let index = 0; index < layers.length; index += 1) {
                      if (isObject(layers[index]) && layers[index].type === 'group') {
                        ungroupLayer(layers[index].id)
                        return
                      }
                    }
                  },
                },
                INSPECTOR_COPY.ungroupSelection,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: INSPECTOR_COPY.deleteSelection + ' — ' + strings.delete,
                onClick: deleteSelection,
              },
              strings.delete + ' ' + String(existingIds.length) + ' ' + (existingIds.length === 1 ? strings.layer.toLowerCase() : strings.layers.toLowerCase()),
            ),
          ),
        )
      } else {
        sections.push(
          h(
            'div',
            { className: 'dc-section dci-section', key: 'selection-actions' },
            h('div', { className: 'dc-section-title' }, INSPECTOR_COPY.actions),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.delete,
                onClick: deleteSelection,
              },
              strings.delete + ' ' + strings.layer.toLowerCase(),
            ),
          ),
        )
      }

      /* Comments (single selection only — a batch edit has no single thread) */
      if (!multi) {
        sections.push(
          h(CommentThread, {
            key: 'comments',
            strings: strings,
            comments: Array.isArray(comments) ? comments : [],
            canAdd: true,
            actions: {
              resolveComment: actions.resolveComment,
              reopenComment: actions.reopenComment,
              deleteComment: actions.deleteComment,
              openComposer: actions.openComposer,
            },
          }),
        )
      }

      // Feature parts contribute inspector sections through EXTENSIONS.inspector
      // (see 00-core.js): new layer props, export settings, layout helpers, …
      if (EXTENSIONS.inspector.length) {
        const extensionSections = renderExtensions(
          EXTENSIONS.inspector,
          extensionContext || {
            doc: doc,
            tree: tree,
            strings: strings,
            selection: {
              layerIds: existingIds.slice(),
              primaryLayerId: primaryId || null,
              artboardId: props.selectedArtboardId || (found ? found.artboard.id : null),
            },
            selectedLayerId: primaryId || null,
            selectedArtboardId: props.selectedArtboardId || null,
            actions: actions,
          },
        )
        if (extensionSections) {
          for (let index = 0; index < extensionSections.length; index += 1) {
            sections.push(extensionSections[index])
          }
        }
      }

      return h(
        'aside',
        { className: 'dc-right', 'aria-label': strings.inspector },
        h('style', { dangerouslySetInnerHTML: { __html: INSPECTOR_CSS } }),
        header,
        multi
          ? h(
              'div',
              { className: 'dci-multi-head' },
              h(
                'div',
                { className: 'dci-multi-title' },
                String(existingIds.length) + INSPECTOR_COPY.selectionManySuffix,
              ),
              h(
                'div',
                { className: 'dci-multi-sub' },
                singleType
                  ? treeTypeName(singleType) + ' · ' + INSPECTOR_COPY.multiHint
                  : INSPECTOR_COPY.typeMixed + ' · ' + INSPECTOR_COPY.multiHint,
              ),
            )
          : null,
        sections,
      )
    }

    /* ------------------------------------- structure helpers --------------------------------- */

    /** Frames and groups the layer may be moved into (never itself or its own descendant). */
    function buildParentOptionsFor(props, doc, tree, layer) {
      const options = []
      if (!tree || !Array.isArray(tree.artboards)) return options
      const blocked = new Set()
      if (isObject(layer)) {
        blocked.add(layer.id)
        collectSubtreeIds(layer, blocked)
      }
      function pushContainers(nodes, depth) {
        if (!Array.isArray(nodes)) return
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]
          if (!node || !isObject(node.layer)) continue
          if (!treeIsContainerType(node.layer.type)) continue
          if (blocked.has(node.layer.id)) continue
          options.push({
            value: 'frame:' + node.layer.id,
            label: (depth > 0 ? '· '.repeat(depth) : '') + (node.layer.name || node.layer.id),
          })
          pushContainers(treeNodeChildren(node), depth + 1)
        }
      }
      tree.artboards.forEach(function (entry) {
        if (!entry || !entry.artboard) return
        options.push({
          value: 'artboard:' + entry.artboard.id,
          label: entry.artboard.name || entry.artboard.id,
        })
        pushContainers(entry.layers, 1)
      })
      return options
    }

    function collectSubtreeIds(layer, target) {
      if (!isObject(layer) || !(target instanceof Set)) return target
      const kids = treeLayerChildren(layer)
      for (let index = 0; index < kids.length; index += 1) {
        const child = kids[index]
        if (!isObject(child) || typeof child.id !== 'string') continue
        target.add(child.id)
        collectSubtreeIds(child, target)
      }
      return target
    }

    function handleMoveInto(props, layer, value) {
      const actions = props.actions || {}
      const token = String(value || '')
      const destination = token.indexOf('frame:') === 0
        ? { parentId: token.slice(6) }
        : token.indexOf('artboard:') === 0
          ? { artboardId: token.slice(9) }
          : null
      if (!destination) return
      if (typeof actions.reparent === 'function') {
        actions.reparent(layer.id, destination)
        return
      }
      const editor = editorFromProps(props)
      if (editor && typeof editor.reparentLayer === 'function') {
        editor.reparentLayer(layer.id, destination)
      }
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas: artboards, layers, selection overlay, pins, inline composer
     * ---------------------------------------------------------------------------------------- */
