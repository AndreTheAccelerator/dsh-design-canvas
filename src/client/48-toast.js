    /* ------------------------------------------------------------------------------------------
     * Toasts
     *
     * Every transient message (the "auto layout positions this layer" hint, locked-layer
     * refusals, failed ops, copy confirmations) used to render as an inline banner ABOVE the
     * toolbar, which pushed the whole canvas down mid-interaction. Toasts float over the bottom
     * of the panel instead: they never move anything, they stack, and they expire on their own.
     *
     * The editor still owns the message (`inlineError` / `setInlineError`); this part renders it
     * as a queue and clears it once the entry is gone, so the same message can fire again later.
     * ---------------------------------------------------------------------------------------- */

    const TOAST_CSS = `
.dc-toast-layer { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 55; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.dc-toast { display: flex; align-items: flex-start; gap: 8px; max-width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #111827); box-shadow: 0 8px 22px rgba(15, 17, 21, 0.18); font-size: 11.5px; line-height: 1.4; pointer-events: auto; }
.dc-toast-warn { border-color: #f59e0b; }
.dc-toast-icon { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-secondary, #6b7280); padding-top: 1px; }
.dc-toast-warn .dc-toast-icon { color: #b45309; }
.dc-toast-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dc-toast-close { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .dc-toast-close:hover { background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: var(--dsw-alias-label-primary, #111827); } }
.dc-toast-close:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, #111827); outline-offset: 1px; }
@media (prefers-reduced-motion: no-preference) {
  .dc-toast { animation: dc-toast-in 140ms ease-out; }
  @keyframes dc-toast-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
}
`

    /** Messages that read as refusals get the warn treatment. */
    function toastLooksLikeWarning(text) {
      return /cannot|can not|locked|not allowed|refus|failed|could not|unavailable|unknown|invalid/i.test(
        String(text || ''),
      )
    }

    const TOAST_STATE = {
      entries: [],
      nextId: 1,
      /** Longest a toast stays on screen (ms); short messages vanish sooner. */
      maxAge: 5200,
    }

    function dismissToast(id) {
      const index = TOAST_STATE.entries.findIndex(function (entry) {
        return entry.id === id
      })
      if (index >= 0) TOAST_STATE.entries.splice(index, 1)
    }

    /**
     * Keep the queue in sync with the editor's `inlineError`. Called during render of the layer,
     * which is safe because it only appends/removes entries and returns the current list.
     */
    function syncToasts(editor) {
      const message = editor && typeof editor.inlineError === 'string' ? editor.inlineError.trim() : ''
      if (!message) return TOAST_STATE.entries
      const last = TOAST_STATE.entries[TOAST_STATE.entries.length - 1]
      if (last && last.text === message) {
        last.stamp = Date.now()
        return TOAST_STATE.entries
      }
      TOAST_STATE.entries.push({
        id: TOAST_STATE.nextId++,
        text: message.slice(0, 400),
        stamp: Date.now(),
        warn: toastLooksLikeWarning(message),
      })
      // Never stack more than three; drop the oldest.
      while (TOAST_STATE.entries.length > 3) TOAST_STATE.entries.shift()
      return TOAST_STATE.entries
    }

    function ToastLayer(props) {
      const ctx = props.ctx || {}
      const editor = ctx.editor || null
      const strings = ctx.strings || currentStrings()
      const [, force] = React.useState(0)

      // Tick while toasts are visible: expire old entries and clear the editor message once the
      // queue is empty so an identical message can be raised again later.
      React.useEffect(
        function () {
          const timer = setInterval(function () {
            const now = Date.now()
            let changed = false
            for (let index = TOAST_STATE.entries.length - 1; index >= 0; index -= 1) {
              const entry = TOAST_STATE.entries[index]
              if (now - entry.stamp > TOAST_STATE.maxAge) {
                TOAST_STATE.entries.splice(index, 1)
                changed = true
              }
            }
            if (changed) {
              if (!TOAST_STATE.entries.length && editor && typeof editor.setInlineError === 'function') {
                editor.setInlineError('')
              }
              force(function (value) {
                return value + 1
              })
            }
          }, 400)
          return function () {
            clearInterval(timer)
          }
        },
        [editor],
      )

      const entries = syncToasts(editor)
      if (!entries.length) return null
      return h(
        'div',
        { className: 'dc-toast-layer', role: 'status', 'aria-live': 'polite' },
        h('style', { dangerouslySetInnerHTML: { __html: TOAST_CSS } }),
        entries.map(function (entry) {
          return h(
            'div',
            {
              key: 'toast-' + entry.id,
              className: 'dc-toast' + (entry.warn ? ' dc-toast-warn' : ''),
              'data-toast': entry.warn ? 'warn' : 'info',
            },
            h('span', { className: 'dc-toast-icon' }, h(Glyph, { name: entry.warn ? 'alert' : 'check', size: 13 })),
            h('span', { className: 'dc-toast-text' }, entry.text),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-toast-close',
                title: strings.dismiss || 'Dismiss',
                'aria-label': strings.dismiss || 'Dismiss',
                onClick: function () {
                  dismissToast(entry.id)
                  if (!TOAST_STATE.entries.length && editor && typeof editor.setInlineError === 'function') {
                    editor.setInlineError('')
                  }
                  force(function (value) {
                    return value + 1
                  })
                },
              },
              h(Glyph, { name: 'close', size: 11 }),
            ),
          )
        }),
      )
    }

    registerAppPanel({
      id: 'toasts',
      render: function (ctx) {
        return h(ToastLayer, { key: 'toast-layer', ctx: ctx })
      },
    })
