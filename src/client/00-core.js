/* eslint-disable */
/**
 * Design canvas — Client half (browser bundle, no build step, no JSX).
 *
 * A chat-paired design canvas that renders as a right-sidebar tab. It owns:
 *   - the tab type + body registration (sidebar.right.pane.tab),
 *   - a conversation composer-row open button (conversation.input.left),
 *   - the canvas surface: artboards, layers, selection, drag/resize, inspector,
 *     layer tree, inline element comments,
 *   - the browser -> Host bridges: JSON fetch (/design-canvas/state|ops|report) and
 *     an <img> beacon (/design-canvas/ping) that survives a CSP connect-src block.
 *
 * Every request carries the framework `sessionId` prop the body receives. All UI
 * chrome uses only the documented --dsw-alias-* theme tokens; artboard content is
 * rendered with its authored colors.
 */

window.__ModuleLoader__.load({
  id: '@andretaccelerator/dsh-design-canvas',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ------------------------------------------------------------------------------------------
     * Constants
     * ---------------------------------------------------------------------------------------- */

    const PLUGIN_ID = '@andretaccelerator/dsh-design-canvas'
    const KIND = 'design-canvas'
    const BASE = 'design-canvas'
    const POLL_MS = 2000
    const MIN_ZOOM = 0.1
    const MAX_ZOOM = 4
    const ZOOM_STEP = 0.1
    const MIN_LAYER_SIZE = 8
    const STAGE_GAP = 40
    const BOARD_LABEL_HEIGHT = 21
    const FIT_PADDING = 48
    const CAMERA_DEFAULT_X = 24
    const CAMERA_DEFAULT_Y = 24
    const CAMERA_DEFAULT_ZOOM = 0.5
    const WHEEL_ZOOM_SENSITIVITY = 0.0015
    const PAN_START_THRESHOLD = 3
    const IMAGE_MAX_BYTES = Math.round(1.5 * 1024 * 1024)
    const IMAGE_MAX_WIDTH_RATIO = 0.4
    const IMAGE_ACCEPT = 'image/*'
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
    const FRAME_MAX_DEPTH = 5
    const FRAME_MAX_CHILDREN = 200
    const FRAME_DEFAULT_WIDTH = 480
    const FRAME_DEFAULT_HEIGHT = 320
    const CHILD_DEFAULT_WIDTH = 100
    const CHILD_DEFAULT_HEIGHT = 40
    const LAYOUT_DIRECTIONS = ['row', 'column']
    const LAYOUT_ALIGNS = ['start', 'center', 'end', 'stretch']
    const LAYOUT_JUSTIFIES = ['start', 'center', 'end', 'space-between']
    const PADDING_SIDES = ['top', 'right', 'bottom', 'left']
    const HISTORY_LIMIT = 50
    const NUDGE_BATCH_MS = 150
    const FEATURE_KEY = 'dsh-design-canvas:autoopened'
    const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    const PLACEHOLDER_IMAGE =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
          '<rect width="320" height="200" fill="#e5e7eb"/>' +
          '<path d="M86 140l44-44 32 32 26-26 46 46" fill="none" stroke="#9ca3af" stroke-width="7"/>' +
          '<circle cx="116" cy="74" r="14" fill="#9ca3af"/>' +
          '</svg>',
      )

    /* ------------------------------------------------------------------------------------------
     * Diagnostics: never throw, never break the UI
     * ---------------------------------------------------------------------------------------- */

    function messageOf(error) {
      if (error === null || error === undefined) return 'unknown error'
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message) return error.message
      try {
        return String(error)
      } catch (ignored) {
        return 'unknown error'
      }
    }

    function shortError(error) {
      return messageOf(error).slice(0, 200)
    }

    /**
     * Fire-and-forget stage marker. A 1x1 GIF GET reaches the Host even when fetch
     * is blocked by the page origin; the Host keeps a small in-memory ring.
     */
    function beacon(stage, data) {
      try {
        const url = new URL(BASE + '/ping', document.baseURI)
        url.searchParams.set('m', String(stage).slice(0, 150))
        if (data !== undefined) {
          let encoded
          try {
            encoded = JSON.stringify(data)
          } catch (ignored) {
            encoded = '"unserializable"'
          }
          url.searchParams.set('d', String(encoded).slice(0, 550))
        }
        const ImageCtor = typeof window !== 'undefined' && typeof window.Image === 'function' ? window.Image : null
        if (!ImageCtor) return
        const image = new ImageCtor()
        image.onload = function () {
          image.onload = image.onerror = null
        }
        image.onerror = function () {
          image.onload = image.onerror = null
        }
        image.src = url.toString()
      } catch (error) {
        /* diagnostics must never throw */
      }
    }

    /** POST a structured diagnostic report; failures degrade to a beacon. */
    function report(payload) {
      try {
        const body = Object.assign({ sessionId: '' }, payload)
        const url = new URL(BASE + '/report', document.baseURI).toString()
        const pending = fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        })
        if (pending && typeof pending.then === 'function') {
          pending
            .then(function (response) {
              beacon('report-response', { kind: body.kind, status: response && response.status })
            })
            .catch(function (error) {
              beacon('report-failed', { kind: body.kind, message: shortError(error) })
            })
        }
      } catch (error) {
        beacon('report-threw', { message: shortError(error) })
      }
    }

    beacon('factory', { href: String(document.baseURI || '').slice(0, 120) })

    /* ------------------------------------------------------------------------------------------
     * Optional client services, captured at apply time
     * ---------------------------------------------------------------------------------------- */

    const runtime = {
      services: null,
      sessions: null,
      sidebarRight: null,
      locale: null,
    }

    function servicesSnapshot() {
      return (
        runtime.services || {
          sidebarRightTabs: false,
          sidebarRight: false,
          sessions: false,
          locale: false,
        }
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Extension registries
     *
     * The browser half is authored as ordered parts in `src/client/` that share ONE module scope
     * (see scripts/build-client.mjs). To keep two authors out of the same file, a feature part
     * registers its UI/handlers here at factory load time and the shell renders the registry.
     * Registration order follows the build manifest order, so the UI order is predictable.
     *
     * Entry shapes (all optional fields):
     *   toolbar     { id, render(ctx) }                 ctx: { editor, strings }
     *   appPanels   { id, render(ctx) }                 full-app overlays rendered last
     *   inspector   { id, render(ctx) }                 ctx: { editor, layer, doc, strings, actions }
     *   selection   { id, render(ctx) }                 selection bar tools (align, group, ...)
     *   keys        { id, match(event, editor) => bool, run(event, editor) => bool }
     *   commands    { id, label, run(editor) }          command-palette / menu entries
     * ---------------------------------------------------------------------------------------- */

    const EXTENSIONS = {
      toolbar: [],
      appPanels: [],
      inspector: [],
      selection: [],
      keys: [],
      commands: [],
    }

    function registerToolbar(entry) {
      if (entry && typeof entry.render === 'function') EXTENSIONS.toolbar.push(entry)
    }
    function registerAppPanel(entry) {
      if (entry && typeof entry.render === 'function') EXTENSIONS.appPanels.push(entry)
    }
    function registerInspectorSection(entry) {
      if (entry && typeof entry.render === 'function') EXTENSIONS.inspector.push(entry)
    }
    function registerSelectionTool(entry) {
      if (entry && typeof entry.render === 'function') EXTENSIONS.selection.push(entry)
    }
    function registerKeyHandler(entry) {
      if (entry && typeof entry.match === 'function' && typeof entry.run === 'function') {
        EXTENSIONS.keys.push(entry)
      }
    }
    function registerCommand(entry) {
      if (entry && typeof entry.run === 'function') EXTENSIONS.commands.push(entry)
    }

    /** Render a registry list, dropping entries that render nothing. */
    function renderExtensions(list, ctx) {
      if (!Array.isArray(list) || !list.length) return null
      const out = []
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index]
        try {
          const rendered = entry.render(ctx)
          if (rendered) out.push(h(React.Fragment, { key: String(entry.id || index) }, rendered))
        } catch (error) {
          beacon('extension-failed', { id: String(entry && entry.id), message: shortError(error) })
        }
      }
      return out.length ? out : null
    }

    /* ------------------------------------------------------------------------------------------
     * Copy: small dictionary keyed by locale id, English fallback per key
     * ---------------------------------------------------------------------------------------- */

