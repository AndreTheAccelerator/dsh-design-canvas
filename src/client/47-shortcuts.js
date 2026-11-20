    /* ------------------------------------------------------------------------------------------
     * Keyboard shortcuts
     *
     * One registry for every binding the canvas has (existing and new) plus the discoverable
     * "Keyboard shortcuts" sheet. Each entry is { id, keys, label, group, run?, when? }, so the
     * sheet and the handler are the same source of truth: a shortcut that is not in the registry
     * does not exist.
     *
     * Bindings are installed through `registerKeyHandler` (EXTENSIONS.keys), so this part owns the
     * keymap and the editor does not need to know about individual keys.
     *
     * Ownership rules (see CONTRACT.md):
     *   - an entry WITH `run` is handled here;
     *   - an entry WITHOUT `run` is documentation only: the editor/shell/selection/comment/export
     *     part keeps its binding and the sheet still lists it, so there is exactly one owner.
     * ---------------------------------------------------------------------------------------- */

    const SHORTCUTS_GROUPS = ['Tools', 'Selection', 'Edit', 'Arrange', 'View', 'Panels', 'Comments', 'Export']

    const SHORTCUTS_IS_MAC =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test(
        String(
          (navigator && (navigator.platform || navigator.userAgent)) || '',
        ),
      )

    /** Chord tokens that name a modifier, not a key. */
    const SHORTCUT_MOD_TOKENS = {
      'Ctrl/Cmd': 'mod',
      Mod: 'mod',
      Ctrl: 'ctrl',
      Cmd: 'meta',
      Meta: 'meta',
      '⌘': 'meta',
      Shift: 'shift',
      '⇧': 'shift',
      Alt: 'alt',
      Option: 'alt',
      '⌥': 'alt',
    }

    /** Named keys: display token -> accepted `event.key` values. */
    const SHORTCUT_KEY_ALIASES = {
      Del: ['Delete', 'Del'],
      Delete: ['Delete', 'Del'],
      Backspace: ['Backspace'],
      Esc: ['Escape', 'Esc'],
      Escape: ['Escape', 'Esc'],
      Enter: ['Enter'],
      Return: ['Enter'],
      Tab: ['Tab'],
      Space: [' ', 'Spacebar', 'Space'],
      '↑': ['ArrowUp'],
      '↓': ['ArrowDown'],
      '←': ['ArrowLeft'],
      '→': ['ArrowRight'],
      Up: ['ArrowUp'],
      Down: ['ArrowDown'],
      Left: ['ArrowLeft'],
      Right: ['ArrowRight'],
      PageUp: ['PageUp'],
      PageDown: ['PageDown'],
      Home: ['Home'],
      End: ['End'],
    }

    /** Punctuation keys: display token -> physical `event.code` (layout independent). */
    const SHORTCUT_CODE_ALIASES = {
      ']': 'BracketRight',
      '[': 'BracketLeft',
      '}': 'BracketRight',
      '{': 'BracketLeft',
      '/': 'Slash',
      '?': 'Slash',
      '=': 'Equal',
      '+': 'NumpadAdd',
      '-': 'Minus',
      ',': 'Comma',
      '.': 'Period',
      ';': 'Semicolon',
      "'": 'Quote',
      '`': 'Backquote',
      '\\': 'Backslash',
    }

    const SHORTCUT_MOD_LABEL = SHORTCUTS_IS_MAC ? '⌘' : 'Ctrl'

    /** Display labels for the keycaps inside the sheet (platform appropriate). */
    const SHORTCUT_TOKEN_LABELS = {
      'Ctrl/Cmd': SHORTCUT_MOD_LABEL,
      Mod: SHORTCUT_MOD_LABEL,
      Ctrl: SHORTCUTS_IS_MAC ? '⌃' : 'Ctrl',
      Cmd: '⌘',
      Meta: '⌘',
      Shift: SHORTCUTS_IS_MAC ? '⇧' : 'Shift',
      Alt: SHORTCUTS_IS_MAC ? '⌥' : 'Alt',
      Option: SHORTCUTS_IS_MAC ? '⌥' : 'Alt',
      Del: 'Del',
      Delete: 'Del',
      Backspace: SHORTCUTS_IS_MAC ? '⌫' : 'Backspace',
      Esc: 'Esc',
      Escape: 'Esc',
      Enter: SHORTCUTS_IS_MAC ? '↵' : 'Enter',
      Tab: 'Tab',
      Space: 'Space',
      Up: '↑',
      Down: '↓',
      Left: '←',
      Right: '→',
      drag: 'drag',
      wheel: 'wheel',
      click: 'click',
      doubleClick: 'double-click',
    }

    /* ------------------------------------------------------------------------------------------
     * Shared state: open/close is a tiny store so the sheet, the command, the toolbar button and
     * other parts (context menu) can drive it without a React tree in between.
     * ---------------------------------------------------------------------------------------- */

    const SHORTCUTS_RUNTIME = {
      /** Full `useEditor` hook captured from an app-panel render (has everything, not just actions). */
      editor: null,
      /** True while the pointer is over the canvas app root (gates single-key tool bindings). */
      pointerInside: false,
      /** Keyboard-shortcut sheet open flag (mirrored in SHORTCUTS_UI). */
      open: false,
    }

    const SHORTCUTS_UI = {
      open: false,
      subscribers: [],
      subscribe: function (listener) {
        SHORTCUTS_UI.subscribers.push(listener)
        return function () {
          const index = SHORTCUTS_UI.subscribers.indexOf(listener)
          if (index >= 0) SHORTCUTS_UI.subscribers.splice(index, 1)
        }
      },
      notify: function () {
        const snapshot = SHORTCUTS_UI.subscribers.slice()
        for (let index = 0; index < snapshot.length; index += 1) {
          try {
            snapshot[index]()
          } catch (error) {
            beacon('shortcuts-subscriber-failed', { message: shortError(error) })
          }
        }
      },
      set: function (patch) {
        Object.assign(SHORTCUTS_UI, patch)
        SHORTCUTS_RUNTIME.open = SHORTCUTS_UI.open === true
        SHORTCUTS_UI.notify()
      },
    }

    function openShortcutsSheet() {
      if (SHORTCUTS_UI.open !== true) {
        SHORTCUTS_UI.set({ open: true })
        beacon('shortcuts-open', {})
      }
      return true
    }

    function closeShortcutsSheet() {
      if (SHORTCUTS_UI.open === true) {
        SHORTCUTS_UI.set({ open: false })
        beacon('shortcuts-close', {})
      }
      return true
    }

    function toggleShortcutsSheet() {
      return SHORTCUTS_UI.open === true ? closeShortcutsSheet() : openShortcutsSheet()
    }

    /* ------------------------------------------------------------------------------------------
     * Chord grammar: 'Ctrl/Cmd+Shift+G', 'Alt+1', 'Shift+2', 'Del', '↑'.
     *
     * A registry entry's `keys` is a list of alternatives; each alternative is one chord. Parsing
     * happens once at load (SHORTCUT_SPECS), so matching a keydown is a flat loop over specs and
     * the handler and the sheet can never drift.
     * ---------------------------------------------------------------------------------------- */

    function shortcutChordSpec(chord) {
      const text = String(chord === undefined || chord === null ? '' : chord).trim()
      if (!text) return null
      const spec = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: '', flexShift: false }
      // Numpad/plus is its own key on every layout: never a modifier chain.
      if (text === '+') {
        spec.key = '+'
        spec.flexShift = true
        return spec
      }
      const parts = text.split('+')
      if (!parts.length) return null
      const keyToken = String(parts[parts.length - 1] || '').trim()
      if (!keyToken) return null
      for (let index = 0; index < parts.length - 1; index += 1) {
        const token = String(parts[index] || '').trim()
        const slot = SHORTCUT_MOD_TOKENS[token]
        if (!slot) return null
        spec[slot] = true
      }
      spec.key = keyToken
      return spec
    }

    function shortcutKeyTokenMatches(event, token) {
      if (!token) return false
      const key = typeof event.key === 'string' ? event.key : ''
      const code = typeof event.code === 'string' ? event.code : ''
      const alias = SHORTCUT_KEY_ALIASES[token]
      if (alias && alias.indexOf(key) >= 0) return true
      const codeAlias = SHORTCUT_CODE_ALIASES[token]
      if (codeAlias && code === codeAlias) return true
      if (token.length === 1) {
        // Physical fallback keeps single-key tools working on non-Latin layouts.
        if (/[A-Za-z]/.test(token) && code === 'Key' + token.toUpperCase()) return true
        if (/[0-9]/.test(token) && code === 'Digit' + token) return true
        if (key === token) return true
        if (key.length === 1 && key.toUpperCase() === token.toUpperCase() && /[A-Za-z0-9]/.test(token)) {
          return true
        }
        return false
      }
      return key === token
    }

    function shortcutSpecMatches(spec, event) {
      if (!spec || !event) return false
      const wantCtrl = spec.ctrl === true || (spec.mod === true && !SHORTCUTS_IS_MAC)
      const wantMeta = spec.meta === true || (spec.mod === true && SHORTCUTS_IS_MAC)
      if ((event.ctrlKey === true) !== wantCtrl) return false
      if ((event.metaKey === true) !== wantMeta) return false
      if ((event.altKey === true) !== (spec.alt === true)) return false
      if (!spec.flexShift && (event.shiftKey === true) !== (spec.shift === true)) return false
      return shortcutKeyTokenMatches(event, spec.key)
    }

    /* ------------------------------------------------------------------------------------------
     * The registry. `run(editor, event, api)` returns true only when it acted; `editor` is the full
     * hook (captured from an app-panel render), `api` is the extension context for the same render.
     * Entries without `run` are documentation: the owning part keeps the binding.
     * ---------------------------------------------------------------------------------------- */

    const SHORTCUTS = [
      /* ------------------------------- Tools ------------------------------- */
      {
        id: 'tool-select',
        group: 'Tools',
        keys: ['V'],
        label: 'Select tool',
        hint: 'Leaves comment mode',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          const setCommentMode = shortcutMethod(editor, api, 'setCommentMode')
          if (!setCommentMode) return false
          setCommentMode(false)
          return true
        },
      },
      {
        id: 'tool-rect',
        group: 'Tools',
        keys: ['R'],
        label: 'Rectangle',
        run: function (editor, event, api) {
          return shortcutCreateLayer(editor, api, 'rect')
        },
      },
      {
        id: 'tool-ellipse',
        group: 'Tools',
        keys: ['O'],
        label: 'Ellipse',
        run: function (editor, event, api) {
          return shortcutCreateLayer(editor, api, 'ellipse')
        },
      },
      {
        id: 'tool-text',
        group: 'Tools',
        keys: ['T'],
        label: 'Text',
        run: function (editor, event, api) {
          return shortcutCreateLayer(editor, api, 'text')
        },
      },
      {
        id: 'tool-frame',
        group: 'Tools',
        keys: ['F'],
        label: 'Frame',
        run: function (editor, event, api) {
          return shortcutCreateLayer(editor, api, 'frame')
        },
      },
      {
        id: 'tool-line',
        group: 'Tools',
        keys: ['L'],
        label: 'Line',
        run: function (editor, event, api) {
          return shortcutCreateLayer(editor, api, 'line')
        },
      },
      {
        id: 'tool-button',
        group: 'Tools',
        keys: ['B'],
        label: 'Button preset',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          const addButtonPreset = shortcutMethod(editor, api, 'addButtonPreset')
          if (!addButtonPreset) return false
          addButtonPreset()
          return true
        },
      },
      {
        id: 'tool-image',
        group: 'Tools',
        keys: ['I'],
        label: 'Image…',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          const openImagePicker = shortcutMethod(editor, api, 'openImagePicker')
          if (!openImagePicker) return false
          openImagePicker('toolbar')
          return true
        },
      },

      /* ------------------------------- Selection ------------------------------- */
      {
        id: 'select-all',
        group: 'Selection',
        keys: ['Ctrl/Cmd+A'],
        label: 'Select all layers',
        owner: 'Editor',
      },
      {
        id: 'select-next-sibling',
        group: 'Selection',
        keys: ['Tab'],
        label: 'Select next layer',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          if (shortcutIsControlTarget(event && event.target)) return false
          return shortcutCycleSibling(editor, api, 1)
        },
      },
      {
        id: 'select-prev-sibling',
        group: 'Selection',
        keys: ['Shift+Tab'],
        label: 'Select previous layer',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          if (shortcutIsControlTarget(event && event.target)) return false
          return shortcutCycleSibling(editor, api, -1)
        },
      },
      {
        id: 'select-parent',
        group: 'Selection',
        keys: ['Ctrl/Cmd+Enter'],
        label: 'Select parent',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutSelectParent(editor, api)
        },
      },
      {
        id: 'drill-in',
        group: 'Selection',
        keys: ['Enter'],
        label: 'Enter group or frame',
        owner: 'Editor',
      },
      {
        id: 'step-out',
        group: 'Selection',
        keys: ['Esc'],
        label: 'Deselect / leave group',
        run: function () {
          // The sheet owns Esc while it is open; every other Esc stays with the editor.
          if (SHORTCUTS_UI.open === true) {
            closeShortcutsSheet()
            return true
          }
          return false
        },
      },
      {
        id: 'lock-selection',
        group: 'Selection',
        keys: ['Ctrl/Cmd+Shift+L'],
        label: 'Lock / unlock selection',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          const selection = shortcutSelection(api, editor)
          if (!selection.layerIds.length) return false
          const toggleLock = shortcutMethod(editor, api, 'toggleLock')
          if (!toggleLock) return false
          toggleLock()
          return true
        },
      },
      {
        id: 'hide-selection',
        group: 'Selection',
        keys: ['Alt+Shift+H'],
        label: 'Hide / show layer',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          const selection = shortcutSelection(api, editor)
          if (!selection.primaryLayerId) return false
          const toggleVisible = shortcutMethod(editor, api, 'toggleVisible')
          if (!toggleVisible) return false
          toggleVisible(selection.primaryLayerId)
          return true
        },
      },
      {
        id: 'nudge-small',
        group: 'Selection',
        keys: ['↑↓←→'],
        label: 'Nudge 1 px',
        owner: 'Editor',
      },
      {
        id: 'nudge-large',
        group: 'Selection',
        keys: ['Shift+↑↓←→'],
        label: 'Nudge 10 px',
        owner: 'Editor',
      },
      /* ------------------------------- Edit ------------------------------- */
      {
        id: 'undo',
        group: 'Edit',
        keys: ['Ctrl/Cmd+Z'],
        label: 'Undo',
        owner: 'Editor',
      },
      {
        id: 'redo',
        group: 'Edit',
        keys: ['Ctrl/Cmd+Shift+Z'],
        label: 'Redo',
        owner: 'Editor',
      },
      {
        id: 'redo-alt',
        group: 'Edit',
        keys: ['Ctrl/Cmd+Y'],
        label: 'Redo (alternative)',
        owner: 'Editor',
      },
      {
        id: 'duplicate',
        group: 'Edit',
        keys: ['Ctrl/Cmd+D'],
        label: 'Duplicate selection',
        owner: 'Editor',
      },
      {
        id: 'copy',
        group: 'Edit',
        keys: ['Ctrl/Cmd+C'],
        label: 'Copy',
        owner: 'Editor',
      },
      {
        id: 'cut',
        group: 'Edit',
        keys: ['Ctrl/Cmd+X'],
        label: 'Cut',
        owner: 'Editor',
      },
      {
        id: 'paste',
        group: 'Edit',
        keys: ['Ctrl/Cmd+V'],
        label: 'Paste',
        owner: 'Editor',
      },
      {
        id: 'delete-selection',
        group: 'Edit',
        keys: ['Delete', 'Backspace'],
        label: 'Delete selection or artboard',
        hint: 'Layers are deleted by the editor; an artboard-only selection is deleted here',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          const selection = shortcutSelection(api, editor)
          if (selection.layerIds.length) return false
          if (!selection.artboardId) return false
          return shortcutDeleteArtboard(editor, api)
        },
      },
      {
        id: 'delete-artboard',
        group: 'Edit',
        keys: ['Ctrl/Cmd+Shift+Backspace'],
        label: 'Delete artboard',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutDeleteArtboard(editor, api)
        },
      },

      /* ------------------------------- Arrange ------------------------------- */
      {
        id: 'group',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+G'],
        label: 'Group selection',
        owner: 'Editor',
      },
      {
        id: 'ungroup',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+G'],
        label: 'Ungroup',
        owner: 'Editor',
      },
      {
        id: 'bring-forward',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+]'],
        label: 'Bring forward',
        owner: 'Editor',
      },
      {
        id: 'send-backward',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+['],
        label: 'Send backward',
        owner: 'Editor',
      },
      {
        id: 'bring-front',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+]'],
        label: 'Bring to front',
        owner: 'Editor',
      },
      {
        id: 'send-back',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+['],
        label: 'Send to back',
        owner: 'Editor',
      },
      {
        id: 'align-selection',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+↑↓←→'],
        label: 'Align selection',
        owner: 'Selection bar',
      },
      {
        id: 'distribute-horizontal',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+H'],
        label: 'Distribute horizontally',
        owner: 'Selection bar',
      },
      {
        id: 'distribute-vertical',
        group: 'Arrange',
        keys: ['Ctrl/Cmd+Shift+V'],
        label: 'Distribute vertically',
        owner: 'Selection bar',
      },

      /* ------------------------------- View ------------------------------- */
      {
        id: 'zoom-100',
        group: 'View',
        keys: ['Ctrl/Cmd+0'],
        label: 'Zoom to 100%',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          const camera = shortcutCamera(editor, api)
          if (!camera) return false
          return shortcutZoomBy(editor, api, 1 - camera.zoom, true)
        },
      },
      {
        id: 'zoom-fit',
        group: 'View',
        keys: ['Ctrl/Cmd+1'],
        label: 'Fit artboards',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          const fitCamera = shortcutMethod(editor, api, 'fitCamera')
          if (!fitCamera) return false
          fitCamera()
          return true
        },
      },
      {
        id: 'zoom-fit-selection',
        group: 'View',
        keys: ['Ctrl/Cmd+2'],
        label: 'Fit selection',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutFitSelection(editor, api)
        },
      },
      {
        id: 'zoom-in',
        group: 'View',
        keys: ['=', '+'],
        label: 'Zoom in',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutZoomBy(editor, api, ZOOM_STEP, true)
        },
      },
      {
        id: 'zoom-out',
        group: 'View',
        keys: ['-'],
        label: 'Zoom out',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutZoomBy(editor, api, -ZOOM_STEP, true)
        },
      },
      {
        id: 'fit-all-shell',
        group: 'View',
        keys: ['Shift+1'],
        label: 'Fit artboards',
        owner: 'Shell',
      },
      {
        id: 'fit-selection-shell',
        group: 'View',
        keys: ['Shift+2'],
        label: 'Fit selection',
        owner: 'Shell',
      },
      {
        id: 'pan-canvas',
        group: 'View',
        keys: ['Space+drag'],
        label: 'Pan the canvas',
        owner: 'Editor',
      },
      {
        id: 'zoom-wheel',
        group: 'View',
        keys: ['Ctrl/Cmd+wheel'],
        label: 'Zoom with the wheel',
        owner: 'Editor',
      },

      /* ------------------------------- Panels ------------------------------- */
      {
        id: 'toggle-layers-panel',
        group: 'Panels',
        keys: ['Alt+1'],
        label: 'Layers panel',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutTogglePanel(editor, api, 'treeOpen', 'setTreeOpen')
        },
      },
      {
        id: 'toggle-inspector-panel',
        group: 'Panels',
        keys: ['Alt+2'],
        label: 'Inspector panel',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          return shortcutTogglePanel(editor, api, 'inspectorOpen', 'setInspectorOpen')
        },
      },
      {
        id: 'toggle-export-dialog',
        group: 'Panels',
        keys: ['Alt+3'],
        label: 'Export dialog',
        run: function (editor, event, api) {
          if (!shortcutFocusInside()) return false
          if (typeof openExportDialog !== 'function') return false
          const isOpen = typeof EXPORT_UI === 'object' && EXPORT_UI !== null && EXPORT_UI.open === true
          if (isOpen && typeof closeExportDialog === 'function') closeExportDialog()
          else openExportDialog()
          return true
        },
      },
      {
        id: 'toggle-comments-panel',
        group: 'Panels',
        keys: ['Alt+C'],
        label: 'Comments panel',
        owner: 'Comments panel',
      },
      {
        id: 'shortcuts-sheet',
        group: 'Panels',
        keys: ['Shift+/'],
        label: 'Keyboard shortcuts',
        hint: 'Opens this sheet',
        run: function () {
          if (!shortcutFocusInside()) return false
          openShortcutsSheet()
          return true
        },
      },

      /* ------------------------------- Comments ------------------------------- */
      {
        id: 'comment-mode',
        group: 'Comments',
        keys: ['C'],
        label: 'Comment mode',
        hint: 'On: click a layer to comment. With a layer selected it also opens its composer',
        run: function (editor, event, api) {
          if (!shortcutToolGate()) return false
          const setCommentMode = shortcutMethod(editor, api, 'setCommentMode')
          if (!setCommentMode) return false
          const current =
            typeof editor.commentMode === 'boolean' ? editor.commentMode : shortcutValue(api, 'commentMode')
          const next = current !== true
          setCommentMode(next)
          if (next) {
            const selection = shortcutSelection(api, editor)
            const openComposerFor = shortcutMethod(editor, api, 'openComposerFor')
            if (selection.primaryLayerId && openComposerFor) {
              openComposerFor(selection.primaryLayerId, selection.artboardId || null)
            }
          }
          return true
        },
      },
      {
        id: 'send-comment',
        group: 'Comments',
        keys: ['Ctrl/Cmd+Enter'],
        label: 'Send the comment (while typing)',
        owner: 'Composer',
      },
      {
        id: 'cancel-comment',
        group: 'Comments',
        keys: ['Esc'],
        label: 'Cancel the comment (while typing)',
        owner: 'Composer',
      },

      /* ------------------------------- Export ------------------------------- */
      {
        id: 'export-dialog',
        group: 'Export',
        keys: ['Ctrl/Cmd+Shift+E'],
        label: 'Export dialog',
        owner: 'Export',
      },
    ]

    /* ------------------------------------------------------------------------------------------
     * Compiled specs: one matcher table built from the registry, platform aware.
     * ---------------------------------------------------------------------------------------- */

    const SHORTCUT_SPECS = []

    function shortcutCompileSpecs() {
      for (let index = 0; index < SHORTCUTS.length; index += 1) {
        const entry = SHORTCUTS[index]
        if (!entry || typeof entry.run !== 'function') continue
        const keys = SHORTCUTS_IS_MAC && Array.isArray(entry.mac) && entry.mac.length ? entry.mac : entry.keys
        const list = Array.isArray(keys) ? keys : [keys]
        for (let scan = 0; scan < list.length; scan += 1) {
          const spec = shortcutChordSpec(list[scan])
          if (!spec) continue
          SHORTCUT_SPECS.push({ entry: entry, spec: spec })
        }
      }
    }

    shortcutCompileSpecs()

    function shortcutFindEntry(event) {
      if (!event) return null
      const key = typeof event.key === 'string' ? event.key : ''
      if (!key && typeof event.code !== 'string') return null
      for (let index = 0; index < SHORTCUT_SPECS.length; index += 1) {
        const item = SHORTCUT_SPECS[index]
        if (shortcutSpecMatches(item.spec, event)) return item.entry
      }
      return null
    }

    /* ------------------------------------------------------------------------------------------
     * Host resolution: the full editor hook (captured from an app-panel render) with the
     * extension context as a fallback, so this part works before its own overlay mounts.
     * ---------------------------------------------------------------------------------------- */

    function shortcutHost(api) {
      if (SHORTCUTS_RUNTIME.editor) return SHORTCUTS_RUNTIME.editor
      if (api && api.editor) return api.editor
      return api || null
    }

    /**
     * Method lookup. The captured hook comes first on purpose: the editor's own keydown effect
     * closes over the extension context of its FIRST render, so `api` values (camera, selection)
     * are stale snapshots. The hook captured from a panel render is refreshed every render.
     */
    function shortcutMethod(editor, api, name) {
      const sources = [SHORTCUTS_RUNTIME.editor, editor, api, api && api.editor]
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index]
        if (source && typeof source[name] === 'function') return source[name]
      }
      return null
    }

    function shortcutValue(api, name) {
      // Same reasoning as shortcutMethod: never trust the keydown closure's snapshot first.
      const sources = [SHORTCUTS_RUNTIME.editor, api && api.editor, api]
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index]
        if (source && source[name] !== undefined && source[name] !== null) return source[name]
      }
      return undefined
    }

    /** The live camera: cameraRef is updated synchronously, the state value is one commit behind. */
    function shortcutCamera(editor, api) {
      const ref = editor && editor.cameraRef
      if (ref && ref.current && typeof ref.current.zoom === 'number') return ref.current
      const camera = shortcutValue(api, 'camera')
      return camera && typeof camera.zoom === 'number' ? camera : null
    }

    function shortcutAppRoot() {
      try {
        return typeof document !== 'undefined' ? document.querySelector('.dc-app') : null
      } catch (error) {
        return null
      }
    }

    /** Focus or pointer inside the canvas panel; the panel must be the active surface. */
    function shortcutFocusInside() {
      const root = shortcutAppRoot()
      if (!root) return false
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (active && active !== document.body && active !== document.documentElement) {
        try {
          if (typeof root.contains === 'function' && root.contains(active)) return true
        } catch (error) {
          /* fall through to the pointer check */
        }
      }
      if (SHORTCUTS_RUNTIME.pointerInside === true) return true
      try {
        if (typeof root.matches === 'function' && root.matches(':hover')) return true
      } catch (error) {
        /* :hover matching is unavailable in a few engines */
      }
      return false
    }

    /** An open dialog (export, shortcuts sheet, …) blocks creation keys but not view/panel keys. */
    function shortcutModalOpen() {
      const root = shortcutAppRoot()
      if (!root) return false
      try {
        return !!root.querySelector('[role="dialog"]')
      } catch (error) {
        return false
      }
    }

    function shortcutToolGate() {
      return shortcutFocusInside() && !shortcutModalOpen()
    }

    function shortcutIsTypingTarget(target) {
      if (!target) return false
      const tag = String(target.tagName || '').toUpperCase()
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
    }

    function shortcutIsControlTarget(target) {
      if (!target) return false
      const tag = String(target.tagName || '').toUpperCase()
      return tag === 'BUTTON' || tag === 'A' || tag === 'SELECT'
    }

    function shortcutSelection(api, editor) {
      // `editor` is the captured (fresh) hook when available; `api` may be a first-render snapshot.
      const primary = editor || api || {}
      const fallback = api || {}
      const primarySelection = primary.selection || fallback.selection || {}
      const fallbackSelection = fallback.selection || {}
      const layerIds = Array.isArray(primary.selectedLayerIds)
        ? primary.selectedLayerIds.slice()
        : Array.isArray(primarySelection.layerIds)
          ? primarySelection.layerIds.slice()
          : Array.isArray(fallback.selectedLayerIds)
            ? fallback.selectedLayerIds.slice()
            : Array.isArray(fallbackSelection.layerIds)
              ? fallbackSelection.layerIds.slice()
              : []
      const primaryLayerId =
        primary.selectedLayerId || primarySelection.primaryLayerId || fallback.selectedLayerId || null
      const artboardId =
        primary.selectedArtboardId || primarySelection.artboardId || fallback.selectedArtboardId || null
      return { layerIds: layerIds, primaryLayerId: primaryLayerId, artboardId: artboardId }
    }

    function shortcutTree(api, editor) {
      return shortcutValue(api, 'tree') || (editor && editor.tree) || null
    }

    function shortcutCreateLayer(editor, api, type) {
      if (!shortcutToolGate()) return false
      const addLayer = shortcutMethod(editor, api, 'addLayer')
      if (!addLayer) return false
      addLayer(type)
      return true
    }

    function shortcutZoomBy(editor, api, delta, claimAlways) {
      const zoomCameraBy = shortcutMethod(editor, api, 'zoomCameraBy')
      if (!zoomCameraBy) return false
      if (!delta && claimAlways !== true) return false
      zoomCameraBy(delta)
      return true
    }

    function shortcutTogglePanel(editor, api, flag, setterName) {
      const setOpen = shortcutMethod(editor, api, setterName)
      if (!setOpen) return false
      let current = typeof editor[flag] === 'boolean' ? editor[flag] : shortcutValue(api, flag)
      if (typeof current !== 'boolean') {
        // DOM fallback: the shell renders .dc-left / .dc-right while the panel is visible.
        try {
          current = !!document.querySelector(flag === 'treeOpen' ? '.dc-app .dc-left' : '.dc-app .dc-right')
        } catch (error) {
          return false
        }
      }
      setOpen(!current)
      return true
    }

    function shortcutSiblings(editor, api, node, tree) {
      const siblingNodesOf = shortcutMethod(editor, api, 'siblingNodesOf')
      if (siblingNodesOf) {
        const list = siblingNodesOf(node)
        if (Array.isArray(list) && list.length) return list
      }
      if (node && node.parent && Array.isArray(node.parent.children)) return node.parent.children
      if (node && node.artboard && tree && Array.isArray(tree.artboards)) {
        for (let index = 0; index < tree.artboards.length; index += 1) {
          const entry = tree.artboards[index]
          if (entry && entry.artboard && entry.artboard.id === node.artboard.id) {
            return Array.isArray(entry.layers) ? entry.layers : []
          }
        }
      }
      return []
    }

    function shortcutCycleSibling(editor, api, direction) {
      const selection = shortcutSelection(api, editor)
      if (!selection.primaryLayerId) return false
      const tree = shortcutTree(api, editor)
      if (!tree || !tree.byId || typeof tree.byId.get !== 'function') return false
      const node = tree.byId.get(selection.primaryLayerId)
      if (!node) return false
      const siblings = shortcutSiblings(editor, api, node, tree)
      if (siblings.length < 2) return false
      let index = -1
      for (let scan = 0; scan < siblings.length; scan += 1) {
        if (siblings[scan] && siblings[scan].id === node.id) index = scan
      }
      if (index < 0) return false
      const next = siblings[(index + direction + siblings.length) % siblings.length]
      if (!next || !next.id) return false
      const selectLayer = shortcutMethod(editor, api, 'selectLayer')
      if (!selectLayer) return false
      selectLayer(next.id, (next.artboard && next.artboard.id) || selection.artboardId || null)
      return true
    }

    function shortcutSelectParent(editor, api) {
      const selection = shortcutSelection(api, editor)
      const tree = shortcutTree(api, editor)
      const selectLayer = shortcutMethod(editor, api, 'selectLayer')
      const node =
        selection.primaryLayerId && tree && tree.byId && typeof tree.byId.get === 'function'
          ? tree.byId.get(selection.primaryLayerId) || null
          : null
      if (node && node.parent && selectLayer) {
        selectLayer(node.parent.id, (node.artboard && node.artboard.id) || selection.artboardId || null)
        return true
      }
      // A top-level layer's parent is the artboard itself.
      const selectArtboard = shortcutMethod(editor, api, 'selectArtboard')
      if (node && node.artboard && node.artboard.id && selectArtboard) {
        selectArtboard(node.artboard.id)
        return true
      }
      const drillId =
        editor && typeof editor.drillGroupId === 'string'
          ? editor.drillGroupId
          : shortcutValue(api, 'drillGroupId')
      if (drillId && selectLayer) {
        selectLayer(drillId, selection.artboardId || null)
        return true
      }
      const stepSelectionOut = shortcutMethod(editor, api, 'stepSelectionOut')
      if (stepSelectionOut) return stepSelectionOut() === true
      return false
    }

    function shortcutFitSelection(editor, api) {
      const fitSelection = shortcutMethod(editor, api, 'fitSelection')
      if (fitSelection) {
        fitSelection()
        return true
      }
      const fitCamera = shortcutMethod(editor, api, 'fitCamera')
      const node = shortcutValue(api, 'selectedNode')
      const layout = shortcutValue(api, 'layout')
      const canvasViewport = shortcutMethod(editor, api, 'canvasViewport')
      const setCamera = shortcutMethod(editor, api, 'setCameraValue')
      if (!node || !layout || !layout.entryById || !canvasViewport || !setCamera) {
        if (fitCamera) {
          fitCamera()
          return true
        }
        return false
      }
      const entry = layout.entryById.get(node.artboard && node.artboard.id)
      if (!entry || !node.worldRect) {
        if (fitCamera) {
          fitCamera()
          return true
        }
        return false
      }
      const viewport = canvasViewport()
      if (!viewport || viewport.width < 40 || viewport.height < 40) return false
      const width = Math.max(1, finiteNumber(node.worldRect.width, 1))
      const height = Math.max(1, finiteNumber(node.worldRect.height, 1))
      const padding = Math.min(FIT_PADDING, Math.min(viewport.width, viewport.height) * 0.25)
      const zoom = clamp(
        Math.min((viewport.width - padding) / width, (viewport.height - padding) / height),
        MIN_ZOOM,
        Math.min(MAX_ZOOM, 2),
      )
      const centerX = entry.frameX + node.worldRect.x + width / 2
      const centerY = entry.frameY + node.worldRect.y + height / 2
      setCamera({
        x: Math.round(viewport.width / 2 - centerX * zoom),
        y: Math.round(viewport.height / 2 - centerY * zoom),
        zoom: zoom,
      })
      return true
    }

    function shortcutArtboardForSelection(editor, api, selection) {
      if (selection.artboardId) return selection.artboardId
      const tree = shortcutTree(api, editor)
      if (!tree || !tree.byId || !selection.primaryLayerId) return null
      const node = tree.byId.get(selection.primaryLayerId)
      return node && node.artboard ? node.artboard.id : null
    }

    function shortcutDeleteArtboard(editor, api) {
      const selection = shortcutSelection(api, editor)
      const artboardId = shortcutArtboardForSelection(editor, api, selection)
      if (!artboardId) return false
      const deleteArtboard = shortcutMethod(editor, api, 'deleteArtboard')
      if (deleteArtboard) {
        deleteArtboard(artboardId)
        return true
      }
      const runOps = shortcutMethod(editor, api, 'runOps')
      if (!runOps) return false
      runOps([{ type: 'artboard.delete', artboardId: artboardId }])
      const clearSelection = shortcutMethod(editor, api, 'clearSelection')
      if (clearSelection) clearSelection()
      return true
    }

    /* ------------------------------------------------------------------------------------------
     * The one key handler: match -> run -> preventDefault/stopPropagation when it acted.
     * ---------------------------------------------------------------------------------------- */

    function shortcutRunEntry(event, api) {
      const entry = shortcutFindEntry(event)
      if (!entry || typeof entry.run !== 'function') return false
      // Typing anywhere (inspector, tree rename, composer, chat) never fires a tool key.
      if (shortcutIsTypingTarget(event.target)) return false
      const editor = shortcutHost(api)
      if (!editor) return false
      if (typeof entry.enabled === 'function') {
        try {
          if (entry.enabled(editor, api) !== true) return false
        } catch (error) {
          return false
        }
      }
      let handled = false
      try {
        handled = entry.run(editor, event, api) === true
      } catch (error) {
        beacon('shortcut-failed', { id: String(entry.id), message: shortError(error) })
        return false
      }
      if (!handled) return false
      try {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
      } catch (error) {
        /* a synthetic event may not expose these */
      }
      beacon('shortcut', { id: String(entry.id) })
      return true
    }

    registerKeyHandler({
      id: 'shortcuts-keymap',
      match: function (event) {
        return !!shortcutFindEntry(event)
      },
      run: function (event, api) {
        return shortcutRunEntry(event, api)
      },
    })

    /* ------------------------------------------------------------------------------------------
     * The sheet: a real cheatsheet (grouped, filterable, two columns when there is room).
     * CSS lives here, not in 42-css.js.
     * ---------------------------------------------------------------------------------------- */

    const SHORTCUTS_CSS = `
.dc-ks-backdrop { position: absolute; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(15, 17, 21, 0.42); }
.dc-ks-panel { display: flex; flex-direction: column; width: 100%; max-width: 640px; max-height: 100%; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #111827); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 12px; box-shadow: 0 20px 56px rgba(15, 23, 42, 0.32); }
.dc-ks-head { display: flex; align-items: flex-start; gap: 8px; flex: 0 0 auto; padding: 12px 12px 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb); }
.dc-ks-head-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; margin-top: 1px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-head-main { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; }
.dc-ks-title { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
.dc-ks-sub { font-size: 11px; line-height: 1.35; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-search { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 30px; margin: 10px 14px 0; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-search:focus-within { border-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-ks-search-icon { display: inline-flex; align-items: center; flex: 0 0 auto; }
.dc-ks-search-input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary, #111827); font: inherit; font-size: 12px; outline: none; }
.dc-ks-search-input::placeholder { color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-clear { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
.dc-ks-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 14px 14px; }
.dc-ks-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; align-items: start; }
.dc-ks-group { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dc-ks-group-title { margin: 0 0 4px; font-size: 10px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; padding: 3px 6px; border-radius: 5px; }
.dc-ks-label { flex: 1 1 auto; min-width: 88px; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-primary, #111827); }
.dc-ks-note { margin-left: 5px; font-size: 9.5px; letter-spacing: 0.02em; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.75; white-space: nowrap; }
.dc-ks-keylist { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 3px; flex: 0 1 auto; min-width: 0; }
.dc-ks-keys { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.dc-ks-or { flex: 0 0 auto; padding: 0 1px; font-size: 10px; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.65; }
.dc-ks-key { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 19px; padding: 0 5px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-bottom-width: 2px; border-radius: 5px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); color: var(--dsw-alias-label-secondary, #6b7280); font-family: inherit; font-size: 10.5px; line-height: 1; white-space: nowrap; }
.dc-ks-empty { padding: 26px 10px 30px; text-align: center; }
.dc-ks-empty-title { font-size: 12px; font-weight: 550; color: var(--dsw-alias-label-primary, #111827); }
.dc-ks-empty-sub { margin-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-foot { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-1, #f7f7f8); font-size: 10.5px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-ks-foot-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-ks-foot-key { flex: 0 0 auto; margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
.dc-ks-foot-key .dc-ks-key { height: 17px; }
@container dcpane (max-width: 560px) { .dc-ks-columns { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
@media (hover: hover) and (pointer: fine) { .dc-ks-row:hover { background: var(--dsw-alias-bg-layer-1, #f7f7f8); } .dc-ks-clear:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); } }
`

    function shortcutChordsOf(entry) {
      const chords = SHORTCUTS_IS_MAC && Array.isArray(entry.mac) && entry.mac.length ? entry.mac : entry.keys
      return Array.isArray(chords) ? chords : [chords]
    }

    function shortcutKeycaps(chord) {
      const parts = String(chord === undefined || chord === null ? '' : chord)
        .split('+')
        .filter(function (token) {
          return token.length > 0
        })
      return parts.map(function (token, index) {
        return h(
          'kbd',
          { className: 'dc-ks-key', key: String(token) + '-' + String(index) },
          SHORTCUT_TOKEN_LABELS[token] || token,
        )
      })
    }

    function shortcutKeyGroups(entry) {
      const chords = shortcutChordsOf(entry)
      const nodes = []
      for (let index = 0; index < chords.length; index += 1) {
        if (index > 0) nodes.push(h('span', { className: 'dc-ks-or', key: 'or-' + String(index) }, '/'))
        nodes.push(h('span', { className: 'dc-ks-keys', key: 'chord-' + String(index) }, shortcutKeycaps(chords[index])))
      }
      return h('span', { className: 'dc-ks-keylist' }, nodes)
    }

    /** Everything a search word may match: label, group, owner, hint and the printed keys. */
    function shortcutSearchIndex(entry) {
      if (entry.search === undefined) {
        const pieces = [entry.label, entry.group, entry.owner, entry.hint]
        const chords = shortcutChordsOf(entry)
        for (let index = 0; index < chords.length; index += 1) {
          const chord = String(chords[index] || '')
          pieces.push(chord)
          const tokens = chord.split('+')
          const labels = []
          for (let scan = 0; scan < tokens.length; scan += 1) {
            labels.push(SHORTCUT_TOKEN_LABELS[tokens[scan]] || tokens[scan])
          }
          pieces.push(labels.join(' '))
          pieces.push(labels.join(''))
        }
        entry.search = pieces
          .filter(function (piece) {
            return typeof piece === 'string' && piece
          })
          .join(' ')
          .toLowerCase()
      }
      return entry.search
    }

    function shortcutMatchesQuery(entry, words) {
      if (!words.length) return true
      const haystack = shortcutSearchIndex(entry)
      for (let index = 0; index < words.length; index += 1) {
        if (haystack.indexOf(words[index]) < 0) return false
      }
      return true
    }

    function ShortcutsSheet(props) {
      const ctx = props.ctx || {}
      const strings = ctx.strings || {}
      const forceState = React.useState(0)
      const force = forceState[1]
      const queryState = React.useState('')
      const query = queryState[0]
      const setQuery = queryState[1]
      const inputRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(function () {
        return SHORTCUTS_UI.subscribe(function () {
          force(function (value) {
            return value + 1
          })
        })
      }, [])

      // Capture the full hook (not just the curated actions) and keep it fresh: run() has no
      // other way to reach `setCommentMode`, `treeOpen`, `zoomCameraBy`, `siblingNodesOf`, …
      React.useEffect(function () {
        const next = (ctx && ctx.editor) || null
        SHORTCUTS_RUNTIME.editor = next
        return function () {
          if (SHORTCUTS_RUNTIME.editor === next) SHORTCUTS_RUNTIME.editor = null
        }
      })

      // One pointer listener keeps single-key tools scoped to the canvas panel.
      React.useEffect(function () {
        function onPointer(event) {
          const root = shortcutAppRoot()
          if (!root) return
          try {
            SHORTCUTS_RUNTIME.pointerInside = !!(event.target && root.contains(event.target))
          } catch (error) {
            SHORTCUTS_RUNTIME.pointerInside = false
          }
        }
        window.addEventListener('pointermove', onPointer, true)
        window.addEventListener('pointerdown', onPointer, true)
        return function () {
          window.removeEventListener('pointermove', onPointer, true)
          window.removeEventListener('pointerdown', onPointer, true)
        }
      }, [])

      const open = SHORTCUTS_UI.open === true

      // Fresh sheet on every open, focused on the filter so typing narrows immediately.
      React.useEffect(
        function () {
          if (!open) return
          setQuery('')
          const node = inputRef.current
          if (node && typeof node.focus === 'function') {
            node.focus()
            if (typeof node.select === 'function') node.select()
          }
        },
        [open],
      )

      // Esc closes the sheet before any canvas binding sees it (capture phase, even from the
      // filter input, which the editor's own handler would skip).
      React.useEffect(
        function () {
          if (!open) return undefined
          function onKey(event) {
            if (!event || event.key !== 'Escape') return
            if (typeof event.preventDefault === 'function') event.preventDefault()
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            closeShortcutsSheet()
          }
          document.addEventListener('keydown', onKey, true)
          return function () {
            document.removeEventListener('keydown', onKey, true)
          }
        },
        [open],
      )

      if (!open) return null

      const words = query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(function (word) {
          return word.length > 0
        })
      const sections = []
      let visible = 0
      for (let index = 0; index < SHORTCUTS_GROUPS.length; index += 1) {
        const title = SHORTCUTS_GROUPS[index]
        const rows = []
        for (let scan = 0; scan < SHORTCUTS.length; scan += 1) {
          const entry = SHORTCUTS[scan]
          if (!entry || entry.group !== title) continue
          if (!shortcutMatchesQuery(entry, words)) continue
          rows.push(entry)
        }
        if (!rows.length) continue
        visible += rows.length
        sections.push({ title: title, rows: rows })
      }

      function onBackdropPointerDown(event) {
        if (event && event.target === event.currentTarget) closeShortcutsSheet()
      }

      function onPanelKeyDown(event) {
        if (!event || event.key !== 'Tab') return
        const panel = panelRef.current
        if (!panel || typeof panel.querySelectorAll !== 'function') return
        const nodes = panel.querySelectorAll('input, button')
        if (!nodes.length) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        const inside = !!active && typeof panel.contains === 'function' && panel.contains(active)
        if (event.shiftKey) {
          if (!inside || active === first) {
            if (typeof event.preventDefault === 'function') event.preventDefault()
            if (last && typeof last.focus === 'function') last.focus()
          }
          return
        }
        if (!inside || active === last) {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (first && typeof first.focus === 'function') first.focus()
        }
      }

      return h(
        'div',
        { className: 'dc-ks-backdrop', onPointerDown: onBackdropPointerDown },
        h('style', { dangerouslySetInnerHTML: { __html: SHORTCUTS_CSS } }),
        h(
          'div',
          {
            className: 'dc-ks-panel',
            ref: panelRef,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Keyboard shortcuts',
            onKeyDown: onPanelKeyDown,
          },
          h(
            'div',
            { className: 'dc-ks-head' },
            h(
              'span',
              { className: 'dc-ks-head-icon', 'aria-hidden': 'true' },
              h(Glyph, { name: 'keyboard', size: 15 }),
            ),
            h(
              'div',
              { className: 'dc-ks-head-main' },
              h('span', { className: 'dc-ks-title' }, 'Keyboard shortcuts'),
              h(
                'span',
                { className: 'dc-ks-sub' },
                'Press ? anywhere in the canvas to open this sheet.',
              ),
            ),
            h(IconButton, {
              icon: 'close',
              title: strings.dismiss || 'Close',
              onClick: closeShortcutsSheet,
            }),
          ),
          h(
            'div',
            { className: 'dc-ks-search' },
            h('span', { className: 'dc-ks-search-icon', 'aria-hidden': 'true' }, h(Glyph, { name: 'search', size: 13 })),
            h('input', {
              ref: inputRef,
              type: 'text',
              className: 'dc-ks-search-input',
              value: query,
              placeholder: 'Filter by name or key…',
              'aria-label': 'Filter shortcuts',
              autoComplete: 'off',
              spellCheck: false,
              onChange: function (event) {
                setQuery(event && event.target ? String(event.target.value || '') : '')
              },
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dc-ks-clear',
                    title: 'Clear the filter',
                    'aria-label': 'Clear the filter',
                    onClick: function () {
                      setQuery('')
                      const node = inputRef.current
                      if (node && typeof node.focus === 'function') node.focus()
                    },
                  },
                  h(Glyph, { name: 'close', size: 10 }),
                )
              : null,
          ),
          h(
            'div',
            { className: 'dc-ks-scroll' },
            visible
              ? h(
                  'div',
                  { className: 'dc-ks-columns' },
                  sections.map(function (section) {
                    return h(
                      'section',
                      { className: 'dc-ks-group', key: 'group-' + section.title },
                      h('h3', { className: 'dc-ks-group-title' }, section.title),
                      section.rows.map(function (entry) {
                        return h(
                          'div',
                          { className: 'dc-ks-row', key: 'row-' + entry.id, title: entry.hint || undefined },
                          h(
                            'span',
                            { className: 'dc-ks-label' },
                            entry.label,
                            entry.owner ? h('span', { className: 'dc-ks-note' }, entry.owner) : null,
                          ),
                          shortcutKeyGroups(entry),
                        )
                      }),
                    )
                  }),
                )
              : h(
                  'div',
                  { className: 'dc-ks-empty' },
                  h(
                    'div',
                    { className: 'dc-ks-empty-title' },
                    'No shortcut matches “' + query.trim() + '”',
                  ),
                  h(
                    'div',
                    { className: 'dc-ks-empty-sub' },
                    'Try a tool (rectangle), an action (undo) or a key (ctrl).',
                  ),
                ),
          ),
          h(
            'div',
            { className: 'dc-ks-foot' },
            h(
              'span',
              { className: 'dc-ks-foot-text' },
              visible + ' of ' + SHORTCUTS.length + ' shortcuts · work while the canvas panel has focus',
            ),
            h(
              'span',
              { className: 'dc-ks-foot-key' },
              h('kbd', { className: 'dc-ks-key' }, 'Esc'),
              h('span', null, 'close'),
            ),
          ),
        ),
      )
    }

    registerAppPanel({
      id: 'shortcuts-sheet-panel',
      render: function (ctx) {
        return h(ShortcutsSheet, { key: 'shortcuts-sheet', ctx: ctx })
      },
    })

    /* ------------------------------------------------------------------------------------------
     * Discoverability: a toolbar button, a command (header "More commands" menu / command
     * palette) and the `?` binding all open the same sheet.
     * ---------------------------------------------------------------------------------------- */

    function ShortcutsToolbarButton(props) {
      return h(ToolButton, {
        icon: 'keyboard',
        title: 'Shortcuts',
        hint: '?',
        iconOnly: true,
        className: 'dc-ks-tool',
        onClick: function () {
          openShortcutsSheet()
        },
      })
    }

    registerToolbar({
      id: 'shortcuts-toolbar',
      render: function (ctx) {
        return h(ShortcutsToolbarButton, { key: 'shortcuts-toolbar', ctx: ctx })
      },
    })

    registerCommand({
      id: 'shortcuts-sheet',
      label: 'Keyboard shortcuts…',
      run: function () {
        return openShortcutsSheet()
      },
    })
