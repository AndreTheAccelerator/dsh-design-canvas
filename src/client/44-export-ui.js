    /* ------------------------------------------------------------------------------------------
     * Export UI
     *
     * Makes the export feature visible and self-explanatory inside the panel:
     *   - a labelled "Export" toolbar button (EXTENSIONS.toolbar)
     *   - the dialog itself as an app-level overlay (EXTENSIONS.appPanels)
     *   - Ctrl/Cmd+Shift+E (EXTENSIONS.keys) and a "Copy as HTML" command
     *
     * The dialog previews the generated code, explains each format, and copies or downloads the
     * result. All rendering lives in 43-export-code.js; this part is UI only (plus its own CSS,
     * so 42-css.js stays one author's file).
     * ---------------------------------------------------------------------------------------- */

    const EXPORT_FORMAT_META = [
      {
        id: 'html',
        label: 'HTML + CSS',
        hint: 'One standalone .html file. Auto-layout frames become real flexbox.',
        detail:
          'Self-contained document with an inline stylesheet: open it in any browser or paste it into an existing page.',
      },
      {
        id: 'react',
        label: 'React',
        hint: 'A JSX component with inline style objects.',
        detail:
          'Copy-paste into a React project: `export default function Artboard()` with no external CSS.',
      },
      {
        id: 'svg',
        label: 'SVG',
        hint: 'True vector output: shapes, text, lines, groups.',
        detail:
          'Resolution independent and pixel-matched to the canvas geometry, including auto layout.',
      },
      {
        id: 'png',
        label: 'PNG',
        hint: 'Raster image of the artboard.',
        detail: 'Rendered from the vector export, so text stays sharp at every scale.',
      },
      {
        id: 'json',
        label: 'JSON',
        hint: 'The document model for this artboard.',
        detail:
          'Exactly what `design_read` returns (schema version, artboard, layers, comments) — useful for tooling and tests.',
      },
    ]

    const EXPORT_CSS = `
.dc-exp-backdrop { position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(15, 17, 21, 0.38); backdrop-filter: blur(1px); }
.dc-exp-dialog { display: flex; flex-direction: column; width: 100%; max-width: 560px; max-height: 100%; min-height: 0; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 12px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28); overflow: hidden; }
.dc-exp-head { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb); }
.dc-exp-head-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dc-exp-title { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
.dc-exp-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-exp-formats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 10px 14px 0; }
.dc-exp-format { display: flex; flex-direction: column; gap: 2px; padding: 7px 6px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fafafa); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; font-weight: 550; cursor: pointer; text-align: center; }
@media (hover: hover) and (pointer: fine) { .dc-exp-format:hover { background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: var(--dsw-alias-label-primary, #111); } }
.dc-exp-format:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, #111); outline-offset: 1px; }
.dc-exp-format.dc-active { border-color: var(--dsw-alias-label-primary, #111); color: var(--dsw-alias-label-primary, #111); background: var(--dsw-alias-bg-base, #fff); box-shadow: inset 0 -2px 0 var(--dsw-alias-label-primary, #111); }
.dc-exp-detail { padding: 6px 14px 0; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-exp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 14px 0; }
.dc-exp-field { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-exp-input { height: 22px; padding: 0 6px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary, #111); background: var(--dsw-alias-bg-base, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 5px; }
.dc-exp-input:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, #111); outline-offset: 1px; }
.dc-exp-name { flex: 1 1 auto; min-width: 140px; }
.dc-exp-meta { display: flex; align-items: center; gap: 6px; padding: 6px 14px 0; font-size: 10px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-exp-code-wrap { position: relative; margin: 8px 14px 0; min-height: 120px; flex: 1 1 auto; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fafafa); overflow: hidden; }
.dc-exp-code { margin: 0; max-height: 260px; overflow: auto; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-primary, #111); white-space: pre; tab-size: 2; }
.dc-exp-preview-img { display: block; max-width: 100%; max-height: 260px; margin: 0 auto; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
.dc-exp-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 70%, transparent); }
.dc-exp-error { margin: 8px 14px 0; padding: 6px 8px; border-radius: 6px; font-size: 11px; color: var(--dsw-alias-state-error-primary, #b91c1c); background: var(--dsw-alias-bg-layer-1, #fafafa); border: 1px solid var(--dsw-alias-state-error-primary, #b91c1c); }
.dc-exp-foot { display: flex; align-items: center; gap: 6px; padding: 10px 14px 12px; }
.dc-exp-foot .dc-spacer { flex: 1 1 auto; }
.dc-exp-hint { font-size: 10px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-exp-ok { color: var(--dsw-alias-state-success-primary, #15803d); }
@media (max-width: 520px) { .dc-exp-formats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: no-preference) { .dc-exp-format { transition: background-color 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out; } }
`

    const EXPORT_PANEL_KEY = 'dsh-design-canvas:export'

    /** Tiny shared store so the toolbar button and the dialog agree on open state. */
    const EXPORT_UI = {
      open: false,
      format: '',
      scope: '',
      artboardId: '',
      scale: 0,
      fileName: '',
      includeComments: false,
      subscribers: [],
      subscribe: function (listener) {
        EXPORT_UI.subscribers.push(listener)
        return function () {
          const index = EXPORT_UI.subscribers.indexOf(listener)
          if (index >= 0) EXPORT_UI.subscribers.splice(index, 1)
        }
      },
      notify: function () {
        const snapshot = EXPORT_UI.subscribers.slice()
        for (let index = 0; index < snapshot.length; index += 1) {
          try {
            snapshot[index]()
          } catch (error) {
            beacon('export-subscriber-failed', { message: shortError(error) })
          }
        }
      },
      set: function (patch) {
        Object.assign(EXPORT_UI, patch)
        if (EXPORT_UI.open) {
          try {
            localStorage.setItem(
              EXPORT_PANEL_KEY,
              JSON.stringify({
                format: EXPORT_UI.format,
                scope: EXPORT_UI.scope,
                scale: EXPORT_UI.scale,
                includeComments: EXPORT_UI.includeComments,
              }),
            )
          } catch (error) {
            /* preferences are best-effort */
          }
        }
        EXPORT_UI.notify()
      },
    }

    function restoreExportPreferences() {
      try {
        const raw = localStorage.getItem(EXPORT_PANEL_KEY)
        if (!raw) return
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object') {
          if (EXPORT_FORMATS.indexOf(saved.format) >= 0) EXPORT_UI.format = saved.format
          if (saved.scope === 'artboard' || saved.scope === 'all' || saved.scope === 'selection') {
            EXPORT_UI.scope = saved.scope
          }
          if (typeof saved.scale === 'number') EXPORT_UI.scale = clamp(Math.round(saved.scale), 1, EXPORT_MAX_SCALE)
          EXPORT_UI.includeComments = saved.includeComments === true
        }
      } catch (error) {
        /* ignore a corrupt preference blob */
      }
    }

    function openExportDialog(patch) {
      if (!EXPORT_UI.format) restoreExportPreferences()
      if (!EXPORT_UI.format) EXPORT_UI.format = 'html'
      if (!EXPORT_UI.scope) EXPORT_UI.scope = 'artboard'
      if (!EXPORT_UI.scale) EXPORT_UI.scale = 2
      EXPORT_UI.set(Object.assign({ open: true }, patch || {}))
      beacon('export-open', { format: EXPORT_UI.format })
    }

    function closeExportDialog() {
      EXPORT_UI.set({ open: false })
    }

    /** React state bound to the shared store. */
    function useExportUi() {
      const [, force] = React.useState(0)
      React.useEffect(function () {
        return EXPORT_UI.subscribe(function () {
          force(function (value) {
            return value + 1
          })
        })
      }, [])
      return EXPORT_UI
    }

    /** The dialog: format picker, scope, file name, preview, copy/download. */
    function ExportDialog(props) {
      const ui = useExportUi()
      const ctx = props.ctx || {}
      const doc = ctx.doc || (ctx.editor && ctx.editor.doc) || null
      const strings = ctx.strings || currentStrings()
      const selection = ctx.selection || { layerIds: [], artboardId: null }
      const selectedArtboardId = ctx.selectedArtboardId || (selection && selection.artboardId) || null
      const [preview, setPreview] = React.useState('')
      const [previewImage, setPreviewImage] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [copied, setCopied] = React.useState('')
      const dialogRef = React.useRef(null)

      const artboards = doc ? artboardsOf(doc) : []
      const activeArtboard = (function () {
        const wanted = ui.artboardId || selectedArtboardId
        if (wanted) {
          const found = artboards.find(function (board) {
            return board && board.id === wanted
          })
          if (found) return found
        }
        return artboards[0] || null
      })()

      const options = React.useMemo(
        function () {
          const scope = ui.scope || 'artboard'
          return {
            artboardId: activeArtboard ? activeArtboard.id : '',
            scope: scope,
            layerIds: scope === 'selection' ? (selection.layerIds || []) : [],
            scale: ui.scale || 2,
            includeComments: ui.includeComments === true,
          }
        },
        [ui.scope, ui.scale, ui.includeComments, activeArtboard, selection.layerIds],
      )

      const fileInfo = exportFileInfo(
        ui.format || 'html',
        ui.scope === 'selection'
          ? { name: 'selection', width: 0, height: 0 }
          : activeArtboard,
        doc,
      )
      const fileName = ui.fileName || fileInfo.fileName

      // Regenerate the preview whenever the inputs change.
      React.useEffect(
        function () {
          if (!ui.open || !doc) return undefined
          let cancelled = false
          setError('')
          setBusy(true)
          const run = function () {
            try {
              if (ui.format === 'png') {
                Promise.resolve(renderPngDataUrl(doc, options)).then(
                  function (dataUrl) {
                    if (cancelled) return
                    setPreviewImage(dataUrl)
                    setPreview('')
                    setBusy(false)
                  },
                  function (failure) {
                    if (cancelled) return
                    setPreviewImage('')
                    setError(messageOf(failure))
                    setBusy(false)
                  },
                )
                return
              }
              const text = renderExport(doc, ui.format || 'html', options)
              if (cancelled) return
              setPreviewImage('')
              setPreview(typeof text === 'string' ? text : '')
              setBusy(false)
            } catch (failure) {
              if (cancelled) return
              setError(messageOf(failure))
              setBusy(false)
            }
          }
          const timer = setTimeout(run, 60)
          return function () {
            cancelled = true
            clearTimeout(timer)
          }
        },
        [ui.open, ui.format, doc, options],
      )

      // Esc closes; keep focus inside the dialog while it is open.
      React.useEffect(
        function () {
          if (!ui.open) return undefined
          function onKey(event) {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeExportDialog()
            }
          }
          document.addEventListener('keydown', onKey, true)
          const timer = setTimeout(function () {
            if (dialogRef.current && typeof dialogRef.current.focus === 'function') {
              dialogRef.current.focus()
            }
          }, 30)
          return function () {
            document.removeEventListener('keydown', onKey, true)
            clearTimeout(timer)
          }
        },
        [ui.open],
      )

      if (!ui.open || !doc) return null

      const formatMeta =
        EXPORT_FORMAT_META.find(function (entry) {
          return entry.id === (ui.format || 'html')
        }) || EXPORT_FORMAT_META[0]
      const previewText = preview || ''
      const sizeLabel = previewImage
        ? Math.round((previewImage.length * 3) / 4 / 1024) + ' KB'
        : previewText
          ? String(Math.round((previewText.length / 1024) * 10) / 10) + ' KB'
          : ''

      function copyNow() {
        if (ui.format === 'png') {
          setError('PNG is binary — use Download.')
          return
        }
        copyTextToClipboard(previewText).then(function (ok) {
          setCopied(ok ? 'Copied' : 'Copy failed')
          setTimeout(function () {
            setCopied('')
          }, 1800)
        })
      }

      function downloadNow() {
        if (ui.format === 'png') {
          if (!previewImage) {
            setError('PNG is still rendering.')
            return
          }
          downloadDataUrl(fileName, previewImage)
          return
        }
        downloadTextFile(fileName, fileInfo.mime, previewText)
      }

      const scopeOptions = [
        { value: 'artboard', label: 'This artboard' },
        { value: 'all', label: 'All artboards' },
      ]
      if (selection.layerIds && selection.layerIds.length) {
        scopeOptions.push({ value: 'selection', label: 'Selection (' + selection.layerIds.length + ')' })
      }

      return h(
        'div',
        {
          className: 'dc-exp-backdrop',
          onPointerDown: function (event) {
            if (event.target === event.currentTarget) closeExportDialog()
          },
        },
        h('style', { dangerouslySetInnerHTML: { __html: EXPORT_CSS } }),
        h(
          'div',
          {
            className: 'dc-exp-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Export design',
            tabIndex: -1,
            ref: dialogRef,
          },
          h(
            'div',
            { className: 'dc-exp-head' },
            h(
              'div',
              { className: 'dc-exp-head-main' },
              h('div', { className: 'dc-exp-title' }, 'Export'),
              h(
                'div',
                { className: 'dc-exp-sub' },
                'Download this design as code, vector, image, or JSON.',
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-ibtn',
                title: 'Close',
                'aria-label': 'Close export',
                onClick: closeExportDialog,
              },
              h(Glyph, { name: 'close', size: 14 }),
            ),
          ),
          h(
            'div',
            { className: 'dc-exp-formats', role: 'tablist' },
            EXPORT_FORMAT_META.map(function (entry) {
              return h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': (ui.format || 'html') === entry.id,
                  className: 'dc-exp-format' + ((ui.format || 'html') === entry.id ? ' dc-active' : ''),
                  title: entry.hint,
                  onClick: function () {
                    EXPORT_UI.set({ format: entry.id, fileName: '' })
                  },
                },
                entry.label,
              )
            }),
          ),
          h('div', { className: 'dc-exp-detail' }, formatMeta.detail),
          h(
            'div',
            { className: 'dc-exp-row' },
            h(
              'label',
              { className: 'dc-exp-field' },
              'File',
              h('input', {
                className: 'dc-exp-input dc-exp-name',
                value: fileName,
                spellCheck: false,
                onChange: function (event) {
                  EXPORT_UI.set({ fileName: event.target.value })
                },
              }),
            ),
            h(
              'label',
              { className: 'dc-exp-field' },
              'Scope',
              h(
                'select',
                {
                  className: 'dc-exp-input',
                  value: ui.scope || 'artboard',
                  onChange: function (event) {
                    EXPORT_UI.set({ scope: event.target.value })
                  },
                },
                scopeOptions.map(function (option) {
                  return h('option', { key: option.value, value: option.value }, option.label)
                }),
              ),
            ),
            artboards.length > 1
              ? h(
                  'label',
                  { className: 'dc-exp-field' },
                  'Artboard',
                  h(
                    'select',
                    {
                      className: 'dc-exp-input',
                      value: activeArtboard ? activeArtboard.id : '',
                      onChange: function (event) {
                        EXPORT_UI.set({ artboardId: event.target.value })
                      },
                    },
                    artboards.map(function (board) {
                      return h(
                        'option',
                        { key: board.id, value: board.id },
                        (board.name || board.id) + ' · ' + Math.round(board.width) + '×' + Math.round(board.height),
                      )
                    }),
                  ),
                )
              : null,
            (ui.format || 'html') === 'png'
              ? h(
                  'label',
                  { className: 'dc-exp-field' },
                  'Scale',
                  h(
                    'select',
                    {
                      className: 'dc-exp-input',
                      value: String(ui.scale || 2),
                      onChange: function (event) {
                        EXPORT_UI.set({ scale: finiteNumber(event.target.value, 2) })
                      },
                    },
                    [1, 2, 3, 4].map(function (value) {
                      return h('option', { key: value, value: String(value) }, value + '×')
                    }),
                  ),
                )
              : null,
            h(
              'label',
              { className: 'dc-exp-field', title: 'Append the artboard comments to the export' },
              h('input', {
                type: 'checkbox',
                checked: ui.includeComments === true,
                onChange: function (event) {
                  EXPORT_UI.set({ includeComments: event.target.checked })
                },
              }),
              'Comments',
            ),
          ),
          h(
            'div',
            { className: 'dc-exp-meta' },
            h('span', null, fileName),
            sizeLabel ? h('span', null, '· ' + sizeLabel) : null,
            activeArtboard
              ? h('span', null, '· ' + Math.round(activeArtboard.width) + '×' + Math.round(activeArtboard.height))
              : null,
            copied ? h('span', { className: 'dc-exp-ok' }, '· ' + copied) : null,
          ),
          error ? h('div', { className: 'dc-exp-error' }, error) : null,
          h(
            'div',
            { className: 'dc-exp-code-wrap' },
            ui.format === 'png' && previewImage
              ? h('img', { className: 'dc-exp-preview-img', src: previewImage, alt: 'Artboard preview' })
              : h('pre', { className: 'dc-exp-code' }, previewText),
            busy ? h('div', { className: 'dc-exp-busy' }, h('span', { className: 'dc-spinner' }), 'Generating…') : null,
          ),
          h(
            'div',
            { className: 'dc-exp-foot' },
            h('span', { className: 'dc-exp-hint' }, 'Ctrl/Cmd + Shift + E'),
            h('span', { className: 'dc-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                disabled: busy || (ui.format === 'png' ? !previewImage : !previewText),
                onClick: copyNow,
              },
              copied === 'Copied' ? 'Copied' : 'Copy code',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-primary',
                disabled: busy || (ui.format === 'png' ? !previewImage : !previewText),
                onClick: downloadNow,
              },
              'Download',
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Entry points
     * ---------------------------------------------------------------------------------------- */

    function ExportToolbarButton(props) {
      const ui = useExportUi()
      const ctx = (props && props.ctx) || {}
      const doc = ctx.doc || (ctx.editor && ctx.editor.doc) || null
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-tool' + (ui.open ? ' dc-active' : ''),
          title: 'Export this design as code, SVG, PNG or JSON (Ctrl/Cmd+Shift+E)',
          disabled: !doc,
          onClick: function () {
            if (ui.open) closeExportDialog()
            else openExportDialog()
          },
        },
        h(Glyph, { name: 'export', size: 14 }),
        h('span', null, 'Export'),
      )
    }

    registerToolbar({
      id: 'export',
      render: function (ctx) {
        return h(ExportToolbarButton, { key: 'export-toolbar', ctx: ctx })
      },
    })

    registerAppPanel({
      id: 'export-dialog',
      render: function (ctx) {
        return h(ExportDialog, { key: 'export-dialog', ctx: ctx })
      },
    })

    registerKeyHandler({
      id: 'export-shortcut',
      match: function (event) {
        return (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          String(event.key || '').toLowerCase() === 'e'
        )
      },
      run: function () {
        if (EXPORT_UI.open) closeExportDialog()
        else openExportDialog()
        return true
      },
    })

    /**
     * Copy the current selection to the clipboard as `format` ('svg' | 'png' | 'html' | 'react' |
     * 'json'). Used by the context menu's "Copy as …" items; falls back to a readable error when
     * the clipboard is unavailable.
     */
    function copySelectionAs(format, api) {
      const ctx = api || {}
      const editor = ctx.editor || ctx
      const doc = ctx.doc || (editor && editor.doc) || null
      const selection = ctx.selection || (editor && editor.selection) || null
      const layerIds = selection && Array.isArray(selection.layerIds) ? selection.layerIds : []
      const setError =
        typeof ctx.setInlineError === 'function'
          ? ctx.setInlineError
          : editor && typeof editor.setInlineError === 'function'
            ? editor.setInlineError
            : function () {}
      if (!doc || !layerIds.length) {
        setError('Select something to copy first')
        return Promise.resolve(false)
      }
      const options = { scope: 'selection', layerIds: layerIds, scale: 2 }
      const label = layerIds.length === 1 ? 'layer' : layerIds.length + ' layers'
      try {
        if (format === 'png') {
          return Promise.resolve(renderPngDataUrl(doc, options)).then(
            function (dataUrl) {
              return copyImageDataUrl(dataUrl).then(function (ok) {
                setError(ok ? 'Copied ' + label + ' as PNG' : 'Could not copy the PNG')
                return ok
              })
            },
            function (error) {
              setError(messageOf(error))
              return false
            },
          )
        }
        const text = renderExport(doc, format, options)
        return copyTextToClipboard(text).then(function (ok) {
          setError(
            ok
              ? 'Copied ' + label + ' as ' + String(format).toUpperCase()
              : 'Could not copy to the clipboard',
          )
          return ok
        })
      } catch (error) {
        setError(messageOf(error))
        return Promise.resolve(false)
      }
    }

    /** Copy a PNG data URL as an image (ClipboardItem), falling back to a download. */
    function copyImageDataUrl(dataUrl) {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.write === 'function' &&
          typeof ClipboardItem === 'function'
        ) {
          return fetch(dataUrl)
            .then(function (response) {
              return response.blob()
            })
            .then(function (blob) {
              return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            })
            .then(
              function () {
                return true
              },
              function () {
                downloadDataUrl('selection.png', dataUrl)
                return true
              },
            )
        }
      } catch (error) {
        /* fall through to the download */
      }
      downloadDataUrl('selection.png', dataUrl)
      return Promise.resolve(true)
    }

    registerCommand({
      id: 'export-dialog',
      label: 'Export…',
      run: function () {
        if (EXPORT_UI.open) closeExportDialog()
        else openExportDialog()
        return true
      },
    })

    registerCommand({
      id: 'export-html',
      label: 'Copy as HTML',
      run: function (api) {
        const doc = (api && api.doc) || null
        if (!doc) return false
        try {
          const html = renderHtml(doc, { scope: 'artboard', artboardId: api.selectedArtboardId || '' })
          copyTextToClipboard(html).then(function (ok) {
            if (api.setInlineError) {
              api.setInlineError(ok ? 'HTML copied to the clipboard' : 'Could not copy the HTML')
            }
          })
          return true
        } catch (error) {
          if (api.setInlineError) api.setInlineError(messageOf(error))
          return false
        }
      },
    })
