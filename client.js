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
      /** Design (project) name of the last document seen, used for the tab title. */
      designName: '',
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

    const STRINGS = {
      en: {
        pluginTitle: 'Design',
        openCanvas: 'Design canvas',
        guideTitle: 'Design canvas',
        guideDescription: 'Artboards, layers and inline element comments',
        noSession: 'No session selected',
        noSessionHint: 'Open a session to use the design canvas.',
        loading: 'Loading the design…',
        loadFailed: 'Could not load the design',
        retry: 'Retry',
        renderFailed: 'Design canvas failed to render',
        untitled: 'Untitled design',
        synced: 'Synced',
        saving: 'Saving…',
        offline: 'Offline',
        revising: 'AI revising',
        addArtboard: 'Add artboard',
        zoomOut: 'Zoom out',
        zoomIn: 'Zoom in',
        zoomFit: 'Fit to canvas',
        commentMode: 'Comment mode',
        commentOn: 'Comment on',
        commentPlaceholder: 'Describe the change you want…',
        send: 'Send',
        sending: 'Sending…',
        cancel: 'Cancel',
        comments: 'Comments',
        resolve: 'Resolve',
        reopen: 'Reopen',
        delete: 'Delete',
        deleteComment: 'Delete comment',
        moveUp: 'Bring forward',
        moveDown: 'Send backward',
        layers: 'Layers',
        inspector: 'Inspector',
        hide: 'Hide',
        show: 'Show',
        artboard: 'Artboard',
        layer: 'Layer',
        noArtboards: 'No artboards yet',
        noComments: 'No comments on this layer yet',
        addComment: 'Add comment',
        element: 'Element',
        layout: 'Layout',
        appearance: 'Appearance',
        textSection: 'Text',
        imageSection: 'Image',
        name: 'Name',
        x: 'X',
        y: 'Y',
        width: 'W',
        height: 'H',
        opacity: 'Opacity',
        radius: 'Radius',
        fill: 'Fill',
        color: 'Color',
        borderWidth: 'Border',
        borderColor: 'Border color',
        fontSize: 'Size',
        fontWeight: 'Weight',
        align: 'Align',
        left: 'Left',
        center: 'Center',
        right: 'Right',
        lineHeight: 'Line height',
        fontFamily: 'Font',
        content: 'Content',
        src: 'Source URL',
        fit: 'Fit',
        cover: 'Cover',
        contain: 'Contain',
        fillFit: 'Fill',
        rect: 'Rectangle',
        ellipse: 'Ellipse',
        text: 'Text',
        image: 'Image',
        chatFailed: 'Comment saved, but the chat request failed',
        sessionUnavailable: 'The chat session is not available',
        openFailed: 'Could not open the design canvas',
        postFailed: 'Could not save the change',
        resolved: 'Resolved',
        open: 'Open',
        dismiss: 'Dismiss',
        deleteLayer: 'Delete layer',
        selectHint: 'Select a layer or an artboard to edit it',
        pinTitle: 'Open comments',
        retryHint: 'Check the Host bridge, then try again.',
        addLayerHint: 'Add a shape to the selected artboard',
        addImage: 'Add image',
        chooseFile: 'Choose file…',
        imageTooLarge: 'Image is too large — the limit is 1.5 MiB',
        imageBadType: 'Unsupported image type — use PNG, JPEG, WebP, GIF or SVG',
        imageReadFailed: 'Could not read that image file',
        imageNoArtboard: 'Add an artboard before adding an image',
        imageHint: 'Drop an image here to place it',
        frame: 'Frame',
        addFrame: 'Add frame',
        autoLayout: 'Auto layout',
        enableAutoLayout: 'Enable auto layout',
        disableAutoLayout: 'Disable auto layout',
        direction: 'Direction',
        row: 'Row',
        column: 'Column',
        gap: 'Gap',
        padding: 'Padding',
        paddingTop: 'T',
        paddingRight: 'R',
        paddingBottom: 'B',
        paddingLeft: 'L',
        alignStart: 'Start',
        alignCenter: 'Center',
        alignEnd: 'End',
        alignStretch: 'Stretch',
        justifyStart: 'Start',
        justifyCenter: 'Center',
        justifyEnd: 'End',
        justifySpaceBetween: 'Space between',
        wrap: 'Wrap',
        clip: 'Clip',
        grow: 'Grow',
        alignSelf: 'Self align',
        inherit: 'Inherit',
        moveInto: 'Move into',
        parent: 'Parent',
        structure: 'Structure',
        absoluteMode: 'Absolute positioning — children keep their own x/y',
        derivedGeometry: 'Derived geometry',
        inAutoLayout: 'Auto layout child',
        on: 'On',
        off: 'Off',
        collapse: 'Collapse',
        expand: 'Expand',
        depthLimit: 'Frames can only nest 5 levels deep',
        childLimit: 'This frame already has 200 children',
        reparentFailed: 'Could not move the layer there',
        layoutChangeFailed: 'Could not update the frame layout',
        effects: 'Effects',
        shadow: 'Shadow',
        shadowPlaceholder: '0 12px 32px rgba(15,23,42,0.14)',
        shadowInvalid: 'Shadow must be a single CSS box-shadow value (no newlines, braces or semicolons)',
        clear: 'Clear',
        gradientHint: 'Accepts any CSS color or gradient (e.g. linear-gradient(…)).',
        letterSpacing: 'Letter spacing',
        textTransform: 'Transform',
        none: 'None',
        uppercase: 'Uppercase',
        lowercase: 'Lowercase',
        duplicate: 'Duplicate',
        nudgeAutoLayout: 'Auto layout positions this layer — drag it to reorder instead.',
        undo: 'Undo',
        redo: 'Redo',
        undoFailed: 'Could not undo the last change',
        redoFailed: 'Could not redo that change',
        duplicateTooLarge: 'This frame is too large to duplicate in one batch',
      },
      zh: {
        pluginTitle: '设计',
        openCanvas: '设计画布',
        guideTitle: '设计画布',
        guideDescription: '画板、图层与行内元素评论',
        noSession: '未选择会话',
        noSessionHint: '打开一个会话后即可使用设计画布。',
        loading: '正在加载设计…',
        loadFailed: '无法加载设计',
        retry: '重试',
        renderFailed: '设计画布渲染失败',
        untitled: '未命名设计',
        synced: '已同步',
        saving: '保存中…',
        offline: '离线',
        revising: 'AI 修改中',
        addArtboard: '添加画板',
        zoomOut: '缩小',
        zoomIn: '放大',
        zoomFit: '适应画布',
        commentMode: '评论模式',
        commentOn: '评论',
        commentPlaceholder: '描述你想要的修改…',
        send: '发送',
        sending: '发送中…',
        cancel: '取消',
        comments: '评论',
        resolve: '解决',
        reopen: '重新打开',
        delete: '删除',
        deleteComment: '删除评论',
        moveUp: '上移一层',
        moveDown: '下移一层',
        layers: '图层',
        inspector: '属性',
        hide: '隐藏',
        show: '显示',
        artboard: '画板',
        layer: '图层',
        noArtboards: '还没有画板',
        noComments: '该图层还没有评论',
        addComment: '添加评论',
        element: '元素',
        layout: '布局',
        appearance: '外观',
        textSection: '文本',
        imageSection: '图片',
        name: '名称',
        x: 'X',
        y: 'Y',
        width: '宽',
        height: '高',
        opacity: '不透明度',
        radius: '圆角',
        fill: '填充',
        color: '颜色',
        borderWidth: '边框',
        borderColor: '边框颜色',
        fontSize: '字号',
        fontWeight: '字重',
        align: '对齐',
        left: '左',
        center: '中',
        right: '右',
        lineHeight: '行高',
        fontFamily: '字体',
        content: '内容',
        src: '图片地址',
        fit: '填充方式',
        cover: '覆盖',
        contain: '包含',
        fillFit: '拉伸',
        rect: '矩形',
        ellipse: '椭圆',
        text: '文本',
        image: '图片',
        chatFailed: '评论已保存，但发送聊天请求失败',
        sessionUnavailable: '聊天会话当前不可用',
        openFailed: '无法打开设计画布',
        postFailed: '无法保存修改',
        resolved: '已解决',
        open: '待处理',
        dismiss: '关闭',
        deleteLayer: '删除图层',
        selectHint: '选择图层或画板进行编辑',
        pinTitle: '查看评论',
        retryHint: '请检查 Host 连接后重试。',
        addLayerHint: '在选中的画板中添加图形',
        addImage: '添加图片',
        chooseFile: '选择文件…',
        imageTooLarge: '图片过大 — 上限 1.5 MiB',
        imageBadType: '不支持的图片类型 — 请使用 PNG、JPEG、WebP、GIF 或 SVG',
        imageReadFailed: '无法读取该图片文件',
        imageNoArtboard: '请先添加画板，再添加图片',
        imageHint: '拖入图片即可放置',
        frame: '框架',
        addFrame: '添加框架',
        autoLayout: '自动布局',
        enableAutoLayout: '启用自动布局',
        disableAutoLayout: '关闭自动布局',
        direction: '方向',
        row: '横向',
        column: '纵向',
        gap: '间距',
        padding: '内边距',
        paddingTop: '上',
        paddingRight: '右',
        paddingBottom: '下',
        paddingLeft: '左',
        alignStart: '起始',
        alignCenter: '居中',
        alignEnd: '结束',
        alignStretch: '拉伸',
        justifyStart: '起始',
        justifyCenter: '居中',
        justifyEnd: '结束',
        justifySpaceBetween: '两端',
        wrap: '换行',
        clip: '裁剪',
        grow: '填充',
        alignSelf: '自身对齐',
        inherit: '继承',
        moveInto: '移动到',
        parent: '父级',
        structure: '结构',
        absoluteMode: '绝对定位 — 子级使用自身 x/y',
        derivedGeometry: '推导几何',
        inAutoLayout: '自动布局子级',
        on: '开',
        off: '关',
        collapse: '折叠',
        expand: '展开',
        depthLimit: '框架最多嵌套 5 层',
        childLimit: '该框架已有 200 个子级',
        reparentFailed: '无法将图层移动到该位置',
        layoutChangeFailed: '无法更新框架布局',
        effects: '效果',
        shadow: '阴影',
        shadowPlaceholder: '0 12px 32px rgba(15,23,42,0.14)',
        shadowInvalid: '阴影必须是单个 CSS box-shadow 值（不能包含换行、花括号或分号）',
        clear: '清除',
        gradientHint: '支持任意 CSS 颜色或渐变（如 linear-gradient(…))。',
        letterSpacing: '字距',
        textTransform: '大小写',
        none: '无',
        uppercase: '大写',
        lowercase: '小写',
        duplicate: '复制',
        nudgeAutoLayout: '该图层由自动布局定位 — 请拖拽以重新排序。',
        undo: '撤销',
        redo: '重做',
        undoFailed: '无法撤销上一步修改',
        redoFailed: '无法重做该修改',
        duplicateTooLarge: '该框架过大，无法一次性复制',
      },
    }

    function localeIdOf(localeService) {
      if (!localeService) return 'en'
      try {
        const snapshot =
          typeof localeService.getLocale === 'function' ? localeService.getLocale() : undefined
        const active = snapshot && (snapshot.active || snapshot)
        const id = active && (active.id || active.locale || active.tag)
        return typeof id === 'string' && id ? id : 'en'
      } catch (error) {
        return 'en'
      }
    }

    function baseLocaleId(localeId) {
      const value = String(localeId || 'en').toLowerCase()
      const dash = value.indexOf('-')
      const underscore = value.indexOf('_')
      let cut = value.length
      if (dash >= 0 && dash < cut) cut = dash
      if (underscore >= 0 && underscore < cut) cut = underscore
      return value.slice(0, cut) || 'en'
    }

    function stringsFor(localeId) {
      const base = baseLocaleId(localeId)
      const dictionary = STRINGS[base]
      if (!dictionary) return STRINGS.en
      return Object.assign({}, STRINGS.en, dictionary)
    }

    function currentLocaleId() {
      return localeIdOf(runtime.locale)
    }

    function currentStrings() {
      return stringsFor(currentLocaleId())
    }

    /* ------------------------------------------------------------------------------------------
     * HTTP
     * ---------------------------------------------------------------------------------------- */

    function apiUrl(path, params) {
      const url = new URL(BASE + path, document.baseURI)
      if (params) {
        Object.keys(params).forEach(function (key) {
          const value = params[key]
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
        })
      }
      return url.toString()
    }

    function parseJsonResponse(response) {
      return response.text().then(function (text) {
        let body = null
        try {
          body = text ? JSON.parse(text) : null
        } catch (error) {
          body = null
        }
        if (!response.ok || body === null || body.ok === false) {
          const detail = body && body.error ? body.error : null
          const failure = new Error(
            (detail && detail.message) || 'design-canvas request failed (' + response.status + ')',
          )
          failure.code = detail && detail.code ? detail.code : 'http-' + response.status
          throw failure
        }
        // Track the design (project) name so the sidebar tab can show it. Every mutation
        // response carries the document, so a rename is picked up on the next request.
        if (body && body.doc && typeof body.doc.name === 'string') {
          const name = body.doc.name.trim().slice(0, 120)
          if (name) runtime.designName = name
        }
        return body
      })
    }

    function getState(sessionId) {
      return fetch(apiUrl('/state', { sessionId: sessionId }), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      }).then(parseJsonResponse)
    }

    function postOps(sessionId, ops, options) {
      const body = { sessionId: sessionId, ops: ops }
      if (options && options.atomic === true) body.atomic = true
      return fetch(apiUrl('/ops'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(parseJsonResponse)
    }

    /* ------------------------------------------------------------------------------------------
     * Pure document helpers
     * ---------------------------------------------------------------------------------------- */

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function finiteNumber(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    function clamp(number, minimum, maximum) {
      return Math.min(Math.max(number, minimum), maximum)
    }

    function roundTo(number, decimals) {
      const factor = Math.pow(10, decimals || 0)
      return Math.round(number * factor) / factor
    }

    function makeId(prefix) {
      return prefix + '-' + Math.random().toString(36).slice(2, 10)
    }

    function artboardsOf(doc) {
      return doc && Array.isArray(doc.artboards) ? doc.artboards : []
    }

    function commentsOf(doc) {
      return doc && Array.isArray(doc.comments) ? doc.comments : []
    }

    function layersOf(artboard) {
      return artboard && Array.isArray(artboard.layers) ? artboard.layers : []
    }

    /** True when a layer owns children (a frame with or without auto layout, or a group). */
    function isContainerLayer(layer) {
      return isObject(layer) && (layer.type === 'frame' || layer.type === 'group')
    }

    /** Children array of any container: an artboard (`layers`), a frame or a group (`children`). */
    function childrenOf(container) {
      if (!isObject(container)) return []
      if (isContainerLayer(container)) {
        return Array.isArray(container.children) ? container.children : []
      }
      return layersOf(container)
    }

    function findArtboardById(doc, artboardId) {
      if (!doc || typeof artboardId !== 'string' || !artboardId) return null
      const artboards = artboardsOf(doc)
      for (let index = 0; index < artboards.length; index += 1) {
        if (artboards[index] && artboards[index].id === artboardId) return artboards[index]
      }
      return null
    }

    function findLayerInList(list, layerId, artboard, parentLayer, depth) {
      if (!Array.isArray(list)) return null
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        if (!isObject(layer)) continue
        if (layer.id === layerId) {
          return {
            layer: layer,
            artboard: artboard,
            parent: parentLayer || null,
            parentId: parentLayer && typeof parentLayer.id === 'string' ? parentLayer.id : null,
            index: index,
            depth: depth,
          }
        }
        if (isContainerLayer(layer)) {
          const found = findLayerInList(childrenOf(layer), layerId, artboard, layer, depth + 1)
          if (found) return found
        }
      }
      return null
    }

    /** Recursive layer lookup: returns { layer, artboard, parent, parentId, index, depth } or null. */
    function findLayerById(doc, layerId) {
      if (!doc || typeof layerId !== 'string' || !layerId) return null
      const artboards = artboardsOf(doc)
      for (let artboardIndex = 0; artboardIndex < artboards.length; artboardIndex += 1) {
        const artboard = artboards[artboardIndex]
        if (!isObject(artboard)) continue
        const found = findLayerInList(layersOf(artboard), layerId, artboard, null, 1)
        if (found) return found
      }
      return null
    }

    /**
     * Cheap identity check between two in-memory documents: same board, ignoring `version`.
     * Used by the poller to notice that the Host replaced/reset the document even though the
     * version number did not move forward (Reset doc, adopting another workspace's board).
     */
    function sameDocumentIdentity(first, second) {
      if (!isObject(first) || !isObject(second)) return first === second
      if (String(first.updatedAt || '') !== String(second.updatedAt || '')) return false
      if (String(first.name || '') !== String(second.name || '')) return false
      const boardsA = artboardsOf(first)
      const boardsB = artboardsOf(second)
      if (boardsA.length !== boardsB.length) return false
      for (let index = 0; index < boardsA.length; index += 1) {
        const a = boardsA[index]
        const b = boardsB[index]
        if (!isObject(a) || !isObject(b)) return false
        if (a.id !== b.id) return false
        if (layersOf(a).length !== layersOf(b).length) return false
      }
      return true
    }

    function collectLayerIds(layer, target) {
      if (!isObject(layer) || !(target instanceof Set)) return target
      if (typeof layer.id === 'string' && layer.id) target.add(layer.id)
      if (isContainerLayer(layer)) {
        const kids = childrenOf(layer)
        for (let index = 0; index < kids.length; index += 1) collectLayerIds(kids[index], target)
      }
      return target
    }

    function subtreeContains(layer, layerId) {
      if (!isObject(layer) || typeof layerId !== 'string' || !layerId) return false
      if (layer.id === layerId) return true
      if (!isContainerLayer(layer)) return false
      const kids = childrenOf(layer)
      for (let index = 0; index < kids.length; index += 1) {
        if (subtreeContains(kids[index], layerId)) return true
      }
      return false
    }

    /** Nested-container height of a subtree (a leaf layer is 1, matching Host depth rules). */
    function subtreeHeight(layer) {
      if (!isObject(layer) || !isContainerLayer(layer)) return 1
      let tallest = 0
      const kids = childrenOf(layer)
      for (let index = 0; index < kids.length; index += 1) {
        const childHeight = subtreeHeight(kids[index])
        if (childHeight > tallest) tallest = childHeight
      }
      return 1 + tallest
    }

    function countLayers(doc) {
      let total = 0
      function countList(list) {
        const layers = Array.isArray(list) ? list : []
        for (let index = 0; index < layers.length; index += 1) {
          const layer = layers[index]
          if (!isObject(layer)) continue
          total += 1
          if (isContainerLayer(layer)) countList(childrenOf(layer))
        }
      }
      const artboards = artboardsOf(doc)
      for (let index = 0; index < artboards.length; index += 1) countList(layersOf(artboards[index]))
      return total
    }

    /**
     * Map every layer of a tree through `mapper` (frames keep recursing into children after the
     * mapper runs). Returns the original array when nothing changed so callers can skip re-renders.
     */
    function mapLayerList(list, mapper) {
      const layers = Array.isArray(list) ? list : []
      let changed = false
      const next = layers.map(function (layer) {
        if (!isObject(layer)) return layer
        let result = mapper(layer)
        if (!isObject(result)) result = layer
        if (isContainerLayer(result)) {
          const kids = childrenOf(result)
          const nextKids = mapLayerList(kids, mapper)
          if (nextKids !== kids) result = Object.assign({}, result, { children: nextKids })
        }
        if (result !== layer) changed = true
        return result
      })
      return changed ? next : layers
    }

    function replaceLayerListIn(layers, parentId, nextChildren) {
      let changed = false
      const next = layers.map(function (layer) {
        if (!isObject(layer)) return layer
        if (layer.id === parentId) {
          changed = true
          return Object.assign({}, layer, { children: nextChildren })
        }
        if (isContainerLayer(layer)) {
          const kids = childrenOf(layer)
          const nextKids = replaceLayerListIn(kids, parentId, nextChildren)
          if (nextKids !== kids) {
            changed = true
            return Object.assign({}, layer, { children: nextKids })
          }
        }
        return layer
      })
      return changed ? next : layers
    }

    function docReplaceLayerList(doc, artboardId, parentId, nextChildren) {
      let changed = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard) || artboard.id !== artboardId) return artboard
        if (!parentId) {
          const layers = layersOf(artboard)
          if (layers === nextChildren) return artboard
          changed = true
          return Object.assign({}, artboard, { layers: nextChildren })
        }
        const layers = layersOf(artboard)
        const nextLayers = replaceLayerListIn(layers, parentId, nextChildren)
        if (nextLayers === layers) return artboard
        changed = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!changed) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    /** Replace one layer's own properties, producing a new document. */
    function docPatchLayer(doc, layerId, patch) {
      if (!doc) return doc
      function mapper(layer) {
        if (layer.id !== layerId) return layer
        return Object.assign({}, layer, patch)
      }
      let touched = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard)) return artboard
        const layers = layersOf(artboard)
        const nextLayers = mapLayerList(layers, mapper)
        if (nextLayers === layers) return artboard
        touched = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!touched) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    /**
     * Batched variant of `docPatchLayer`: `entries` is `[{ layerId, patch }]`. Returns one new
     * document for every changed layer so a gesture over N selected layers triggers a single
     * state update (N=50 must stay smooth), and reuses the original arrays when nothing changed.
     */
    function docPatchLayers(doc, entries) {
      if (!doc || !Array.isArray(entries) || entries.length === 0) return doc
      const patches = new Map()
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!isObject(entry)) continue
        if (typeof entry.layerId !== 'string' || !entry.layerId) continue
        if (!isObject(entry.patch)) continue
        if (patches.has(entry.layerId)) continue
        patches.set(entry.layerId, entry.patch)
      }
      if (patches.size === 0) return doc
      function mapper(layer) {
        const patch = patches.get(layer.id)
        if (!patch) return layer
        return Object.assign({}, layer, patch)
      }
      let touched = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard)) return artboard
        const layers = layersOf(artboard)
        const nextLayers = mapLayerList(layers, mapper)
        if (nextLayers === layers) return artboard
        touched = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!touched) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    function docPatchArtboard(doc, artboardId, patch) {
      if (!doc) return doc
      let changed = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!artboard || artboard.id !== artboardId) return artboard
        changed = true
        return Object.assign({}, artboard, patch)
      })
      if (!changed) return doc
      return Object.assign({}, doc, { artboards: artboards })
    }

    function docInsertArtboard(doc, artboard, index) {
      const artboards = artboardsOf(doc).slice()
      const position =
        typeof index === 'number' ? clamp(index, 0, artboards.length) : artboards.length
      artboards.splice(position, 0, artboard)
      return Object.assign({}, doc, { artboards: artboards })
    }

    /** Insert a layer into a destination: `{ artboardId }` (top level) or `{ parentId }` (frame). */
    function docInsertLayer(doc, destination, layer, index) {
      if (!doc || !isObject(destination) || !isObject(layer)) return doc
      const parentId =
        typeof destination.parentId === 'string' && destination.parentId
          ? destination.parentId
          : null
      const artboardId =
        typeof destination.artboardId === 'string' && destination.artboardId
          ? destination.artboardId
          : null
      if (!parentId && !artboardId) return doc
      if (parentId) {
        const parentFound = findLayerById(doc, parentId)
        if (!parentFound) return doc
        const list = childrenOf(parentFound.layer).slice()
        const position = typeof index === 'number' ? clamp(index, 0, list.length) : list.length
        list.splice(position, 0, layer)
        return docReplaceLayerList(doc, parentFound.artboard.id, parentId, list)
      }
      const artboard = findArtboardById(doc, artboardId)
      if (!artboard) return doc
      const list = layersOf(artboard).slice()
      const position = typeof index === 'number' ? clamp(index, 0, list.length) : list.length
      list.splice(position, 0, layer)
      return docReplaceLayerList(doc, artboardId, null, list)
    }

    /** Batched variant: insert several layers (in order) into one destination. */
    function docInsertLayers(doc, destination, layers, index) {
      if (!doc || !isObject(destination) || !Array.isArray(layers) || layers.length === 0) return doc
      const parentId =
        typeof destination.parentId === 'string' && destination.parentId
          ? destination.parentId
          : null
      const artboardId =
        typeof destination.artboardId === 'string' && destination.artboardId
          ? destination.artboardId
          : null
      if (!parentId && !artboardId) return doc
      let baseList = null
      let ownerArtboardId = artboardId
      if (parentId) {
        const parentFound = findLayerById(doc, parentId)
        if (!parentFound) return doc
        baseList = childrenOf(parentFound.layer)
        ownerArtboardId = parentFound.artboard.id
      } else {
        const artboard = findArtboardById(doc, artboardId)
        if (!artboard) return doc
        baseList = layersOf(artboard)
      }
      const list = (baseList || []).slice()
      const position = typeof index === 'number' ? clamp(index, 0, list.length) : list.length
      list.splice.apply(list, [position, 0].concat(layers))
      return docReplaceLayerList(doc, ownerArtboardId, parentId, list)
    }

    /** Remove one layer (not its comments) from wherever it lives. */
    function removeLayerFromTree(doc, layerId) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const list = (found.parent ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
      if (found.index < 0 || found.index >= list.length) return doc
      list.splice(found.index, 1)
      return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
    }

    /** Remove a layer and its whole subtree, dropping comments that referenced any deleted layer. */
    function docRemoveLayer(doc, layerId) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const removedIds = collectLayerIds(found.layer, new Set())
      const next = removeLayerFromTree(doc, layerId)
      return Object.assign({}, next, {
        comments: commentsOf(next).filter(function (comment) {
          return (
            !isObject(comment) ||
            typeof comment.layerId !== 'string' ||
            !removedIds.has(comment.layerId)
          )
        }),
      })
    }

    /**
     * Batched variant of `docRemoveLayer`: removes several layer roots and every comment that
     * referenced anything in their subtrees, in ONE document copy. Ids nested inside another
     * removed id are dropped from the work list (the ancestor carries the subtree).
     */
    function docRemoveLayers(doc, layerIds) {
      if (!doc) return doc
      const requested = []
      const requestedSet = new Set()
      const raw = Array.isArray(layerIds) ? layerIds : []
      for (let index = 0; index < raw.length; index += 1) {
        const layerId = raw[index]
        if (typeof layerId !== 'string' || !layerId) continue
        if (requestedSet.has(layerId)) continue
        requestedSet.add(layerId)
        requested.push(layerId)
      }
      if (requested.length === 0) return doc
      // Keep only outermost targets: an id whose ancestor is also removed is already covered.
      const roots = requested.filter(function (layerId) {
        let found = findLayerById(doc, layerId)
        while (found && found.parent) {
          if (requestedSet.has(found.parent.id)) return false
          found = findLayerById(doc, found.parent.id)
        }
        return true
      })
      if (roots.length === 0) return doc
      const targetIds = new Set(roots)
      const removedIds = new Set()

      function pruneList(list) {
        const layers = Array.isArray(list) ? list : []
        let changed = false
        const next = layers.map(function (layer) {
          if (!isObject(layer)) return layer
          if (targetIds.has(layer.id)) {
            collectLayerIds(layer, removedIds)
            changed = true
            return null
          }
          if (!isContainerLayer(layer)) return layer
          const kids = childrenOf(layer)
          const nextKids = pruneList(kids)
          if (nextKids === kids) return layer
          changed = true
          return Object.assign({}, layer, { children: nextKids })
        })
        if (!changed) return layers
        return next.filter(function (layer) { return layer !== null })
      }

      let touched = false
      const artboards = artboardsOf(doc).map(function (artboard) {
        if (!isObject(artboard)) return artboard
        const layers = layersOf(artboard)
        const nextLayers = pruneList(layers)
        if (nextLayers === layers) return artboard
        touched = true
        return Object.assign({}, artboard, { layers: nextLayers })
      })
      if (!touched) return doc
      return Object.assign({}, doc, {
        artboards: artboards,
        comments: commentsOf(doc).filter(function (comment) {
          return (
            !isObject(comment) ||
            typeof comment.layerId !== 'string' ||
            !removedIds.has(comment.layerId)
          )
        }),
      })
    }

    /** Reorder a layer within its current parent (artboard or frame). Index is the final position. */
    function docReorderLayer(doc, layerId, targetIndex) {
      if (!doc) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const list = (found.parent ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
      if (list.length === 0) return doc
      const to = clamp(finiteNumber(targetIndex, found.index), 0, list.length - 1)
      if (to === found.index) return doc
      const moved = list.splice(found.index, 1)[0]
      list.splice(to, 0, moved)
      return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
    }

    /** Move a layer to another parent (or reorder in place) in one document update. */
    function docMoveLayer(doc, layerId, destination, index) {
      if (!doc || !isObject(destination)) return doc
      const found = findLayerById(doc, layerId)
      if (!found) return doc
      const parentId =
        typeof destination.parentId === 'string' && destination.parentId
          ? destination.parentId
          : null
      const artboardId =
        typeof destination.artboardId === 'string' && destination.artboardId
          ? destination.artboardId
          : null
      if (!parentId && !artboardId) return doc
      const sameParent = parentId ? parentId === found.parentId : !found.parentId && artboardId === found.artboard.id
      if (sameParent) {
        const list = (parentId ? childrenOf(found.parent) : layersOf(found.artboard)).slice()
        if (list.length === 0) return doc
        const to = clamp(
          typeof index === 'number' ? index : list.length - 1,
          0,
          list.length - 1,
        )
        if (to === found.index) return doc
        const moved = list.splice(found.index, 1)[0]
        list.splice(to, 0, moved)
        return docReplaceLayerList(doc, found.artboard.id, found.parentId, list)
      }
      let destArtboardId = artboardId
      let destList = null
      if (parentId) {
        const parentFound = findLayerById(doc, parentId)
        if (!parentFound) return doc
        destArtboardId = parentFound.artboard.id
        destList = childrenOf(parentFound.layer).slice()
      } else {
        const artboard = findArtboardById(doc, artboardId)
        if (!artboard) return doc
        destList = layersOf(artboard).slice()
      }
      const position = typeof index === 'number' ? clamp(index, 0, destList.length) : destList.length
      destList.splice(position, 0, found.layer)
      const removed = removeLayerFromTree(doc, layerId)
      return docReplaceLayerList(removed, destArtboardId, parentId, destList)
    }

    function docPatchComment(doc, commentId, patch) {
      if (!doc) return doc
      let changed = false
      const comments = commentsOf(doc).map(function (comment) {
        if (!comment || comment.id !== commentId) return comment
        changed = true
        return Object.assign({}, comment, patch)
      })
      if (!changed) return doc
      return Object.assign({}, doc, { comments: comments })
    }

    function docRemoveComment(doc, commentId) {
      if (!doc) return doc
      const comments = commentsOf(doc)
      const next = comments.filter(function (comment) { return !comment || comment.id !== commentId })
      if (next.length === comments.length) return doc
      return Object.assign({}, doc, { comments: next })
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas geometry: camera + artboard layout + image input helpers
     * ---------------------------------------------------------------------------------------- */

    function defaultCamera() {
      return { x: CAMERA_DEFAULT_X, y: CAMERA_DEFAULT_Y, zoom: CAMERA_DEFAULT_ZOOM }
    }

    /** Coerce any candidate camera into {x, y, zoom}, clamped and finite. */
    function normalizeCamera(value, fallback) {
      const source = isObject(value) ? value : {}
      const base = isObject(fallback) ? fallback : defaultCamera()
      return {
        x: roundTo(finiteNumber(source.x, finiteNumber(base.x, CAMERA_DEFAULT_X)), 1),
        y: roundTo(finiteNumber(source.y, finiteNumber(base.y, CAMERA_DEFAULT_Y)), 1),
        zoom: clamp(
          roundTo(finiteNumber(source.zoom, finiteNumber(base.zoom, CAMERA_DEFAULT_ZOOM)), 3),
          MIN_ZOOM,
          MAX_ZOOM,
        ),
      }
    }

    /**
     * Vertical artboard stack in canvas units. Every artboard gets an entry with the
     * wrapper origin (x, y) and the board-frame origin (frameX, frameY); the label row
     * sits above the frame. This is the single source of truth for fit, hit-testing
     * and projecting layers into viewport space.
     */
    function computeLayout(doc) {
      const artboards = artboardsOf(doc)
      const entries = []
      const entryById = new Map()
      let cursor = 0
      let widest = 0
      for (let index = 0; index < artboards.length; index += 1) {
        const artboard = artboards[index]
        if (!isObject(artboard)) continue
        const width = Math.max(1, finiteNumber(artboard.width, 1))
        const height = Math.max(1, finiteNumber(artboard.height, 1))
        const entry = {
          artboard: artboard,
          id: artboard.id,
          x: 0,
          y: cursor,
          frameX: 0,
          frameY: cursor + BOARD_LABEL_HEIGHT,
          width: width,
          height: height,
        }
        entries.push(entry)
        if (typeof artboard.id === 'string' && artboard.id) entryById.set(artboard.id, entry)
        cursor += BOARD_LABEL_HEIGHT + height + STAGE_GAP
        if (width > widest) widest = width
      }
      if (entries.length === 0) {
        return { entries: entries, entryById: entryById, width: 0, height: 0 }
      }
      for (let index = 0; index < entries.length; index += 1) {
        const centered = Math.round((widest - entries[index].width) / 2)
        entries[index].x = centered
        entries[index].frameX = centered
      }
      return {
        entries: entries,
        entryById: entryById,
        width: widest,
        height: Math.max(0, cursor - STAGE_GAP),
      }
    }

    function layoutEntryAt(layout, x, y) {
      if (!layout || !Array.isArray(layout.entries)) return null
      const pointX = finiteNumber(x, 0)
      const pointY = finiteNumber(y, 0)
      for (let index = 0; index < layout.entries.length; index += 1) {
        const entry = layout.entries[index]
        if (!entry) continue
        if (
          pointX >= entry.frameX &&
          pointX <= entry.frameX + entry.width &&
          pointY >= entry.frameY &&
          pointY <= entry.frameY + entry.height
        ) {
          return entry
        }
      }
      return null
    }

    /** Screen delta -> canvas (document) delta: divide by the camera zoom. */
    function screenDeltaToCanvas(delta, zoom) {
      const scale = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      return finiteNumber(delta, 0) / scale
    }

    /* ------------------------------------------------------------------------------------------
     * Selection rectangles and snap guides
     *
     * All rects here are artboard-local canvas units (computed node worldRect), which is the space
     * the renderer draws the selection overlay and guide lines in.
     * ---------------------------------------------------------------------------------------- */

    function rectOf(x, y, width, height) {
      return {
        x: finiteNumber(x, 0),
        y: finiteNumber(y, 0),
        width: Math.max(0, finiteNumber(width, 0)),
        height: Math.max(0, finiteNumber(height, 0)),
      }
    }

    /** Union of several rects; null when the list is empty. */
    function unionRects(rects) {
      const list = Array.isArray(rects) ? rects : []
      let left = null
      let top = null
      let right = null
      let bottom = null
      for (let index = 0; index < list.length; index += 1) {
        const rect = list[index]
        if (!isObject(rect)) continue
        const x = finiteNumber(rect.x, 0)
        const y = finiteNumber(rect.y, 0)
        const width = Math.max(0, finiteNumber(rect.width, 0))
        const height = Math.max(0, finiteNumber(rect.height, 0))
        if (left === null || x < left) left = x
        if (top === null || y < top) top = y
        if (right === null || x + width > right) right = x + width
        if (bottom === null || y + height > bottom) bottom = y + height
      }
      if (left === null) return null
      return rectOf(left, top, right - left, bottom - top)
    }

    /** Rect from two corner points (a marquee drag in any direction). */
    function rectFromPoints(first, second) {
      const a = isObject(first) ? first : {}
      const b = isObject(second) ? second : {}
      const ax = finiteNumber(a.x, 0)
      const ay = finiteNumber(a.y, 0)
      const bx = finiteNumber(b.x, 0)
      const by = finiteNumber(b.y, 0)
      return rectOf(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
    }

    /** True when two rects overlap (touching edges count as an intersection). */
    function rectsIntersect(first, second) {
      if (!isObject(first) || !isObject(second)) return false
      const ax = finiteNumber(first.x, 0)
      const ay = finiteNumber(first.y, 0)
      const aw = Math.max(0, finiteNumber(first.width, 0))
      const ah = Math.max(0, finiteNumber(first.height, 0))
      const bx = finiteNumber(second.x, 0)
      const by = finiteNumber(second.y, 0)
      const bw = Math.max(0, finiteNumber(second.width, 0))
      const bh = Math.max(0, finiteNumber(second.height, 0))
      return ax <= bx + bw && bx <= ax + aw && ay <= by + bh && by <= ay + ah
    }

    /** True when `outer` fully contains `inner` (used by marquee container-vs-children rules). */
    function rectContainsRect(outer, inner) {
      if (!isObject(outer) || !isObject(inner)) return false
      const ox = finiteNumber(outer.x, 0)
      const oy = finiteNumber(outer.y, 0)
      const ow = Math.max(0, finiteNumber(outer.width, 0))
      const oh = Math.max(0, finiteNumber(outer.height, 0))
      const ix = finiteNumber(inner.x, 0)
      const iy = finiteNumber(inner.y, 0)
      const iw = Math.max(0, finiteNumber(inner.width, 0))
      const ih = Math.max(0, finiteNumber(inner.height, 0))
      return ix >= ox && iy >= oy && ix + iw <= ox + ow && iy + ih <= oy + oh
    }

    function rectContainsPoint(rect, point) {
      if (!isObject(rect) || !isObject(point)) return false
      const x = finiteNumber(point.x, 0)
      const y = finiteNumber(point.y, 0)
      return (
        x >= finiteNumber(rect.x, 0) &&
        x <= finiteNumber(rect.x, 0) + Math.max(0, finiteNumber(rect.width, 0)) &&
        y >= finiteNumber(rect.y, 0) &&
        y <= finiteNumber(rect.y, 0) + Math.max(0, finiteNumber(rect.height, 0))
      )
    }

    /** The three interesting positions of a box on one axis: start, center, end. */
    function boxAxisPoints(box, axis) {
      if (!isObject(box)) return []
      if (axis === 'y') {
        const top = finiteNumber(box.y, 0)
        const height = Math.max(0, finiteNumber(box.height, 0))
        return [top, top + height / 2, top + height]
      }
      const left = finiteNumber(box.x, 0)
      const width = Math.max(0, finiteNumber(box.width, 0))
      return [left, left + width / 2, left + width]
    }

    /** Snap lines (start/center/end) contributed by a list of static rects on one axis. */
    function axisSnapLines(rects, axis) {
      const lines = []
      const list = Array.isArray(rects) ? rects : []
      for (let index = 0; index < list.length; index += 1) {
        const points = boxAxisPoints(list[index], axis)
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          lines.push(roundTo(points[pointIndex], 2))
        }
      }
      return lines
    }

    /**
     * Snap a moving box to the nearest line on one axis.
     * Returns `{ delta, at }` — `delta` is the correction to add to the proposed offset so that
     * the closest box point lands exactly on the guide — or null when nothing is within
     * `threshold` canvas units.
     */
    function nearestSnap(box, axis, lines, threshold) {
      const limit = Math.max(0, finiteNumber(threshold, 0))
      if (!isObject(box) || !Array.isArray(lines) || lines.length === 0) return null
      const points = boxAxisPoints(box, axis)
      let best = null
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]
        if (!Number.isFinite(line)) continue
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          const distance = Math.abs(points[pointIndex] - line)
          if (distance > limit) continue
          if (best && distance >= best.distance) continue
          best = { delta: line - points[pointIndex], at: line, distance: distance }
        }
      }
      return best ? { delta: roundTo(best.delta, 2), at: best.at } : null
    }

    /**
     * Snap a drag preview. `movingBox` is the selection box at the proposed offset; `staticRects`
     * are sibling boxes; `frameRect` is the artboard/parent box (its edges and center also snap).
     * Returns `{ dx, dy, guides }` where guides are `[{ axis: 'x'|'y', at }]` in artboard-local
     * canvas units, ready for the renderer to draw as full-length lines.
     */
    function snapMovingBox(movingBox, staticRects, frameRect, dx, dy, threshold) {
      const shiftX = finiteNumber(dx, 0)
      const shiftY = finiteNumber(dy, 0)
      if (!isObject(movingBox)) return { dx: shiftX, dy: shiftY, guides: [] }
      const statics = Array.isArray(staticRects) ? staticRects.slice() : []
      if (isObject(frameRect)) statics.push(frameRect)
      const proposed = rectOf(
        movingBox.x + shiftX,
        movingBox.y + shiftY,
        movingBox.width,
        movingBox.height,
      )
      const xSnap = nearestSnap(proposed, 'x', axisSnapLines(statics, 'x'), threshold)
      const ySnap = nearestSnap(proposed, 'y', axisSnapLines(statics, 'y'), threshold)
      const guides = []
      let nextX = shiftX
      let nextY = shiftY
      if (xSnap) {
        nextX = shiftX + xSnap.delta
        guides.push({ axis: 'x', at: xSnap.at })
      }
      if (ySnap) {
        nextY = shiftY + ySnap.delta
        guides.push({ axis: 'y', at: ySnap.at })
      }
      return { dx: roundTo(nextX, 2), dy: roundTo(nextY, 2), guides: guides }
    }

    function imageFileType(file) {
      if (!file || typeof file !== 'object') return ''
      const type = typeof file.type === 'string' ? file.type.toLowerCase() : ''
      if (IMAGE_TYPES.indexOf(type) >= 0) return type
      const name = typeof file.name === 'string' ? file.name.toLowerCase() : ''
      const dot = name.lastIndexOf('.')
      const extension = dot >= 0 ? name.slice(dot + 1) : ''
      if (extension === 'png') return 'image/png'
      if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
      if (extension === 'webp') return 'image/webp'
      if (extension === 'gif') return 'image/gif'
      if (extension === 'svg') return 'image/svg+xml'
      return ''
    }

    function readFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof FileReader !== 'function') {
            reject(new Error('FileReader is unavailable'))
            return
          }
          const reader = new FileReader()
          let settled = false
          reader.onload = function () {
            if (settled) return
            settled = true
            const result = reader.result
            if (typeof result === 'string' && result.indexOf('data:') === 0) resolve(result)
            else reject(new Error('image file produced no data URL'))
          }
          reader.onerror = function () {
            if (settled) return
            settled = true
            reject(reader.error || new Error('image file could not be read'))
          }
          reader.readAsDataURL(file)
        } catch (error) {
          reject(error)
        }
      })
    }

    /** Natural pixel size of a data: URL; resolves 0×0 when the browser cannot decode it. */
    function measureImageSize(dataUrl) {
      return new Promise(function (resolve) {
        try {
          const ImageCtor =
            typeof window !== 'undefined' && typeof window.Image === 'function' ? window.Image : null
          if (!ImageCtor) {
            resolve({ width: 0, height: 0 })
            return
          }
          const image = new ImageCtor()
          let settled = false
          function finish(width, height) {
            if (settled) return
            settled = true
            image.onload = null
            image.onerror = null
            resolve({ width: width, height: height })
          }
          image.onload = function () {
            finish(finiteNumber(image.naturalWidth, 0), finiteNumber(image.naturalHeight, 0))
          }
          image.onerror = function () {
            finish(0, 0)
          }
          image.src = dataUrl
        } catch (error) {
          resolve({ width: 0, height: 0 })
        }
      })
    }

    /**
     * Deepest group/frame under an artboard-local canvas point, so an image dropped on a group
     * lands inside that group instead of on the artboard behind it. Returns
     * `{ node, localPoint }` (localPoint relative to the container's top-left) or null.
     */
    function imageDropContainerAt(tree, artboardId, point) {
      if (!tree || !Array.isArray(tree.artboards) || !isObject(point)) return null
      const entry = tree.artboards.find(function (item) {
        return item && item.artboard && item.artboard.id === artboardId
      })
      if (!entry) return null
      function visit(nodes) {
        const list = Array.isArray(nodes) ? nodes : []
        // Front-to-back: later siblings paint on top, so visit the last child first.
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const node = list[index]
          if (!node || !node.layer) continue
          const rect = node.worldRect
          if (!rectContainsPoint(rect, point)) continue
          if (!isContainerLayer(node.layer)) continue
          // Frames and groups are containers: the innermost one under the pointer wins, so an
          // image dropped over a group's children still lands in the group.
          const deeper = visit(node.children)
          if (deeper) return deeper
          return {
            node: node,
            localPoint: {
              x: finiteNumber(point.x, 0) - finiteNumber(rect.x, 0),
              y: finiteNumber(point.y, 0) - finiteNumber(rect.y, 0),
            },
          }
        }
        return null
      }
      return visit(entry.layers)
    }

    /* ------------------------------------------------------------------------------------------
     * Frames, CSS-like flex layout and the computed render tree
     *
     * The Host only stores authored geometry; the Client is the single source of truth for
     * rendered positions. `computeFrameChildBoxes` is the pure flex engine (row/column, gap,
     * padding, grow, justify, align/alignSelf, wrap) returning child boxes relative to the
     * frame's top-left. `buildComputedTree` walks the whole document once per version and
     * produces nodes with world rects used by the renderer, selection overlay, pins and the
     * comment composer. The layer tree and the inspector reuse the same nodes.
     * ---------------------------------------------------------------------------------------- */

    /* ------------------------------------------------------------------------------------------
     * Layout v2 vocabulary
     *
     * The Host validates the same lists (host/model.js) and stores a complete layout object, but
     * the renderer stays defensive: documents can be hand-edited or older than the client, so
     * every value is re-validated here. A v1 document (no alignContent / rowGap / columnGap)
     * keeps rendering exactly as it did before these fields existed.
     * ---------------------------------------------------------------------------------------- */

    const LAYOUT_JUSTIFY_VALUES = [
      'start',
      'center',
      'end',
      'space-between',
      'space-around',
      'space-evenly',
    ]
    const LAYOUT_ALIGN_CONTENT_VALUES = [
      'start',
      'center',
      'end',
      'stretch',
      'space-between',
      'space-around',
    ]
    const LINE_ORIENTATION_VALUES = ['horizontal', 'vertical', 'diagonal']
    const LINE_DEFAULT_STROKE = '#94a3b8'
    const LINE_DEFAULT_STROKE_WIDTH = 2
    const LINE_MIN_STROKE_WIDTH = 0.5
    const LINE_MAX_STROKE_WIDTH = 64
    // Arrow heads are proportional to `strokeWidth`; the exporter (43-export-code.js) uses the
    // same ratios so "exported SVG == canvas" holds.
    const LINE_ARROW_LENGTH_RATIO = 4.5
    const LINE_ARROW_HALF_WIDTH_RATIO = 2.25
    const LINE_DASH_ON_RATIO = 4
    const LINE_DASH_OFF_RATIO = 3
    const TEXT_WIDTH_CACHE_LIMIT = 800
    const TEXT_HEIGHT_CACHE_LIMIT = 400

    function defaultLayoutObject() {
      return {
        direction: 'row',
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        align: 'stretch',
        justify: 'start',
        wrap: false,
        alignContent: 'stretch',
      }
    }

    /**
     * Normalize a stored layout into a complete object (Host fills defaults; be defensive).
     * `rowGap`/`columnGap` are only present when authored, so a normalized object can be sent
     * straight back to the Host as a `layout` patch without inventing new properties.
     */
    function normalizeLayoutObject(layout) {
      if (!isObject(layout)) return null
      const base = defaultLayoutObject()
      const rawPadding = isObject(layout.padding) ? layout.padding : {}
      const padding = {}
      for (let index = 0; index < PADDING_SIDES.length; index += 1) {
        const side = PADDING_SIDES[index]
        padding[side] = Math.max(0, finiteNumber(rawPadding[side], 0))
      }
      const normalized = {
        direction: LAYOUT_DIRECTIONS.indexOf(layout.direction) >= 0 ? layout.direction : base.direction,
        gap: Math.max(0, finiteNumber(layout.gap, base.gap)),
        padding: padding,
        align: LAYOUT_ALIGNS.indexOf(layout.align) >= 0 ? layout.align : base.align,
        justify: LAYOUT_JUSTIFY_VALUES.indexOf(layout.justify) >= 0 ? layout.justify : base.justify,
        wrap: layout.wrap === true,
        alignContent:
          LAYOUT_ALIGN_CONTENT_VALUES.indexOf(layout.alignContent) >= 0
            ? layout.alignContent
            : base.alignContent,
      }
      if (typeof layout.rowGap === 'number' && Number.isFinite(layout.rowGap) && layout.rowGap >= 0) {
        normalized.rowGap = layout.rowGap
      }
      if (
        typeof layout.columnGap === 'number' &&
        Number.isFinite(layout.columnGap) &&
        layout.columnGap >= 0
      ) {
        normalized.columnGap = layout.columnGap
      }
      return normalized
    }

    /**
     * Resolved gap between two wrapped/adjacent items on an axis. `rowGap` overrides the
     * vertical gap and `columnGap` the horizontal one, each falling back to `gap`.
     */
    function resolveLayoutGap(layout, axis) {
      if (!isObject(layout)) return 0
      const explicit =
        axis === 'row'
          ? typeof layout.rowGap === 'number'
            ? layout.rowGap
            : null
          : typeof layout.columnGap === 'number'
            ? layout.columnGap
            : null
      if (explicit !== null && Number.isFinite(explicit) && explicit >= 0) return explicit
      return Math.max(0, finiteNumber(layout.gap, 0))
    }

    /** Main/cross gaps for a direction: rows accumulate horizontally, columns vertically. */
    function layoutAxisGaps(layout) {
      const isRow = layout.direction !== 'column'
      return {
        main: isRow ? resolveLayoutGap(layout, 'column') : resolveLayoutGap(layout, 'row'),
        cross: isRow ? resolveLayoutGap(layout, 'row') : resolveLayoutGap(layout, 'column'),
      }
    }

    function paddingSummary(padding) {
      const pad = isObject(padding) ? padding : {}
      const values = [
        roundTo(finiteNumber(pad.top, 0), 2),
        roundTo(finiteNumber(pad.right, 0), 2),
        roundTo(finiteNumber(pad.bottom, 0), 2),
        roundTo(finiteNumber(pad.left, 0), 2),
      ]
      const same =
        values[0] === values[1] && values[1] === values[2] && values[2] === values[3]
      return same ? String(values[0]) : values.join('/')
    }

    function layoutSummaryText(layout) {
      const normalized = normalizeLayoutObject(layout)
      if (!normalized) return 'absolute'
      const gaps = layoutAxisGaps(normalized)
      const gapText =
        normalized.rowGap === undefined && normalized.columnGap === undefined
          ? ' gap=' + roundTo(normalized.gap, 2)
          : ' gap=' + roundTo(gaps.main, 2) + '/' + roundTo(gaps.cross, 2)
      return (
        'layout=' +
        normalized.direction +
        gapText +
        ' pad=' +
        paddingSummary(normalized.padding) +
        ' align=' +
        normalized.align +
        ' justify=' +
        normalized.justify +
        (normalized.wrap ? ' wrap' : '') +
        (normalized.wrap && normalized.alignContent !== 'stretch'
          ? ' alignContent=' + normalized.alignContent
          : '')
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Box sizing v2: hug + min/max clamping + text measurement
     *
     * Every layer's rendered box goes through `layerEffectiveSize`, so hugging and clamping apply
     * uniformly to top-level layers, auto-layout children (the flex engine calls it for its base
     * sizes), text, images, frames and groups. The result is memoized per layer object: the doc
     * is replaced wholesale on every version bump, so a new object identity is a new measurement.
     * ---------------------------------------------------------------------------------------- */

    const LAYER_SIZE_CACHE = new WeakMap()
    const TEXT_MEASURE = {
      context: null,
      node: null,
      widthCache: new Map(),
      heightCache: new Map(),
    }

    /** Unset min/max are `0` (no constraint); the caller clamps a rendered box to `>= 1`. */
    function layerBoxBounds(layer) {
      return {
        minWidth: Math.max(0, finiteNumber(layer.minWidth, 0)),
        minHeight: Math.max(0, finiteNumber(layer.minHeight, 0)),
        maxWidth: Math.max(0, finiteNumber(layer.maxWidth, 0)),
        maxHeight: Math.max(0, finiteNumber(layer.maxHeight, 0)),
      }
    }

    /** Clamp a rendered box dimension: at least 1px, then min/max when authored. */
    function clampBoxValue(value, minimum, maximum) {
      let out = Math.max(1, finiteNumber(value, 1))
      const min = finiteNumber(minimum, 0)
      if (min > 0) out = Math.max(out, min)
      const max = finiteNumber(maximum, 0)
      if (max > 0) out = Math.min(out, max)
      return Math.max(1, out)
    }

    function resolvedTextLineHeight(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      // A value <= 4 is a CSS-like multiplier (1.4), above that it is an absolute px height.
      if (lineHeight > 4) return lineHeight
      return Math.max(1, lineHeight * fontSize)
    }

    function textDisplayValue(layer) {
      const raw = typeof layer.text === 'string' ? layer.text : ''
      if (layer.textTransform === 'uppercase') return raw.toUpperCase()
      if (layer.textTransform === 'lowercase') return raw.toLowerCase()
      return raw
    }

    function textFontString(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const weight = Math.round(finiteNumber(layer.fontWeight, 400))
      return String(weight) + ' ' + fontSize + 'px ' + (layer.fontFamily || DEFAULT_FONT)
    }

    function textMetricsContext() {
      if (TEXT_MEASURE.context) return TEXT_MEASURE.context
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const context = canvas.getContext('2d')
        if (!context) return null
        TEXT_MEASURE.context = context
        return context
      } catch (error) {
        return null
      }
    }

    function cachePut(cache, key, value, limit) {
      cache.set(key, value)
      if (cache.size > limit) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return value
    }

    /**
     * Single-line width of a text layer in authored px, with letter spacing applied the way CSS
     * does it (after every glyph, including the last one). Memoized per (text, font, spacing).
     */
    function measuredTextWidth(text, layer) {
      const value = String(text || '')
      if (!value) return 0
      const font = textFontString(layer)
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      const key = font + '|' + letterSpacing + '|' + value
      const cached = TEXT_MEASURE.widthCache.get(key)
      if (cached !== undefined) return cached
      const context = textMetricsContext()
      let width = 0
      if (context) {
        try {
          context.font = font
          width = context.measureText(value).width
        } catch (error) {
          width = 0
        }
      }
      if (!(width > 0)) {
        // No canvas (or an unparseable font): a conservative average advance keeps hug sizing
        // sane instead of collapsing to zero.
        width = value.length * Math.max(1, finiteNumber(layer.fontSize, 16)) * 0.55
      }
      width += letterSpacing * value.length
      return cachePut(TEXT_MEASURE.widthCache, key, width, TEXT_WIDTH_CACHE_LIMIT)
    }

    function textMeasureNode() {
      if (TEXT_MEASURE.node) return TEXT_MEASURE.node
      if (typeof document === 'undefined' || !document.body) return null
      try {
        const node = document.createElement('div')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('data-dc-measure', '1')
        node.style.position = 'fixed'
        node.style.left = '-10000px'
        node.style.top = '0'
        node.style.visibility = 'hidden'
        node.style.pointerEvents = 'none'
        node.style.boxSizing = 'border-box'
        node.style.margin = '0'
        node.style.padding = '0'
        node.style.overflow = 'hidden'
        // Mirror `.dc-layer-text` exactly so wrapping matches the real layer.
        node.style.whiteSpace = 'pre-wrap'
        node.style.wordBreak = 'break-word'
        document.body.appendChild(node)
        TEXT_MEASURE.node = node
        return node
      } catch (error) {
        return null
      }
    }

    /**
     * Rendered height of a text layer wrapped at `width`, measured in an off-screen DOM node so
     * it matches the browser's real line breaking (canvas `measureText` cannot wrap). Falls back
     * to an estimate when no document is available. Memoized per (text, font, width).
     */
    function measuredTextHeight(layer, width) {
      const value = textDisplayValue(layer)
      const boxWidth = Math.max(1, finiteNumber(width, 1))
      const font = textFontString(layer)
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      const lineHeight = resolvedTextLineHeight(layer)
      const key = font + '|' + letterSpacing + '|' + boxWidth + '|' + lineHeight + '|' + value
      const cached = TEXT_MEASURE.heightCache.get(key)
      if (cached !== undefined) return cached
      let height = 0
      const node = textMeasureNode()
      if (!value) {
        height = lineHeight
      } else if (node) {
        try {
          node.style.width = boxWidth + 'px'
          node.style.font = font
          node.style.letterSpacing = letterSpacing + 'px'
          node.style.lineHeight = lineHeight + 'px'
          node.textContent = value
          height = node.offsetHeight
        } catch (error) {
          height = 0
        }
      }
      if (!(height > 0)) {
        // Estimate: greedy word wrap using the measured single-line width.
        const single = measuredTextWidth(value, layer)
        const lines = Math.max(1, Math.ceil(single / Math.max(1, boxWidth)))
        height = lines * lineHeight
      }
      return cachePut(TEXT_MEASURE.heightCache, key, height, TEXT_HEIGHT_CACHE_LIMIT)
    }

    /**
     * Intrinsic content size of a layer, used by `hugWidth`/`hugHeight`:
     *   text            -> measured glyph box (one line for width, wrapped height for height)
     *   frame + layout  -> children sum on the main axis, tallest child on the cross axis + padding
     *   frame / group   -> union box of the children (absolute positioning) + padding
     * Anything else has no content and returns null (hug keeps the authored size).
     */
    function layerContentSize(layer, depth) {
      if (!isObject(layer)) return null
      const level = finiteNumber(depth, 0)
      if (level > FRAME_MAX_DEPTH + 1) return null
      if (layer.type === 'text') {
        const text = textDisplayValue(layer)
        const lineHeight = resolvedTextLineHeight(layer)
        const width = Math.ceil(measuredTextWidth(text, layer))
        const wrapWidth = layer.hugWidth === true ? Math.max(1, width) : Math.max(1, finiteNumber(layer.width, width))
        return {
          width: Math.max(1, width),
          height: Math.max(lineHeight, measuredTextHeight(layer, wrapWidth) || lineHeight),
        }
      }
      if (!isContainerLayer(layer)) return null
      const children = childrenOf(layer)
      const layout = layer.type === 'frame' ? normalizeLayoutObject(layer.layout) : null
      if (layout) {
        const padX = layout.padding.left + layout.padding.right
        const padY = layout.padding.top + layout.padding.bottom
        const gaps = layoutAxisGaps(layout)
        const isRow = layout.direction === 'row'
        let main = 0
        let cross = 0
        let count = 0
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index]
          if (!isObject(child) || child.visible === false) continue
          const size = layerEffectiveSize(child, level + 1)
          const childMain = isRow ? size.width : size.height
          const childCross = isRow ? size.height : size.width
          main += (count > 0 ? gaps.main : 0) + childMain
          if (childCross > cross) cross = childCross
          count += 1
        }
        return { width: main + padX, height: cross + padY }
      }
      // Absolute container (frame without layout, or a group): the union box of the children
      // (which `layer.group` guarantees starts at the origin).
      const padding = isObject(layer.padding) ? layer.padding : null
      const padX = padding
        ? Math.max(0, finiteNumber(padding.left, 0)) + Math.max(0, finiteNumber(padding.right, 0))
        : 0
      const padY = padding
        ? Math.max(0, finiteNumber(padding.top, 0)) + Math.max(0, finiteNumber(padding.bottom, 0))
        : 0
      let maxX = 0
      let maxY = 0
      let minX = 0
      let minY = 0
      let any = false
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (!isObject(child) || child.visible === false) continue
        const size = layerEffectiveSize(child, level + 1)
        const x = finiteNumber(child.x, 0)
        const y = finiteNumber(child.y, 0)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x + size.width > maxX) maxX = x + size.width
        if (y + size.height > maxY) maxY = y + size.height
        any = true
      }
      if (!any) return null
      return {
        width: Math.max(1, maxX - minX + padX),
        height: Math.max(1, maxY - minY + padY),
      }
    }

    /**
     * Final rendered box of a layer before its parent places it: hug sizing first, then the
     * min/max clamp (spec: "the clamp applies after hug sizing").
     */
    function layerEffectiveSize(layer, depth) {
      if (!isObject(layer)) return { width: 1, height: 1 }
      const cached = LAYER_SIZE_CACHE.get(layer)
      if (cached) return cached
      const bounds = layerBoxBounds(layer)
      let width = Math.max(1, finiteNumber(layer.width, 1))
      let height = Math.max(1, finiteNumber(layer.height, 1))
      if (layer.hugWidth === true || layer.hugHeight === true) {
        const content = layerContentSize(layer, depth)
        if (content) {
          if (layer.hugWidth === true) width = content.width
          if (layer.hugHeight === true) height = content.height
        }
      }
      const size = {
        width: clampBoxValue(width, bounds.minWidth, bounds.maxWidth),
        height: clampBoxValue(height, bounds.minHeight, bounds.maxHeight),
      }
      LAYER_SIZE_CACHE.set(layer, size)
      return size
    }

    /**
     * Pure CSS-like flex engine. Returns a Map from the authored child layer object to
     * `{ x, y, width, height }` relative to the frame's top-left (padding included), or null
     * when the frame is in absolute mode.
     */
    function computeFrameChildBoxes(layoutValue, frameWidthValue, frameHeightValue, children) {
      const layout = normalizeLayoutObject(layoutValue)
      if (!layout) return null
      const frameWidth = Math.max(1, finiteNumber(frameWidthValue, 1))
      const frameHeight = Math.max(1, finiteNumber(frameHeightValue, 1))
      const pad = layout.padding
      const contentWidth = Math.max(1, frameWidth - pad.left - pad.right)
      const contentHeight = Math.max(1, frameHeight - pad.top - pad.bottom)
      const isRow = layout.direction === 'row'
      const contentMain = isRow ? contentWidth : contentHeight
      const contentCross = isRow ? contentHeight : contentWidth
      const gaps = layoutAxisGaps(layout)
      const mainGap = gaps.main
      const crossGap = gaps.cross

      const items = []
      const list = Array.isArray(children) ? children : []
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        // Hidden layers behave like display:none: they neither render nor take layout space.
        if (!isObject(layer) || layer.visible === false) continue
        // Hug sizing and min/max clamping apply to auto-layout children too.
        const size = layerEffectiveSize(layer, 1)
        const baseWidth = size.width
        const baseHeight = size.height
        const bounds = layerBoxBounds(layer)
        items.push({
          layer: layer,
          bounds: bounds,
          baseMain: isRow ? baseWidth : baseHeight,
          baseCross: isRow ? baseHeight : baseWidth,
          main: isRow ? baseWidth : baseHeight,
          grow: layer.grow === true,
        })
      }

      // Split the children into flex lines (runs) when wrapping is enabled.
      const runs = []
      let run = null
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (layout.wrap && run && run.items.length > 0) {
          const needed = run.usedMain + mainGap + item.baseMain
          if (needed > contentMain) {
            runs.push(run)
            run = null
          }
        }
        if (!run) run = { items: [], usedMain: 0 }
        if (run.items.length > 0) run.usedMain += mainGap
        run.usedMain += item.baseMain
        run.items.push(item)
      }
      if (run && run.items.length > 0) runs.push(run)
      const boxes = new Map()
      if (runs.length === 0) return boxes

      // A single line fills the container's cross axis (CSS single-line flexbox behaviour, where
      // align-content has no effect); wrapped lines keep their own cross size (tallest child).
      const singleLine = runs.length === 1

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        const count = current.items.length
        const gapTotal = mainGap * Math.max(0, count - 1)
        const fixedMain = current.items.reduce(function (sum, item) {
          return sum + item.baseMain
        }, 0)
        const free = Math.max(0, contentMain - fixedMain - gapTotal)
        const growItems = current.items.filter(function (item) {
          return item.grow
        })
        if (growItems.length > 0 && free > 0) {
          // Boolean `grow` behaves like flex-grow: 1 — free main-axis space is shared equally.
          const share = free / growItems.length
          for (let growIndex = 0; growIndex < growItems.length; growIndex += 1) {
            const item = growItems[growIndex]
            const grown = item.baseMain + share
            item.main = isRow
              ? clampBoxValue(grown, item.bounds.minWidth, item.bounds.maxWidth)
              : clampBoxValue(grown, item.bounds.minHeight, item.bounds.maxHeight)
          }
        }
        current.usedMain =
          current.items.reduce(function (sum, item) {
            return sum + item.main
          }, 0) + gapTotal
        const leftover = Math.max(0, contentMain - current.usedMain)
        // Justify distributes the leftover space on the main axis: `extraGap` is added after
        // every item, `startOffset` shifts the whole run.
        let startOffset = 0
        let extraGap = 0
        if (layout.justify === 'center') {
          startOffset = leftover / 2
        } else if (layout.justify === 'end') {
          startOffset = leftover
        } else if (layout.justify === 'space-between' && count > 1) {
          extraGap = leftover / (count - 1)
        } else if (layout.justify === 'space-around') {
          extraGap = leftover / count
          startOffset = extraGap / 2
        } else if (layout.justify === 'space-evenly') {
          extraGap = leftover / (count + 1)
          startOffset = extraGap
        }
        current.startOffset = startOffset
        current.extraGap = extraGap
        let tallest = 0
        for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
          tallest = Math.max(tallest, current.items[itemIndex].baseCross)
        }
        current.crossSize = singleLine ? contentCross : Math.max(1, tallest)
      }

      // Wrapped runs sit on the cross axis according to `alignContent`; a single run always
      // fills the container (v1 behaviour, and CSS single-line flexbox).
      let runStart = 0
      let runExtraGap = 0
      if (!singleLine) {
        const totalCross =
          runs.reduce(function (sum, current) {
            return sum + current.crossSize
          }, 0) +
          crossGap * (runs.length - 1)
        const crossLeftover = contentCross - totalCross
        if (layout.alignContent === 'center') {
          runStart = crossLeftover / 2
        } else if (layout.alignContent === 'end') {
          runStart = crossLeftover
        } else if (layout.alignContent === 'space-between' && runs.length > 1) {
          runExtraGap = crossLeftover / (runs.length - 1)
        } else if (layout.alignContent === 'space-around') {
          runExtraGap = crossLeftover / runs.length
          runStart = runExtraGap / 2
        } else if (layout.alignContent === 'stretch' && crossLeftover > 0) {
          // Stretch: grow every line equally so the lines fill the container.
          const share = crossLeftover / runs.length
          for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
            runs[runIndex].crossSize += share
          }
        }
      }

      let crossCursor = runStart
      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        let mainCursor = current.startOffset
        for (let itemIndex = 0; itemIndex < current.items.length; itemIndex += 1) {
          const item = current.items[itemIndex]
          const alignSelfRaw = item.layer.alignSelf
          const crossAlign =
            LAYOUT_ALIGNS.indexOf(alignSelfRaw) >= 0 ? alignSelfRaw : layout.align
          let crossSize = crossAlign === 'stretch' ? current.crossSize : item.baseCross
          // Stretch/grow can push a child past its authored min/max.
          crossSize = isRow
            ? clampBoxValue(crossSize, item.bounds.minHeight, item.bounds.maxHeight)
            : clampBoxValue(crossSize, item.bounds.minWidth, item.bounds.maxWidth)
          let crossOffset = 0
          if (crossAlign === 'center') crossOffset = (current.crossSize - crossSize) / 2
          else if (crossAlign === 'end') crossOffset = current.crossSize - crossSize
          boxes.set(item.layer, {
            x: isRow ? pad.left + mainCursor : pad.left + crossCursor + crossOffset,
            y: isRow ? pad.top + crossCursor + crossOffset : pad.top + mainCursor,
            width: isRow ? item.main : crossSize,
            height: isRow ? crossSize : item.main,
          })
          mainCursor += item.main + mainGap + current.extraGap
        }
        crossCursor += current.crossSize + crossGap + runExtraGap
      }
      return boxes
    }

    /**
     * One immutable snapshot of the rendered document:
     *   { artboards: [{ artboard, layers: nodes }], byId: Map<layerId, node>, allNodes: node[] }
     * A node is { id, layer, type, artboard, parent, parentId, index, depth, x, y, width,
     * height, worldRect, autoParent, locked, children }. x/y are relative to the parent
     * (computed for auto-layout children); worldRect is relative to the artboard's top-left and
     * always stays in *authored* canvas units — the camera zoom is applied when styling, never
     * here, so hit-testing, drag math and every other consumer keep working in canvas units.
     */
    function buildComputedTree(doc) {
      const byId = new Map()
      const allNodes = []
      const artboards = []

      function buildList(list, context) {
        const nodes = []
        const layers = Array.isArray(list) ? list : []
        // Defensive cap: the Host enforces the depth limit, but never recurse forever
        // on a hand-edited/corrupt document.
        if (context.depth > FRAME_MAX_DEPTH + 1) return nodes
        for (let index = 0; index < layers.length; index += 1) {
          const layer = layers[index]
          if (!isObject(layer)) continue
          const box = context.parentAuto && context.boxes ? context.boxes.get(layer) || null : null
          const effective = layerEffectiveSize(layer, context.depth)
          const offsetX = box ? finiteNumber(box.x, 0) : finiteNumber(layer.x, 0)
          const offsetY = box ? finiteNumber(box.y, 0) : finiteNumber(layer.y, 0)
          // Auto-layout boxes already carry the clamped size; absolute layers use the
          // hug/clamp result from `layerEffectiveSize`.
          const width = box
            ? clampBoxValue(box.width, 0, 0)
            : effective.width
          const height = box
            ? clampBoxValue(box.height, 0, 0)
            : effective.height
          const worldRect = {
            x: context.parentX + offsetX,
            y: context.parentY + offsetY,
            width: width,
            height: height,
          }
          const node = {
            id: layer.id,
            layer: layer,
            type: layer.type,
            artboard: context.artboard,
            parent: context.parent,
            parentId: context.parent ? context.parent.id : null,
            index: index,
            depth: context.depth,
            x: offsetX,
            y: offsetY,
            width: width,
            height: height,
            worldRect: worldRect,
            autoParent: !!context.parentAuto,
            locked: layer.locked === true,
            children: null,
          }
          byId.set(node.id, node)
          allNodes.push(node)
          if (isContainerLayer(layer)) {
            // A group is always absolute; only a frame can own an auto-layout object.
            const layout = layer.type === 'frame' ? normalizeLayoutObject(layer.layout) : null
            let boxes = null
            if (layout) {
              boxes = computeFrameChildBoxes(layer.layout, width, height, childrenOf(layer))
            }
            node.children = buildList(childrenOf(layer), {
              artboard: context.artboard,
              parent: node,
              parentX: worldRect.x,
              parentY: worldRect.y,
              parentAuto: !!layout,
              depth: context.depth + 1,
              boxes: boxes,
            })
          }
          nodes.push(node)
        }
        return nodes
      }

      const boards = artboardsOf(doc)
      for (let index = 0; index < boards.length; index += 1) {
        const artboard = boards[index]
        if (!isObject(artboard)) continue
        artboards.push({
          artboard: artboard,
          layers: buildList(layersOf(artboard), {
            artboard: artboard,
            parent: null,
            parentX: 0,
            parentY: 0,
            parentAuto: false,
            depth: 1,
            boxes: null,
          }),
        })
      }
      return { artboards: artboards, byId: byId, allNodes: allNodes }
    }

    /* ------------------------------------------------------------------------------------------
     * Geometry helpers shared with the renderer
     * ---------------------------------------------------------------------------------------- */

    /** Normalized line props: the model stores them, but a hand-edited doc may omit any. */
    function lineLayerGeometry(layer, widthValue, heightValue) {
      const width = Math.max(1, finiteNumber(widthValue, 1))
      const height = Math.max(1, finiteNumber(heightValue, 1))
      const strokeWidth = clamp(
        finiteNumber(layer.strokeWidth, LINE_DEFAULT_STROKE_WIDTH),
        LINE_MIN_STROKE_WIDTH,
        LINE_MAX_STROKE_WIDTH,
      )
      const orientation =
        LINE_ORIENTATION_VALUES.indexOf(layer.orientation) >= 0 ? layer.orientation : 'horizontal'
      let x1 = 0
      let y1 = height / 2
      let x2 = width
      let y2 = height / 2
      if (orientation === 'vertical') {
        x1 = width / 2
        y1 = 0
        x2 = width / 2
        y2 = height
      } else if (orientation === 'diagonal') {
        x1 = 0
        y1 = 0
        x2 = width
        y2 = height
      }
      return {
        orientation: orientation,
        width: width,
        height: height,
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        stroke: typeof layer.stroke === 'string' && layer.stroke ? layer.stroke : LINE_DEFAULT_STROKE,
        strokeWidth: strokeWidth,
        dashed: layer.dashed === true,
        arrowStart: layer.arrowStart === true,
        arrowEnd: layer.arrowEnd === true,
      }
    }

    /** Arrow head triangle (tip, left corner, right corner) for a line endpoint. */
    function lineArrowPoints(geometry, atEnd) {
      const dx = geometry.x2 - geometry.x1
      const dy = geometry.y2 - geometry.y1
      const length = Math.sqrt(dx * dx + dy * dy)
      if (!(length > 0)) return null
      const ux = dx / length
      const uy = dy / length
      const headLength = Math.max(2, geometry.strokeWidth * LINE_ARROW_LENGTH_RATIO)
      const headHalf = Math.max(1, geometry.strokeWidth * LINE_ARROW_HALF_WIDTH_RATIO)
      // The end arrow points along the path, the start arrow points back at the start point.
      const tipX = atEnd ? geometry.x2 : geometry.x1
      const tipY = atEnd ? geometry.y2 : geometry.y1
      const dirX = atEnd ? ux : -ux
      const dirY = atEnd ? uy : -uy
      const baseX = tipX - dirX * headLength
      const baseY = tipY - dirY * headLength
      // Perpendicular of the direction, scaled to the head half width.
      const nx = -dirY
      const ny = dirX
      return (
        tipX +
        ',' +
        tipY +
        ' ' +
        (baseX + nx * headHalf) +
        ',' +
        (baseY + ny * headHalf) +
        ' ' +
        (baseX - nx * headHalf) +
        ',' +
        (baseY - ny * headHalf)
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Layer defaults
     * ---------------------------------------------------------------------------------------- */

    const LAYER_TYPE_LABELS = {
      // The value doubles as the Glyph name used by the layer tree and the inspector.
      rect: 'rect',
      ellipse: 'ellipse',
      text: 'text',
      image: 'image',
      frame: 'frame',
      line: 'minus',
      group: 'layers',
    }

    const BUTTON_PRESET = {
      label: 'Button',
      height: 44,
      width: 136,
      fontSize: 15,
      lineHeight: 20,
      fill: '#2563eb',
      color: '#ffffff',
      gap: 8,
      paddingY: 12,
      paddingX: 20,
      radius: 10,
    }

    function layerTypeLabel(type) {
      return LAYER_TYPE_LABELS[type] || String(type || 'layer')
    }

    function defaultGeometryFor(type, artboard) {
      const width = Math.max(200, finiteNumber(artboard && artboard.width, 1200))
      const height = Math.max(200, finiteNumber(artboard && artboard.height, 800))
      if (type === 'text') {
        return {
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.15),
          width: Math.min(360, Math.round(width * 0.6)),
          height: 48,
        }
      }
      if (type === 'image') {
        return {
          x: Math.round((width - 320) / 2),
          y: Math.round((height - 200) / 2),
          width: 320,
          height: 200,
        }
      }
      if (type === 'ellipse') {
        return {
          x: Math.round((width - 160) / 2),
          y: Math.round((height - 160) / 2),
          width: 160,
          height: 160,
        }
      }
      if (type === 'frame') {
        const frameWidth = Math.min(FRAME_DEFAULT_WIDTH, Math.max(160, Math.round(width * 0.5)))
        const frameHeight = Math.min(FRAME_DEFAULT_HEIGHT, Math.max(120, Math.round(height * 0.5)))
        return {
          x: Math.round((width - frameWidth) / 2),
          y: Math.round((height - frameHeight) / 2),
          width: frameWidth,
          height: frameHeight,
        }
      }
      if (type === 'line') {
        // A thin horizontal rule at ~40% height, wide enough to read at fit zoom.
        return {
          x: Math.round((width - 160) / 2),
          y: Math.round(height * 0.4),
          width: 160,
          height: 2,
        }
      }
      if (type === 'group') {
        return {
          x: Math.round((width - 240) / 2),
          y: Math.round((height - 160) / 2),
          width: 240,
          height: 160,
        }
      }
      return {
        x: Math.round((width - 240) / 2),
        y: Math.round((height - 160) / 2),
        width: 240,
        height: 160,
      }
    }

    function createLayer(type, container) {
      const box = isObject(container) ? container : {}
      const geometry = defaultGeometryFor(type, box)
      const siblings = childrenOf(box)
      const sameType = siblings.filter(function (layer) { return layer && layer.type === type }).length
      const base = {
        id: makeId('l'),
        type: type,
        name:
          type === 'rect'
            ? 'Rectangle'
            : type === 'ellipse'
              ? 'Ellipse'
              : type === 'text'
                ? 'Text'
                : type === 'image'
                  ? 'Image'
                  : type === 'frame'
                    ? 'Frame'
                    : type === 'line'
                      ? 'Line'
                      : type === 'group'
                        ? 'Group'
                        : 'Layer',
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }
      if (sameType > 0) base.name = base.name + ' ' + (sameType + 1)
      if (type === 'rect') {
        base.fill = '#e5e7eb'
        base.radius = 8
        base.borderWidth = 0
        base.borderColor = '#9ca3af'
      } else if (type === 'ellipse') {
        base.fill = '#dbeafe'
        base.borderWidth = 0
        base.borderColor = '#9ca3af'
      } else if (type === 'text') {
        base.text = 'New text'
        base.color = '#111827'
        base.fontSize = 24
        base.fontWeight = 600
        base.fontFamily = DEFAULT_FONT
        base.align = 'left'
        base.lineHeight = 32
      } else if (type === 'image') {
        base.src = ''
        base.fit = 'cover'
        base.radius = 0
      } else if (type === 'line') {
        base.stroke = '#111827'
        base.strokeWidth = 2
        base.orientation = 'horizontal'
      } else if (type === 'frame') {
        base.fill = '#f3f4f6'
        base.radius = 8
        base.borderWidth = 1
        base.borderColor = '#d1d5db'
        base.clip = false
        base.layout = null
        base.children = []
      } else if (type === 'group') {
        // Groups are normally created from a selection (`layer.group`); this only has to be a
        // structurally valid container when a caller asks for one directly.
        base.clip = false
        base.children = []
      }
      return base
    }

    /**
     * The two layers of the button preset: an auto-layout frame (row, gap 8, padding 12/20,
     * radius 10, brand fill) with a centred white label. The editor turns these into two
     * `layer.add` ops (a frame cannot be added with children in one op).
     */
    function createButtonPresetLayers(container) {
      const box = isObject(container) ? container : {}
      const width = Math.max(1, finiteNumber(box.width, 1200))
      const height = Math.max(1, finiteNumber(box.height, 800))
      const preset = BUTTON_PRESET
      const frame = createLayer('frame', box)
      frame.name = preset.label
      frame.width = preset.width
      frame.height = preset.height
      frame.x = Math.round((width - preset.width) / 2)
      frame.y = Math.round((height - preset.height) / 2)
      frame.fill = preset.fill
      frame.radius = preset.radius
      frame.borderWidth = 0
      frame.borderColor = preset.fill
      frame.clip = false
      frame.layout = {
        direction: 'row',
        gap: preset.gap,
        padding: {
          top: preset.paddingY,
          right: preset.paddingX,
          bottom: preset.paddingY,
          left: preset.paddingX,
        },
        align: 'center',
        justify: 'center',
        wrap: false,
      }
      const label = createLayer('text', frame)
      label.name = 'Button label'
      label.text = preset.label
      label.color = preset.color
      label.fontSize = preset.fontSize
      label.fontWeight = 600
      label.fontFamily = DEFAULT_FONT
      label.align = 'center'
      label.lineHeight = preset.lineHeight
      label.width = 56
      label.height = preset.lineHeight
      label.x = 0
      label.y = 0
      return { frame: frame, text: label }
    }

    function createArtboard(doc) {
      const existing = artboardsOf(doc)
      const base = existing.find(function (artboard) { return isObject(artboard) })
      return {
        id: makeId('ab'),
        name: 'Artboard ' + (existing.length + 1),
        x: 0,
        y: 0,
        width: finiteNumber(base && base.width, 1200),
        height: finiteNumber(base && base.height, 800),
        background: '#ffffff',
      }
    }

    /* ------------------------------------------------------------------------------------------
     * Frames / layout helpers continue in 28-layout.js; this part owns layer defaults only.
     * ---------------------------------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------
     * Chat message for comments (single and batch)
     *
     * ONE code path: `buildCommentMessage(details, strings)` normalises `details` to a list of
     * comment entries, renders one block per comment (comment id, artboard id/name/size, target
     * layer id/name/type, geometry, a compact type-relevant props excerpt and the comment text)
     * and appends one short instruction block. The opening line is fixed because the Host
     * system prompt matches on "Design canvas revision request".
     *
     * Message length is hard-capped (`COMMENT_MESSAGE_MAX_CHARS`): entries that do not fit are
     * dropped and their ids are listed in a truncation note so the model knows more is coming.
     * The batch cap (`COMMENT_BATCH_LIMIT`) is enforced by the sending UI, not here.
     * ---------------------------------------------------------------------------------------- */

    const COMMENT_MESSAGE_OPENING_LINE = 'Design canvas revision request — apply it now.'
    const COMMENT_MESSAGE_MAX_CHARS = 12000
    const COMMENT_BATCH_LIMIT = 20
    const COMMENT_ENTRY_TEXT_CHARS = 260
    const COMMENT_PROPS_MAX_CHARS = 460

    /** Collapse whitespace and clip a string, with an ellipsis when anything was dropped. */
    function commentTextExcerpt(value, limit) {
      const raw =
        typeof value === 'string'
          ? value
          : value === undefined || value === null
            ? ''
            : String(value)
      const trimmed = raw.replace(/\s+$/, '').replace(/^\s+/, '')
      if (!limit || trimmed.length <= limit) return trimmed
      return trimmed.slice(0, Math.max(0, limit - 1)).replace(/\s+$/, '') + '…'
    }

    /** A readable `key=value` token for the props excerpt (strings are quoted, quotes flattened). */
    function commentPropValue(value, limit) {
      if (typeof value === 'string') {
        // Double quotes inside a quoted value ("Segoe UI") would be escaped noise in a prompt.
        const flat = commentTextExcerpt(value, limit || 60).replace(/"/g, "'")
        return JSON.stringify(flat)
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return '?'
        return String(roundTo(value, 2))
      }
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      return JSON.stringify(commentTextExcerpt(String(value), limit || 60))
    }

    /** Artboard/board-relative rendered rect, when the caller could compute one. */
    function commentRectText(rect) {
      if (!isObject(rect)) return ''
      return (
        'x=' +
        Math.round(finiteNumber(rect.x, 0)) +
        ' y=' +
        Math.round(finiteNumber(rect.y, 0)) +
        ' width=' +
        Math.round(finiteNumber(rect.width, 0)) +
        ' height=' +
        Math.round(finiteNumber(rect.height, 0))
      )
    }

    /** Auto-layout summary without depending on the renderer's normalized layout object. */
    function commentLayoutExcerpt(layout) {
      if (!isObject(layout)) return 'absolute (children keep their own x/y)'
      const pad = isObject(layout.padding) ? layout.padding : {}
      const sides = ['top', 'right', 'bottom', 'left']
      const values = []
      for (let index = 0; index < sides.length; index += 1) {
        values.push(roundTo(finiteNumber(pad[sides[index]], 0), 2))
      }
      const uniform =
        values[0] === values[1] && values[1] === values[2] && values[2] === values[3]
      const padding = uniform ? String(values[0]) : values.join('/')
      return (
        'direction=' +
        (layout.direction === 'column' ? 'column' : 'row') +
        ' gap=' +
        roundTo(finiteNumber(layout.gap, 0), 2) +
        ' padding=' +
        padding +
        ' align=' +
        commentTextExcerpt(String(layout.align || 'stretch'), 20) +
        ' justify=' +
        commentTextExcerpt(String(layout.justify || 'start'), 20) +
        (layout.wrap === true ? ' wrap' : '')
      )
    }

    /**
     * Compact, type-relevant props summary for the chat message. Deliberately small: the agent
     * can call design_read for the whole document; this is only "what the comment is about".
     */
    function commentPropExcerpt(layer) {
      if (!isObject(layer)) return ''
      const parts = []
      function add(key, value, limit) {
        if (value === undefined || value === null || value === '') return
        parts.push(key + '=' + commentPropValue(value, limit))
      }
      const opacity = finiteNumber(layer.opacity, 1)
      if (opacity !== 1) add('opacity', opacity)
      if (layer.visible === false) parts.push('visible=false')
      if (layer.locked === true) parts.push('locked=true')
      const type = String(layer.type || '')
      if (type === 'text') {
        add('text', layer.text, COMMENT_ENTRY_TEXT_CHARS)
        add('fontSize', layer.fontSize)
        add('fontWeight', layer.fontWeight)
        add('fontFamily', layer.fontFamily, 40)
        add('align', layer.align)
        add('lineHeight', layer.lineHeight)
        add('letterSpacing', layer.letterSpacing)
        add('textTransform', layer.textTransform)
        add('color', layer.color, 60)
        add('fill', layer.fill, 80)
      } else if (type === 'rect' || type === 'ellipse') {
        add('fill', layer.fill, 120)
        add('radius', layer.radius)
        add('borderWidth', layer.borderWidth)
        add('borderColor', layer.borderColor, 60)
      } else if (type === 'image') {
        const src = typeof layer.src === 'string' ? layer.src : ''
        if (src.indexOf('data:') === 0) {
          parts.push('src=' + JSON.stringify(src.slice(0, 24)) + ' (data URL, ' + src.length + ' chars)')
        } else if (src) {
          add('src', src, 90)
        }
        add('fit', layer.fit)
        add('radius', layer.radius)
      } else if (type === 'line') {
        add('stroke', layer.stroke, 60)
        add('strokeWidth', layer.strokeWidth)
        add('orientation', layer.orientation)
        if (layer.dashed === true) parts.push('dashed=true')
        if (layer.arrowStart === true) parts.push('arrowStart=true')
        if (layer.arrowEnd === true) parts.push('arrowEnd=true')
      } else if (type === 'frame') {
        add('fill', layer.fill, 120)
        add('radius', layer.radius)
        add('borderWidth', layer.borderWidth)
        add('borderColor', layer.borderColor, 60)
        if (layer.clip === true) parts.push('clip=true')
        parts.push('layout: ' + commentLayoutExcerpt(layer.layout))
        const children = Array.isArray(layer.children) ? layer.children.length : 0
        parts.push('children=' + children)
      } else if (type === 'group') {
        if (layer.clip === true) parts.push('clip=true')
        const children = Array.isArray(layer.children) ? layer.children.length : 0
        parts.push('children=' + children)
      } else {
        add('fill', layer.fill, 120)
        add('borderWidth', layer.borderWidth)
        add('borderColor', layer.borderColor, 60)
      }
      if (typeof layer.shadow === 'string' && layer.shadow) add('shadow', layer.shadow, 80)
      if (typeof layer.minWidth === 'number') add('minWidth', layer.minWidth)
      if (typeof layer.minHeight === 'number') add('minHeight', layer.minHeight)
      if (typeof layer.maxWidth === 'number') add('maxWidth', layer.maxWidth)
      if (typeof layer.maxHeight === 'number') add('maxHeight', layer.maxHeight)
      if (layer.hugWidth === true) parts.push('hugWidth')
      if (layer.hugHeight === true) parts.push('hugHeight')
      if (layer.grow === true) parts.push('grow=true')
      if (typeof layer.alignSelf === 'string' && layer.alignSelf) add('alignSelf', layer.alignSelf)
      let text = parts.join(' ')
      if (text.length > COMMENT_PROPS_MAX_CHARS) {
        text = text.slice(0, COMMENT_PROPS_MAX_CHARS - 1).replace(/\s+$/, '') + '…'
      }
      return text
    }

    /** One entry per comment. Accepts a prepared entry, a comment record, or a v1 details object. */
    function commentEntryOf(input) {
      const source = isObject(input) ? input : {}
      const layer = isObject(source.layer) ? source.layer : null
      const artboard = isObject(source.artboard) ? source.artboard : null
      const commentId =
        typeof source.commentId === 'string' && source.commentId
          ? source.commentId
          : typeof source.id === 'string'
            ? source.id
            : ''
      return {
        commentId: commentId,
        text: typeof source.text === 'string' ? source.text : '',
        status: typeof source.status === 'string' && source.status ? source.status : 'open',
        author: typeof source.author === 'string' ? source.author : '',
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
        artboardId:
          typeof source.artboardId === 'string'
            ? source.artboardId
            : artboard && typeof artboard.id === 'string'
              ? artboard.id
              : '',
        layerId:
          typeof source.layerId === 'string'
            ? source.layerId
            : layer && typeof layer.id === 'string'
              ? layer.id
              : '',
        artboard: artboard,
        layer: layer,
        parentId: typeof source.parentId === 'string' ? source.parentId : '',
        renderedRect: isObject(source.renderedRect) ? source.renderedRect : null,
      }
    }

    /** `details` -> { boardPath, version, entries[] }; accepts one comment or a `comments` list. */
    function commentEntriesFrom(details) {
      const source = isObject(details) ? details : {}
      const list = Array.isArray(source.comments)
        ? source.comments
        : Array.isArray(source.entries)
          ? source.entries
          : [source]
      const entries = []
      for (let index = 0; index < list.length; index += 1) {
        const entry = commentEntryOf(list[index])
        if (!entry.commentId && !entry.text && !entry.layer && !entry.artboard) continue
        entries.push(entry)
      }
      return {
        boardPath: typeof source.boardPath === 'string' ? source.boardPath : '',
        version: source.version,
        note: typeof source.note === 'string' ? source.note : '',
        entries: entries,
      }
    }

    /** Lines for one comment block (ids, target, geometry, props excerpt, comment text). */
    function commentEntryLines(entry, position, total) {
      const lines = []
      lines.push(
        '--- Comment ' +
          String(position) +
          '/' +
          String(total) +
          (entry.commentId ? ' · ' + entry.commentId : '') +
          ' ---',
      )
      if (entry.commentId) {
        lines.push('Comment id: ' + entry.commentId + ' · status ' + entry.status)
      }
      const artboard = entry.artboard
      if (artboard) {
        lines.push(
          'Artboard: "' +
            (artboard.name || artboard.id) +
            '" (' +
            artboard.id +
            ') ' +
            Math.round(finiteNumber(artboard.width, 0)) +
            '×' +
            Math.round(finiteNumber(artboard.height, 0)),
        )
      } else if (entry.artboardId) {
        lines.push('Artboard: ' + entry.artboardId)
      }
      const layer = entry.layer
      if (layer) {
        lines.push(
          'Target layer: "' +
            (layer.name || layer.id) +
            '" (' +
            layer.id +
            ') type ' +
            String(layer.type || '?'),
        )
        lines.push(
          'Geometry: x=' +
            Math.round(finiteNumber(layer.x, 0)) +
            ' y=' +
            Math.round(finiteNumber(layer.y, 0)) +
            ' width=' +
            Math.round(finiteNumber(layer.width, 0)) +
            ' height=' +
            Math.round(finiteNumber(layer.height, 0)),
        )
        if (entry.parentId) lines.push('Parent frame: ' + entry.parentId)
        const rendered = commentRectText(entry.renderedRect)
        if (rendered) lines.push('Rendered rect (relative to artboard): ' + rendered)
        const props = commentPropExcerpt(layer)
        if (props) lines.push('Current props: ' + props)
      } else if (entry.layerId) {
        lines.push('Target layer: ' + entry.layerId + ' (no longer exists)')
      }
      lines.push('Comment: ' + (entry.text ? entry.text : '(empty)'))
      return lines
    }

    /** The instruction block appended to every revision request (single or batch). */
    function commentInstructionLines(count) {
      return [
        '',
        'How to handle this — decide and act, do not ask clarifying questions:',
        '1. Call design_read (include "summary") only when the ids, geometry or props above are not enough; skip it when they are.',
        '2. design_apply the minimal ops that satisfy each comment (prefer layer.update for styling; layer.add only for something new). Keep every change inside the comment\'s artboard and leave unrelated layers untouched.',
        '3. When a comment is handled, resolve it: design_apply [{ type: "comment.update", commentId: "<commentId>", status: "resolved" }] — one op per comment id, and only for what you actually changed.',
        '4. Reply with one short sentence per comment group (' +
          (count > 1 ? 'a batch may share one sentence' : 'one sentence') +
          '). Prefer a reasonable interpretation over asking for clarification.',
      ]
    }

    /**
     * Build the chat message for one comment or a batch. `details` is either a v1 single-comment
     * object (boardPath, version, artboard, layer, parentId, renderedRect, commentId, text) or
     * `{ boardPath, version, comments: [entry, ...] }`; entries share the same shape.
     */
    function buildCommentMessage(details, strings) {
      const normalized = commentEntriesFrom(details)
      const entries = normalized.entries
      const total = entries.length
      const boardPath = normalized.boardPath || 'design-board.json'

      const head = [COMMENT_MESSAGE_OPENING_LINE, '']
      head.push(
        'Board: ' + boardPath + (normalized.version ? ' (version ' + normalized.version + ')' : ''),
      )
      if (total > 1) {
        head.push('Comments in this request: ' + total + ' — work through the list in order.')
      } else if (total === 1) {
        head.push('Comment in this request: 1')
      }
      if (normalized.note) head.push(normalized.note)

      const instructions = commentInstructionLines(total)
      // Reserve room for the header, the instruction block and a truncation note.
      const budget = Math.max(
        400,
        COMMENT_MESSAGE_MAX_CHARS - head.join('\n').length - instructions.join('\n').length - 320,
      )

      const blocks = []
      const skipped = []
      let used = 0
      for (let index = 0; index < total; index += 1) {
        const block = commentEntryLines(entries[index], index + 1, total).join('\n')
        const cost = block.length + 2
        if (blocks.length > 0 && used + cost > budget) {
          skipped.push(entries[index])
          continue
        }
        blocks.push(block)
        used += cost
      }

      const chunks = [head.join('\n')]
      for (let index = 0; index < blocks.length; index += 1) {
        chunks.push('')
        chunks.push(blocks[index])
      }

      const skippedIds = []
      for (let index = 0; index < skipped.length; index += 1) {
        if (skipped[index].commentId) skippedIds.push(skipped[index].commentId)
      }
      if (skipped.length > 0) {
        chunks.push('')
        chunks.push(
          'Not included (message length limit): ' +
            String(skipped.length) +
            ' more comment' +
            (skipped.length === 1 ? '' : 's') +
            ' — ids: ' +
            (skippedIds.length ? skippedIds.join(', ') : '(unknown ids)') +
            '. Handle the comments above first; the rest will arrive in a follow-up request.',
        )
      }
      chunks.push(instructions.join('\n'))
      let message = chunks.join('\n')

      if (message.length > COMMENT_MESSAGE_MAX_CHARS) {
        const leftoverIds = []
        for (let index = 0; index < entries.length; index += 1) {
          if (entries[index].commentId) leftoverIds.push(entries[index].commentId)
        }
        let note =
          '\n\n… message truncated at ' +
          String(COMMENT_MESSAGE_MAX_CHARS) +
          ' characters. Remaining comment ids: ' +
          leftoverIds.join(', ')
        if (note.length > 900) note = note.slice(0, 899) + '…'
        message =
          message
            .slice(0, Math.max(0, COMMENT_MESSAGE_MAX_CHARS - note.length - 1))
            .replace(/\s+$/, '') + note
      }
      return message
    }
    /**
     * Iconography: one 16x16 viewBox, stroke-based (1.5), `currentColor`.
     * Keep every glyph on the same optical weight so the chrome reads as one set.
     */
    const ICON_PATHS = {
      plus: ['M8 3v10', 'M3 8h10'],
      minus: ['M3 8h10'],
      fit: ['M3 6V3h3', 'M13 6V3h-3', 'M3 10v3h3', 'M13 10v3h-3'],
      zoomReset: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13.5 2.5v3h-3'],
      comment: ['M2.5 3.5h11v7.5h-6l-3.5 2.5v-2.5h-1.5z'],
      close: ['M4 4l8 8', 'M12 4l-8 8'],
      trash: ['M3.5 4.5h9', 'M6.5 4.5V3h3v1.5', 'M5 4.5l.6 8h4.8l.6-8', 'M7 7v3.5', 'M9 7v3.5'],
      up: ['M8 12.5V4', 'M4.5 7.5L8 4l3.5 3.5'],
      down: ['M8 3.5V12', 'M4.5 8.5L8 12l3.5-3.5'],
      eye: ['M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z'],
      eyeOff: ['M2 2l12 12', 'M6.5 4.2A7.6 7.6 0 0 1 8 3.8c4 0 6.5 4.2 6.5 4.2a12 12 0 0 1-2.3 2.6', 'M4.2 5.1A12 12 0 0 0 1.5 8S4 12.2 8 12.2c.9 0 1.7-.2 2.4-.5'],
      chevronLeft: ['M10 4L6 8l4 4'],
      chevronRight: ['M6 4l4 4-4 4'],
      chevronDown: ['M4 6l4 4 4-4'],
      copy: ['M5.5 4.5h8v8h-8z', 'M2.5 11.5v-8h8'],
      undo: ['M5 6H10.5a3.5 3.5 0 1 1 0 7H7', 'M7.5 3.5L5 6l2.5 2.5'],
      redo: ['M11 6H5.5a3.5 3.5 0 1 0 0 7H9', 'M8.5 3.5L11 6 8.5 8.5'],
      layers: ['M8 2.5l5.5 3L8 8.5 2.5 5.5 8 2.5z', 'M2.5 8.5L8 11.5l5.5-3'],
      inspector: ['M2.5 5.5h11', 'M2.5 10.5h11', 'M6 3.5v4', 'M10 8.5v4'],
      frame: ['M4.5 2v12', 'M11.5 2v12', 'M2 4.5h12', 'M2 11.5h12'],
      canvas: ['M2.5 3.5h11v9h-11z', 'M2.5 7h11', 'M6 7v5.5'],
      rect: ['M2.5 3.5h11v9h-11z'],
      ellipse: ['M8 3.5c3.3 0 6 2 6 4.5s-2.7 4.5-6 4.5-6-2-6-4.5S4.7 3.5 8 3.5z'],
      text: ['M3.5 4h9', 'M8 4v9', 'M5.5 13h5'],
      image: ['M2.5 3.5h11v9h-11z', 'M2.5 10.5l3.2-3.2 2.3 2.3 2.5-2.5 3 3'],
      line: ['M2.5 13.5L13.5 2.5', 'M2.5 13.5h.01', 'M13.5 2.5h.01'],
      button: ['M2 5.5h12v5H2z', 'M5.5 8h5'],
      send: ['M14 2L2 7l4.5 2L9 13.5 14 2z', 'M6.5 9L14 2'],
      retry: ['M12.5 8a4.5 4.5 0 1 1-1.6-3.4', 'M12.5 3v3h-3'],
      more: ['M3.5 8h0', 'M8 8h0', 'M12.5 8h0'],
      export: ['M8 2.5v8', 'M5 5.5l3-3 3 3', 'M3 10.5v3h10v-3'],
      keyboard: ['M2.5 5.5h11v6h-11z', 'M4.5 9.5h7', 'M5 7.5h.01', 'M8 7.5h.01', 'M11 7.5h.01'],
      alert: ['M8 2.8l5.4 9.7H2.6z', 'M8 6.6v2.8', 'M8 11.3h.01'],
      check: ['M3.5 8.5l3 3 6-6'],
      search: ['M7.5 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M10.9 10.9l2.6 2.6'],
      lock: ['M4.5 7.5h7v6h-7z', 'M6 7.5V5.5a2 2 0 0 1 4 0v2'],
      unlock: ['M4.5 7.5h7v6h-7z', 'M6 7.5V5.5a2 2 0 0 1 3.8-.8'],
      group: ['M2.5 5.5V2.5h3', 'M10.5 2.5h3v3', 'M13.5 10.5v3h-3', 'M5.5 13.5h-3v-3', 'M6 6h4v4H6z'],
      artboard: ['M2.5 3.5h11v9h-11z', 'M8 3.5v9'],
      panelLeft: ['M2.5 3.5h11v9h-11z', 'M6.5 3.5v9'],
      panelRight: ['M2.5 3.5h11v9h-11z', 'M9.5 3.5v9'],
      dot: ['M8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
    }

    function Glyph(props) {
      const spec = ICON_PATHS[props.name] || ICON_PATHS.dot
      const size = props.size || 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.weight || 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { flex: '0 0 auto', display: 'block' },
        },
        spec.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /** A 16x16 glyph rendered inside a text-sized square (used by menus and chips). */
    function glyphFits(name) {
      return Object.prototype.hasOwnProperty.call(ICON_PATHS, String(name))
    }

    /* ------------------------------------------------------------------------------------------
     * Styles (chrome only; theme tokens only)
     * ---------------------------------------------------------------------------------------- */
    const CSS_TEXT = `
.dc-app { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; container-type: inline-size; container-name: dcpane; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); overflow: hidden; }
.dc-app * { box-sizing: border-box; }
.dc-app :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: 1px; }
.dc-app ::-webkit-scrollbar { width: 8px; height: 8px; }
.dc-app ::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #d4d6dc); border-radius: 4px; }
.dc-app ::-webkit-scrollbar-track { background: transparent; }

/* ------------------------------------------------------------------ header */
.dc-header { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; height: 40px; padding: 0 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-head-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.dc-head-actions { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dc-name { flex: 0 1 auto; min-width: 40px; max-width: 220px; height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 13px; font-weight: 600; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.dc-name-input { display: block; flex: 0 1 auto; width: 180px; max-width: 50%; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-brand-primary, #3b82f6); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 13px; font-weight: 600; }
.dc-version { flex: 0 0 auto; height: 18px; padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }
.dc-status { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; }
.dc-status-label { overflow: hidden; text-overflow: ellipsis; }
.dc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: 0 0 auto; background: var(--dsw-alias-state-idle-primary, #9ca3af); }
.dc-dot-synced { background: var(--dsw-alias-state-success-primary, #22c55e); }
.dc-dot-saving { background: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dc-dot-offline { background: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-dot-revising { background: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-retry { min-height: 20px; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-brand-primary, #3b82f6); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; }
.dc-zoom-group { display: inline-flex; align-items: center; gap: 2px; padding: 1px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); }
.dc-zoom-label { min-width: 44px; height: 22px; padding: 0 2px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; cursor: pointer; }

/* ------------------------------------------------------------------ toolbar */
.dc-toolbar { display: flex; align-items: center; flex-wrap: nowrap; gap: 4px; flex: 0 0 auto; min-width: 0; height: 38px; padding: 0 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.dc-toolbar::-webkit-scrollbar { display: none; }
.dc-tool-group { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; min-width: 0; }
.dc-toolbar-view { position: sticky; right: 0; flex: 0 0 auto; padding-left: 6px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); box-shadow: -8px 0 12px -8px rgba(15, 23, 42, 0.18); }
.dc-toolbar-divider { flex: 0 0 auto; width: 1px; height: 18px; margin: 0 4px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-spacer { flex: 1 1 auto; min-width: 4px; }
.dc-tool { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 26px; height: 26px; padding: 0 5px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.dc-tool-label { font-size: 11px; }
.dc-tool:active:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
.dc-tool.dc-active { background: var(--dsw-alias-bg-layer-2, #f0f0f2); border-color: var(--dsw-alias-border-l1, #e3e4e8); color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-tool:disabled { opacity: 0.4; cursor: default; }
.dc-tool-caret { width: 10px; height: 10px; margin-left: -2px; opacity: 0.8; }
.dc-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; cursor: pointer; }
.dc-ibtn.dc-active { color: var(--dsw-alias-brand-primary, #3b82f6); background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
.dc-ibtn:disabled { opacity: 0.4; cursor: default; }

/* ------------------------------------------------------------------ buttons */
.dc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-btn-primary { background: var(--dsw-alias-brand-primary, #3b82f6); border-color: transparent; color: var(--dsw-alias-bg-base, #ffffff); font-weight: 600; }
.dc-btn-wide { width: 100%; }
.dc-btn-sm { height: 24px; padding: 0 8px; font-size: 11px; }
.dc-btn-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); }

/* ------------------------------------------------------------------ banner */
.dc-banner { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 30px; padding: 4px 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-banner-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-banner-close { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }

/* ------------------------------------------------------------------ selection bar */
.dc-selection-bar { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 34px; padding: 4px 8px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.dc-selection-bar::-webkit-scrollbar { display: none; }
.dc-sel-chip { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; max-width: 150px; height: 22px; padding: 0 8px; border-radius: 11px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); font-size: 11px; font-weight: 600; white-space: nowrap; }
.dc-sel-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dc-sel-sep { flex: 0 0 auto; width: 1px; height: 16px; margin: 0 2px; background: var(--dsw-alias-border-l1, #e3e4e8); }

/* ------------------------------------------------------------------ body / panels / splitters */
.dc-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dc-panel-slot { display: flex; flex-direction: column; flex: 0 0 auto; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
.dc-panel-slot > .dc-left, .dc-panel-slot > .dc-right { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; }
.dc-panel-slot > .dc-left { border-right: 0; }
.dc-panel-slot > .dc-right { border-left: 0; }
.dc-splitter { flex: 0 0 7px; width: 7px; position: relative; padding: 0; border: 0; background: transparent; cursor: col-resize; touch-action: none; align-self: stretch; }
.dc-splitter::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-splitter.dc-splitter-active::after { left: 2px; width: 3px; border-radius: 2px; background: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-splitter:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-app.dc-splitting, .dc-app.dc-splitting * { cursor: col-resize; user-select: none; -webkit-user-select: none; }
.dc-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 0 0 28px; width: 28px; padding: 8px 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); }
.dc-rail-left { border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-rail-right { border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-rail-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }

/* narrow layout: panels become overlay drawers so the canvas keeps the full width */
.dc-body { position: relative; }
.dc-drawer-scrim { position: absolute; inset: 0; z-index: 44; padding: 0; border: 0; background: rgba(15, 23, 42, 0.24); cursor: pointer; }
.dc-drawer { position: absolute; top: 0; bottom: 0; z-index: 45; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); box-shadow: 0 0 40px rgba(15, 23, 42, 0.3); }
.dc-drawer-left { left: 0; border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-drawer-right { right: 0; border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-drawer > .dc-left, .dc-drawer > .dc-right { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; border: 0; }
.dc-drawer > .dc-right { background: transparent; }

/* ------------------------------------------------------------------ layer tree */
.dc-left { display: flex; flex-direction: column; flex: 0 0 180px; width: 180px; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-right: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex: 0 0 auto; min-height: 32px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-panel-head > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; }
.dc-tree-group { display: flex; flex-direction: column; gap: 1px; margin-bottom: 6px; }
.dc-tree-ab { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; text-align: left; }
.dc-tree-ab.dc-sel { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-tree-row { display: flex; align-items: center; gap: 4px; min-height: 24px; padding: 2px 4px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-tree-row.dc-sel { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary, #3b82f6); }
.dc-tree-row.dc-drop-into, .dc-tree-ab.dc-drop-into { outline: 1px dashed var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-tree-caret { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
.dc-tree-caret:disabled { opacity: 0.3; cursor: default; }
.dc-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree-meta { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.9; font-variant-numeric: tabular-nums; }
.dc-tree-type { display: inline-flex; flex: 0 0 auto; color: var(--dsw-alias-label-secondary, #6b7280); opacity: 0.9; }
.dc-eye { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; }
.dc-eye.dc-off { opacity: 0.45; }
.dc-badge { flex: 0 0 auto; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--dsw-alias-state-warn-primary, #f59e0b); color: var(--dsw-alias-bg-base, #ffffff); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.dc-panel-foot { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 4px 6px; border-top: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-muted { color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; }
.dc-pad { padding: 8px; }

/* ------------------------------------------------------------------ inspector */
.dc-right { display: flex; flex-direction: column; flex: 0 0 240px; width: 240px; min-height: 0; background: var(--dsw-alias-bg-layer-1, #f7f7f8); border-left: 1px solid var(--dsw-alias-border-l1, #e3e4e8); overflow: auto; }
.dc-section { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e4e8); }
.dc-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dc-field { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.dc-field-col { flex-direction: column; align-items: stretch; gap: 4px; }
.dc-field-label { flex: 0 0 auto; min-width: 14px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; }
.dc-input { width: 100%; min-width: 0; height: 24px; padding: 0 6px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-input:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }
.dc-input:disabled { opacity: 0.5; }
.dc-input::-webkit-outer-spin-button, .dc-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dc-num { text-align: right; font-variant-numeric: tabular-nums; }
.dc-select { padding-right: 2px; }
.dc-swatch { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; background: transparent; cursor: pointer; }
.dc-swatch::-webkit-color-swatch-wrapper { padding: 1px; }
.dc-swatch::-webkit-color-swatch { border: none; border-radius: 2px; }
.dc-seg { display: flex; flex: 1 1 auto; min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-seg-btn { flex: 1 1 0; min-width: 0; height: 22px; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; cursor: pointer; }
.dc-seg-btn:disabled { opacity: 0.45; cursor: default; background: transparent; }
.dc-seg-btn.dc-active { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); font-weight: 600; }
.dc-geo-note { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dc-textarea { width: 100%; min-height: 60px; resize: vertical; padding: 6px 7px; font: inherit; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; }
.dc-textarea:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }

/* ------------------------------------------------------------------ comments */
.dc-comment { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 6px; background: var(--dsw-alias-bg-base, #ffffff); }
.dc-comment.dc-resolved { opacity: 0.6; }
.dc-comment-text { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-primary, #1a1c21); white-space: pre-wrap; word-break: break-word; }
.dc-comment-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-comment-status { text-transform: uppercase; letter-spacing: 0.04em; }
.dc-comment-actions { display: flex; align-items: center; gap: 8px; }
.dc-link { padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--dsw-alias-brand-primary, #3b82f6); font: inherit; font-size: 11px; cursor: pointer; }
.dc-link.dc-danger { color: var(--dsw-alias-state-error-primary, #ef4444); }

/* ------------------------------------------------------------------ canvas / stage */
.dc-canvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #ffffff); touch-action: none; }
.dc-canvas.dc-gesture-active { user-select: none; }
.dc-canvas.dc-space-pan { cursor: grab; }
.dc-canvas.dc-panning { cursor: grabbing; user-select: none; }
.dc-canvas.dc-drag-over { outline: 2px dashed var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -3px; }
.dc-stage { position: absolute; left: 0; top: 0; min-width: 0; min-height: 0; pointer-events: none; }
.dc-board-wrap { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.dc-file-input { display: none; }
.dc-board-label { display: flex; align-items: baseline; gap: 8px; padding: 0 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-board-name { font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-board-size { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-board-frame { position: relative; background: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px var(--dsw-alias-border-l1, #e3e4e8); }
.dc-board-frame.dc-board-frame-selected { box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 0 0 1px var(--dsw-alias-brand-primary, #3b82f6); }
.dc-board-inner { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dc-layer { position: absolute; margin: 0; padding: 0; overflow: hidden; user-select: none; }
.dc-layer-text { display: block; overflow: hidden; word-break: break-word; white-space: pre-wrap; }
.dc-layer-frame { overflow: visible; }
.dc-layer-auto { cursor: grab; }
.dc-comment-mode .dc-layer { cursor: crosshair; }
.dc-gesture-active .dc-layer { cursor: default; }
/* ================================================================== SELECTION CHROME ========
 * Owned by the selection overlay renderer (src/client/60-render.js): the union selection box,
 * its 8 resize handles and the thin per-member outlines. Everything here is *screen* constant
 * by construction — the stage carries CSS zoom and the renderer divides every dimension by
 * it (borderWidth, handle size, radius, shadow) — so these rules must never scale anything
 * themselves and must not set width/height/border-width (the renderer writes those inline).
 *
 * Colours: the DSH theme accent is monochrome, so the selection reads with a fixed Figma-style
 * blue that has contrast on both light and dark artboards. The custom property
 * --dsw-alias-accent-selection is honoured when a theme provides it.
 * ========================================================================================== */
.dc-sel-box,
.dc-sel-member,
.dc-sel-handle { --dc-selection-accent: var(--dsw-alias-accent-selection, #0d99ff); }
.dc-sel-member { position: absolute; z-index: 19; box-sizing: border-box; border: 1px solid var(--dc-selection-accent); pointer-events: none; }
.dc-sel-box { position: absolute; z-index: 20; box-sizing: border-box; border: 1px solid var(--dc-selection-accent); pointer-events: none; }
.dc-sel-handle { position: absolute; z-index: 21; box-sizing: border-box; background: #ffffff; border: 1.5px solid var(--dc-selection-accent); border-radius: 2px; box-shadow: 0 0 0 0.5px rgba(13, 153, 255, 0.9), 0 0 0 1px rgba(13, 153, 255, 0.16), 0 1px 2px rgba(15, 23, 42, 0.26); pointer-events: auto; }
/* Fill only: the renderer writes the screen-constant box-shadow inline (it has to divide it by
 * the zoom), so a stylesheet shadow here would never win, and animating it would also flicker
 * on every zoom step. */
@media (hover: hover) {
  .dc-sel-handle:hover { background: var(--dc-selection-accent); }
}
.dc-sel-handle:active { background: var(--dc-selection-accent); }
@media (prefers-reduced-motion: no-preference) {
  .dc-sel-handle { transition: background-color 90ms ease-out; }
}

.dc-pin { position: absolute; z-index: 25; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 1px solid var(--dsw-alias-bg-base, #ffffff); background: var(--dsw-alias-brand-primary, #3b82f6); color: var(--dsw-alias-bg-base, #ffffff); font-size: 10px; font-weight: 700; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }

/* ------------------------------------------------------------------ composer */
.dc-composer { position: absolute; z-index: 40; width: 272px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2); }
.dc-composer-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-cmt-chip-target { align-self: flex-start; max-width: 100%; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-cmt-counter { margin-right: auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-cmt-counter-warn { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dc-composer-text { min-height: 72px; }
.dc-composer-error { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-composer-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* ------------------------------------------------------------------ empty / loading / error */
.dc-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 20px; text-align: center; }
.dc-center-icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-center-text { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); max-width: 280px; overflow-wrap: anywhere; }
.dc-center-hint { font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #6b7280); max-width: 280px; overflow-wrap: anywhere; }
.dc-center-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.dc-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2, #d4d6dc); border-top-color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-fallback { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; height: 100%; padding: 16px; font-size: 12px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); }
.dc-fallback-title { font-size: 13px; font-weight: 600; }
.dc-fallback-text { font-size: 12px; color: var(--dsw-alias-state-error-primary, #ef4444); overflow-wrap: anywhere; }
.dc-open-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }

/* ------------------------------------------------------------------ menus */
.dc-menu-host { position: absolute; inset: 0; z-index: 60; }
.dc-menu-scrim { position: absolute; inset: 0; }
.dc-menu { position: absolute; min-width: 204px; max-width: min(280px, calc(100cqw - 16px)); max-height: calc(100cqh - 16px); overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 6px rgba(15, 23, 42, 0.08); }
.dc-menu-label { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary, #1a1c21); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.dc-menu-item:disabled { opacity: 0.45; cursor: default; }
.dc-menu-item.dc-danger { color: var(--dsw-alias-state-error-primary, #ef4444); }
.dc-menu-item-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-item.dc-danger .dc-menu-item-icon { color: inherit; }
.dc-menu-item-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-menu-item-hint { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dc-menu-item-check { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 14px; color: var(--dsw-alias-brand-primary, #3b82f6); }
.dc-menu-sep { height: 1px; margin: 4px; background: var(--dsw-alias-border-l1, #e3e4e8); }
.dc-menu-form { display: flex; align-items: flex-end; gap: 6px; padding: 4px 8px 8px; }
.dc-menu-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-menu-input { width: 62px; height: 26px; padding: 0 6px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 4px; font-variant-numeric: tabular-nums; }
.dc-menu-input:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); outline: 2px solid var(--dsw-alias-brand-primary, #3b82f6); outline-offset: -1px; }

/* ------------------------------------------------------------------ dialogs */
.dc-modal-backdrop { position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.3); }
.dc-modal { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 340px; max-height: 100%; overflow: auto; padding: 14px; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 24px 48px rgba(15, 23, 42, 0.28); }
.dc-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dc-modal-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1c21); }
.dc-shortcut-list { display: flex; flex-direction: column; gap: 6px; }
.dc-shortcut-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dc-shortcut-keys { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dc-kbd { display: inline-flex; align-items: center; min-height: 18px; padding: 0 5px; border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-bottom-width: 2px; border-radius: 4px; background: var(--dsw-alias-bg-layer-1, #f7f7f8); font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }

/* ------------------------------------------------------------------ narrow container adaptations */
@container dcpane (max-width: 560px) {
  .dc-name { max-width: 168px; }
}
@container dcpane (max-width: 500px) {
  .dc-status-label { display: none; }
  .dc-toolbar-secondary { display: none; }
  .dc-name { max-width: 150px; }
  .dc-version { display: none; }
}
@container dcpane (max-width: 380px) {
  .dc-name { max-width: 124px; }
  .dc-toolbar { gap: 2px; }
}

/* hover affordances are for devices that really hover (no sticky touch states) */
@media (hover: hover) and (pointer: fine) {
  .dc-name:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-zoom-label:hover { color: var(--dsw-alias-label-primary, #1a1c21); background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-tool:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-ibtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary, #3b82f6); filter: brightness(0.94); }
  .dc-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-banner-close:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-splitter:hover::after { left: 2px; width: 3px; border-radius: 2px; background: var(--dsw-alias-brand-primary, #3b82f6); }
  .dc-rail-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-ab:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-row:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-tree-caret:hover:not(:disabled) { background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-eye:hover { background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-input:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, #d4d6dc); }
  .dc-seg-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
  .dc-link:hover { text-decoration: underline; }
  .dc-pin:hover { filter: brightness(0.94); }
  .dc-open-btn:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f2); color: var(--dsw-alias-label-primary, #1a1c21); }
  .dc-menu-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f0f2); }
}

/* ------------------------------------------------------------------ motion */
@media (prefers-reduced-motion: no-preference) {
  .dc-tool, .dc-ibtn, .dc-btn, .dc-link, .dc-menu-item, .dc-tree-row, .dc-tree-ab, .dc-tree-caret, .dc-eye, .dc-name, .dc-seg-btn, .dc-rail-btn, .dc-banner-close, .dc-zoom-label, .dc-retry, .dc-open-btn, .dc-pin { transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, opacity 120ms ease; }
  .dc-spinner { animation: dc-spin 0.9s linear infinite; }
  .dc-app.dc-splitting .dc-splitter::after { transition: background-color 120ms ease; }
}
@keyframes dc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dc-spinner { animation: none; border-top-color: var(--dsw-alias-brand-primary, #3b82f6); }
}
`
    /* ------------------------------------------------------------------------------------------
     * Export to code
     *
     * Pure document -> source renderers. No DOM writes here: the dialog in `44-export-ui.js`
     * owns the UI. Every renderer takes `(doc, options)` and returns a string; unknown layer
     * types degrade to a neutral box instead of throwing, and the document is never mutated.
     *
     * `options` (all optional):
     *   artboardId   export only this artboard (default: the first artboard)
     *   scope        'artboard' (default) | 'all' | 'selection'
     *   layerIds     the selection, for scope:'selection'
     *   scale        PNG raster scale, 1..4 (default 2)
     *   includeComments  append the artboard's open comments as an HTML comment / JSON key
     *   pretty       indent the generated markup (default true)
     *   className    HTML: wrapper class name (default derives from the artboard name)
     *
     * Geometry: the SVG/PNG renderers use the canvas layout engine (`buildComputedTree`) so the
     * output is pixel-true even for auto-layout frames, groups, hug sizes and min/max clamping.
     * The HTML/React renderers use idiomatic CSS (real flexbox for auto-layout frames) so the
     * exported markup stays readable and editable.
     * ---------------------------------------------------------------------------------------- */

    const EXPORT_FORMATS = ['html', 'react', 'svg', 'png', 'json']
    const EXPORT_MAX_SCALE = 4

    function escapeHtml(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    /** Keep a file name safe on every OS. */
    function sanitizeFileName(value, fallback) {
      const base = String(value === undefined || value === null ? '' : value)
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80)
      return base || fallback || 'design-export'
    }

    /** Normalise caller options into the shape the renderers expect. */
    function resolveExportOptions(doc, options) {
      const input = isObject(options) ? options : {}
      const artboards = artboardsOf(doc)
      const scope = input.scope === 'all' || input.scope === 'selection' ? input.scope : 'artboard'
      const requested = typeof input.artboardId === 'string' ? input.artboardId : ''
      const artboard = requested
        ? artboards.find(function (entry) {
            return entry && entry.id === requested
          }) || null
        : artboards[0] || null
      const layerIds = Array.isArray(input.layerIds)
        ? input.layerIds.filter(function (id) {
            return typeof id === 'string' && id
          })
        : []
      const scale = clamp(Math.round(finiteNumber(input.scale, 2)), 1, EXPORT_MAX_SCALE)
      return {
        artboardId: artboard ? artboard.id : '',
        artboard: artboard,
        scope: scope,
        layerIds: layerIds,
        selectionName:
          typeof input.selectionName === 'string' && input.selectionName
            ? input.selectionName
            : layerIds.length === 1
              ? 'selection'
              : 'selection-' + layerIds.length + '-layers',
        scale: scale,
        includeComments: input.includeComments === true,
        pretty: input.pretty !== false,
        className: typeof input.className === 'string' && input.className ? input.className : '',
      }
    }

    /** Comments for one artboard (open first), used by the HTML/JSON renderers. */
    function exportCommentsFor(doc, artboard, layerIds) {
      const wanted = Array.isArray(layerIds) && layerIds.length ? new Set(layerIds) : null
      return commentsOf(doc).filter(function (comment) {
        if (!isObject(comment)) return false
        if (artboard && comment.artboardId !== artboard.id) return false
        if (wanted && !wanted.has(comment.layerId)) return false
        return true
      })
    }

    /* ------------------------------------------------------------------------------------------
     * Shared style translation (canvas props -> CSS)
     * ---------------------------------------------------------------------------------------- */

    /** Border radius/background/border/shadow/opacity shared by rect, frame, group and text. */
    function exportBoxStyle(layer) {
      const style = {}
      if (typeof layer.fill === 'string' && layer.fill) style.background = layer.fill
      const radius = Math.max(0, finiteNumber(layer.radius, 0))
      if (radius > 0) style.borderRadius = radius + 'px'
      const borderWidth = Math.max(0, finiteNumber(layer.borderWidth, 0))
      if (borderWidth > 0) {
        style.border = borderWidth + 'px solid ' + (layer.borderColor || 'transparent')
      }
      if (typeof layer.shadow === 'string' && layer.shadow) style.boxShadow = layer.shadow
      const opacity = finiteNumber(layer.opacity, 1)
      if (opacity !== 1) style.opacity = String(clamp(opacity, 0, 1))
      return style
    }

    /** Content box sizing hints: hug sizes, min/max clamps, grow/alignSelf inside flex parents. */
    function exportSizeStyle(layer, node, inFlex) {
      const style = {}
      if (inFlex) {
        if (layer.grow === true) {
          style.flex = '1 1 0'
          style.minWidth = '0'
          style.minHeight = '0'
        } else {
          style.flex = '0 0 auto'
        }
        if (layer.alignSelf) {
          style.alignSelf =
            layer.alignSelf === 'start'
              ? 'flex-start'
              : layer.alignSelf === 'end'
                ? 'flex-end'
                : layer.alignSelf
        }
      } else {
        style.position = 'absolute'
        style.left = roundTo(finiteNumber(node ? node.x : layer.x, 0), 2) + 'px'
        style.top = roundTo(finiteNumber(node ? node.y : layer.y, 0), 2) + 'px'
      }
      if (layer.hugWidth === true) style.width = 'fit-content'
      else style.width = roundTo(Math.max(0, finiteNumber(node ? node.width : layer.width, 1)), 2) + 'px'
      if (layer.hugHeight === true) style.height = 'fit-content'
      else style.height = roundTo(Math.max(0, finiteNumber(node ? node.height : layer.height, 1)), 2) + 'px'
      const minWidth = finiteNumber(layer.minWidth, 0)
      if (minWidth > 0) style.minWidth = roundTo(minWidth, 2) + 'px'
      const minHeight = finiteNumber(layer.minHeight, 0)
      if (minHeight > 0) style.minHeight = roundTo(minHeight, 2) + 'px'
      const maxWidth = finiteNumber(layer.maxWidth, 0)
      if (maxWidth > 0) style.maxWidth = roundTo(maxWidth, 2) + 'px'
      const maxHeight = finiteNumber(layer.maxHeight, 0)
      if (maxHeight > 0) style.maxHeight = roundTo(maxHeight, 2) + 'px'
      return style
    }

    function exportTextStyle(layer) {
      const style = {}
      style.margin = '0'
      style.color = layer.color || '#111827'
      style.fontSize = Math.max(1, finiteNumber(layer.fontSize, 16)) + 'px'
      style.fontWeight = String(finiteNumber(layer.fontWeight, 400))
      style.fontFamily = layer.fontFamily || DEFAULT_FONT
      style.textAlign = layer.align || 'left'
      style.lineHeight = textLineHeight(layer)
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      if (letterSpacing !== 0) style.letterSpacing = letterSpacing + 'px'
      if (layer.textTransform === 'uppercase' || layer.textTransform === 'lowercase') {
        style.textTransform = layer.textTransform
      }
      style.whiteSpace = 'pre-wrap'
      style.wordBreak = 'break-word'
      return style
    }

    /** `{ a: '1px', b: 'red' }` -> `a:1px;b:red` (CSS) */
    function cssDeclaration(style) {
      return Object.keys(style)
        .filter(function (key) {
          return style[key] !== undefined && style[key] !== null && style[key] !== ''
        })
        .map(function (key) {
          const cssKey = key.replace(/[A-Z]/g, function (letter) {
            return '-' + letter.toLowerCase()
          })
          return cssKey + ':' + String(style[key]) + ';'
        })
        .join('')
    }

    /** camelCase style object -> JSX style literal body. */
    function jsxStyle(style) {
      const parts = Object.keys(style)
        .filter(function (key) {
          return style[key] !== undefined && style[key] !== null && style[key] !== ''
        })
        .map(function (key) {
          return key + ': ' + JSON.stringify(String(style[key]))
        })
      return parts.length ? '{ ' + parts.join(', ') + ' }' : '{}'
    }

    /* ------------------------------------------------------------------------------------------
     * HTML + CSS
     * ---------------------------------------------------------------------------------------- */

    function exportLayoutCss(layout) {
      const value = normalizeLayoutObject(layout)
      if (!value) return {}
      const style = {
        display: 'flex',
        flexDirection: value.direction,
        flexWrap: value.wrap ? 'wrap' : 'nowrap',
      }
      const rowGap = finiteNumber(value.rowGap, finiteNumber(value.gap, 0))
      const columnGap = finiteNumber(value.columnGap, finiteNumber(value.gap, 0))
      style.gap = rowGap + 'px ' + columnGap + 'px'
      const pad = value.padding
      if (pad.top || pad.right || pad.bottom || pad.left) {
        style.padding = pad.top + 'px ' + pad.right + 'px ' + pad.bottom + 'px ' + pad.left + 'px'
      }
      style.alignItems =
        value.align === 'start' ? 'flex-start' : value.align === 'end' ? 'flex-end' : value.align
      style.justifyContent =
        value.justify === 'start'
          ? 'flex-start'
          : value.justify === 'end'
            ? 'flex-end'
            : value.justify
      if (value.wrap) {
        style.alignContent =
          value.alignContent === 'start'
            ? 'flex-start'
            : value.alignContent === 'end'
              ? 'flex-end'
              : value.alignContent
      }
      return style
    }

    function indentLine(depth, text) {
      const pad = depth > 0 ? new Array(depth * 2 + 1).join(' ') : ''
      return pad + text
    }

    /** Recursively render one node as HTML. `inFlex` = parent has an auto layout. */
    function renderNodeHtml(node, inFlex, depth, pretty, tree) {
      const layer = node.layer
      if (!isObject(layer)) return ''
      if (layer.visible === false) return ''
      const line = function (text) {
        return pretty ? indentLine(depth, text) : text
      }
      const computed = node.computed || null

      if (layer.type === 'text') {
        const style = Object.assign(
          exportBoxStyle(layer),
          exportSizeStyle(layer, computed, inFlex),
          exportTextStyle(layer),
        )
        const content = escapeHtml(layer.text || '')
        return line('<div style="' + cssDeclaration(style) + '">' + content + '</div>')
      }

      if (layer.type === 'image') {
        const style = Object.assign(exportBoxStyle(layer), exportSizeStyle(layer, computed, inFlex), {
          overflow: 'hidden',
        })
        const imgStyle = {
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: layer.fit || 'cover',
        }
        const src = typeof layer.src === 'string' && layer.src ? layer.src : ''
        if (!src) {
          return line(
            '<div style="' +
              cssDeclaration(Object.assign({}, style, { background: '#f3f4f6' })) +
              '"></div>',
          )
        }
        return line(
          '<div style="' +
            cssDeclaration(style) +
            '"><img src="' +
            escapeHtml(src) +
            '" alt="' +
            escapeHtml(layer.name || 'image') +
            '" style="' +
            cssDeclaration(imgStyle) +
            '" /></div>',
        )
      }

      if (layer.type === 'line') {
        const style = Object.assign(exportSizeStyle(layer, computed, inFlex), { overflow: 'visible' })
        const svg = renderLineSvg(layer, computed, true)
        return line('<div style="' + cssDeclaration(style) + '">' + svg + '</div>')
      }

      const style = Object.assign(exportBoxStyle(layer), exportSizeStyle(layer, computed, inFlex))
      if (layer.clip === true) style.overflow = 'hidden'
      if (layer.type === 'ellipse') style.borderRadius = '50%'

      const children = Array.isArray(layer.children) ? layer.children : []
      if (layer.type === 'frame') {
        Object.assign(style, exportLayoutCss(layer.layout))
        if (layer.layout === null || layer.layout === undefined) style.position = style.position || 'absolute'
      }
      if (!children.length) {
        return line('<div style="' + cssDeclaration(style) + '"></div>')
      }
      const childFlex = layer.type === 'frame' && isObject(layer.layout)
      const inner = []
      const childNodes = tree && Array.isArray(node.children) ? node.children : []
      const byId = new Map()
      childNodes.forEach(function (child) {
        if (child && child.layer) byId.set(child.layer.id, child)
      })
      const sourceOrder = children
        .map(function (child) {
          return byId.get(child.id) || { layer: child, computed: null }
        })
        .filter(function (child) {
          return child && child.layer
        })
      sourceOrder.forEach(function (child) {
        const rendered = renderNodeHtml(child, childFlex, depth + 1, pretty, null)
        if (rendered) inner.push(rendered)
      })
      if (!inner.length) return line('<div style="' + cssDeclaration(style) + '"></div>')
      return [
        line('<div style="' + cssDeclaration(style) + '">'),
        inner.join(pretty ? '\n' : ''),
        line('</div>'),
      ].join(pretty ? '\n' : '')
    }

    /** Inline SVG for a `line` layer (used by the HTML and SVG exporters). */
    function renderLineSvg(layer, computed, inline) {
      const width = Math.max(0, finiteNumber(computed ? computed.width : layer.width, 1))
      const height = Math.max(0, finiteNumber(computed ? computed.height : layer.height, 1))
      const strokeWidth = Math.max(0.5, finiteNumber(layer.strokeWidth, 2))
      const stroke = layer.stroke || '#94a3b8'
      const orientation = layer.orientation || 'horizontal'
      const pad = strokeWidth / 2
      let x1 = 0
      let y1 = height / 2
      let x2 = width
      let y2 = height / 2
      if (orientation === 'vertical') {
        x1 = width / 2
        y1 = 0
        x2 = width / 2
        y2 = height
      } else if (orientation === 'diagonal') {
        x1 = 0
        y1 = 0
        x2 = width
        y2 = height
      } else {
        y1 = clamp(height / 2, pad, Math.max(pad, height - pad))
        y2 = y1
      }
      const dash = layer.dashed === true ? ' stroke-dasharray="' + strokeWidth * 3 + ' ' + strokeWidth * 2 + '"' : ''
      const markers = []
      let markerDefs = ''
      if (layer.arrowEnd === true) {
        markers.push(' marker-end="url(#dc-arrow-end)"')
      }
      if (layer.arrowStart === true) {
        markers.push(' marker-start="url(#dc-arrow-start)"')
      }
      if (markers.length) {
        const head =
          '<marker id="dc-arrow-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="' +
          escapeHtml(stroke) +
          '" /></marker>'
        const tail =
          '<marker id="dc-arrow-start" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="' +
          escapeHtml(stroke) +
          '" /></marker>'
        markerDefs = '<defs>' + (layer.arrowEnd === true ? head : '') + (layer.arrowStart === true ? tail : '') + '</defs>'
      }
      const svg =
        '<svg ' +
        (inline ? 'width="100%" height="100%" ' : '') +
        'viewBox="0 0 ' +
        roundTo(Math.max(width, 1), 2) +
        ' ' +
        roundTo(Math.max(height, 1), 2) +
        '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block">' +
        markerDefs +
        '<line x1="' +
        roundTo(x1, 2) +
        '" y1="' +
        roundTo(y1, 2) +
        '" x2="' +
        roundTo(x2, 2) +
        '" y2="' +
        roundTo(y2, 2) +
        '" stroke="' +
        escapeHtml(stroke) +
        '" stroke-width="' +
        strokeWidth +
        '" stroke-linecap="round"' +
        dash +
        markers.join('') +
        ' /></svg>'
      return svg
    }

    /** One artboard -> a standalone HTML document. */
    function renderHtml(doc, options) {
      const resolved = resolveExportOptions(doc, options)
      const artboard = resolved.artboard
      if (!artboard) return '<!doctype html><html><body></body></html>'
      const tree = buildComputedTree(doc)
      const boardTree =
        (tree.artboards || []).find(function (entry) {
          return entry && entry.artboard && entry.artboard.id === artboard.id
        }) || null
      const nodes = boardTree && Array.isArray(boardTree.layers) ? boardTree.layers : []
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))
      const boardStyle = {
        position: 'relative',
        width: width + 'px',
        height: height + 'px',
        overflow: 'hidden',
        background: artboard.background || '#ffffff',
        margin: '0 auto',
      }
      const pretty = resolved.pretty
      const lines = []
      lines.push('<!doctype html>')
      lines.push('<html lang="en">')
      lines.push('<head>')
      lines.push('  <meta charset="utf-8" />')
      lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1" />')
      lines.push('  <title>' + escapeHtml(artboard.name || doc.name || 'Design') + '</title>')
      lines.push('  <style>')
      lines.push('    *, *::before, *::after { box-sizing: border-box; }')
      lines.push('    body { margin: 0; padding: 24px; background: #f5f5f5; font-family: ' + DEFAULT_FONT + '; }')
      lines.push('    .dc-artboard { ' + cssDeclaration(boardStyle).split(';').filter(Boolean).join('; ') + '; box-shadow: 0 1px 3px rgba(0,0,0,.14); }')
      lines.push('  </style>')
      lines.push('</head>')
      lines.push('<body>')
      lines.push('  <!-- Exported from the DSH design canvas: ' + escapeHtml(artboard.name || artboard.id) + ' -->')
      const boardNodes = nodes
        .filter(function (node) {
          return node && node.layer
        })
        .map(function (node) {
          return renderNodeHtml(node, false, 2, pretty, null)
        })
        .filter(Boolean)
      lines.push('  <div class="dc-artboard">')
      lines.push(boardNodes.join('\n'))
      lines.push('  </div>')
      if (resolved.includeComments) {
        const comments = exportCommentsFor(doc, artboard, null)
        if (comments.length) {
          lines.push('  <!-- Open comments:')
          comments.forEach(function (comment) {
            lines.push('       [' + String(comment.status || 'open') + '] ' + escapeHtml(String(comment.text || '')))
          })
          lines.push('  -->')
        }
      }
      lines.push('</body>')
      lines.push('</html>')
      return lines.join('\n')
    }

    /* ------------------------------------------------------------------------------------------
     * React (JSX with inline style objects, no CSS file needed)
     * ---------------------------------------------------------------------------------------- */

    function jsxComponentName(value) {
      const base = String(value || 'Artboard')
        .replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, function (_match, letter) {
          return letter.toUpperCase()
        })
        .replace(/^([0-9])/, '_$1')
      const name = base.charAt(0).toUpperCase() + base.slice(1)
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : 'Artboard'
    }

    function renderNodeJsx(node, inFlex, depth, pretty) {
      const layer = node.layer
      if (!isObject(layer) || layer.visible === false) return ''
      const computed = node.computed || null
      const line = function (text) {
        return pretty ? indentLine(depth, text) : text
      }
      if (layer.type === 'text') {
        const style = Object.assign(
          exportBoxStyle(layer),
          exportSizeStyle(layer, computed, inFlex),
          exportTextStyle(layer),
        )
        return line(
          '<div style=' + jsxStyle(style) + '>' + escapeJsxText(layer.text || '') + '</div>',
        )
      }
      if (layer.type === 'image') {
        const style = Object.assign(exportBoxStyle(layer), exportSizeStyle(layer, computed, inFlex), {
          overflow: 'hidden',
        })
        const src = typeof layer.src === 'string' && layer.src ? layer.src : ''
        if (!src) return line('<div style=' + jsxStyle(style) + ' />')
        return line(
          '<div style=' +
            jsxStyle(style) +
            '><img src=' +
            JSON.stringify(src) +
            ' alt=' +
            JSON.stringify(layer.name || 'image') +
            ' style=' +
            jsxStyle({ display: 'block', width: '100%', height: '100%', objectFit: layer.fit || 'cover' }) +
            ' /></div>',
        )
      }
      if (layer.type === 'line') {
        const width = Math.max(1, finiteNumber(computed ? computed.width : layer.width, 1))
        const height = Math.max(1, finiteNumber(computed ? computed.height : layer.height, 1))
        const strokeWidth = Math.max(0.5, finiteNumber(layer.strokeWidth, 2))
        const stroke = layer.stroke || '#94a3b8'
        const orientation = layer.orientation || 'horizontal'
        const x1 = orientation === 'vertical' ? width / 2 : 0
        const y1 = orientation === 'vertical' ? 0 : orientation === 'diagonal' ? 0 : height / 2
        const x2 = orientation === 'vertical' ? width / 2 : width
        const y2 = orientation === 'vertical' ? height : orientation === 'diagonal' ? height : height / 2
        const style = Object.assign(exportSizeStyle(layer, computed, inFlex), { overflow: 'visible' })
        return line(
          '<div style=' +
            jsxStyle(style) +
            '><svg viewBox={' +
            JSON.stringify('0 0 ' + width + ' ' + height) +
            '} preserveAspectRatio="none" style={{ display: \'block\', width: \'100%\', height: \'100%\', overflow: \'visible\' }}><line x1={' +
            roundTo(x1, 2) +
            '} y1={' +
            roundTo(y1, 2) +
            '} x2={' +
            roundTo(x2, 2) +
            '} y2={' +
            roundTo(y2, 2) +
            '} stroke=' +
            JSON.stringify(stroke) +
            ' strokeWidth={' +
            strokeWidth +
            '} strokeLinecap="round"' +
            (layer.dashed === true ? ' strokeDasharray={' + JSON.stringify(strokeWidth * 3 + ' ' + strokeWidth * 2) + '}' : '') +
            ' /></svg></div>',
        )
      }
      const style = Object.assign(exportBoxStyle(layer), exportSizeStyle(layer, computed, inFlex))
      if (layer.clip === true) style.overflow = 'hidden'
      if (layer.type === 'ellipse') style.borderRadius = '50%'
      if (layer.type === 'frame') {
        const layoutStyle = exportLayoutCss(layer.layout)
        Object.keys(layoutStyle).forEach(function (key) {
          if (layoutStyle[key] !== undefined) style[key] = layoutStyle[key]
        })
      }
      const children = Array.isArray(layer.children) ? layer.children : []
      if (!children.length) return line('<div style=' + jsxStyle(style) + ' />')
      const childFlex = layer.type === 'frame' && isObject(layer.layout)
      const computedChildren = Array.isArray(node.children) ? node.children : []
      const byId = new Map()
      computedChildren.forEach(function (child) {
        if (child && child.layer) byId.set(child.layer.id, child)
      })
      const inner = children
        .map(function (child) {
          return renderNodeJsx(byId.get(child.id) || { layer: child, computed: null }, childFlex, depth + 1, pretty)
        })
        .filter(Boolean)
      if (!inner.length) return line('<div style=' + jsxStyle(style) + ' />')
      return [
        line('<div style=' + jsxStyle(style) + '>'),
        inner.join(pretty ? '\n' : ''),
        line('</div>'),
      ].join(pretty ? '\n' : '')
    }

    /** JSX text child: escape braces and angle brackets, keep newlines as {'\\n'}. */
    function escapeJsxText(value) {
      const text = String(value === undefined || value === null ? '' : value)
      return text
        .split('\n')
        .map(function (part) {
          return part.replace(/[{}<>]/g, function (letter) {
            return '&#' + letter.charCodeAt(0) + ';'
          })
        })
        .join("{'\\n'}")
    }

    function renderReact(doc, options) {
      const resolved = resolveExportOptions(doc, options)
      const artboard = resolved.artboard
      if (!artboard) return 'export default function Artboard() {\n  return null\n}\n'
      const tree = buildComputedTree(doc)
      const boardTree =
        (tree.artboards || []).find(function (entry) {
          return entry && entry.artboard && entry.artboard.id === artboard.id
        }) || null
      const nodes = boardTree && Array.isArray(boardTree.layers) ? boardTree.layers : []
      const name = jsxComponentName(artboard.name || doc.name)
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))
      const boardStyle = {
        position: 'relative',
        width: width + 'px',
        height: height + 'px',
        overflow: 'hidden',
        background: artboard.background || '#ffffff',
        fontFamily: DEFAULT_FONT,
      }
      const children = nodes
        .filter(function (node) {
          return node && node.layer
        })
        .map(function (node) {
          return renderNodeJsx(node, false, 3, resolved.pretty)
        })
        .filter(Boolean)
      return [
        '/**',
        ' * ' + (artboard.name || doc.name || 'Design') + ' — exported from the DSH design canvas.',
        ' * Usage: import ' + name + " from './" + name + "'",
        ' * Every element is absolutely positioned inside one relative stage, and auto-layout',
        ' * frames become real flex containers, so the markup stays editable.',
        ' */',
        '',
        'export default function ' + name + '() {',
        '  return (',
        '    <div style=' + jsxStyle(boardStyle) + '>',
        children.join('\n'),
        '    </div>',
        '  )',
        '}',
        '',
      ].join('\n')
    }

    /* ------------------------------------------------------------------------------------------
     * SVG + PNG (pixel-true: computed geometry)
     * ---------------------------------------------------------------------------------------- */

    /** Approximate word wrap for SVG text (no canvas measuring available in a pure renderer). */
    function wrapSvgText(text, fontSize, width) {
      const source = String(text === undefined || text === null ? '' : text)
      if (!width || width <= 0) return source.split('\n')
      const averageGlyph = Math.max(1, fontSize * 0.52)
      const maxChars = Math.max(1, Math.floor(width / averageGlyph))
      const out = []
      source.split('\n').forEach(function (paragraph) {
        if (!paragraph) {
          out.push('')
          return
        }
        let current = ''
        paragraph.split(/\s+/).forEach(function (word) {
          if (!current) {
            current = word
            return
          }
          if ((current + ' ' + word).length <= maxChars) current += ' ' + word
          else {
            out.push(current)
            current = word
          }
        })
        if (current) out.push(current)
      })
      return out
    }

    function renderSvgText(layer, node) {
      const rect = node && node.worldRect ? node.worldRect : node || {}
      const width = Math.max(0, finiteNumber(rect.width, 0))
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      const align = layer.align || 'left'
      const x = roundTo(finiteNumber(rect.x, 0), 2)
      const y = roundTo(finiteNumber(rect.y, 0), 2)
      const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
      const textX = align === 'center' ? roundTo(x + width / 2, 2) : align === 'right' ? roundTo(x + width, 2) : x
      const lines = wrapSvgText(layer.text, fontSize, width)
      const tspans = lines
        .map(function (line, index) {
          return (
            '<tspan x="' +
            textX +
            '" y="' +
            roundTo(y + fontSize + index * lineHeight - fontSize * 0.2, 2) +
            '">' +
            escapeHtml(line) +
            '</tspan>'
          )
        })
        .join('')
      const letterSpacing = finiteNumber(layer.letterSpacing, 0)
      return (
        '<text font-family="' +
        escapeHtml(layer.fontFamily || DEFAULT_FONT) +
        '" font-size="' +
        fontSize +
        '" font-weight="' +
        finiteNumber(layer.fontWeight, 400) +
        '" fill="' +
        escapeHtml(layer.color || '#111827') +
        '" text-anchor="' +
        anchor +
        '"' +
        (letterSpacing !== 0 ? ' letter-spacing="' + letterSpacing + '"' : '') +
        (layer.textTransform === 'uppercase'
          ? ' style="text-transform:uppercase"'
          : layer.textTransform === 'lowercase'
            ? ' style="text-transform:lowercase"'
            : '') +
        '>' +
        tspans +
        '</text>'
      )
    }

    /* --- CSS paint -> SVG paint -------------------------------------------------------------
     * The model stores fills as CSS (`linear-gradient(135deg, #a, #b)`, `radial-gradient(...)`).
     * SVG has no such syntax: an unparsed `fill="linear-gradient(...)"` paints BLACK. Translate
     * gradients into <linearGradient>/<radialGradient> defs, and fall back to the first stop
     * colour when the value cannot be parsed.
     * ---------------------------------------------------------------------------------------- */

    /** Split `a, b(c, d), e` on top-level commas. */
    function splitCssArgs(value) {
      const out = []
      let depth = 0
      let current = ''
      const text = String(value || '')
      for (let index = 0; index < text.length; index += 1) {
        const character = text.charAt(index)
        if (character === '(') depth += 1
        if (character === ')') depth -= 1
        if (character === ',' && depth === 0) {
          out.push(current.trim())
          current = ''
          continue
        }
        current += character
      }
      if (current.trim()) out.push(current.trim())
      return out
    }

    /** `#2563eb 0%`, `rgba(0,0,0,.4)`, `to right` -> stop list. */
    function parseGradientStops(args) {
      const stops = []
      for (let index = 0; index < args.length; index += 1) {
        const raw = args[index].trim()
        if (!raw || /^(to\s|at\s|circle|ellipse|closest|farthest)/i.test(raw)) continue
        const match = /^(.+?)\s+(-?[\d.]+)%$/.exec(raw)
        if (match) stops.push({ color: match[1].trim(), offset: clamp(finiteNumber(match[2], 0), 0, 100) / 100 })
        else if (/^(#|rgb|hsl|var\()/i.test(raw) || /^[a-z]+$/i.test(raw)) stops.push({ color: raw, offset: null })
      }
      // Distribute offsets for stops authored without one.
      if (stops.length && stops.some(function (stop) { return stop.offset === null })) {
        stops.forEach(function (stop, index) {
          if (stop.offset === null) stop.offset = stops.length === 1 ? 0 : index / (stops.length - 1)
        })
      }
      return stops
    }

    function gradientDirection(value, isRadial) {
      if (isRadial) return { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, cx: 0.5, cy: 0.5, r: 0.75 }
      const raw = String(value || '').trim()
      let dx = 0
      let dy = 1
      const deg = /^(-?[\d.]+)deg$/.exec(raw)
      if (deg) {
        const angle = (finiteNumber(deg[1], 180) * Math.PI) / 180
        dx = Math.sin(angle)
        dy = -Math.cos(angle)
      } else if (/to\s+right/i.test(raw)) {
        dx = 1
        dy = 0
      } else if (/to\s+left/i.test(raw)) {
        dx = -1
        dy = 0
      } else if (/to\s+top/i.test(raw)) {
        dx = 0
        dy = -1
      } else if (/to\s+bottom/i.test(raw)) {
        dx = 0
        dy = 1
      }
      return {
        x1: roundTo(0.5 - dx / 2, 4),
        y1: roundTo(0.5 - dy / 2, 4),
        x2: roundTo(0.5 + dx / 2, 4),
        y2: roundTo(0.5 + dy / 2, 4),
      }
    }

    /**
     * Resolve a stored paint value for SVG. Returns `{ paint, def }` where `paint` is what goes
     * into `fill=` and `def` (when present) must be added to the document `<defs>`.
     */
    function svgPaint(fill, key) {
      const value = typeof fill === 'string' ? fill.trim() : ''
      if (!value) return { paint: 'none', def: '' }
      const linear = /^linear-gradient\((.*)\)$/i.exec(value)
      const radial = /^radial-gradient\((.*)\)$/i.exec(value)
      if (!linear && !radial) return { paint: value, def: '' }
      const args = splitCssArgs(linear ? linear[1] : radial[1])
      const stops = parseGradientStops(args)
      if (!stops.length) return { paint: 'none', def: '' }
      if (stops.length === 1) return { paint: stops[0].color, def: '' }
      const id = 'dc-grad-' + String(key).replace(/[^A-Za-z0-9_-]/g, '') + (linear ? '-l' : '-r')
      const stopMarkup = stops
        .map(function (stop) {
          return (
            '<stop offset="' + roundTo(stop.offset, 4) + '" stop-color="' + escapeHtml(stop.color) + '" />'
          )
        })
        .join('')
      if (linear) {
        const direction = gradientDirection(args[0] && /(deg|to\s)/i.test(args[0]) ? args[0] : '', false)
        return {
          paint: 'url(#' + id + ')',
          def:
            '<linearGradient id="' + id + '" x1="' + direction.x1 + '" y1="' + direction.y1 +
            '" x2="' + direction.x2 + '" y2="' + direction.y2 + '">' + stopMarkup + '</linearGradient>',
        }
      }
      const direction = gradientDirection('', true)
      return {
        paint: 'url(#' + id + ')',
        def:
          '<radialGradient id="' + id + '" cx="' + direction.cx + '" cy="' + direction.cy +
          '" r="' + direction.r + '">' + stopMarkup + '</radialGradient>',
      }
    }

    /**
     * One computed node -> SVG markup at ABSOLUTE (artboard) coordinates: the export is a flat
     * document, so every element uses `node.worldRect`, never the parent-relative x/y.
     */
    function renderSvgNode(node, depth, defs) {
      const layer = node.layer
      if (!isObject(layer) || layer.visible === false) return ''
      const rect = node.worldRect || {
        x: finiteNumber(node.x, 0),
        y: finiteNumber(node.y, 0),
        width: finiteNumber(node.width, 0),
        height: finiteNumber(node.height, 0),
      }
      const x = roundTo(finiteNumber(rect.x, 0), 2)
      const y = roundTo(finiteNumber(rect.y, 0), 2)
      const width = Math.max(0, finiteNumber(rect.width, 0))
      const height = Math.max(0, finiteNumber(rect.height, 0))
      const opacity = finiteNumber(layer.opacity, 1)
      const children = Array.isArray(node.children) ? node.children : []

      if (layer.type === 'text') {
        return '<g>' + renderSvgText(layer, node) + '</g>'
      }
      if (layer.type === 'line') {
        const strokeWidth = Math.max(0.5, finiteNumber(layer.strokeWidth, 2))
        const stroke = layer.stroke || '#94a3b8'
        const orientation = layer.orientation || 'horizontal'
        const x1 = orientation === 'vertical' ? x + width / 2 : x
        const y1 = orientation === 'vertical' ? y : orientation === 'diagonal' ? y : y + height / 2
        const x2 = orientation === 'vertical' ? x + width / 2 : x + width
        const y2 = orientation === 'vertical' ? y + height : orientation === 'diagonal' ? y + height : y + height / 2
        return (
          '<line x1="' + roundTo(x1, 2) + '" y1="' + roundTo(y1, 2) + '" x2="' + roundTo(x2, 2) + '" y2="' + roundTo(y2, 2) +
          '" stroke="' + escapeHtml(stroke) + '" stroke-width="' + strokeWidth + '" stroke-linecap="round"' +
          (layer.dashed === true ? ' stroke-dasharray="' + strokeWidth * 3 + ' ' + strokeWidth * 2 + '"' : '') +
          ' />'
        )
      }
      if (layer.type === 'image' && typeof layer.src === 'string' && layer.src) {
        const radius = Math.max(0, finiteNumber(layer.radius, 0))
        const clipId = radius > 0 ? 'dc-imgclip-' + String(layer.id).replace(/[^A-Za-z0-9_-]/g, '') : ''
        if (clipId) {
          defs.push(
            '<clipPath id="' + clipId + '"><rect x="' + x + '" y="' + y + '" width="' + roundTo(width, 2) +
              '" height="' + roundTo(height, 2) + '" rx="' + radius + '" /></clipPath>',
          )
        }
        return (
          '<image x="' + x + '" y="' + y + '" width="' + roundTo(width, 2) + '" height="' + roundTo(height, 2) +
          '" href="' + escapeHtml(layer.src) +
          '" preserveAspectRatio="' + (layer.fit === 'fill' ? 'none' : layer.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice') + '"' +
          (clipId ? ' clip-path="url(#' + clipId + ')"' : '') +
          (opacity !== 1 ? ' opacity="' + clamp(opacity, 0, 1) + '"' : '') +
          ' />'
        )
      }
      if (layer.type === 'ellipse') {
        const paint = svgPaint(layer.fill, layer.id)
        if (paint.def) defs.push(paint.def)
        const borderWidth = Math.max(0, finiteNumber(layer.borderWidth, 0))
        return (
          '<ellipse cx="' + roundTo(x + width / 2, 2) + '" cy="' + roundTo(y + height / 2, 2) +
          '" rx="' + roundTo(width / 2, 2) + '" ry="' + roundTo(height / 2, 2) + '" fill="' + escapeHtml(paint.paint) + '"' +
          (borderWidth > 0
            ? ' stroke="' + escapeHtml(layer.borderColor || 'transparent') + '" stroke-width="' + borderWidth + '"'
            : '') +
          (opacity !== 1 ? ' opacity="' + clamp(opacity, 0, 1) + '"' : '') +
          ' />'
        )
      }

      // rect / frame / group: a (rounded) rect at absolute coordinates plus recursive children.
      const radius = Math.max(0, finiteNumber(layer.radius, 0))
      const paint = svgPaint(layer.fill, layer.id)
      if (paint.def) defs.push(paint.def)
      const borderWidth = Math.max(0, finiteNumber(layer.borderWidth, 0))
      const clipId = layer.clip === true ? 'dc-clip-' + String(layer.id).replace(/[^A-Za-z0-9_-]/g, '') : ''
      if (clipId) {
        defs.push(
          '<clipPath id="' + clipId + '"><rect x="' + x + '" y="' + y + '" width="' + roundTo(width, 2) +
            '" height="' + roundTo(height, 2) + '" rx="' + radius + '" /></clipPath>',
        )
      }
      const hasPaint = paint.paint !== 'none' || borderWidth > 0
      const rectMarkup = hasPaint
        ? '<rect x="' + x + '" y="' + y + '" width="' + roundTo(width, 2) + '" height="' + roundTo(height, 2) + '"' +
          (radius > 0 ? ' rx="' + radius + '" ry="' + radius + '"' : '') +
          ' fill="' + escapeHtml(paint.paint) + '"' +
          (borderWidth > 0
            ? ' stroke="' + escapeHtml(layer.borderColor || 'transparent') + '" stroke-width="' + borderWidth + '"'
            : '') +
          ' />'
        : ''
      const inner = children
        .map(function (child) {
          return renderSvgNode(child, depth + 1, defs)
        })
        .filter(Boolean)
        .join('')
      const content = rectMarkup + inner
      if (!content) return ''
      const opacityAttr = opacity !== 1 ? ' opacity="' + clamp(opacity, 0, 1) + '"' : ''
      return (
        '<g' + (clipId ? ' clip-path="url(#' + clipId + ')"' : '') + opacityAttr + '>' + content + '</g>'
      )
    }

    function renderSvg(doc, options) {
      const resolved = resolveExportOptions(doc, options)
      const artboard = resolved.artboard
      if (!artboard) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
      const tree = buildComputedTree(doc)
      const boardTree =
        (tree.artboards || []).find(function (entry) {
          return entry && entry.artboard && entry.artboard.id === artboard.id
        }) || null
      const nodes = boardTree && Array.isArray(boardTree.layers) ? boardTree.layers : []
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))
      const defs = []
      const body = nodes
        .map(function (node) {
          return renderSvgNode(node, 0, defs)
        })
        .filter(Boolean)
        .join('')
      const backgroundPaint = svgPaint(artboard.background, 'board')
      if (backgroundPaint.def) defs.push(backgroundPaint.def)
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(width) + '" height="' + Math.round(height) +
        '" viewBox="0 0 ' + Math.round(width) + ' ' + Math.round(height) +
        '" font-family="' + escapeHtml(DEFAULT_FONT) + '">' +
        (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
        '<rect x="0" y="0" width="' + Math.round(width) + '" height="' + Math.round(height) + '" fill="' +
        escapeHtml(backgroundPaint.paint) + '" />' +
        body +
        '</svg>'
      )
    }

    /** Rasterise the SVG export into a PNG data URL (browser only; rejects in Node). */
    function renderPngDataUrl(doc, options) {
      const resolved = resolveExportOptions(doc, options)
      // A selection is rendered through its synthetic document (see exportTargetDoc).
      const target = exportTargetDoc(doc, resolved)
      if (target && target !== doc) {
        return renderPngDataUrl(target, { scale: resolved.scale })
      }
      const artboard = resolved.artboard
      const svg = renderSvg(doc, options)
      if (!artboard) return Promise.reject(new Error('no artboard to export'))
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return Promise.reject(new Error('PNG export needs a browser document'))
      }
      const scale = resolved.scale
      const width = Math.max(1, Math.round(finiteNumber(artboard.width, 1) * scale))
      const height = Math.max(1, Math.round(finiteNumber(artboard.height, 1) * scale))
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      return new Promise(function (resolve, reject) {
        const image = new window.Image()
        image.onload = function () {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext('2d')
            if (!context) throw new Error('canvas 2d context unavailable')
            context.drawImage(image, 0, 0, width, height)
            URL.revokeObjectURL(url)
            resolve(canvas.toDataURL('image/png'))
          } catch (error) {
            URL.revokeObjectURL(url)
            reject(error)
          }
        }
        image.onerror = function () {
          URL.revokeObjectURL(url)
          reject(new Error('could not rasterise the artboard'))
        }
        image.src = url
      })
    }

    /* ------------------------------------------------------------------------------------------
     * JSON snapshot
     * ---------------------------------------------------------------------------------------- */

    function renderJson(doc, options) {
      const resolved = resolveExportOptions(doc, options)
      const artboard = resolved.artboard
      let payload = doc
      if (artboard && resolved.scope !== 'all') {
        const layerIds = new Set()
        const walk = function (layers) {
          for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index]
            if (!layer) continue
            layerIds.add(layer.id)
            if (Array.isArray(layer.children)) walk(layer.children)
          }
        }
        walk(Array.isArray(artboard.layers) ? artboard.layers : [])
        payload = {
          schemaVersion: doc.schemaVersion,
          name: doc.name,
          version: doc.version,
          updatedAt: doc.updatedAt,
          artboards: [artboard],
          comments: commentsOf(doc).filter(function (comment) {
            return comment.artboardId === artboard.id || layerIds.has(comment.layerId)
          }),
        }
      }
      return resolved.pretty === false
        ? JSON.stringify(payload)
        : JSON.stringify(payload, null, 2) + '\n'
    }

    /* ------------------------------------------------------------------------------------------
     * Output helpers (browser side; all best-effort)
     * ---------------------------------------------------------------------------------------- */

    function downloadTextFile(fileName, mime, text) {
      try {
        const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        setTimeout(function () {
          URL.revokeObjectURL(url)
        }, 2000)
        return true
      } catch (error) {
        beacon('export-download-failed', { message: shortError(error) })
        return false
      }
    }

    function downloadDataUrl(fileName, dataUrl) {
      try {
        const anchor = document.createElement('a')
        anchor.href = dataUrl
        anchor.download = fileName
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        return true
      } catch (error) {
        beacon('export-download-failed', { message: shortError(error) })
        return false
      }
    }

    function copyTextToClipboard(text) {
      const value = String(text === undefined || text === null ? '' : text)
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(value).then(
            function () {
              return true
            },
            function () {
              return copyTextFallback(value)
            },
          )
        }
      } catch (error) {
        /* fall through to the textarea path */
      }
      return Promise.resolve(copyTextFallback(value))
    }

    function copyTextFallback(value) {
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', 'readonly')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand ? document.execCommand('copy') : false
        document.body.removeChild(area)
        return Boolean(ok)
      } catch (error) {
        beacon('export-copy-failed', { message: shortError(error) })
        return false
      }
    }

    /* --- selection export ------------------------------------------------------------------
     * "Export objects, not only artboards": the selection is re-rooted into a synthetic
     * one-artboard document whose size is the selection's bounding box, with every root moved to
     * its absolute position. The existing renderers then run unchanged, so HTML/React/SVG/PNG/JSON
     * all support a selection without a second code path.
     * -------------------------------------------------------------------------------------- */

    /** Outermost selected computed nodes (a selected container covers its descendants). */
    function selectionExportRoots(doc, layerIds) {
      const tree = buildComputedTree(doc)
      const wanted = new Set(
        (Array.isArray(layerIds) ? layerIds : []).filter(function (id) {
          return typeof id === 'string' && id
        }),
      )
      if (!wanted.size) return []
      const roots = []
      const visit = function (nodes) {
        const list = Array.isArray(nodes) ? nodes : []
        for (let index = 0; index < list.length; index += 1) {
          const node = list[index]
          if (!node || !node.layer) continue
          if (wanted.has(node.id)) {
            roots.push(node)
            continue
          }
          if (Array.isArray(node.children) && node.children.length) visit(node.children)
        }
      }
      const boards = Array.isArray(tree.artboards) ? tree.artboards : []
      for (let index = 0; index < boards.length; index += 1) {
        const entry = boards[index]
        if (entry && Array.isArray(entry.layers)) visit(entry.layers)
      }
      return roots
    }

    /** Bounding box of computed nodes, in artboard-local canvas units. */
    function nodesBoundingBox(nodes) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const list = Array.isArray(nodes) ? nodes : []
      for (let index = 0; index < list.length; index += 1) {
        const rect = list[index] && list[index].worldRect
        if (!rect) continue
        minX = Math.min(minX, finiteNumber(rect.x, 0))
        minY = Math.min(minY, finiteNumber(rect.y, 0))
        maxX = Math.max(maxX, finiteNumber(rect.x, 0) + Math.max(0, finiteNumber(rect.width, 0)))
        maxY = Math.max(maxY, finiteNumber(rect.y, 0) + Math.max(0, finiteNumber(rect.height, 0)))
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      }
    }

    /**
     * A synthetic document holding just the selection. Roots become absolutely positioned at their
     * rendered position (so a layer that lived inside an auto-layout frame lands where it looked),
     * children keep their relative coordinates.
     */
    function selectionExportDoc(doc, layerIds, name) {
      const roots = selectionExportRoots(doc, layerIds)
      if (!roots.length) return null
      const box = nodesBoundingBox(roots)
      if (!box) return null
      const layers = roots.map(function (node) {
        const layer = node.layer
        const rect = node.worldRect || { x: 0, y: 0, width: layer.width, height: layer.height }
        const copy = cloneLayerProps(layer)
        copy.x = roundTo(finiteNumber(rect.x, 0) - box.x, 2)
        copy.y = roundTo(finiteNumber(rect.y, 0) - box.y, 2)
        copy.width = Math.max(1, roundTo(finiteNumber(rect.width, finiteNumber(layer.width, 1)), 2))
        copy.height = Math.max(1, roundTo(finiteNumber(rect.height, finiteNumber(layer.height, 1)), 2))
        return copy
      })
      return {
        schemaVersion: doc && doc.schemaVersion ? doc.schemaVersion : 1,
        name: (doc && doc.name) || 'Design',
        version: doc && typeof doc.version === 'number' ? doc.version : 1,
        updatedAt: (doc && doc.updatedAt) || '1970-01-01T00:00:00.000Z',
        artboards: [
          {
            id: 'ab-selection',
            name: name || 'Selection',
            x: 0,
            y: 0,
            width: Math.ceil(box.width),
            height: Math.ceil(box.height),
            background: 'transparent',
            layers: layers,
          },
        ],
        comments: [],
      }
    }

    /** Deep copy of a layer's authored props (no computed fields, no shared arrays). */
    function cloneLayerProps(layer) {
      const copy = {}
      const keys = Object.keys(layer || {})
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        const value = layer[key]
        if (Array.isArray(value)) copy[key] = value.slice()
        else if (isObject(value)) copy[key] = JSON.parse(JSON.stringify(value))
        else copy[key] = value
      }
      return copy
    }

    /** Resolve the document a format should render: the selection wrapped as a document, or doc. */
    function exportTargetDoc(doc, resolved) {
      if (!doc) return null
      if (resolved && resolved.scope === 'selection' && resolved.layerIds && resolved.layerIds.length) {
        return selectionExportDoc(doc, resolved.layerIds, resolved.selectionName) || doc
      }
      return doc
    }

    /** Export the current document in one of EXPORT_FORMATS; returns a string (PNG: data URL). */
    function renderExport(doc, format, options) {
      const resolved = resolveExportOptions(doc, options)
      const target = exportTargetDoc(doc, resolved) || doc
      const forwarded = resolved.scope === 'selection' ? { pretty: resolved.pretty } : options
      switch (format) {
        case 'json':
          return renderJson(target, forwarded)
        case 'svg':
          return renderSvg(target, forwarded)
        case 'react':
          return renderReact(target, forwarded)
        case 'png':
          return renderPngDataUrl(target, forwarded)
        case 'html':
        default:
          return renderHtml(target, forwarded)
      }
    }

    /** File extension + mime for a format. */
    function exportFileInfo(format, artboard, doc) {
      const boardName = (artboard && (artboard.name || artboard.id)) || (doc && doc.name) || 'design'
      const base = sanitizeFileName(boardName, 'design')
      if (format === 'react') return { fileName: base + '.jsx', mime: 'text/plain;charset=utf-8', extension: 'jsx' }
      if (format === 'svg') return { fileName: base + '.svg', mime: 'image/svg+xml;charset=utf-8', extension: 'svg' }
      if (format === 'png') return { fileName: base + '.png', mime: 'image/png', extension: 'png' }
      if (format === 'json') return { fileName: base + '.json', mime: 'application/json;charset=utf-8', extension: 'json' }
      return { fileName: base + '.html', mime: 'text/html;charset=utf-8', extension: 'html' }
    }
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
    function StyleTag() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS_TEXT } })
    }

    /* ------------------------------------------------------------------------------------------
     * Small UI primitives
     * ---------------------------------------------------------------------------------------- */

    function IconButton(props) {
      const className =
        'dc-ibtn' +
        (props.active ? ' dc-active' : '') +
        (props.className ? ' ' + props.className : '')
      const attributes = {
        type: 'button',
        className: className,
        title: props.title,
        'aria-label': props.title,
        'aria-pressed': props.active ? 'true' : undefined,
        disabled: !!props.disabled,
        onClick: props.onClick,
        onPointerDown: props.onPointerDown,
      }
      if (props.menuToggle) attributes['data-dc-menu-toggle'] = ''
      return h(
        'button',
        attributes,
        props.children || h(Glyph, { name: props.icon, size: props.size || 14 }),
      )
    }

    /** Join a tooltip and an optional shortcut hint: "Duplicate · Ctrl/Cmd+D". */
    function tooltipText(base, hint) {
      const label = String(base || '')
      const extra = String(hint || '')
      if (!extra) return label || undefined
      return label ? label + ' · ' + extra : extra
    }

    function ToolButton(props) {
      const iconOnly = props.iconOnly === true || !props.label
      const title = tooltipText(props.title || props.label || props.icon, props.hint)
      const attributes = {
        type: 'button',
        className:
          'dc-tool' +
          (props.active ? ' dc-active' : '') +
          (props.className ? ' ' + props.className : ''),
        title: title,
        'aria-label': props.title || props.label || props.icon,
        'aria-pressed': props.active ? 'true' : undefined,
        disabled: !!props.disabled,
        onClick: props.onClick,
      }
      if (props.menuToggle) attributes['data-dc-menu-toggle'] = ''
      return h(
        'button',
        attributes,
        props.icon ? h(Glyph, { name: props.icon, size: props.iconSize || 14 }) : null,
        !iconOnly && props.label ? h('span', { className: 'dc-tool-label' }, props.label) : null,
        props.caret ? h(Glyph, { name: 'chevronDown', size: 10, weight: 1.6 }) : null,
      )
    }

    function formatNumber(value, decimals) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      const factor = Math.pow(10, decimals || 0)
      return String(Math.round(value * factor) / factor)
    }

    function NumField(props) {
      const [draft, setDraft] = React.useState(formatNumber(props.value, props.decimals))
      const focusedRef = React.useRef(false)
      React.useEffect(
        function () {
          if (!focusedRef.current) setDraft(formatNumber(props.value, props.decimals))
        },
        [props.value, props.decimals],
      )
      function commit() {
        focusedRef.current = false
        const parsed = Number.parseFloat(draft)
        if (!Number.isFinite(parsed)) {
          setDraft(formatNumber(props.value, props.decimals))
          return
        }
        let next = parsed
        if (typeof props.min === 'number') next = Math.max(next, props.min)
        if (typeof props.max === 'number') next = Math.min(next, props.max)
        if (props.integer !== false) next = Math.round(next)
        if (next !== props.value) props.onCommit(next)
        else setDraft(formatNumber(props.value, props.decimals))
      }
      return h(
        'label',
        { className: 'dc-field', title: props.title || props.label },
        h('span', { className: 'dc-field-label' }, props.label),
        h('input', {
          className: 'dc-input dc-num',
          type: 'number',
          inputMode: 'decimal',
          step: props.step || 1,
          value: draft,
          disabled: !!props.disabled,
          onFocus: function () {
            focusedRef.current = true
          },
          onChange: function (event) {
            setDraft(event.target.value)
          },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(formatNumber(props.value, props.decimals))
              event.currentTarget.blur()
            }
          },
        }),
      )
    }

    function TextField(props) {
      const [draft, setDraft] = React.useState(typeof props.value === 'string' ? props.value : '')
      const focusedRef = React.useRef(false)
      React.useEffect(
        function () {
          if (!focusedRef.current) setDraft(typeof props.value === 'string' ? props.value : '')
        },
        [props.value],
      )
      function commit() {
        focusedRef.current = false
        if (draft !== props.value) props.onCommit(draft)
      }
      return h(
        'label',
        { className: 'dc-field', title: props.title || props.label },
        props.label ? h('span', { className: 'dc-field-label' }, props.label) : null,
        h('input', {
          className: 'dc-input',
          type: 'text',
          value: draft,
          placeholder: props.placeholder || '',
          spellCheck: false,
          disabled: !!props.disabled,
          onFocus: function () {
            focusedRef.current = true
          },
          onChange: function (event) {
            setDraft(event.target.value)
          },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(typeof props.value === 'string' ? props.value : '')
              event.currentTarget.blur()
            }
          },
        }),
      )
    }

    function TextAreaField(props) {
      const [draft, setDraft] = React.useState(typeof props.value === 'string' ? props.value : '')
      const focusedRef = React.useRef(false)
      React.useEffect(
        function () {
          if (!focusedRef.current) setDraft(typeof props.value === 'string' ? props.value : '')
        },
        [props.value],
      )
      function commit() {
        focusedRef.current = false
        if (draft !== props.value) props.onCommit(draft)
      }
      return h(
        'label',
        { className: 'dc-field dc-field-col', title: props.title || props.label },
        props.label ? h('span', { className: 'dc-field-label' }, props.label) : null,
        h('textarea', {
          className: 'dc-textarea',
          value: draft,
          rows: props.rows || 2,
          spellCheck: false,
          onFocus: function () {
            focusedRef.current = true
          },
          onChange: function (event) {
            setDraft(event.target.value)
          },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(typeof props.value === 'string' ? props.value : '')
              event.currentTarget.blur()
            }
          },
        }),
      )
    }

    function SelectField(props) {
      return h(
        'label',
        { className: 'dc-field', title: props.title || props.label },
        h('span', { className: 'dc-field-label' }, props.label),
        h(
          'select',
          {
            className: 'dc-input dc-select',
            value: String(props.value),
            disabled: !!props.disabled,
            onChange: function (event) {
              props.onCommit(props.numeric ? Number(event.target.value) : event.target.value)
            },
          },
          (props.options || []).map(function (option) {
            return h('option', { key: option.value, value: String(option.value) }, option.label)
          }),
        ),
      )
    }

    function Segmented(props) {
      return h(
        'div',
        { className: 'dc-field dc-field-col' },
        props.label ? h('span', { className: 'dc-field-label' }, props.label) : null,
        h(
          'div',
          { className: 'dc-seg', role: 'group', 'aria-label': props.label },
          (props.options || []).map(function (option) {
            return h(
              'button',
              {
                key: option.value,
                type: 'button',
                title: option.title || option.label,
                'aria-pressed': props.value === option.value ? 'true' : 'false',
                disabled: Boolean(props.disabled),
                className: 'dc-seg-btn' + (props.value === option.value ? ' dc-active' : ''),
                onClick: function () {
                  if (props.value !== option.value) props.onCommit(option.value)
                },
              },
              option.label,
            )
          }),
        ),
      )
    }

    function safeSwatchColor(value) {
      if (typeof value !== 'string') return '#000000'
      if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
      if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        return (
          '#' +
          value.charAt(1) + value.charAt(1) +
          value.charAt(2) + value.charAt(2) +
          value.charAt(3) + value.charAt(3)
        )
      }
      return '#000000'
    }

    function SwatchField(props) {
      const [draft, setDraft] = React.useState(typeof props.value === 'string' ? props.value : '')
      const focusedRef = React.useRef(false)
      React.useEffect(
        function () {
          if (!focusedRef.current) setDraft(typeof props.value === 'string' ? props.value : '')
        },
        [props.value],
      )
      function commitText() {
        focusedRef.current = false
        if (draft !== props.value) props.onCommit(draft)
      }
      return h(
        'div',
        { className: 'dc-field', title: props.title || props.label },
        h('span', { className: 'dc-field-label' }, props.label),
        h('input', {
          className: 'dc-swatch',
          type: 'color',
          'aria-label': props.label,
          value: safeSwatchColor(props.value),
          disabled: !!props.disabled,
          onChange: function (event) {
            setDraft(event.target.value)
            props.onCommit(event.target.value)
          },
        }),
        h('input', {
          className: 'dc-input',
          type: 'text',
          value: draft,
          disabled: !!props.disabled,
          spellCheck: false,
          onFocus: function () {
            focusedRef.current = true
          },
          onChange: function (event) {
            setDraft(event.target.value)
          },
          onBlur: commitText,
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(typeof props.value === 'string' ? props.value : '')
              event.currentTarget.blur()
            }
          },
        }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Popover menus + dialogs
     * ---------------------------------------------------------------------------------------- */

    /**
     * Anchored popover rendered by the shell inside `.dc-app`. Closes on outside pointerdown,
     * Escape and scroll-away; anchors marked with `data-dc-menu-toggle` are ignored so a
     * second click on the trigger toggles instead of reopening.
     */
    function MenuPanel(props) {
      const nodeRef = React.useRef(null)
      const onClose = props.onClose
      React.useEffect(
        function () {
          function onPointerDown(event) {
            const node = nodeRef.current
            const target = event.target
            if (node && target && typeof node.contains === 'function' && node.contains(target)) return
            if (target && typeof target.closest === 'function' && target.closest('[data-dc-menu-toggle]')) {
              return
            }
            onClose()
          }
          function onKeyDown(event) {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (typeof event.preventDefault === 'function') event.preventDefault()
            onClose()
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          return function () {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
          }
        },
        [onClose],
      )
      return h(
        'div',
        { className: 'dc-menu-host' },
        h('div', { className: 'dc-menu-scrim', 'aria-hidden': 'true' }),
        h(
          'div',
          {
            className: 'dc-menu',
            role: 'menu',
            'aria-label': props.label,
            ref: nodeRef,
            style: props.style,
          },
          props.children,
        ),
      )
    }

    function MenuLabel(props) {
      return h('div', { className: 'dc-menu-label' }, props.children || props.label)
    }

    function MenuSeparator() {
      return h('div', { className: 'dc-menu-sep', role: 'separator' })
    }

    function MenuItem(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className:
            'dc-menu-item' +
            (props.danger ? ' dc-danger' : '') +
            (props.className ? ' ' + props.className : ''),
          title: props.title || undefined,
          disabled: !!props.disabled,
          onClick: function (event) {
            if (props.disabled) return
            props.onSelect(event)
          },
        },
        props.icon ? h('span', { className: 'dc-menu-item-icon' }, h(Glyph, { name: props.icon, size: 14 })) : null,
        h('span', { className: 'dc-menu-item-label' }, props.label),
        props.hint ? h('span', { className: 'dc-menu-item-hint' }, props.hint) : null,
        props.checked ? h('span', { className: 'dc-menu-item-check' }, h(Glyph, { name: 'check', size: 12 })) : null,
      )
    }

    /** Data-driven menu body: item objects in, menu rows out. */
    function MenuList(props) {
      const items = Array.isArray(props.items) ? props.items : []
      return items.map(function (item, index) {
        if (!item) return null
        const key = item.id || 'menu-' + index
        if (item.separator) return h(MenuSeparator, { key: key })
        if (item.heading) return h(MenuLabel, { key: key, label: item.heading })
        return h(MenuItem, {
          key: key,
          icon: item.icon,
          label: item.label,
          hint: item.hint,
          checked: item.checked,
          danger: item.danger,
          disabled: item.disabled,
          title: item.title,
          onSelect: function (event) {
            if (typeof item.onSelect === 'function') item.onSelect(event)
            if (props.closeOnSelect !== false && typeof props.onClose === 'function') props.onClose()
          },
        })
      })
    }

    /** Vertical panel splitter: pointer drag plus keyboard resize (arrow keys, Home resets). */
    function Splitter(props) {
      return h('div', {
        className: 'dc-splitter' + (props.active ? ' dc-splitter-active' : ''),
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': props.title,
        'aria-valuenow': Math.round(props.value),
        'aria-valuemin': props.min,
        'aria-valuemax': props.max,
        tabIndex: 0,
        title: props.title,
        onPointerDown: props.onPointerDown,
        onPointerMove: props.onPointerMove,
        onPointerUp: props.onPointerUp,
        onPointerCancel: props.onPointerCancel,
        onDoubleClick: props.onDoubleClick,
        onKeyDown: props.onKeyDown,
      })
    }

    function ModalDialog(props) {
      const onClose = props.onClose
      React.useEffect(
        function () {
          function onKeyDown(event) {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (typeof event.preventDefault === 'function') event.preventDefault()
            onClose()
          }
          document.addEventListener('keydown', onKeyDown, true)
          return function () {
            document.removeEventListener('keydown', onKeyDown, true)
          }
        },
        [onClose],
      )
      return h(
        'div',
        {
          className: 'dc-modal-backdrop',
          onPointerDown: function (event) {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'dc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
          h(
            'div',
            { className: 'dc-modal-head' },
            h('span', { className: 'dc-modal-title' }, props.title),
            h(IconButton, { icon: 'close', title: props.closeLabel, onClick: onClose }),
          ),
          props.children,
        ),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Layer tree
     * ---------------------------------------------------------------------------------------- */
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
.dc-ctxmenu { position: fixed; z-index: 80; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; min-width: 200px; max-width: 280px; padding: 4px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background: var(--dsw-alias-bg-overlay, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e4e8); border-radius: 8px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 6px rgba(15, 23, 42, 0.08); font-size: 12px; }
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

    /** One actionable row: { id, label, shortcut?, icon?, disabled?, danger?, checked?, reason?, run }. */
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
          run: function () {
            return typeof editor.arrangeSelection === 'function' ? editor.arrangeSelection('front') : false
          },
        }),
        contextMenuItem('bring-forward', 'Bring forward', {
          shortcut: 'Ctrl/Cmd+]',
          icon: 'up',
          disabled: locked || typeof editor.arrangeSelection !== 'function',
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
          ? item.reason || item.label
          : item.shortcut
            ? item.label + ' (' + item.shortcut + ')'
            : item.label
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
.dc-spacer { flex: 1 1 auto; min-width: 4px; }
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
      deleteArtboard: 'Delete artboard',
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

    /**
     * Delete an artboard from the layers panel. Prefers the editor's undoable `deleteArtboard`;
     * falls back to the raw op so the button works even on an older hook.
     */
    function deleteArtboardById(props, artboard) {
      if (!artboard || typeof artboard.id !== 'string') return
      const actions = (props && props.actions) || {}
      if (typeof actions.deleteArtboard === 'function') {
        actions.deleteArtboard(artboard.id)
        return
      }
      const editor = editorFromProps(props)
      if (editor && typeof editor.deleteArtboard === 'function') {
        editor.deleteArtboard(artboard.id)
        return
      }
      if (typeof actions.runOps === 'function') {
        actions.runOps([{ type: 'artboard.delete', artboardId: artboard.id }])
        return
      }
      if (editor && typeof editor.runOps === 'function') {
        editor.runOps([{ type: 'artboard.delete', artboardId: artboard.id }])
      }
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
            // Delete the artboard straight from the layers panel (also available on Delete /
            // right-click). Inline sizing keeps this out of the shared stylesheet.
            h(
              'button',
              {
                type: 'button',
                className: 'dc-ibtn dct-ab-del',
                title: TREE_COPY.deleteArtboard,
                'aria-label': TREE_COPY.deleteArtboard + ': ' + (artboard.name || artboard.id),
                style: { width: 16, height: 16, flex: '0 0 auto', opacity: 0.72 },
                onClick: function (event) {
                  event.preventDefault()
                  event.stopPropagation()
                  deleteArtboardById(props, artboard)
                },
              },
              h(TreeGlyph, { name: 'trash', size: 11 }),
            ),
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
    /* ------------------------------------------------------------------------------------------
     * Element comments: the per-layer thread + comment UI state shared with 53-batch.js
     *
     * `CommentThread` is rendered by the inspector (55-inspector.js) for the selected layer. It
     * keeps the v1 behaviour (resolve / reopen / delete / add) and adds filter chips with counts,
     * a newest/oldest ordering toggle, relative timestamps, an author chip, a "jump to layer"
     * action, hover highlighting of the commented layer, selection checkboxes for a batch send
     * and a compact empty state.
     *
     * The checkboxes and the "sent" markers live in COMMENT_UI (a tiny observable store keyed by
     * comment id) so the thread and the global Comments panel stay in sync. The store keeps no
     * document state: statuses stay `open` after a send (the agent resolves them) and the "sent"
     * marker is a quiet local flag for this page session only.
     * ---------------------------------------------------------------------------------------- */

    const COMMENT_UI_COPY = {
      all: 'All',
      openFilter: 'Open',
      resolvedFilter: 'Resolved',
      sentFilter: 'Sent',
      unsentFilter: 'Unsent',
      newestFirst: 'Newest first',
      oldestFirst: 'Oldest first',
      search: 'Search comments…',
      selectAllOpen: 'Select all open',
      selectAllOpenShort: 'All open',
      clearSelection: 'Clear',
      jumpToLayer: 'Jump to the commented layer',
      hoverHint: 'Highlight the layer on the canvas',
      sentTitle: 'Sent to the agent in this session (status stays open until the agent resolves it)',
      selectOne: 'Select this comment for a batch revision request',
      selectAll: 'Select all comments',
      sendToAgent: 'Send to agent',
      sending: 'Sending…',
      panelTitle: 'Comments',
      closePanel: 'Close comments',
      resolveAll: 'Resolve all shown',
      reopenAll: 'Reopen all shown',
      noMatch: 'No comments match this filter.',
      noCommentsYet: 'No comments yet.',
      addComment: 'New comment',
      saveOnly: 'Save only',
      sendComment: 'Send to agent',
      target: 'Target',
      noTarget: 'Select a layer or an artboard first',
      commentLimit: 'Comments are limited to 2000 characters',
    }

    const COMMENT_COMPOSER_LIMIT = 2000

    /* ------------------------------- shared comment UI state ------------------------------- */

    function createCommentUiStore() {
      const state = {
        selected: {},
        sent: {},
        panelOpen: false,
        busy: false,
        progress: '',
        error: '',
      }
      const listeners = []
      let snapshot = null

      function publish() {
        const selectedKeys = Object.keys(state.selected)
        const sentKeys = Object.keys(state.sent)
        const selectedIds = []
        const sentIds = []
        for (let index = 0; index < selectedKeys.length; index += 1) {
          if (state.selected[selectedKeys[index]] === true) selectedIds.push(selectedKeys[index])
        }
        for (let index = 0; index < sentKeys.length; index += 1) {
          if (state.sent[sentKeys[index]]) sentIds.push(sentKeys[index])
        }
        snapshot = {
          selected: state.selected,
          selectedIds: selectedIds,
          selectedCount: selectedIds.length,
          sent: state.sent,
          sentIds: sentIds,
          panelOpen: state.panelOpen,
          busy: state.busy,
          progress: state.progress,
          error: state.error,
        }
        for (let index = 0; index < listeners.length; index += 1) {
          try {
            listeners[index](snapshot)
          } catch (error) {
            /* a broken subscriber must never break the comment UI */
          }
        }
        return snapshot
      }

      function get() {
        return snapshot || publish()
      }

      function setPanelOpen(value) {
        const next = value === true
        if (state.panelOpen === next) return
        state.panelOpen = next
        if (!next) state.error = ''
        publish()
      }

      return {
        get: get,
        subscribe: function (listener) {
          if (typeof listener !== 'function') return function () {}
          listeners.push(listener)
          return function () {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          }
        },
        isSelected: function (commentId) {
          return typeof commentId === 'string' && state.selected[commentId] === true
        },
        setSelected: function (commentId, value) {
          if (typeof commentId !== 'string' || !commentId) return
          if (value === true) {
            if (state.selected[commentId] === true) return
            state.selected[commentId] = true
          } else {
            if (state.selected[commentId] !== true) return
            delete state.selected[commentId]
          }
          publish()
        },
        toggleSelected: function (commentId) {
          if (typeof commentId !== 'string' || !commentId) return
          state.selected[commentId] = state.selected[commentId] !== true
          publish()
        },
        selectMany: function (commentIds, value) {
          const list = Array.isArray(commentIds) ? commentIds : []
          let changed = false
          for (let index = 0; index < list.length; index += 1) {
            const id = list[index]
            if (typeof id !== 'string' || !id) continue
            if (value === true) {
              if (state.selected[id] !== true) {
                state.selected[id] = true
                changed = true
              }
            } else if (state.selected[id] === true) {
              delete state.selected[id]
              changed = true
            }
          }
          if (changed) publish()
        },
        clearSelected: function () {
          if (!Object.keys(state.selected).length) return
          state.selected = {}
          publish()
        },
        isSent: function (commentId) {
          return typeof commentId === 'string' && !!state.sent[commentId]
        },
        sentAt: function (commentId) {
          const value = typeof commentId === 'string' ? state.sent[commentId] : ''
          return typeof value === 'string' ? value : ''
        },
        markSent: function (commentIds) {
          const list = Array.isArray(commentIds) ? commentIds : []
          if (!list.length) return
          const iso = new Date().toISOString()
          for (let index = 0; index < list.length; index += 1) {
            if (typeof list[index] === 'string' && list[index]) state.sent[list[index]] = iso
          }
          publish()
        },
        forgetSent: function (commentId) {
          if (typeof commentId !== 'string' || !state.sent[commentId]) return
          delete state.sent[commentId]
          publish()
        },
        setPanelOpen: setPanelOpen,
        togglePanel: function () {
          setPanelOpen(!state.panelOpen)
        },
        setBusy: function (value) {
          const next = value === true
          if (state.busy === next) return
          state.busy = next
          if (!next) state.progress = ''
          publish()
        },
        setProgress: function (text) {
          const next = typeof text === 'string' ? text : ''
          if (state.progress === next) return
          state.progress = next
          publish()
        },
        setError: function (message) {
          const next = typeof message === 'string' ? message : ''
          if (state.error === next) return
          state.error = next
          publish()
        },
      }
    }

    const COMMENT_UI = createCommentUiStore()

    /** The extension context captured from a rendered registry entry (toolbar/app panel). */
    const COMMENT_TOOLS = { api: null }

    function rememberCommentContext(api) {
      if (isObject(api) && isObject(api.actions)) COMMENT_TOOLS.api = api
    }

    function commentEditorApi() {
      return COMMENT_TOOLS.api
    }

    /** Subscribe a component to COMMENT_UI. */
    function useCommentUi() {
      const [snapshot, setSnapshot] = React.useState(function () {
        return COMMENT_UI.get()
      })
      React.useEffect(
        function () {
          return COMMENT_UI.subscribe(function (next) {
            setSnapshot(next)
          })
        },
        [],
      )
      return snapshot
    }

    /* ------------------------------- comment presentation helpers ------------------------------- */

    function commentParseTime(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value !== 'string' || !value) return 0
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    /** "just now" / "2m ago" / "3h ago" / "4d ago" / "2w ago" for an ISO timestamp. */
    function commentRelativeTime(value, nowMs) {
      const then = commentParseTime(value)
      if (!then) return ''
      const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now()
      const delta = now - then
      if (delta < 0) return 'just now'
      const seconds = Math.round(delta / 1000)
      if (seconds < 45) return 'just now'
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return minutes + 'm ago'
      const hours = Math.round(minutes / 60)
      if (hours < 24) return hours + 'h ago'
      const days = Math.round(hours / 24)
      if (days < 7) return days + 'd ago'
      const weeks = Math.round(days / 7)
      if (weeks < 5) return weeks + 'w ago'
      const months = Math.round(days / 30)
      if (months < 12) return months + 'mo ago'
      return Math.round(days / 365) + 'y ago'
    }

    /** One comment + its resolved target layer/artboard (missing targets are tolerated). */
    function commentRowOf(api, comment) {
      const record = isObject(comment) ? comment : {}
      const doc = api && isObject(api.doc) ? api.doc : null
      let found = null
      if (doc && typeof record.layerId === 'string' && record.layerId) {
        found = findLayerById(doc, record.layerId)
      }
      let artboard = found ? found.artboard : null
      if (!artboard && doc && typeof record.artboardId === 'string' && record.artboardId) {
        artboard = findArtboardById(doc, record.artboardId)
      }
      const layer = found ? found.layer : null
      const node =
        layer && api && api.tree && api.tree.byId ? api.tree.byId.get(layer.id) || null : null
      return {
        comment: record,
        layer: layer,
        artboard: artboard,
        parentId: found ? found.parentId : '',
        node: node,
        missingLayer: typeof record.layerId === 'string' && !!record.layerId && !layer,
      }
    }

    /** Highlight the comment's layer (or artboard) on the canvas by toggling a CSS class. */
    function highlightCommentTarget(artboardId, layerId, enabled) {
      try {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
        const nodes = document.querySelectorAll('[data-layer-id], [data-artboard-id]')
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]
          if (!node || !node.classList) continue
          const layerMatch =
            typeof layerId === 'string' && layerId && node.getAttribute('data-layer-id') === layerId
          const boardMatch =
            !layerId &&
            typeof artboardId === 'string' &&
            artboardId &&
            node.getAttribute('data-artboard-id') === artboardId
          if (!layerMatch && !boardMatch) continue
          if (enabled) node.classList.add('dc-cmt-hl')
          else node.classList.remove('dc-cmt-hl')
        }
      } catch (error) {
        /* the highlight is decorative; never break the panel over it */
      }
    }

    function highlightCommentRow(row, enabled) {
      if (!isObject(row)) return
      const layerId = row.layer && typeof row.layer.id === 'string' ? row.layer.id : ''
      const artboardId =
        row.artboard && typeof row.artboard.id === 'string'
          ? row.artboard.id
          : row.comment && typeof row.comment.artboardId === 'string'
            ? row.comment.artboardId
            : ''
      if (!layerId && !artboardId) return
      highlightCommentTarget(artboardId, layerId, enabled === true)
    }

    function commentActionApi(api) {
      const resolved = api || commentEditorApi()
      return {
        actions: resolved && isObject(resolved.actions) ? resolved.actions : null,
        editor: resolved && isObject(resolved.editor) ? resolved.editor : null,
      }
    }

    /** Select the commented layer (or its artboard) through the curated editor actions. */
    function commentSelectRow(api, row) {
      if (!isObject(row)) return false
      const resolved = commentActionApi(api)
      const actions = resolved.actions
      const editor = resolved.editor
      const selectLayer =
        actions && typeof actions.selectLayer === 'function'
          ? actions.selectLayer
          : editor && typeof editor.selectLayer === 'function'
            ? editor.selectLayer
            : null
      const layer = row.layer
      const artboard = row.artboard
      if (layer && selectLayer) {
        selectLayer(layer.id, artboard && artboard.id ? artboard.id : null)
        return true
      }
      const selectArtboard =
        actions && typeof actions.selectArtboard === 'function'
          ? actions.selectArtboard
          : editor && typeof editor.selectArtboard === 'function'
            ? editor.selectArtboard
            : null
      if (!layer && artboard && selectArtboard) {
        selectArtboard(artboard.id)
        return true
      }
      return false
    }

    /**
     * Set the status of one or many comments. A list goes through the v2
     * `comment.batch_update` op (one request, one error listing every missing id); a single
     * comment keeps the curated action that also patches the local document speculatively.
     */
    function commentSetStatuses(api, commentIds, status) {
      const ids = []
      const list = Array.isArray(commentIds) ? commentIds : [commentIds]
      for (let index = 0; index < list.length; index += 1) {
        const id = list[index]
        if (typeof id === 'string' && id && ids.indexOf(id) < 0) ids.push(id)
      }
      const nextStatus = status === 'resolved' ? 'resolved' : 'open'
      if (!ids.length) return Promise.resolve({ ok: true, count: 0 })
      const resolved = commentActionApi(api)
      const actions = resolved.actions
      const editor = resolved.editor
      if (ids.length > 1 && editor && typeof editor.runOps === 'function') {
        return Promise.resolve()
          .then(function () {
            return editor.runOps([
              { type: 'comment.batch_update', commentIds: ids, status: nextStatus },
            ])
          })
          .then(function (result) {
            if (result && result.ok === false) {
              const first = result.errors && result.errors[0]
              return {
                ok: false,
                error: (first && (first.message || first.code)) || 'Could not update the comments',
              }
            }
            return { ok: true, count: ids.length }
          })
          .catch(function (error) {
            return { ok: false, error: messageOf(error) }
          })
      }
      if (actions && typeof actions.setCommentStatus === 'function') {
        try {
          for (let index = 0; index < ids.length; index += 1) {
            actions.setCommentStatus(ids[index], nextStatus)
          }
          return Promise.resolve({ ok: true, count: ids.length })
        } catch (error) {
          return Promise.resolve({ ok: false, error: messageOf(error) })
        }
      }
      if (editor && typeof editor.setCommentStatus === 'function') {
        try {
          for (let index = 0; index < ids.length; index += 1) {
            editor.setCommentStatus(ids[index], nextStatus)
          }
          return Promise.resolve({ ok: true, count: ids.length })
        } catch (error) {
          return Promise.resolve({ ok: false, error: messageOf(error) })
        }
      }
      return Promise.resolve({ ok: false, error: 'Comment status is unavailable' })
    }

    function commentDeleteRow(api, commentId) {
      if (typeof commentId !== 'string' || !commentId) return false
      const resolved = commentActionApi(api)
      const actions = resolved.actions
      const editor = resolved.editor
      const remove =
        actions && typeof actions.deleteComment === 'function'
          ? actions.deleteComment
          : editor && typeof editor.deleteCommentById === 'function'
            ? editor.deleteCommentById
            : null
      if (!remove) return false
      try {
        remove(commentId)
        return true
      } catch (error) {
        return false
      }
    }

    function commentIsResolved(comment) {
      return isObject(comment) && comment.status === 'resolved'
    }

    /** Rows for a comment list, filtered by the Open/Resolved/All chips and sorted. */
    function commentRowsFor(api, comments, filter, order, sentMap) {
      const list = Array.isArray(comments) ? comments : []
      const rows = []
      const sent = isObject(sentMap) ? sentMap : {}
      for (let index = 0; index < list.length; index += 1) {
        const comment = list[index]
        if (!isObject(comment)) continue
        const resolved = commentIsResolved(comment)
        if (filter === 'open' && resolved) continue
        if (filter === 'resolved' && !resolved) continue
        if (filter === 'sent' && !sent[comment.id]) continue
        if (filter === 'unsent' && sent[comment.id]) continue
        const row = commentRowOf(api, comment)
        row.sentAt = typeof sent[comment.id] === 'string' ? sent[comment.id] : ''
        rows.push(row)
      }
      rows.sort(function (first, second) {
        const firstResolved = commentIsResolved(first.comment)
        const secondResolved = commentIsResolved(second.comment)
        if (firstResolved !== secondResolved) return firstResolved ? 1 : -1
        const firstTime = commentParseTime(first.comment.createdAt)
        const secondTime = commentParseTime(second.comment.createdAt)
        if (firstTime !== secondTime) {
          return order === 'oldest' ? firstTime - secondTime : secondTime - firstTime
        }
        return String(first.comment.id).localeCompare(String(second.comment.id))
      })
      return rows
    }

    function commentMatchesQuery(row, query) {
      const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
      if (!needle) return true
      const comment = isObject(row) && isObject(row.comment) ? row.comment : {}
      const layer = isObject(row) && isObject(row.layer) ? row.layer : {}
      const artboard = isObject(row) && isObject(row.artboard) ? row.artboard : {}
      const haystack = [
        comment.text,
        comment.id,
        comment.author,
        layer.name,
        layer.id,
        layer.type,
        artboard.name,
        artboard.id,
      ]
        .filter(function (value) {
          return typeof value === 'string' && value
        })
        .join(' ')
        .toLowerCase()
      return haystack.indexOf(needle) >= 0
    }

    /** Filter chips with counts for a comment list. */
    function commentFilterCounts(comments, sentMap) {
      const list = Array.isArray(comments) ? comments : []
      const sent = isObject(sentMap) ? sentMap : {}
      let open = 0
      let resolved = 0
      let sentCount = 0
      for (let index = 0; index < list.length; index += 1) {
        const comment = list[index]
        if (!isObject(comment)) continue
        if (commentIsResolved(comment)) resolved += 1
        else open += 1
        if (comment.id && sent[comment.id]) sentCount += 1
      }
      return {
        all: open + resolved,
        open: open,
        resolved: resolved,
        sent: sentCount,
        unsent: open + resolved - sentCount,
      }
    }

    /* ------------------------------- per-layer thread ------------------------------- */

    function CommentThread(props) {
      const strings = props.strings || currentStrings()
      const comments = Array.isArray(props.comments) ? props.comments : []
      const actions = isObject(props.actions) ? props.actions : {}
      const ui = useCommentUi()
      const api = commentEditorApi()
      const [filter, setFilter] = React.useState('all')
      const [order, setOrder] = React.useState('newest')
      const [error, setError] = React.useState('')
      const [bulkBusy, setBulkBusy] = React.useState(false)

      const counts = commentFilterCounts(comments, ui.sent)
      const rows = commentRowsFor(api, comments, filter, order, ui.sent)
      const threadIds = []
      for (let index = 0; index < comments.length; index += 1) {
        if (comments[index] && typeof comments[index].id === 'string') threadIds.push(comments[index].id)
      }
      let selectedHere = 0
      for (let index = 0; index < threadIds.length; index += 1) {
        if (ui.selected[threadIds[index]] === true) selectedHere += 1
      }
      const targetRow = rows.length ? rows[0] : comments.length ? commentRowOf(api, comments[0]) : null
      const canJump = !!(
        api &&
        ((isObject(api.actions) && typeof api.actions.selectLayer === 'function') ||
          (isObject(api.editor) && typeof api.editor.selectLayer === 'function'))
      )
      const canSend = selectedHere > 0 && !!api && !ui.busy
      const openComposer = typeof actions.openComposer === 'function' ? actions.openComposer : null
      const openIdsHere = []
      for (let index = 0; index < comments.length; index += 1) {
        const comment = comments[index]
        if (isObject(comment) && comment.id && !commentIsResolved(comment)) openIdsHere.push(comment.id)
      }
      const selectAllHere = selectedHere < openIdsHere.length && openIdsHere.length > 0

      function jumpToTarget() {
        if (!targetRow) return
        commentSelectRow(api, targetRow)
      }

      function setStatus(commentId, status) {
        setError('')
        const action = status === 'resolved' ? actions.resolveComment : actions.reopenComment
        if (typeof action === 'function') {
          try {
            action(commentId)
            return
          } catch (failure) {
            setError(messageOf(failure))
            return
          }
        }
        commentSetStatuses(api, [commentId], status).then(function (result) {
          if (!result.ok) setError(result.error || 'Could not update the comment')
        })
      }

      function removeComment(commentId) {
        setError('')
        if (typeof actions.deleteComment === 'function') {
          try {
            actions.deleteComment(commentId)
            COMMENT_UI.forgetSent(commentId)
            return
          } catch (failure) {
            setError(messageOf(failure))
            return
          }
        }
        if (!commentDeleteRow(api, commentId)) setError('Could not delete the comment')
        else COMMENT_UI.forgetSent(commentId)
      }

      function sendSelected() {
        if (!canSend) return undefined
        setError('')
        setBulkBusy(true)
        return submitComments(ui.selectedIds, api)
          .then(function (result) {
            if (!result || result.ok !== true) {
              setError((result && result.error) || 'Could not send the comments')
              return
            }
            COMMENT_UI.clearSelected()
          })
          .catch(function (failure) {
            setError(messageOf(failure))
          })
          .then(function () {
            setBulkBusy(false)
          })
      }

      function filterChip(key, label, count) {
        const active = filter === key
        return h(
          'button',
          {
            key: key,
            type: 'button',
            className: 'dc-cmt-chip' + (active ? ' dc-active' : ''),
            'aria-pressed': active,
            title: label,
            onClick: function () {
              setFilter(key)
            },
          },
          h('span', null, label),
          h('span', { className: 'dc-cmt-chip-count' }, String(count)),
        )
      }

      return h(
        'div',
        { className: 'dc-section dc-cmt-thread', 'data-comment-thread': '1' },
        h(CommentStyleTag, { key: 'style' }),
        h(
          'div',
          { key: 'head', className: 'dc-cmt-thread-head' },
          h(
            'div',
            { className: 'dc-section-title' },
            strings.comments + ' (' + String(counts.open) + '/' + String(counts.all) + ')',
          ),
          counts.open > 0
            ? h('span', { className: 'dc-badge', title: counts.open + ' open' }, String(counts.open))
            : null,
        ),
        h(
          'div',
          { key: 'chips', className: 'dc-cmt-toolbar' },
          h(
            'div',
            { className: 'dc-cmt-chips', role: 'group', 'aria-label': strings.comments },
            filterChip('open', COMMENT_UI_COPY.openFilter, counts.open),
            filterChip('resolved', COMMENT_UI_COPY.resolvedFilter, counts.resolved),
            filterChip('all', COMMENT_UI_COPY.all, counts.all),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-link dc-cmt-order',
              title: order === 'newest' ? COMMENT_UI_COPY.newestFirst : COMMENT_UI_COPY.oldestFirst,
              'aria-label':
                order === 'newest' ? COMMENT_UI_COPY.newestFirst : COMMENT_UI_COPY.oldestFirst,
              onClick: function () {
                setOrder(order === 'newest' ? 'oldest' : 'newest')
              },
            },
            order === 'newest' ? '↓' : '↑',
          ),
          canJump
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dc-link dc-cmt-jump',
                  title: COMMENT_UI_COPY.jumpToLayer,
                  'aria-label': COMMENT_UI_COPY.jumpToLayer,
                  onClick: jumpToTarget,
                },
                '\u2197',
              )
            : null,
          selectAllHere
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dc-link dc-cmt-select-all',
                  title: COMMENT_UI_COPY.selectAll,
                  onClick: function () {
                    COMMENT_UI.selectMany(openIdsHere, true)
                  },
                },
                COMMENT_UI_COPY.selectAllOpenShort,
              )
            : null,
        ),
        rows.length === 0
          ? h(
              'div',
              { key: 'empty', className: 'dc-muted dc-cmt-empty' },
              comments.length === 0 ? strings.noComments : COMMENT_UI_COPY.noMatch,
            )
          : h(
              'div',
              { key: 'rows', className: 'dc-cmt-rows' },
              rows.map(function (row) {
                const comment = row.comment
                const resolved = commentIsResolved(comment)
                const selected = ui.selected[comment.id] === true
                const sentAt = row.sentAt
                return h(
                  'div',
                  {
                    key: String(comment.id),
                    className:
                      'dc-comment dc-cmt-row' +
                      (resolved ? ' dc-resolved' : '') +
                      (selected ? ' dc-cmt-selected' : ''),
                    'data-comment-id': comment.id,
                    onMouseEnter: function () {
                      highlightCommentRow(row, true)
                    },
                    onMouseLeave: function () {
                      highlightCommentRow(row, false)
                    },
                  },
                  resolved
                    ? null
                    : h('input', {
                        type: 'checkbox',
                        className: 'dc-cmt-check',
                        checked: selected,
                        title: COMMENT_UI_COPY.selectOne,
                        'aria-label': COMMENT_UI_COPY.selectOne,
                        onChange: function () {
                          COMMENT_UI.toggleSelected(comment.id)
                        },
                      }),
                  h(
                    'div',
                    { className: 'dc-cmt-body' },
                    h('div', { className: 'dc-comment-text' }, comment.text || ''),
                    h(
                      'div',
                      { className: 'dc-comment-meta' },
                      h(
                        'span',
                        { className: 'dc-cmt-author', title: comment.author || 'user' },
                        comment.author || 'user',
                      ),
                      h(
                        'span',
                        { className: 'dc-comment-status' },
                        resolved ? strings.resolved : strings.open,
                      ),
                      comment.createdAt
                        ? h(
                            'span',
                            { className: 'dc-cmt-time', title: comment.createdAt },
                            commentRelativeTime(comment.createdAt),
                          )
                        : null,
                      sentAt
                        ? h(
                            'span',
                            { className: 'dc-cmt-sent', title: COMMENT_UI_COPY.sentTitle },
                            'sent ' + commentRelativeTime(sentAt),
                          )
                        : null,
                    ),
                    h(
                      'div',
                      { className: 'dc-comment-actions' },
                      resolved
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dc-link',
                              onClick: function () {
                                setStatus(comment.id, 'open')
                              },
                            },
                            strings.reopen,
                          )
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: 'dc-link',
                              onClick: function () {
                                setStatus(comment.id, 'resolved')
                              },
                            },
                            strings.resolve,
                          ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dc-link dc-danger',
                          title: strings.deleteComment,
                          'aria-label': strings.deleteComment,
                          onClick: function () {
                            removeComment(comment.id)
                          },
                        },
                        strings.delete,
                      ),
                    ),
                  ),
                )
              }),
            ),
        selectedHere > 0
          ? h(
              'div',
              { key: 'bulk', className: 'dc-cmt-bulk' },
              h(
                'span',
                { className: 'dc-cmt-bulk-text' },
                String(selectedHere) + ' selected',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn dc-btn-primary',
                  disabled: !canSend,
                  title: COMMENT_UI_COPY.sendToAgent,
                  onClick: sendSelected,
                },
                bulkBusy || ui.busy ? COMMENT_UI_COPY.sending : COMMENT_UI_COPY.sendToAgent,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-btn',
                  disabled: ui.busy,
                  onClick: function () {
                    COMMENT_UI.clearSelected()
                  },
                },
                COMMENT_UI_COPY.clearSelection,
              ),
            )
          : null,
        error ? h('div', { key: 'error', className: 'dc-cmt-error' }, error) : null,
        props.canAdd && openComposer
          ? h(
              'button',
              {
                key: 'add',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                onClick: openComposer,
              },
              strings.addComment,
            )
          : null,
      )
    }

    /* ------------------------------- styles (own classes only) ------------------------------- */

    const COMMENT_CSS = `
.dc-cmt-thread { gap: 5px; }
.dc-cmt-thread-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.dc-cmt-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dc-cmt-chips { display: inline-flex; align-items: center; gap: 1px; padding: 1px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); min-width: 0; max-width: 100%; flex-wrap: wrap; }
.dc-cmt-chip { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 5px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 10px; cursor: pointer; white-space: nowrap; }
.dc-cmt-chip.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dc-cmt-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dc-cmt-chip-count { font-variant-numeric: tabular-nums; opacity: 0.72; }
.dc-cmt-order, .dc-cmt-jump { font-size: 11px; line-height: 1; padding: 0 2px; }
.dc-cmt-rows { display: flex; flex-direction: column; gap: 4px; }
.dc-cmt-row { flex-direction: row; align-items: flex-start; gap: 5px; padding: 4px 5px; }
.dc-cmt-row.dc-cmt-selected { border-color: var(--dsw-alias-brand-primary); }
.dc-cmt-row:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dc-cmt-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 auto; }
.dc-cmt-check { flex: 0 0 auto; width: 12px; height: 12px; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dc-cmt-check:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dc-cmt-author { display: inline-flex; align-items: center; max-width: 96px; padding: 0 4px; height: 14px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-cmt-time { font-variant-numeric: tabular-nums; }
.dc-cmt-sent { color: var(--dsw-alias-state-success-primary); font-variant-numeric: tabular-nums; }
.dc-cmt-empty { padding: 2px 1px; }
.dc-cmt-error { color: var(--dsw-alias-state-error-primary); font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
.dc-cmt-bulk { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 5px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); }
.dc-cmt-bulk-text { flex: 1 1 auto; min-width: 0; font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dc-layer.dc-cmt-hl, .dc-board-wrap.dc-cmt-hl { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
@media (hover: hover) and (pointer: fine) {
.dc-cmt-row:hover { border-color: var(--dsw-alias-border-l2); }
.dc-cmt-chip:hover:not(.dc-active) { color: var(--dsw-alias-label-primary); }
}
@media (prefers-reduced-motion: reduce) {
.dc-cmt-row, .dc-cmt-chip { transition: none; }
}
`

    function CommentStyleTag() {
      return h('style', { dangerouslySetInnerHTML: { __html: COMMENT_CSS } })
    }
    /* ------------------------------------------------------------------------------------------
     * Comment workflow extras: batch send to the agent + the global Comments panel
     *
     * Today one comment = one chat message. This part adds "collect several comments and send
     * them as ONE revision request":
     *   - selection in the per-layer thread (52-comments.js) and in this global panel, keyed by
     *     comment id in COMMENT_UI and shared by both,
     *   - the panel lists every comment in the document grouped by artboard → layer, with
     *     All / Open / Resolved / Sent / Unsent filters, search, per-row resolve/reopen/delete,
     *     "Select all open", bulk resolve/reopen (one `comment.batch_update` op) and a primary
     *     "Send N comments to agent" action with a busy state and inline errors,
     *   - `submitComments(commentIds)` builds ONE message with `buildCommentMessage`
     *     (35-comment-msg.js) and sends it through the documented session path: `sendCommentChat`
     *     from 70-editor.js when the extension context exposes it, otherwise a self-contained
     *     sender built on `runtime.sessions` (00-core.js).
     *
     * Guardrails: at most COMMENT_BATCH_LIMIT (20) comments per message — larger selections are
     * chunked with a progress label — and statuses stay `open` after a send (the agent resolves
     * them). The quiet "sent" marker is component state only (COMMENT_UI.sent), never a document
     * field.
     * ---------------------------------------------------------------------------------------- */

    const COMMENT_BATCH_COPY = {
      toolbarTitle: 'Comments panel (Alt+C)',
      close: 'Close comments',
      sendNone: 'Send comments to agent',
      sendOne: 'Send 1 comment to agent',
      sendMany: 'Send N comments to agent',
      sending: 'Sending…',
      sendHint: 'Select comments to send them as one revision request',
      sentNote: 'Statuses stay open — the agent resolves each comment when it is done.',
      addComment: 'New comment',
      cancel: 'Cancel',
      saveOnly: 'Save only',
      sendNow: 'Send to agent',
      saved: 'Comment saved.',
      sent: 'Comment sent to the agent.',
      savedOnlyHint: 'Saved on the board without a chat message.',
      emptyTitle: 'No comments in this design yet',
      emptyHint: 'Switch on comment mode, click an element and describe the change you want.',
      noMatchTitle: 'Nothing matches these filters',
      noMatchHint: 'Try another filter or clear the search.',
      missingLayer: 'layer deleted',
      boardLevel: 'Artboard-level comment',
      selectAll: 'Select all open',
      clear: 'Clear',
      resolveAll: 'Resolve all shown',
      reopenAll: 'Reopen all shown',
      resolveAllHint: 'Resolve every comment currently shown (one comment.batch_update op)',
      reopenAllHint: 'Reopen every resolved comment currently shown (one comment.batch_update op)',
      resolve: 'Resolve',
      reopen: 'Reopen',
      remove: 'Delete',
      jump: 'Jump to layer',
      selectRow: 'Select for the batch request',
      sessionUnavailable: 'The chat session is not available',
      promptFailed: 'The chat request failed',
      chunkNote: 'Sent in several messages (20 comments per message).',
    }

    /* ------------------------------- session sending ------------------------------- */

    /** The entry payload `buildCommentMessage` needs for one comment row. */
    function commentEntryForSend(row) {
      const comment = row && isObject(row.comment) ? row.comment : {}
      const layer = row && isObject(row.layer) ? row.layer : null
      const artboard = row && isObject(row.artboard) ? row.artboard : null
      return {
        commentId: typeof comment.id === 'string' ? comment.id : '',
        text: typeof comment.text === 'string' ? comment.text : '',
        status: typeof comment.status === 'string' ? comment.status : 'open',
        author: typeof comment.author === 'string' ? comment.author : '',
        createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : '',
        artboardId: artboard && typeof artboard.id === 'string' ? artboard.id : comment.artboardId || '',
        layerId: layer && typeof layer.id === 'string' ? layer.id : comment.layerId || '',
        artboard: artboard,
        layer: layer,
        parentId: row && typeof row.parentId === 'string' ? row.parentId : '',
        renderedRect: row && row.node && isObject(row.node.worldRect) ? row.node.worldRect : null,
      }
    }

    /** Best-effort session id for the self-contained sender (see the report for the patch). */
    function commentSendSessionId(api) {
      const candidates = [
        api && api.sessionId,
        api && api.editor && api.editor.sessionId,
        api && api.session && api.session.id,
        api && api.editor && api.editor.session && api.editor.session.id,
      ]
      for (let index = 0; index < candidates.length; index += 1) {
        const value = candidates[index]
        if (typeof value === 'string' && value) return value
      }
      try {
        if (typeof location !== 'undefined' && location && typeof location.href === 'string') {
          const url = new URL(location.href)
          const fromQuery = url.searchParams.get('sessionId') || url.searchParams.get('session')
          if (fromQuery) return fromQuery
          const match = /(?:sessionId|session)=([^&/]+)/.exec(String(url.hash || ''))
          if (match && match[1]) return decodeURIComponent(match[1])
        }
      } catch (error) {
        /* the URL is only a last-resort hint */
      }
      return ''
    }

    /**
     * Send one comment or a batch as a single chat message.
     * 1. `editor.sendCommentChat(details)` (70-editor.js) — the documented path, already used by
     *    the single-comment composer: it builds the text with `buildCommentMessage` and calls
     *    `sessions.using(…).prompt([text], 'queue')`. The builder accepts `comments: [...]`, so
     *    single and batch share one code path.
     * 2. Self-contained sender over `runtime.sessions` (00-core.js) when the editor does not
     *    expose the helper — the same three calls, no dependency on another part's file.
     */
    function sendCommentBatchMessage(api, details) {
      const editor = api && isObject(api.editor) ? api.editor : null
      const entries = details && Array.isArray(details.comments) ? details.comments : []
      const count = entries.length

      if (editor && typeof editor.sendCommentChat === 'function') {
        return Promise.resolve()
          .then(function () {
            return editor.sendCommentChat(details)
          })
          .then(function () {
            beacon('comment-batch-sent', { count: count, via: 'sendCommentChat' })
          })
      }

      const text = buildCommentMessage(details, api && api.strings)
      const sessions = runtime.sessions
      const sessionId = commentSendSessionId(api)
      if (sessions && typeof sessions.using === 'function' && sessionId) {
        return Promise.resolve()
          .then(function () {
            return sessions.using(sessionId, { source: 'controllerOperation' }, function (reference) {
              const session = reference && reference.binding ? reference.binding.session : null
              if (!session || typeof session.prompt !== 'function') {
                throw new Error(COMMENT_BATCH_COPY.sessionUnavailable)
              }
              return Promise.resolve(session.prompt([{ type: 'text', text: text }], 'queue')).then(
                function (result) {
                  if (result && result.ok === false) {
                    const detail = result.error || {}
                    throw new Error(detail.message || detail.code || 'prompt rejected')
                  }
                  return true
                },
              )
            })
          })
          .then(function () {
            beacon('comment-batch-sent', { count: count, via: 'runtime.sessions' })
          })
      }

      if (editor && typeof editor.submitComments === 'function') {
        return Promise.resolve()
          .then(function () {
            return editor.submitComments(
              entries.map(function (entry) {
                return entry.commentId
              }),
            )
          })
          .then(function () {
            beacon('comment-batch-sent', { count: count, via: 'editor.submitComments' })
          })
      }

      beacon('comment-batch-unsendable', {
        hasSessions: !!(sessions && typeof sessions.using === 'function'),
        hasSessionId: !!sessionId,
        hasSendCommentChat: !!(editor && typeof editor.sendCommentChat === 'function'),
      })
      return Promise.reject(
        new Error(((api && api.strings && api.strings.sessionUnavailable) || COMMENT_BATCH_COPY.sessionUnavailable) + ' — no send bridge'),
      )
    }

    /**
     * Turn comment ids into ONE revision request (chunked at COMMENT_BATCH_LIMIT comments per
     * message), mark them sent and keep their status `open`. Returns `{ ok, count, chunks }` or
     * `{ ok:false, error }`; the caller shows the error inline.
     */
    function submitComments(commentIds, apiOverride) {
      let api = apiOverride || commentEditorApi()
      // A key handler can be handed a context captured before the document loaded; prefer the
      // freshly captured one when the given context has no document.
      if (!isObject(api) || !isObject(api.doc)) {
        const fresh = commentEditorApi()
        if (isObject(fresh) && isObject(fresh.doc)) api = fresh
      }
      if (!isObject(api)) {
        return Promise.resolve({ ok: false, error: 'The comment panel is not ready yet' })
      }
      const doc = api.doc
      if (!isObject(doc)) {
        return Promise.resolve({ ok: false, error: 'The design is not loaded yet' })
      }
      const wanted = Array.isArray(commentIds) ? commentIds : []
      const seen = {}
      const rows = []
      for (let index = 0; index < wanted.length; index += 1) {
        const commentId = wanted[index]
        if (typeof commentId !== 'string' || !commentId || seen[commentId]) continue
        seen[commentId] = true
        const comments = commentsOf(doc)
        let record = null
        for (let cursor = 0; cursor < comments.length; cursor += 1) {
          if (isObject(comments[cursor]) && comments[cursor].id === commentId) {
            record = comments[cursor]
            break
          }
        }
        if (!record) continue
        const row = commentRowOf(api, record)
        row.sentAt = ''
        rows.push(row)
      }
      if (!rows.length) {
        return Promise.resolve({ ok: false, error: 'Those comments no longer exist' })
      }

      const chunks = []
      for (let start = 0; start < rows.length; start += COMMENT_BATCH_LIMIT) {
        chunks.push(rows.slice(start, start + COMMENT_BATCH_LIMIT))
      }
      const boardPath = api.boardPath
      const version = api.version

      COMMENT_UI.setBusy(true)
      COMMENT_UI.setError('')
      COMMENT_UI.setProgress('')
      let sentCount = 0

      function sendChunk(chunkIndex) {
        if (chunkIndex >= chunks.length) return Promise.resolve()
        const chunk = chunks[chunkIndex]
        const entries = []
        for (let index = 0; index < chunk.length; index += 1) {
          entries.push(commentEntryForSend(chunk[index]))
        }
        COMMENT_UI.setProgress(
          chunks.length > 1 ? 'Sending ' + (chunkIndex + 1) + '/' + chunks.length + '…' : '',
        )
        return sendCommentBatchMessage(api, {
          boardPath: boardPath,
          version: version,
          comments: entries,
          note:
            chunks.length > 1
              ? 'Batch ' + (chunkIndex + 1) + ' of ' + chunks.length + ' — ' + COMMENT_BATCH_LIMIT + ' comments per message.'
              : '',
        }).then(function () {
          const ids = []
          for (let index = 0; index < chunk.length; index += 1) {
            if (chunk[index].comment && chunk[index].comment.id) {
              ids.push(chunk[index].comment.id)
            }
          }
          COMMENT_UI.markSent(ids)
          sentCount += chunk.length
          return sendChunk(chunkIndex + 1)
        })
      }

      return sendChunk(0)
        .then(function () {
          COMMENT_UI.clearSelected()
          return { ok: true, count: sentCount, chunks: chunks.length }
        })
        .catch(function (error) {
          const message = messageOf(error)
          COMMENT_UI.setError(message)
          beacon('comment-batch-failed', { message: message.slice(0, 180), sent: sentCount })
          return { ok: false, error: message, count: sentCount, chunks: chunks.length }
        })
        .then(function (result) {
          COMMENT_UI.setBusy(false)
          COMMENT_UI.setProgress('')
          return result
        })
    }

    /* ------------------------------- panel data ------------------------------- */

    function commentRowPassesFilter(row, filter, sentMap) {
      const comment = row && isObject(row.comment) ? row.comment : null
      if (!comment) return false
      const resolved = commentIsResolved(comment)
      const sent = !!(isObject(sentMap) && typeof comment.id === 'string' && sentMap[comment.id])
      if (filter === 'open') return !resolved
      if (filter === 'resolved') return resolved
      if (filter === 'sent') return sent
      if (filter === 'unsent') return !sent
      return true
    }

    /** Every comment in the document as a row with its artboard/layer, newest data included. */
    function commentPanelRows(api, sentMap) {
      const doc = api && api.doc ? api.doc : null
      const comments = commentsOf(doc)
      const rows = []
      for (let index = 0; index < comments.length; index += 1) {
        const comment = comments[index]
        if (!isObject(comment)) continue
        const row = commentRowOf(api, comment)
        row.sentAt =
          isObject(sentMap) && typeof comment.id === 'string' && sentMap[comment.id]
            ? String(sentMap[comment.id])
            : ''
        rows.push(row)
      }
      return rows
    }

    function commentSortRows(rows, order) {
      const copy = Array.isArray(rows) ? rows.slice() : []
      copy.sort(function (first, second) {
        const firstResolved = commentIsResolved(first.comment)
        const secondResolved = commentIsResolved(second.comment)
        if (firstResolved !== secondResolved) return firstResolved ? 1 : -1
        const firstTime = commentParseTime(first.comment.createdAt)
        const secondTime = commentParseTime(second.comment.createdAt)
        if (firstTime !== secondTime) {
          return order === 'oldest' ? firstTime - secondTime : secondTime - firstTime
        }
        return String(first.comment.id).localeCompare(String(second.comment.id))
      })
      return copy
    }

    /** Group rows by artboard → layer, following the document's own order. */
    function commentPanelGroups(api, rows) {
      const doc = api && api.doc ? api.doc : null
      const artboardOrder = {}
      const layerOrder = {}
      const artboards = artboardsOf(doc)
      for (let index = 0; index < artboards.length; index += 1) {
        if (artboards[index] && typeof artboards[index].id === 'string') {
          artboardOrder[artboards[index].id] = index
        }
      }
      const nodes = api && api.tree && Array.isArray(api.tree.allNodes) ? api.tree.allNodes : []
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (node && node.layer && typeof node.layer.id === 'string') {
          layerOrder[node.layer.id] = index
        }
      }
      const groups = []
      const byKey = {}
      const list = Array.isArray(rows) ? rows : []
      for (let index = 0; index < list.length; index += 1) {
        const row = list[index]
        const comment = row.comment
        const artboardId =
          row.artboard && typeof row.artboard.id === 'string'
            ? row.artboard.id
            : typeof comment.artboardId === 'string'
              ? comment.artboardId
              : ''
        const layerId =
          row.layer && typeof row.layer.id === 'string'
            ? row.layer.id
            : typeof comment.layerId === 'string'
              ? comment.layerId
              : ''
        const key = artboardId + '|' + layerId
        let group = byKey[key]
        if (!group) {
          group = {
            key: key,
            artboardId: artboardId,
            layerId: layerId,
            artboardName:
              row.artboard && (row.artboard.name || row.artboard.id)
                ? String(row.artboard.name || row.artboard.id)
                : artboardId,
            layerName:
              row.layer && (row.layer.name || row.layer.id)
                ? String(row.layer.name || row.layer.id)
                : layerId,
            layerType: row.layer && row.layer.type ? String(row.layer.type) : '',
            missing: !!row.missingLayer,
            rows: [],
          }
          byKey[key] = group
          groups.push(group)
        }
        group.rows.push(row)
      }
      groups.sort(function (first, second) {
        const firstBoard =
          typeof artboardOrder[first.artboardId] === 'number' ? artboardOrder[first.artboardId] : 9999
        const secondBoard =
          typeof artboardOrder[second.artboardId] === 'number'
            ? artboardOrder[second.artboardId]
            : 9999
        if (firstBoard !== secondBoard) return firstBoard - secondBoard
        const firstLayer = typeof layerOrder[first.layerId] === 'number' ? layerOrder[first.layerId] : -1
        const secondLayer =
          typeof layerOrder[second.layerId] === 'number' ? layerOrder[second.layerId] : -1
        if (firstLayer !== secondLayer) return firstLayer - secondLayer
        return String(first.artboardName + first.layerName).localeCompare(
          String(second.artboardName + second.layerName),
        )
      })
      return groups
    }

    function commentComposerTarget(api) {
      const doc = api && api.doc ? api.doc : null
      if (!doc) return null
      const layerId = api && typeof api.selectedLayerId === 'string' ? api.selectedLayerId : ''
      const found = layerId ? findLayerById(doc, layerId) : null
      if (found) {
        return {
          layer: found.layer,
          artboard: found.artboard,
          layerId: found.layer.id,
          artboardId: found.artboard.id,
          label: String(found.layer.name || found.layer.id),
          type: String(found.layer.type || ''),
        }
      }
      const artboardId = api && typeof api.selectedArtboardId === 'string' ? api.selectedArtboardId : ''
      let artboard = artboardId ? findArtboardById(doc, artboardId) : null
      if (!artboard) {
        const boards = artboardsOf(doc)
        artboard = boards.length ? boards[0] : null
      }
      if (!artboard) return null
      return {
        layer: null,
        artboard: artboard,
        layerId: '',
        artboardId: artboard.id,
        label: String(artboard.name || artboard.id),
        type: 'artboard',
      }
    }

    /* ------------------------------- panel widgets ------------------------------- */

    function CommentPanelChip(props) {
      const active = props.active === true
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-cmt-chip' + (active ? ' dc-active' : ''),
          'aria-pressed': active,
          title: props.title || props.label,
          onClick: props.onClick,
        },
        h('span', null, props.label),
        h('span', { className: 'dc-cmt-chip-count' }, String(props.count)),
      )
    }

    function CommentPanelRow(props) {
      const row = props.row
      const api = props.api
      const ui = props.ui
      const comment = row.comment
      const resolved = commentIsResolved(comment)
      const selected = ui.selected[comment.id] === true
      const sentAt = row.sentAt
      return h(
        'div',
        {
          className:
            'dc-comment dc-cmt-row' +
            (resolved ? ' dc-resolved' : '') +
            (selected ? ' dc-cmt-selected' : ''),
          'data-comment-id': comment.id,
          onMouseEnter: function () {
            highlightCommentRow(row, true)
          },
          onMouseLeave: function () {
            highlightCommentRow(row, false)
          },
        },
        resolved
          ? null
          : h('input', {
              type: 'checkbox',
              className: 'dc-cmt-check',
              checked: selected,
              title: COMMENT_BATCH_COPY.selectRow,
              'aria-label': COMMENT_BATCH_COPY.selectRow,
              onChange: function () {
                COMMENT_UI.toggleSelected(comment.id)
              },
            }),
        h(
          'div',
          { className: 'dc-cmt-body' },
          h('div', { className: 'dc-comment-text' }, comment.text || ''),
          h(
            'div',
            { className: 'dc-comment-meta' },
            h('span', { className: 'dc-cmt-author', title: comment.author || 'user' }, comment.author || 'user'),
            h(
              'span',
              { className: 'dc-comment-status' },
              resolved ? props.strings.resolved : props.strings.open,
            ),
            comment.createdAt
              ? h(
                  'span',
                  { className: 'dc-cmt-time', title: comment.createdAt },
                  commentRelativeTime(comment.createdAt),
                )
              : null,
            sentAt
              ? h(
                  'span',
                  { className: 'dc-cmt-sent', title: COMMENT_UI_COPY.sentTitle },
                  'sent ' + commentRelativeTime(sentAt),
                )
              : null,
          ),
          h(
            'div',
            { className: 'dc-comment-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link',
                onClick: function () {
                  if (!commentSelectRow(api, row)) props.onError('Could not select that layer')
                  else if (props.onClose) props.onClose()
                },
              },
              COMMENT_BATCH_COPY.jump,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link',
                onClick: function () {
                  commentSetStatuses(api, [comment.id], resolved ? 'open' : 'resolved').then(function (result) {
                    if (!result.ok) props.onError(result.error || 'Could not update the comment')
                  })
                },
              },
              resolved ? COMMENT_BATCH_COPY.reopen : COMMENT_BATCH_COPY.resolve,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link dc-danger',
                title: props.strings.deleteComment,
                'aria-label': props.strings.deleteComment,
                onClick: function () {
                  if (!commentDeleteRow(api, comment.id)) props.onError('Could not delete the comment')
                  else COMMENT_UI.forgetSent(comment.id)
                },
              },
              COMMENT_BATCH_COPY.remove,
            ),
          ),
        ),
      )
    }

    function CommentComposer(props) {
      const api = props.api
      const strings = (api && api.strings) || currentStrings()
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const target = commentComposerTarget(api)
      const trimmed = text.trim()
      const remaining = COMMENT_COMPOSER_LIMIT - text.length
      const nearLimit = text.length > COMMENT_COMPOSER_LIMIT * 0.8

      function submit(sendToAgent) {
        if (!trimmed || busy || !target) return undefined
        const editor = api && isObject(api.editor) ? api.editor : null
        if (!editor || typeof editor.runOps !== 'function') {
          setError(strings.postFailed || 'Could not save the comment')
          return undefined
        }
        setBusy(true)
        setError('')
        const op = { type: 'comment.add', text: trimmed }
        if (target.layerId) op.layerId = target.layerId
        if (target.artboardId) op.artboardId = target.artboardId
        return Promise.resolve()
          .then(function () {
            return editor.runOps([op])
          })
          .then(function (result) {
            if (!result || result.ok === false) {
              const first = result && result.errors && result.errors[0]
              throw new Error((first && (first.message || first.code)) || 'Could not save the comment')
            }
            let commentId = ''
            const applied = result.applied && Array.isArray(result.applied) ? result.applied : []
            for (let index = 0; index < applied.length; index += 1) {
              if (applied[index] && applied[index].type === 'comment.add' && applied[index].id) {
                commentId = applied[index].id
                break
              }
            }
            if (!sendToAgent) {
              return { saved: true }
            }
            const entry = commentEntryForSend({
              comment: {
                id: commentId,
                text: trimmed,
                status: 'open',
                author: 'user',
                createdAt: new Date().toISOString(),
              },
              layer: target.layer,
              artboard: target.artboard,
              parentId: '',
              node: null,
            })
            return sendCommentBatchMessage(api, {
              boardPath: api.boardPath,
              version: api.version,
              comments: [entry],
            }).then(function () {
              if (commentId) COMMENT_UI.markSent([commentId])
              return { sent: true }
            })
          })
          .then(function (outcome) {
            setText('')
            setBusy(false)
            if (props.onDone) props.onDone(outcome && outcome.sent ? COMMENT_BATCH_COPY.sent : COMMENT_BATCH_COPY.saved)
            else if (props.onClose) props.onClose()
          })
          .catch(function (failure) {
            setBusy(false)
            setError(messageOf(failure))
          })
      }

      return h(
        'div',
        { className: 'dc-cmt-composer' },
        h(
          'div',
          { className: 'dc-cmt-chip-target', title: target ? target.label + ' (' + target.type + ')' : '' },
          target
            ? COMMENT_UI_COPY.target + ': ' + target.label + ' · ' + target.type
            : COMMENT_UI_COPY.noTarget,
        ),
        h('textarea', {
          className: 'dc-textarea dc-cmt-composer-text',
          rows: 2,
          autoFocus: true,
          maxLength: COMMENT_COMPOSER_LIMIT,
          value: text,
          placeholder: strings.commentPlaceholder,
          'aria-label': strings.commentPlaceholder,
          onChange: function (event) {
            setText(event.target.value)
          },
          onKeyDown: function (event) {
            if (event.key === 'Escape') {
              event.stopPropagation()
              if (props.onClose) props.onClose()
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              submit(true)
            }
          },
        }),
        h(
          'div',
          { className: 'dc-cmt-composer-actions' },
          h(
            'span',
            { className: 'dc-cmt-hint' },
            'Ctrl/Cmd+Enter',
          ),
          h(
            'span',
            {
              className: 'dc-cmt-counter' + (nearLimit ? ' dc-cmt-counter-warn' : ''),
              'aria-live': 'polite',
            },
            nearLimit ? (remaining > 0 ? String(remaining) + ' left' : 'at the limit') : '',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-btn',
              disabled: busy || !trimmed || !target,
              title: COMMENT_BATCH_COPY.savedOnlyHint,
              onClick: function () {
                return submit(false)
              },
            },
            COMMENT_BATCH_COPY.saveOnly,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-btn dc-btn-primary',
              disabled: busy || !trimmed || !target,
              onClick: function () {
                return submit(true)
              },
            },
            busy ? COMMENT_BATCH_COPY.sending : COMMENT_BATCH_COPY.sendNow,
          ),
        ),
        error ? h('div', { className: 'dc-cmt-error' }, error) : null,
      )
    }

    /* ------------------------------- the panel ------------------------------- */

    function CommentsPanel(props) {
      const api = props.api
      const ui = useCommentUi()
      const strings = (api && api.strings) || currentStrings()
      const [filter, setFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      const [order, setOrder] = React.useState('newest')
      const [adding, setAdding] = React.useState(false)
      const [flash, setFlash] = React.useState('')
      const [localError, setLocalError] = React.useState('')
      const searchRef = React.useRef(null)
      const opened = ui.panelOpen

      React.useEffect(
        function () {
          if (!opened) return
          const node = searchRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus()
            } catch (error) {
              /* focus is best-effort */
            }
          }
        },
        [opened],
      )

      if (!opened || !isObject(api) || !isObject(api.doc)) return null

      const allRows = commentPanelRows(api, ui.sent)
      const counts = commentFilterCounts(commentsOf(api.doc), ui.sent)
      const visible = []
      for (let index = 0; index < allRows.length; index += 1) {
        const row = allRows[index]
        if (!commentRowPassesFilter(row, filter, ui.sent)) continue
        if (!commentMatchesQuery(row, query)) continue
        visible.push(row)
      }
      const sorted = commentSortRows(visible, order)
      const groups = commentPanelGroups(api, sorted)
      let shownOpenCount = 0
      let shownResolvedCount = 0
      for (let index = 0; index < sorted.length; index += 1) {
        if (commentIsResolved(sorted[index].comment)) shownResolvedCount += 1
        else shownOpenCount += 1
      }
      const openIds = []
      for (let index = 0; index < allRows.length; index += 1) {
        if (!commentIsResolved(allRows[index].comment)) openIds.push(allRows[index].comment.id)
      }
      const selectedCount = ui.selectedCount
      const busy = ui.busy || false

      function setShownStatus(status) {
        setLocalError('')
        setFlash('')
        const ids = []
        for (let index = 0; index < sorted.length; index += 1) {
          const resolved = commentIsResolved(sorted[index].comment)
          if (status === 'resolved' ? !resolved : resolved) ids.push(sorted[index].comment.id)
        }
        if (!ids.length) return undefined
        return commentSetStatuses(api, ids, status).then(function (result) {
          if (!result.ok) setLocalError(result.error || 'Could not update the comments')
          else setFlash(String(ids.length) + (status === 'resolved' ? ' resolved' : ' reopened'))
        })
      }

      function sendSelected() {
        if (!selectedCount || busy) return undefined
        setLocalError('')
        setFlash('')
        return submitComments(ui.selectedIds, api).then(function (result) {
          if (!result || result.ok !== true) {
            setLocalError((result && result.error) || COMMENT_BATCH_COPY.promptFailed)
            return
          }
          setFlash(
            'Sent ' +
              String(result.count) +
              ' comment' +
              (result.count === 1 ? '' : 's') +
              ' as one revision request. ' +
              COMMENT_BATCH_COPY.sentNote,
          )
        })
      }

      const sendLabel = busy
        ? COMMENT_BATCH_COPY.sending + (ui.progress ? ' ' + ui.progress : '')
        : selectedCount === 1
          ? COMMENT_BATCH_COPY.sendOne
          : selectedCount > 1
            ? COMMENT_BATCH_COPY.sendMany.replace('N', String(selectedCount))
            : COMMENT_BATCH_COPY.sendNone
      const error = ui.error || localError

      return h(
        'div',
        {
          className: 'dc-cmt-overlay',
          onPointerDown: function (event) {
            event.stopPropagation()
          },
        },
        h(CommentBatchStyleTag, { key: 'style' }),
        h(
          'section',
          {
            key: 'panel',
            className: 'dc-cmt-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': COMMENT_UI_COPY.panelTitle,
            onKeyDown: function (event) {
              if (event.key === 'Escape') {
                event.stopPropagation()
                COMMENT_UI.setPanelOpen(false)
              }
            },
          },
          h(
            'header',
            { key: 'head', className: 'dc-cmt-panel-head' },
            h(
              'div',
              { className: 'dc-cmt-panel-title' },
              h(Glyph, { name: 'comment', size: 13 }),
              h('span', null, COMMENT_UI_COPY.panelTitle),
              h('span', { className: 'dc-muted' }, String(counts.all) + ' total'),
              counts.open ? h('span', { className: 'dc-badge' }, String(counts.open)) : null,
            ),
            h(IconButton, {
              icon: 'close',
              title: COMMENT_BATCH_COPY.close,
              onClick: function () {
                COMMENT_UI.setPanelOpen(false)
              },
            }),
          ),
          h(
            'div',
            { key: 'tools', className: 'dc-cmt-panel-tools' },
            h(
              'div',
              { className: 'dc-cmt-chips', role: 'group', 'aria-label': 'Comment filters' },
              h(CommentPanelChip, {
                label: COMMENT_UI_COPY.all,
                count: counts.all,
                active: filter === 'all',
                onClick: function () {
                  setFilter('all')
                },
              }),
              h(CommentPanelChip, {
                label: COMMENT_UI_COPY.openFilter,
                count: counts.open,
                active: filter === 'open',
                onClick: function () {
                  setFilter('open')
                },
              }),
              h(CommentPanelChip, {
                label: COMMENT_UI_COPY.resolvedFilter,
                count: counts.resolved,
                active: filter === 'resolved',
                onClick: function () {
                  setFilter('resolved')
                },
              }),
              h(CommentPanelChip, {
                label: COMMENT_UI_COPY.sentFilter,
                count: counts.sent,
                active: filter === 'sent',
                onClick: function () {
                  setFilter('sent')
                },
              }),
              h(CommentPanelChip, {
                label: COMMENT_UI_COPY.unsentFilter,
                count: counts.unsent,
                active: filter === 'unsent',
                onClick: function () {
                  setFilter('unsent')
                },
              }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link dc-cmt-order',
                title: order === 'newest' ? COMMENT_UI_COPY.newestFirst : COMMENT_UI_COPY.oldestFirst,
                'aria-label':
                  order === 'newest' ? COMMENT_UI_COPY.newestFirst : COMMENT_UI_COPY.oldestFirst,
                onClick: function () {
                  setOrder(order === 'newest' ? 'oldest' : 'newest')
                },
              },
              order === 'newest' ? '↓' : '↑',
            ),
            h('input', {
              ref: searchRef,
              type: 'search',
              className: 'dc-cmt-search',
              value: query,
              placeholder: COMMENT_UI_COPY.search,
              'aria-label': COMMENT_UI_COPY.search,
              onChange: function (event) {
                setQuery(event.target.value)
              },
            }),
          ),
          h(
            'div',
            { key: 'actions', className: 'dc-cmt-panel-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                disabled: !openIds.length || busy,
                onClick: function () {
                  COMMENT_UI.selectMany(openIds, true)
                },
              },
              COMMENT_UI_COPY.selectAllOpen,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                disabled: !selectedCount || busy,
                onClick: function () {
                  COMMENT_UI.clearSelected()
                },
              },
              COMMENT_UI_COPY.clearSelection,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-primary dc-cmt-send',
                disabled: !selectedCount || busy,
                title: selectedCount ? undefined : COMMENT_BATCH_COPY.sendHint,
                onClick: sendSelected,
              },
              h(Glyph, { name: 'send', size: 11 }),
              h('span', null, sendLabel),
            ),
          ),
          h(
            'div',
            { key: 'bulk', className: 'dc-cmt-panel-bulk' },
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link',
                disabled: !shownOpenCount || busy,
                title: COMMENT_BATCH_COPY.resolveAllHint,
                onClick: function () {
                  return setShownStatus('resolved')
                },
              },
              COMMENT_BATCH_COPY.resolveAll + ' (' + String(shownOpenCount) + ')',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-link',
                disabled: !shownResolvedCount || busy,
                title: COMMENT_BATCH_COPY.reopenAllHint,
                onClick: function () {
                  return setShownStatus('open')
                },
              },
              COMMENT_BATCH_COPY.reopenAll + ' (' + String(shownResolvedCount) + ')',
            ),
          ),
          h(
            'div',
            { key: 'body', className: 'dc-cmt-panel-body' },
            groups.length === 0
              ? h(
                  'div',
                  { className: 'dc-cmt-empty-state' },
                  h(Glyph, { name: 'comment', size: 16 }),
                  h(
                    'div',
                    { className: 'dc-center-text' },
                    allRows.length === 0
                      ? COMMENT_BATCH_COPY.emptyTitle
                      : COMMENT_BATCH_COPY.noMatchTitle,
                  ),
                  h(
                    'div',
                    { className: 'dc-center-hint' },
                    allRows.length === 0
                      ? COMMENT_BATCH_COPY.emptyHint
                      : COMMENT_BATCH_COPY.noMatchHint,
                  ),
                )
              : groups.map(function (group) {
                  return h(
                    'div',
                    { key: group.key, className: 'dc-cmt-group' },
                    h(
                      'div',
                      { className: 'dc-cmt-group-head' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dc-cmt-group-name',
                          title: group.artboardName + (group.layerId ? ' / ' + group.layerName : ''),
                          onClick: function () {
                            const first = group.rows.length ? group.rows[0] : null
                            if (first && !commentSelectRow(api, first)) {
                              setLocalError('Could not select that layer')
                            }
                          },
                        },
                        group.artboardName + (group.layerId ? ' / ' + group.layerName : ''),
                      ),
                      group.layerType
                        ? h('span', { className: 'dc-cmt-group-meta' }, group.layerType)
                        : null,
                      group.missing
                        ? h('span', { className: 'dc-cmt-group-meta' }, COMMENT_BATCH_COPY.missingLayer)
                        : null,
                      h('span', { className: 'dc-cmt-group-count' }, String(group.rows.length)),
                    ),
                    group.rows.map(function (row) {
                      return h(CommentPanelRow, {
                        key: String(row.comment.id),
                        row: row,
                        api: api,
                        ui: ui,
                        strings: strings,
                        onClose: function () {
                          COMMENT_UI.setPanelOpen(false)
                        },
                        onError: function (message) {
                          setLocalError(message || COMMENT_BATCH_COPY.promptFailed)
                        },
                      })
                    }),
                  )
                }),
          ),
          adding
            ? h(CommentComposer, {
                key: 'composer',
                api: api,
                onDone: function (message) {
                  setAdding(false)
                  setFlash(message || '')
                },
                onClose: function () {
                  setAdding(false)
                },
              })
            : null,
          error ? h('div', { key: 'error', className: 'dc-cmt-error dc-pad' }, error) : null,
          h(
            'footer',
            { key: 'foot', className: 'dc-cmt-panel-foot' },
            h(
              'span',
              { className: 'dc-cmt-panel-msg' + (flash ? ' dc-cmt-flash' : ''), 'aria-live': 'polite' },
              flash ||
                (selectedCount
                  ? String(selectedCount) + ' selected — ' + COMMENT_BATCH_COPY.sentNote
                  : busy
                    ? COMMENT_BATCH_COPY.sending
                    : COMMENT_BATCH_COPY.sendHint),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                title: COMMENT_BATCH_COPY.addComment,
                onClick: function () {
                  setAdding(!adding)
                },
              },
              adding ? COMMENT_BATCH_COPY.cancel : COMMENT_BATCH_COPY.addComment,
            ),
          ),
        ),
      )
    }

    /* ------------------------------- entry points ------------------------------- */

    function CommentsToolButton(props) {
      const api = props.api
      const ui = useCommentUi()
      const counts = commentFilterCounts(commentsOf(api && api.doc), ui.sent)
      const open = ui.panelOpen
      const badge = counts.open > 0 ? counts.open : counts.all
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-tool' + (open ? ' dc-active' : ''),
          title: COMMENT_BATCH_COPY.toolbarTitle,
          'aria-label': COMMENT_BATCH_COPY.toolbarTitle,
          'aria-pressed': open,
          onClick: function () {
            rememberCommentContext(api)
            COMMENT_UI.togglePanel()
          },
        },
        h(Glyph, { name: 'comment', size: 12 }),
        h('span', null, COMMENT_UI_COPY.panelTitle),
        badge ? h('span', { className: 'dc-badge', title: counts.open + ' open' }, String(badge)) : null,
      )
    }

    registerToolbar({
      id: 'comment-panel',
      render: function (ctx) {
        // The toolbar renders on every canvas render, before the inspector, so this also hands
        // the per-layer thread a fresh editor context (jump/hover/send).
        rememberCommentContext(ctx)
        return [
          h(CommentBatchStyleTag, { key: 'cmt-panel-css' }),
          h(CommentsToolButton, { key: 'cmt-panel-btn', api: ctx }),
        ]
      },
    })

    registerAppPanel({
      id: 'comment-panel-dialog',
      render: function (ctx) {
        rememberCommentContext(ctx)
        return h(CommentsPanel, { api: ctx })
      },
    })

    registerKeyHandler({
      id: 'comment-panel-keys',
      match: function (event) {
        if (!event) return false
        const key = String(event.key || '').toLowerCase()
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'c') {
          return true
        }
        if (key === 'escape' && COMMENT_UI.get().panelOpen) return true
        if (key === 'enter' && (event.ctrlKey || event.metaKey) && COMMENT_UI.get().panelOpen) {
          return COMMENT_UI.get().selectedCount > 0
        }
        return false
      },
      run: function (event, api) {
        const key = String(event.key || '').toLowerCase()
        // The context handed to a key handler is the one captured when the editor's keydown
        // effect was installed — it can be older than the toolbar render (for example before the
        // document loaded). Prefer the freshly captured context from COMMENT_TOOLS.
        const current = commentEditorApi() || api
        if (event.altKey && key === 'c') {
          rememberCommentContext(current)
          COMMENT_UI.togglePanel()
          return true
        }
        if (key === 'escape') {
          if (!COMMENT_UI.get().panelOpen) return false
          const editor = current && isObject(current.editor) ? current.editor : null
          if (editor && (editor.gestureActive || editor.composer)) return false
          COMMENT_UI.setPanelOpen(false)
          return true
        }
        if (key === 'enter' && (event.ctrlKey || event.metaKey)) {
          const snapshot = COMMENT_UI.get()
          if (!snapshot.panelOpen || !snapshot.selectedCount) return false
          submitComments(snapshot.selectedIds, current)
            .then(function (result) {
              if (!result || result.ok !== true) {
                COMMENT_UI.setError((result && result.error) || COMMENT_BATCH_COPY.promptFailed)
              }
            })
            .catch(function (error) {
              COMMENT_UI.setError(messageOf(error))
            })
          return true
        }
        return false
      },
    })

    /* ------------------------------- styles ------------------------------- */

    const COMMENT_BATCH_CSS = `
.dc-cmt-overlay { position: absolute; inset: 0; z-index: 60; display: flex; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-base); }
.dc-cmt-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-overlay); }
.dc-cmt-panel-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dc-cmt-panel-title { display: flex; align-items: center; gap: 5px; flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-cmt-panel-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-cmt-search { flex: 1 1 110px; min-width: 0; height: 20px; padding: 0 5px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; }
.dc-cmt-search:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dc-cmt-panel-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dc-cmt-panel-bulk { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 3px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-cmt-panel-bulk .dc-link:disabled { color: var(--dsw-alias-label-secondary); opacity: 0.55; cursor: default; text-decoration: none; }
.dc-cmt-send { margin-left: auto; }
.dc-cmt-panel-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 8px; }
.dc-cmt-group { display: flex; flex-direction: column; gap: 4px; }
.dc-cmt-group-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dc-cmt-group-name { flex: 1 1 auto; min-width: 0; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 10px; font-weight: 600; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-cmt-group-name:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-radius: 3px; }
.dc-cmt-group-meta { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dc-cmt-group-count { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dc-cmt-panel-foot { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 5px 8px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dc-cmt-panel-msg { flex: 1 1 auto; min-width: 0; font-size: 10px; line-height: 1.35; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dc-cmt-flash { color: var(--dsw-alias-state-success-primary); }
.dc-cmt-empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 10px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dc-cmt-composer { display: flex; flex-direction: column; gap: 5px; padding: 6px; margin: 0 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); }
.dc-cmt-chip-target { display: inline-flex; align-items: center; max-width: 100%; padding: 1px 6px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-cmt-composer-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dc-cmt-hint { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dc-cmt-counter { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 9px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dc-cmt-counter-warn { color: var(--dsw-alias-state-warn-primary); }
.dc-cmt-panel .dc-cmt-row { background: var(--dsw-alias-bg-base); }
@media (hover: hover) and (pointer: fine) {
.dc-cmt-group-name:hover { color: var(--dsw-alias-label-primary); }
}
`

    function CommentBatchStyleTag() {
      return h('style', {
        dangerouslySetInnerHTML: { __html: COMMENT_CSS + COMMENT_BATCH_CSS },
      })
    }
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
     * at render time so handles stay 7px and outlines stay 1px from 10 % to 400 %. */
    const SELECTION_BORDER_SCREEN = 1
    const SELECTION_HANDLE_SCREEN = 7
    const SELECTION_HANDLE_BORDER_SCREEN = 1.5
    const SELECTION_HANDLE_RADIUS_SCREEN = 2
    const PIN_SCREEN = 18
    const LOCK_BADGE_SCREEN = 14
    const MEASURE_BADGE_HEIGHT_SCREEN = 18
    const MEASURE_BADGE_FONT_SCREEN = 11

    /** Camera zoom for overlay chrome: always a usable positive number. */
    function overlayZoom(value) {
      const zoom = finiteNumber(value, 1)
      return zoom > 0 ? zoom : 1
    }

    /**
     * Snap a canvas-unit rect out to whole *screen* pixels.
     *
     * The stage carries CSS `zoom`, so a canvas coordinate `x` lands on screen pixel `x * zoom`.
     * Rounding the screen edges (not the authored canvas edges) is what keeps a 1 px selection
     * stroke exactly one pixel wide, with no half-pixel blur, at 40 % as well as at 400 %.
     *
     * The snap is outward (floor the near edges, ceil the far ones) so a union box always
     * *covers* every member it wraps, instead of being able to land half a pixel inside one.
     */
    function snapOverlayRect(value, zoom) {
      const z = overlayZoom(zoom)
      const rect = normalizeOverlayRect(value)
      const left = Math.floor(rect.x * z) / z
      const top = Math.floor(rect.y * z) / z
      const right = Math.ceil((rect.x + rect.width) * z) / z
      const bottom = Math.ceil((rect.y + rect.height) * z) / z
      const minimum = 1 / z
      return {
        x: left,
        y: top,
        width: Math.max(minimum, right - left),
        height: Math.max(minimum, bottom - top),
      }
    }

    /** True when two canvas-unit rects describe the same box, within half a device pixel. */
    function sameOverlayRect(first, second, zoom) {
      const a = normalizeOverlayRect(first)
      const b = normalizeOverlayRect(second)
      const tolerance = 0.5 / overlayZoom(zoom)
      return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
      )
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
     * The single bounding box around a selection, for ONE artboard (Figma-style).
     *
     *   SelectionBox({ rect, zoom, handles?, primary?, handlers?, count?, artboardCount?,
     *                  primaryLayerId?, artboardId? })
     *     rect           union rect in artboard-local canvas units (computed node worldRect space)
     *     zoom           camera zoom (px per canvas unit) — every chrome dimension is divided by
     *                    it, so the box is exactly SELECTION_BORDER_SCREEN px on screen from 10 %
     *                    to 400 % and the handles stay SELECTION_HANDLE_SCREEN px
     *     handles        draw the 8 resize handles (single-artboard selections get them)
     *     primary        this box carries the selection's primary layer (diagnostic attribute)
     *     handlers       shell handlers: `handlePointerDown(event, handleId)` fires on each
     *                    handle; `gestureMove/gestureUp/gestureCancel` continue that gesture
     *     count          total layers in the whole selection  → `data-selection-count`
     *     artboardCount  how many artboards the selection spans → `data-selection-artboards`
     *
     * The union rect is published as `data-selection-bounds` (JSON: {x,y,width,height} in
     * artboard canvas units) so tests and the interaction layer can read the box geometry
     * without measuring the DOM. Handles keep their `data-handle` ids; a multi-selection resize
     * therefore only has to read this box instead of the primary member.
     */
    function SelectionBox(props) {
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      const rect = snapOverlayRect(props.rect, zoom)
      const handlers = props.handlers
      const handles = props.handles === true
      const bounds =
        '{"x":' +
        roundTo(rect.x, 3) +
        ',"y":' +
        roundTo(rect.y, 3) +
        ',"width":' +
        roundTo(rect.width, 3) +
        ',"height":' +
        roundTo(rect.height, 3) +
        '}'
      const attributes = {
        className:
          'dc-sel-box' +
          (handles ? ' dc-sel-box-handles' : '') +
          (props.primary ? ' dc-sel-box-primary' : ''),
        'data-selection-bounds': bounds,
        'data-selection-count': Math.max(0, Math.round(finiteNumber(props.count, 1))),
        'data-selection-artboards': Math.max(1, Math.round(finiteNumber(props.artboardCount, 1))),
        'data-selection-handles': handles ? 'true' : 'false',
        'data-primary': props.primary ? 'true' : 'false',
        'data-primary-layer-id':
          typeof props.primaryLayerId === 'string' ? props.primaryLayerId : '',
        'data-artboard-id': typeof props.artboardId === 'string' ? props.artboardId : '',
        style: {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: SELECTION_BORDER_SCREEN * inverse,
        },
      }
      if (!handles) return h('div', attributes)
      return h(
        'div',
        attributes,
        HANDLES.map(function (handle) {
          return h('div', {
            key: handle.id,
            className: 'dc-sel-handle',
            'data-handle': handle.id,
            style: {
              left: handle.fx * 100 + '%',
              top: handle.fy * 100 + '%',
              width: SELECTION_HANDLE_SCREEN * inverse,
              height: SELECTION_HANDLE_SCREEN * inverse,
              borderWidth: SELECTION_HANDLE_BORDER_SCREEN * inverse,
              borderRadius: SELECTION_HANDLE_RADIUS_SCREEN * inverse,
              // Chromium floors fractional *border* widths to whole device pixels, so a 1.5 px
              // border alone would paint 1 px. The accent ring below is a shadow (never snapped),
              // so it restores the intended 1.5 px edge while the drop shadow keeps the white
              // square readable on a light artboard. Both are in canvas units: a CSS px shadow
              // would scale with the stage zoom, which is exactly what the overlay must not do.
              boxShadow:
                '0 0 0 ' +
                roundTo(0.5 * inverse, 3) +
                'px rgba(13, 153, 255, 0.9), 0 0 0 ' +
                roundTo(1 * inverse, 3) +
                'px rgba(13, 153, 255, 0.16), 0 ' +
                roundTo(1 * inverse, 3) +
                'px ' +
                roundTo(2 * inverse, 3) +
                'px rgba(15, 23, 42, 0.26)',
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
        }),
      )
    }

    /**
     * Thin blue outline around ONE selected object of a multi-selection — no handles, no fill,
     * never intercepts the pointer. Figma draws these so you can tell which objects the union
     * `SelectionBox` is wrapping; the union box alone would hide the members.
     */
    function SelectionMember(props) {
      const zoom = overlayZoom(props.zoom)
      const inverse = 1 / zoom
      const rect = snapOverlayRect(props.rect, zoom)
      return h('div', {
        className: 'dc-sel-member',
        'data-selection-member': typeof props.layerId === 'string' ? props.layerId : '',
        style: {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: SELECTION_BORDER_SCREEN * inverse,
        },
      })
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

      // Selection input: the interaction layer passes `selectedNodes` (an array of computed
      // nodes) and `selectedLayerIds`. v1 callers only passed `selectedNode`, which still works.
      let selectedNodes = []
      if (Array.isArray(props.selectedNodes) && props.selectedNodes.length > 0) {
        for (let index = 0; index < props.selectedNodes.length; index += 1) {
          if (props.selectedNodes[index]) selectedNodes.push(props.selectedNodes[index])
        }
      }
      if (selectedNodes.length === 0 && props.selectedNode) selectedNodes = [props.selectedNode]
      const selectedLayerIds = Array.isArray(props.selectedLayerIds) ? props.selectedLayerIds : []
      const primaryLayerId =
        typeof props.primaryLayerId === 'string' ? props.primaryLayerId : selectedLayerId
      const selectionCount = Math.max(selectedNodes.length, selectedLayerIds.length)
      // Members on THIS artboard, and how many artboards the whole selection spans. Figma draws
      // one union box per frame, so a cross-artboard selection never gets a box that wraps
      // unrelated canvas positions.
      const selectionHere = []
      const selectionArtboardIds = []
      for (let index = 0; index < selectedNodes.length; index += 1) {
        const candidate = selectedNodes[index]
        if (!candidate || !candidate.artboard || !candidate.artboard.id) continue
        const ownerId = candidate.artboard.id
        if (selectionArtboardIds.indexOf(ownerId) < 0) selectionArtboardIds.push(ownerId)
        if (ownerId === artboard.id) selectionHere.push(candidate)
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
      // The union rect of this artboard's members, and whether this box owns the resize handles:
      // only when the WHOLE selection lives on this artboard (single or multi selection).
      const selectionUnion = unionRects(
        selectionHere.map(function (node) {
          return node.worldRect
        }),
      )
      const selectionHandles =
        selectionHere.length > 0 && Math.max(1, selectionArtboardIds.length) === 1
      // The selection's primary layer lives on this artboard (it drives `data-primary` and the
      // lock badge); with a cross-artboard selection exactly one box is marked primary.
      let primaryOnThisArtboard = false
      if (primaryLayerId) {
        for (let index = 0; index < selectionHere.length; index += 1) {
          if (selectionHere[index].id === primaryLayerId) {
            primaryOnThisArtboard = true
            break
          }
        }
      }
      const selectionChrome = []
      if (selectionUnion) {
        // A member whose box equals the union is already outlined by the union box itself, so it
        // is skipped — otherwise a single selection would paint a 2 px edge.
        if (selectionHere.length > 1) {
          for (let index = 0; index < selectionHere.length; index += 1) {
            const member = selectionHere[index]
            if (sameOverlayRect(member.worldRect, selectionUnion, zoom)) continue
            selectionChrome.push(
              h(SelectionMember, {
                key: 'sel-member-' + String(member.id),
                rect: member.worldRect,
                zoom: zoom,
                layerId: member.id,
              }),
            )
          }
        }
        selectionChrome.push(
          h(SelectionBox, {
            key: 'sel-box',
            rect: selectionUnion,
            zoom: zoom,
            handles: selectionHandles,
            primary: primaryOnThisArtboard,
            handlers: handlers,
            count: selectionCount,
            artboardCount: Math.max(1, selectionArtboardIds.length),
            primaryLayerId: primaryOnThisArtboard ? primaryLayerId : '',
            artboardId: artboard.id,
          }),
        )
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
          // Figma-style selection chrome: one thin member outline per selected object plus ONE
          // union box (with the 8 handles) around all of this artboard's members.
          selectionChrome,
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
    class CanvasErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
        this.retry = this.retry.bind(this)
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: messageOf(error) }
      }

      componentDidCatch(error) {
        beacon('render-error', { message: shortError(error) })
        beacon('error', { message: shortError(error) })
        report({
          sessionId: this.props.sessionId || '',
          kind: 'error',
          message: 'render error: ' + messageOf(error).slice(0, 2000),
        })
      }

      retry() {
        this.setState({ failed: false, message: '' })
      }

      render() {
        if (this.state.failed) {
          const strings = this.props.strings || STRINGS.en
          return h(
            'div',
            { className: 'dc-fallback' },
            h('style', { dangerouslySetInnerHTML: { __html: CSS_TEXT } }),
            h('div', { className: 'dc-fallback-title' }, strings.renderFailed),
            h('div', { className: 'dc-fallback-text' }, this.state.message || 'unknown error'),
            h(
              'button',
              { type: 'button', className: 'dc-btn', onClick: this.retry },
              strings.retry,
            ),
          )
        }
        return this.props.children
      }
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas root: state, sync, gestures, mutations
     * ---------------------------------------------------------------------------------------- */

    /* ------------------------------------------------------------------------------------------
     * Interaction tuning + feature copy
     *
     * New feature copy lives here as a local constant (see CONTRACT §8.9) and is folded into the
     * strings table during the localization pass.
     * ---------------------------------------------------------------------------------------- */

    /** Snap distance in SCREEN pixels (divided by the camera zoom before comparing). */
    const SNAP_THRESHOLD_SCREEN = 6
    const TIDY_GAP = 16
    const PASTE_OFFSET = 16
    const DUPLICATE_OFFSET = 12
    const DOUBLE_CLICK_MS = 350
    const CLIPBOARD_KIND = 'dsh-design-canvas/layers'
    /** Host cap on ops per call (host/model.js MAX_OPS_PER_CALL). */
    const MAX_OPS_PER_BATCH = 200

    const INTERACTION_COPY = {
      locked: 'Locked — unlock it in the inspector to edit',
      groupNeedsTwo: 'Select at least two layers to group them',
      groupSameParent: 'Grouping needs layers that share the same parent',
      groupAutoLayout: 'Cannot group inside an auto-layout frame — turn its layout off first',
      ungroupNeedsGroup: 'Select a group to ungroup it',
      alignNeedsTwo: 'Select at least two layers to align them',
      alignSameParent: 'Aligning needs layers that share the same parent',
      distributeNeedsThree: 'Select at least three layers to distribute them',
      pasteEmpty: 'Nothing to paste — copy layers first',
      pasteLimit: 'This selection is too large to paste in one step',
      clipboardDenied: '',
    }

    /** Alignment kinds -> the axis and the edge/center they snap to on that axis. */
    const ALIGN_SPECS = {
      left: { axis: 'x', pos: 'start' },
      'center-h': { axis: 'x', pos: 'center' },
      hcenter: { axis: 'x', pos: 'center' },
      'center-x': { axis: 'x', pos: 'center' },
      right: { axis: 'x', pos: 'end' },
      top: { axis: 'y', pos: 'start' },
      'center-v': { axis: 'y', pos: 'center' },
      vcenter: { axis: 'y', pos: 'center' },
      'center-y': { axis: 'y', pos: 'center' },
      bottom: { axis: 'y', pos: 'end' },
    }

    /**
     * Canvas editor state machine: document sync with the Host, selection, camera, history,
     * gestures, mutations and comment flow. `CanvasRoot` (74-shell.js) renders it.
     *
     * Everything this hook returns is read by the shell; parts that only need one slice read
     * that slice. Adding state means adding it here and destructuring it in the shell.
     */
    function useEditor(sessionId) {
      const strings = React.useMemo(function () {
        return stringsFor(currentLocaleId())
      }, [])

      const [doc, setDoc] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      const [boardPath, setBoardPath] = React.useState('design-board.json')
      const [loading, setLoading] = React.useState(true)
      const [loadError, setLoadError] = React.useState('')
      const [status, setStatus] = React.useState('synced')
      const [inlineError, setInlineError] = React.useState('')
      // Multi-selection: ordered ids, the LAST one is the primary layer (`selectedLayerId`). The
      // array is the source of truth; `selectedLayerId` stays for single-layer affordances.
      const [selectedLayerIds, setSelectedLayerIds] = React.useState([])
      const [selectedArtboardId, setSelectedArtboardId] = React.useState(null)
      // Id of the group the user drilled into (double-click / Enter/ Esc steps back out).
      const [drillGroupId, setDrillGroupId] = React.useState(null)
      // Marquee rect in artboard-local canvas units, or null while not dragging.
      const [marquee, setMarquee] = React.useState(null)
      // Active snap guide lines for the renderer: [{ axis: 'x'|'y', at: number }].
      const [snapGuides, setSnapGuides] = React.useState([])
      const [snapGuidesArtboardId, setSnapGuidesArtboardId] = React.useState(null)
      const [snapEnabled, setSnapEnabled] = React.useState(true)
      const [camera, setCamera] = React.useState(defaultCamera)
      const [panning, setPanning] = React.useState(false)
      const [spaceHeld, setSpaceHeld] = React.useState(false)
      const [dragOver, setDragOver] = React.useState(false)
      const [commentMode, setCommentMode] = React.useState(false)
      const [composer, setComposer] = React.useState(null)
      const [commentBusy, setCommentBusy] = React.useState(false)
      const [commentError, setCommentError] = React.useState('')
      const [gestureActive, setGestureActive] = React.useState(false)
      const [treeOpen, setTreeOpen] = React.useState(true)
      const [inspectorOpen, setInspectorOpen] = React.useState(true)

      const selectedLayerId = selectedLayerIds.length
        ? selectedLayerIds[selectedLayerIds.length - 1]
        : null

      const docRef = React.useRef(null)
      const versionRef = React.useRef(0)
      const cameraRef = React.useRef(defaultCamera())
      const panRef = React.useRef(null)
      const spaceHeldRef = React.useRef(false)
      const imageInputRef = React.useRef(null)
      const imagePickSourceRef = React.useRef('toolbar')
      const selectedLayerIdsRef = React.useRef([])
      const selectedLayerIdRef = React.useRef(null)
      const selectedArtboardIdRef = React.useRef(null)
      const drillGroupIdRef = React.useRef(null)
      const snapEnabledRef = React.useRef(true)
      const marqueeRef = React.useRef(null)
      const clipboardRef = React.useRef(null)
      const gestureFrameRef = React.useRef(null)
      const lastLayerPointerRef = React.useRef(null)
      const gestureRef = React.useRef(null)
      const treeRef = React.useRef(null)
      const inFlightRef = React.useRef(0)
      const lastLocalVersionRef = React.useRef(0)
      const statusTimerRef = React.useRef(null)
      const disposedRef = React.useRef(false)
      const mountReportedRef = React.useRef(false)
      const fitPendingRef = React.useRef(true)
      const canvasRef = React.useRef(null)
      const appRef = React.useRef(null)
      const canvasHoverRef = React.useRef(false)
      const historyRef = React.useRef({ undo: [], redo: [] })
      const applyingHistoryRef = React.useRef(false)
      const nudgeRef = React.useRef(null)

      React.useEffect(
        function () {
          selectedLayerIdsRef.current = selectedLayerIds
          selectedLayerIdRef.current = selectedLayerId
          selectedArtboardIdRef.current = selectedArtboardId
          drillGroupIdRef.current = drillGroupId
          snapEnabledRef.current = snapEnabled
        },
        [selectedLayerIds, selectedLayerId, selectedArtboardId, drillGroupId, snapEnabled],
      )

      /** Backwards-compatible single-selection setter (shell/inspector still know this name). */
      function setSelectedLayerId(layerId) {
        setSelectedLayerIds(layerId ? [layerId] : [])
        if (!layerId) setDrillGroupId(null)
      }

      /* ------------------------------- local doc application ------------------------------- */

      const applyDoc = React.useCallback(function (nextDoc, nextVersion) {
        docRef.current = nextDoc
        if (typeof nextVersion === 'number') versionRef.current = nextVersion
        if (disposedRef.current) return
        setDoc(nextDoc)
        if (typeof nextVersion === 'number') setVersion(nextVersion)
      }, [])

      const applyDocLocal = React.useCallback(
        function (nextDoc) {
          if (!nextDoc) return
          applyDoc(nextDoc, versionRef.current)
        },
        [applyDoc],
      )

      function patchLocalLayer(layerId, patch) {
        const current = docRef.current
        if (!current) return
        const next = docPatchLayer(current, layerId, patch)
        if (next !== current) applyDocLocal(next)
      }

      /* ------------------------------- sync effect ------------------------------- */

      React.useEffect(
        function () {
          if (!sessionId) return undefined
          disposedRef.current = false
          mountReportedRef.current = false
          fitPendingRef.current = true
          lastLocalVersionRef.current = 0
          applyDoc(null, 0)
          setLoading(true)
          setLoadError('')
          setInlineError('')
          setStatus('synced')
          setSelectedLayerId(null)
          setSelectedArtboardId(null)
          setDrillGroupId(null)
          setMarquee(null)
          setSnapGuides([])
          setSnapGuidesArtboardId(null)
          marqueeRef.current = null
          clipboardRef.current = null
          lastLayerPointerRef.current = null
          setComposer(null)
          setCommentError('')
          setTreeOpen(true)
          setInspectorOpen(true)
          panRef.current = null
          setPanning(false)
          spaceHeldRef.current = false
          setSpaceHeld(false)
          setDragOver(false)
          cameraRef.current = defaultCamera()
          setCamera(cameraRef.current)
          historyRef.current = { undo: [], redo: [] }
          applyingHistoryRef.current = false
          if (nudgeRef.current && nudgeRef.current.timer) {
            clearTimeout(nudgeRef.current.timer)
            nudgeRef.current = null
          }

          let cancelled = false
          let timer = null

          function failInitial(error) {
            if (cancelled) return
            const message = messageOf(error)
            setLoading(false)
            setLoadError(message)
            setStatus('offline')
            beacon('state-load-failed', { message: message.slice(0, 200) })
            report({
              sessionId: sessionId,
              kind: 'error',
              message: 'state load failed: ' + message.slice(0, 2000),
            })
          }

          function loadInitial() {
            beacon('state-loading', { sessionId: String(sessionId).slice(0, 40) })
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                if (!data || !data.doc) throw new Error('design-canvas state response has no document')
                lastLocalVersionRef.current = typeof data.version === 'number' ? data.version : 0
                if (data.path) setBoardPath(String(data.path))
                applyDoc(data.doc, lastLocalVersionRef.current)
                setLoading(false)
                setLoadError('')
                setStatus('synced')
                beacon('state-loaded', { version: data.version })
              })
              .catch(function (error) {
                failInitial(error)
              })
          }

          function poll() {
            if (cancelled) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            if (gestureRef.current || marqueeRef.current) return
            if (inFlightRef.current > 0) return
            // A batched nudge holds a local-only preview; never let a poll clobber it.
            if (nudgeRef.current) return
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                setStatus(function (previous) {
                  return previous === 'offline' ? 'synced' : previous
                })
                if (!data || !data.doc) return
                if (data.path) setBoardPath(String(data.path))
                const remoteVersion = typeof data.version === 'number' ? data.version : 0
                const heldVersion = versionRef.current
                const sameVersion = remoteVersion === heldVersion
                // The Host owns the board: a replaced/reset document can arrive with an equal or
                // LOWER version (Reset doc, adopting another workspace's board). Adopt it when the
                // version moved in either direction or when the board identity differs, so the
                // canvas never keeps showing a document the Host no longer holds.
                const replacedInPlace = sameVersion && !sameDocumentIdentity(docRef.current, data.doc)
                if (sameVersion && !replacedInPlace) return
                const regressed = remoteVersion < heldVersion
                const external = remoteVersion !== lastLocalVersionRef.current || replacedInPlace
                lastLocalVersionRef.current = remoteVersion
                applyDoc(data.doc, remoteVersion)
                if (regressed) {
                  beacon('state-version-regressed', {
                    from: heldVersion,
                    to: remoteVersion,
                    path: String(data.path || '').slice(0, 80),
                  })
                } else if (replacedInPlace) {
                  beacon('state-replaced-in-place', { version: remoteVersion })
                } else {
                  beacon('state-loaded', { version: remoteVersion, external: external })
                }
                if (external || regressed || replacedInPlace) {
                  setStatus('revising')
                  if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
                  statusTimerRef.current = setTimeout(function () {
                    statusTimerRef.current = null
                    setStatus(function (previous) {
                      return previous === 'revising' ? 'synced' : previous
                    })
                  }, 2500)
                }
              })
              .catch(function (error) {
                if (cancelled) return
                setStatus('offline')
                beacon('poll-failed', { message: shortError(error) })
              })
          }

          loadInitial()
          timer = setInterval(poll, POLL_MS)
          function onVisibilityChange() {
            if (document.visibilityState === 'visible') poll()
          }
          document.addEventListener('visibilitychange', onVisibilityChange)

          return function () {
            cancelled = true
            disposedRef.current = true
            if (timer !== null) clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            if (statusTimerRef.current) {
              clearTimeout(statusTimerRef.current)
              statusTimerRef.current = null
            }
          }
        },
        [sessionId, applyDoc],
      )

      /* ------------------------------- camera: viewport, fit, zoom ------------------------------- */

      function canvasViewport() {
        const node = canvasRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') {
          return { left: 0, top: 0, width: 0, height: 0 }
        }
        try {
          const rect = node.getBoundingClientRect()
          return {
            left: finiteNumber(rect && rect.left, 0),
            top: finiteNumber(rect && rect.top, 0),
            width: Math.max(0, finiteNumber(rect && rect.width, 0)),
            height: Math.max(0, finiteNumber(rect && rect.height, 0)),
          }
        } catch (error) {
          return { left: 0, top: 0, width: 0, height: 0 }
        }
      }

      /** Viewport (client) coordinates -> canvas/document coordinates through the camera. */
      function screenToCanvas(clientX, clientY) {
        const viewport = canvasViewport()
        const cam = cameraRef.current
        const zoom = cam.zoom > 0 ? cam.zoom : 1
        return {
          x: (finiteNumber(clientX, 0) - viewport.left - cam.x) / zoom,
          y: (finiteNumber(clientY, 0) - viewport.top - cam.y) / zoom,
        }
      }

      /** Canvas/document coordinates -> viewport-local pixels (for unscaled overlays). */
      function projectToViewport(canvasX, canvasY) {
        const cam = cameraRef.current
        return {
          x: cam.x + finiteNumber(canvasX, 0) * cam.zoom,
          y: cam.y + finiteNumber(canvasY, 0) * cam.zoom,
        }
      }

      function setCameraValue(next) {
        const value = normalizeCamera(next, cameraRef.current)
        cameraRef.current = value
        setCamera(value)
        return value
      }

      /** Zoom while keeping the canvas point under (viewportX, viewportY) pinned. */
      function zoomAboutViewportPoint(viewportX, viewportY, nextZoom) {
        const cam = cameraRef.current
        const zoom = clamp(roundTo(nextZoom, 3), MIN_ZOOM, MAX_ZOOM)
        const anchorX = finiteNumber(viewportX, 0)
        const anchorY = finiteNumber(viewportY, 0)
        const canvasX = (anchorX - cam.x) / (cam.zoom || 1)
        const canvasY = (anchorY - cam.y) / (cam.zoom || 1)
        return setCameraValue({
          x: anchorX - canvasX * zoom,
          y: anchorY - canvasY * zoom,
          zoom: zoom,
        })
      }

      function zoomCameraBy(delta) {
        const viewport = canvasViewport()
        return zoomAboutViewportPoint(
          viewport.width / 2,
          viewport.height / 2,
          cameraRef.current.zoom + delta,
        )
      }

      /** Camera that frames every artboard inside the current viewport. */
      function computeFitCamera() {
        const viewport = canvasViewport()
        const current = docRef.current
        const layout = computeLayout(current)
        if (layout.width <= 0 || layout.height <= 0) return defaultCamera()
        const availableWidth = Math.max(120, viewport.width - FIT_PADDING)
        const availableHeight = Math.max(120, viewport.height - FIT_PADDING)
        const zoom = clamp(
          roundTo(Math.min(availableWidth / layout.width, availableHeight / layout.height), 2),
          MIN_ZOOM,
          MAX_ZOOM,
        )
        const x = Math.round((viewport.width - layout.width * zoom) / 2)
        const y = Math.round((viewport.height - layout.height * zoom) / 2)
        return {
          x: Number.isFinite(x) ? x : CAMERA_DEFAULT_X,
          y: Number.isFinite(y) ? y : CAMERA_DEFAULT_Y,
          zoom: zoom,
        }
      }

      function fitCamera() {
        const value = setCameraValue(computeFitCamera())
        beacon('camera-fit', { zoom: value.zoom, x: value.x, y: value.y })
        return value
      }

      React.useEffect(
        function () {
          beacon('body-mounted-start', { hasSession: true })
        },
        [],
      )

      React.useEffect(
        function () {
          if (!doc || !fitPendingRef.current) return
          const viewport = canvasViewport()
          // The tab can mount before the sidebar has a measurable size; keep the flag
          // so the first resize/measure still frames the artboards.
          if (viewport.width <= 0 || viewport.height <= 0) return
          fitPendingRef.current = false
          fitCamera()
        },
        [doc],
      )

      React.useEffect(
        function () {
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
            return undefined
          }
          function onWindowResize() {
            if (!fitPendingRef.current || !docRef.current) return
            const viewport = canvasViewport()
            if (viewport.width <= 0 || viewport.height <= 0) return
            fitPendingRef.current = false
            fitCamera()
          }
          window.addEventListener('resize', onWindowResize)
          return function () {
            try {
              window.removeEventListener('resize', onWindowResize)
            } catch (error) {
              /* window may already be gone */
            }
          }
        },
        [],
      )

      React.useEffect(
        function () {
          if (!doc || mountReportedRef.current) return
          mountReportedRef.current = true
          const node = canvasRef.current
          let width = 0
          let height = 0
          try {
            const rect = node ? node.getBoundingClientRect() : null
            width = rect ? Math.round(rect.width) : 0
            height = rect ? Math.round(rect.height) : 0
          } catch (error) {
            width = 0
            height = 0
          }
          const stats = {
            artboards: artboardsOf(doc).length,
            layers: countLayers(doc),
            comments: commentsOf(doc).length,
            width: width,
            height: height,
            zoom: roundTo(cameraRef.current.zoom, 2),
          }
          beacon('body-mounted', stats)
          report({ sessionId: sessionId, kind: 'mount', stats: stats, services: servicesSnapshot() })
        },
        [doc, sessionId],
      )

      /* ------------------------------- selection reconciliation ------------------------------- */

      React.useEffect(
        function () {
          if (!doc) return
          const stillThere = selectedLayerIds.filter(function (layerId) {
            return !!findLayerById(doc, layerId)
          })
          if (stillThere.length !== selectedLayerIds.length) setSelectedLayerIds(stillThere)
          if (selectedArtboardId && !findArtboardById(doc, selectedArtboardId)) setSelectedArtboardId(null)
          if (drillGroupId) {
            const drilled = findLayerById(doc, drillGroupId)
            if (!drilled || drilled.layer.type !== 'group') setDrillGroupId(null)
          }
          if (composer && !findLayerById(doc, composer.layerId)) setComposer(null)
        },
        [doc, selectedLayerIds, selectedArtboardId, drillGroupId, composer],
      )

      /* ------------------------------- ops bridge ------------------------------- */

      function runOps(ops) {
        if (!docRef.current) return Promise.resolve({ ok: false, errors: [], applied: [] })
        inFlightRef.current += 1
        setStatus('saving')
        return postOps(sessionId, ops)
          .then(function (data) {
            const errors = data && Array.isArray(data.errors) ? data.errors : []
            const remoteVersion =
              data && typeof data.version === 'number' ? data.version : versionRef.current
            // Never let an out-of-order response clobber a newer local document.
            if (data && data.doc && !gestureRef.current && remoteVersion >= versionRef.current) {
              applyDoc(data.doc, remoteVersion)
            }
            lastLocalVersionRef.current = remoteVersion
            if (data && data.path) setBoardPath(String(data.path))
            if (errors.length === 0) {
              beacon('ops-ok', { count: ops.length, version: data && data.version })
              setInlineError('')
            } else {
              const text = errors
                .map(function (entry) {
                  return (entry && (entry.message || entry.code)) || 'operation failed'
                })
                .join('; ')
              setInlineError(text)
              beacon('ops-errors', { count: errors.length })
            }
            return {
              ok: errors.length === 0,
              errors: errors,
              doc: data && data.doc ? data.doc : null,
              applied: data && Array.isArray(data.applied) ? data.applied : [],
              version: data && data.version,
            }
          })
          .catch(function (error) {
            const message = messageOf(error)
            setInlineError(message)
            setStatus('offline')
            beacon('ops-failed', { message: message.slice(0, 200) })
            getState(sessionId)
              .then(function (data) {
                if (gestureRef.current) return
                if (data && data.doc) {
                  lastLocalVersionRef.current =
                    typeof data.version === 'number' ? data.version : versionRef.current
                  applyDoc(data.doc, data.version)
                  setStatus('synced')
                  if (data.path) setBoardPath(String(data.path))
                }
              })
              .catch(function () {
                /* stays offline; the header offers Retry */
              })
            return { ok: false, errors: [{ message: message }], applied: [] }
          })
          .finally(function () {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1)
            if (inFlightRef.current === 0) {
              setStatus(function (previous) {
                return previous === 'saving' ? 'synced' : previous
              })
            }
          })
      }

      function retryNow() {
        if (!sessionId) return
        setStatus('saving')
        setInlineError('')
        getState(sessionId)
          .then(function (data) {
            if (!data || !data.doc) throw new Error('design-canvas state response has no document')
            lastLocalVersionRef.current =
              typeof data.version === 'number' ? data.version : 0
            if (data.path) setBoardPath(String(data.path))
            applyDoc(data.doc, data.version)
            setLoading(false)
            setLoadError('')
            setStatus('synced')
            beacon('state-loaded', { version: data.version, retry: true })
          })
          .catch(function (error) {
            setStatus('offline')
            setLoadError(messageOf(error))
            beacon('retry-failed', { message: shortError(error) })
          })
      }

      /* ------------------------------- history (undo/redo) ------------------------------- */

      function historyState() {
        return historyRef.current
      }

      function pushHistoryEntry(label, forwardOps, inverseOps) {
        if (!Array.isArray(forwardOps) || forwardOps.length === 0) return null
        if (!Array.isArray(inverseOps) || inverseOps.length === 0) return null
        const entry = { label: label, ops: forwardOps, inverse: inverseOps }
        const history = historyState()
        history.undo.push(entry)
        if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
        history.redo = []
        return entry
      }

      function dropHistoryEntry(entry) {
        const history = historyState()
        const index = history.undo.indexOf(entry)
        if (index >= 0) history.undo.splice(index, 1)
      }

      /** Run one forward batch and remember its inverse (no recording during undo/redo). */
      function commitWithHistory(label, forwardOps, inverseOps) {
        const entry = pushHistoryEntry(label, forwardOps, inverseOps)
        return runOps(forwardOps).then(function (result) {
          if (entry && result && result.ok === false) dropHistoryEntry(entry)
          return result
        })
      }

      /** Previous values for a layer.update patch so the change can be undone. */
      function inversePatchFor(layer, patch) {
        const inverse = {}
        if (!isObject(layer) || !isObject(patch)) return inverse
        Object.keys(patch).forEach(function (key) {
          const previous = layer[key]
          if (previous === undefined) {
            // Absent props: restore the documented "absent" state. Boolean flags and size
            // bounds clear with false/null (CONTRACT: locked/hug/min-max are absent by default),
            // nullable props clear with null, enums get their documented default back.
            if (key === 'shadow' || key === 'layout' || key === 'alignSelf') inverse[key] = null
            else if (key === 'visible') inverse[key] = true
            else if (key === 'grow' || key === 'clip') inverse[key] = false
            else if (
              key === 'locked' ||
              key === 'hugWidth' ||
              key === 'hugHeight' ||
              key === 'dashed' ||
              key === 'arrowStart' ||
              key === 'arrowEnd'
            ) {
              inverse[key] = false
            } else if (
              key === 'minWidth' ||
              key === 'minHeight' ||
              key === 'maxWidth' ||
              key === 'maxHeight' ||
              key === 'rowGap' ||
              key === 'columnGap'
            ) {
              inverse[key] = null
            } else if (key === 'opacity') inverse[key] = 1
            else if (key === 'letterSpacing') inverse[key] = 0
            else if (key === 'textTransform') inverse[key] = 'none'
            else if (key === 'justify') inverse[key] = 'start'
            else if (key === 'align') inverse[key] = 'stretch'
            else if (key === 'alignContent') inverse[key] = 'stretch'
            return
          }
          inverse[key] = previous
        })
        return inverse
      }

      /** layer.add ops re-creating a whole subtree (root first, children with parentId). */
      function insertOpsForSubtree(layer, destination, index) {
        const ops = []
        if (!isObject(layer) || !isObject(destination)) return ops
        const rootOp = { type: 'layer.add', layer: opLayerForAdd(layer) }
        if (destination.parentId) rootOp.parentId = destination.parentId
        else if (destination.artboardId) rootOp.artboardId = destination.artboardId
        else return ops
        if (typeof index === 'number') rootOp.index = index
        ops.push(rootOp)
        function addChildren(parentLayer) {
          const kids = childrenOf(parentLayer)
          for (let childIndex = 0; childIndex < kids.length; childIndex += 1) {
            const child = kids[childIndex]
            if (!isObject(child)) continue
            ops.push({
              type: 'layer.add',
              parentId: parentLayer.id,
              index: childIndex,
              layer: opLayerForAdd(child),
            })
            addChildren(child)
          }
        }
        addChildren(layer)
        return ops
      }

      function inverseMoveToOps(found) {
        if (!found || !found.layer) return []
        const op = { type: 'layer.move_to', layerId: found.layer.id, index: found.index }
        if (found.parentId) op.parentId = found.parentId
        else op.artboardId = found.artboard.id
        return [op]
      }

      function undoOnce() {
        try {
          if (applyingHistoryRef.current) return false
          if (gestureRef.current || panRef.current) return false
          flushNudge()
          const history = historyState()
          if (history.undo.length === 0) {
            beacon('undo-empty')
            return false
          }
          const entry = history.undo.pop()
          applyingHistoryRef.current = true
          runOps(entry.inverse).then(
            function (result) {
              applyingHistoryRef.current = false
              if (result && result.ok === false) {
                history.undo.push(entry)
                setInlineError(strings.undoFailed)
                beacon('undo-failed', { label: entry.label })
                return
              }
              history.redo.push(entry)
              if (history.redo.length > HISTORY_LIMIT) history.redo.shift()
              beacon('undo', { label: entry.label, count: entry.inverse.length })
            },
            function () {
              applyingHistoryRef.current = false
              history.undo.push(entry)
            },
          )
          return true
        } catch (error) {
          applyingHistoryRef.current = false
          beacon('undo-threw', { message: shortError(error) })
          return false
        }
      }

      function redoOnce() {
        try {
          if (applyingHistoryRef.current) return false
          if (gestureRef.current || panRef.current) return false
          flushNudge()
          const history = historyState()
          if (history.redo.length === 0) {
            beacon('redo-empty')
            return false
          }
          const entry = history.redo.pop()
          applyingHistoryRef.current = true
          runOps(entry.ops).then(
            function (result) {
              applyingHistoryRef.current = false
              if (result && result.ok === false) {
                history.redo.push(entry)
                setInlineError(strings.redoFailed)
                beacon('redo-failed', { label: entry.label })
                return
              }
              history.undo.push(entry)
              if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
              beacon('redo', { label: entry.label, count: entry.ops.length })
            },
            function () {
              applyingHistoryRef.current = false
              history.redo.push(entry)
            },
          )
          return true
        } catch (error) {
          applyingHistoryRef.current = false
          beacon('redo-threw', { message: shortError(error) })
          return false
        }
      }

      /* ------------------------------- selection ------------------------------- */

      /** Computed node for a layer id (with artboard-local worldRect), or null. */
      function nodeForLayer(layerId) {
        const tree = treeRef.current
        if (!tree || !tree.byId || typeof layerId !== 'string' || !layerId) return null
        return tree.byId.get(layerId) || null
      }

      /**
       * Figma-like click target: a click on a child of a `group` selects the group first; once the
       * user drilled into that group (double-click / Enter) the child itself is the target.
       * Frames never trap clicks — their children stay directly selectable (v1 behaviour).
       */
      function selectionTargetForNode(node, drillId) {
        if (!node) return null
        const chain = []
        let current = node
        while (current) {
          chain.push(current)
          current = current.parent || null
        }
        let stop = chain.length - 1
        if (drillId) {
          for (let index = 0; index < chain.length; index += 1) {
            if (chain[index] && chain[index].id === drillId) {
              stop = index - 1
              break
            }
          }
        }
        for (let index = stop; index >= 0; index -= 1) {
          if (chain[index] && chain[index].type === 'group') return chain[index]
        }
        return node
      }

      function artboardIdForNode(node) {
        return node && node.artboard && typeof node.artboard.id === 'string' ? node.artboard.id : null
      }

      function artboardIdForLayer(layerId) {
        const node = nodeForLayer(layerId)
        if (node) return artboardIdForNode(node)
        const current = docRef.current
        const found = current && layerId ? findLayerById(current, layerId) : null
        return found ? found.artboard.id : null
      }

      /** Sibling nodes of a computed node (front-to-back array as authored). */
      function siblingNodesOf(node) {
        if (!node) return []
        if (node.parent) return Array.isArray(node.parent.children) ? node.parent.children : []
        const tree = treeRef.current
        if (!tree || !Array.isArray(tree.artboards)) return []
        for (let index = 0; index < tree.artboards.length; index += 1) {
          const entry = tree.artboards[index]
          if (entry && entry.artboard && node.artboard && entry.artboard.id === node.artboard.id) {
            return Array.isArray(entry.layers) ? entry.layers : []
          }
        }
        return []
      }

      /** Ids from `fromId` to `toId` (inclusive) when both are siblings, else null. */
      function siblingRangeIds(fromId, toId) {
        const fromNode = nodeForLayer(fromId)
        const toNode = nodeForLayer(toId)
        if (!fromNode || !toNode) return null
        if ((fromNode.parent ? fromNode.parent.id : null) !== (toNode.parent ? toNode.parent.id : null)) {
          return null
        }
        if (artboardIdForNode(fromNode) !== artboardIdForNode(toNode)) return null
        const siblings = siblingNodesOf(fromNode)
        let fromIndex = -1
        let toIndex = -1
        for (let index = 0; index < siblings.length; index += 1) {
          const sibling = siblings[index]
          if (!sibling) continue
          if (sibling.id === fromId) fromIndex = index
          if (sibling.id === toId) toIndex = index
        }
        if (fromIndex < 0 || toIndex < 0) return null
        const start = Math.min(fromIndex, toIndex)
        const end = Math.max(fromIndex, toIndex)
        const ids = []
        for (let index = start; index <= end; index += 1) {
          if (siblings[index] && siblings[index].id) ids.push(siblings[index].id)
        }
        return ids
      }

      /**
       * Outermost selected ids: when both a container and one of its descendants are selected, the
       * container is the unit every mutation works on (a group cannot be moved twice).
       */
      function rootSelectionIds(ids) {
        const current = docRef.current
        const list = Array.isArray(ids) ? ids : []
        const roots = []
        if (!current) return list.slice()
        const selected = new Set(list)
        for (let index = 0; index < list.length; index += 1) {
          const layerId = list[index]
          if (typeof layerId !== 'string' || !layerId) continue
          if (roots.indexOf(layerId) >= 0) continue
          let found = findLayerById(current, layerId)
          let nested = false
          const guard = new Set()
          while (found && found.parent) {
            if (guard.has(found.parent.id)) break
            guard.add(found.parent.id)
            if (selected.has(found.parent.id)) {
              nested = true
              break
            }
            found = findLayerById(current, found.parent.id)
          }
          if (!nested) roots.push(layerId)
        }
        return roots
      }

      function selectionNodes(ids) {
        const list = Array.isArray(ids) ? ids : []
        const nodes = []
        for (let index = 0; index < list.length; index += 1) {
          const node = nodeForLayer(list[index])
          if (node) nodes.push(node)
        }
        return nodes
      }

      /** Union box of a selection in artboard-local canvas units, or null. */
      function selectionBounds(ids) {
        const nodes = selectionNodes(ids)
        return unionRects(
          nodes.map(function (node) { return node.worldRect }),
        )
      }

      /**
       * Single funnel for every selection change: ordered ids, the owning artboard, the drilled
       * group and the composer. Refs are written synchronously so the pointer handler that just
       * changed the selection can start a gesture in the same tick.
       */
      function applySelection(ids, artboardId, drillId) {
        const next = []
        const seen = new Set()
        const raw = Array.isArray(ids) ? ids : []
        for (let index = 0; index < raw.length; index += 1) {
          const layerId = raw[index]
          if (typeof layerId !== 'string' || !layerId || seen.has(layerId)) continue
          seen.add(layerId)
          next.push(layerId)
        }
        const drill = typeof drillId === 'string' && drillId ? drillId : null
        const primary = next.length ? next[next.length - 1] : null
        selectedLayerIdsRef.current = next
        selectedLayerIdRef.current = primary
        if (artboardId) selectedArtboardIdRef.current = artboardId
        drillGroupIdRef.current = drill
        setSelectedLayerIds(next)
        setDrillGroupId(drill)
        if (artboardId) setSelectedArtboardId(artboardId)
        setComposer(function (previous) {
          if (!previous) return previous
          return primary && previous.layerId === primary ? previous : null
        })
      }

      /**
       * Select one layer. `options = { additive, range }`: additive (Shift / Ctrl / Cmd+click)
       * toggles the layer in the set; range extends from the primary to the target sibling.
       * Clicking inside a group selects the group unless the user drilled into it.
       */
      function selectLayer(layerId, artboardId, options) {
        const opts = isObject(options) ? options : {}
        if (!layerId) {
          clearSelection()
          return
        }
        const node = nodeForLayer(layerId)
        const drill = drillGroupIdRef.current
        const target = node ? selectionTargetForNode(node, drill) : null
        const targetId = target ? target.id : layerId
        const board =
          artboardId || artboardIdForNode(target) || artboardIdForLayer(layerId) || selectedArtboardIdRef.current || null
        const currentIds = selectedLayerIdsRef.current
        if (opts.additive === true || opts.toggle === true) {
          const at = currentIds.indexOf(targetId)
          const nextIds =
            at >= 0
              ? currentIds.filter(function (id) { return id !== targetId })
              : currentIds.concat([targetId])
          applySelection(nextIds, board, drill)
          beacon('select-layer', { count: nextIds.length, additive: true })
          return
        }
        if (opts.range === true && currentIds.length) {
          const range = siblingRangeIds(currentIds[currentIds.length - 1], targetId)
          if (range && range.length) {
            applySelection(range, board, drill)
            beacon('select-layer', { count: range.length, range: true })
            return
          }
        }
        applySelection([targetId], board, drill)
      }

      /** Replace the selection with a set of ids (tree multi-select, marquee, paste, …). */
      function selectLayers(ids, artboardId) {
        const current = docRef.current
        const clean = []
        const seen = new Set()
        const raw = Array.isArray(ids) ? ids : []
        for (let index = 0; index < raw.length; index += 1) {
          const layerId = raw[index]
          if (typeof layerId !== 'string' || !layerId || seen.has(layerId)) continue
          if (current && !findLayerById(current, layerId)) continue
          seen.add(layerId)
          clean.push(layerId)
        }
        const primary = clean.length ? clean[clean.length - 1] : null
        applySelection(
          clean,
          artboardId || (primary ? artboardIdForLayer(primary) : null),
          null,
        )
        return clean
      }

      /** Select every top-level layer of the selected (or first) artboard — Ctrl/Cmd+A. */
      function selectAllInArtboard() {
        const current = docRef.current
        if (!current) return []
        const boards = artboardsOf(current)
        let boardId = selectedArtboardIdRef.current
        if (!boardId && selectedLayerIdRef.current) boardId = artboardIdForLayer(selectedLayerIdRef.current)
        if (!boardId) {
          const first = boards.find(function (artboard) { return isObject(artboard) })
          boardId = first ? first.id : null
        }
        const artboard = boardId ? findArtboardById(current, boardId) : null
        if (!artboard) {
          clearSelection()
          return []
        }
        const ids = layersOf(artboard)
          .filter(function (layer) { return isObject(layer) && typeof layer.id === 'string' })
          .map(function (layer) { return layer.id })
        applySelection(ids, artboard.id, null)
        beacon('select-all', { count: ids.length })
        return ids
      }

      function selectArtboard(artboardId) {
        applySelection([], artboardId || null, null)
      }

      function clearSelection() {
        applySelection([], null, null)
      }

      /** Enter: step INTO the selected container, selecting its front-most child. */
      function drillIntoSelection() {
        const primaryId = selectedLayerIdRef.current
        if (!primaryId) return false
        const node = nodeForLayer(primaryId)
        if (!node || !isContainerLayer(node.layer)) return false
        const kids = Array.isArray(node.children) ? node.children : []
        const child = kids.length ? kids[kids.length - 1] : null
        applySelection(
          child ? [child.id] : [],
          artboardIdForNode(node),
          node.type === 'group' ? node.id : drillGroupIdRef.current,
        )
        beacon('drill-in', { layerId: node.id, type: node.type })
        return true
      }

      /**
       * Descend from `node` to the deepest visible descendant whose box contains the pointer
       * (artboard-local coordinates). This is what makes double-click "click through" a stack of
       * frames/groups in one gesture, the way Figma's deep select behaves.
       */
      function deepestNodeAtClientPoint(node, clientX, clientY) {
        if (!node) return node
        const current = docRef.current
        const boardId = artboardIdForNode(node)
        if (!current || !boardId) return node
        const entry = computeLayout(current).entryById.get(boardId) || null
        if (!entry) return node
        const point = screenToCanvas(clientX, clientY)
        const local = { x: point.x - entry.frameX, y: point.y - entry.frameY }
        let deepest = node
        let guard = 0
        while (guard < 12) {
          guard += 1
          const children = Array.isArray(deepest.children) ? deepest.children : []
          let next = null
          // Front-to-back: the last painted child owns the pixel when boxes overlap.
          for (let index = children.length - 1; index >= 0; index -= 1) {
            const child = children[index]
            if (!child || !child.layer || child.layer.visible === false) continue
            if (rectContainsPoint(child.worldRect, local)) {
              next = child
              break
            }
          }
          if (!next) break
          deepest = next
        }
        return deepest
      }

      /** Closest containing frame/group of a node (used as the drill scope after a deep select). */
      function containerIdForNode(node) {
        let current = node ? node.parent : null
        while (current) {
          if (isContainerLayer(current.layer)) return current.id
          current = current.parent
        }
        return null
      }

      /**
       * Double-click (Figma deep-select): descend to the layer under the pointer and select it, so
       * repeated double-clicks walk a deeply nested object down to the layer itself. Falls back to
       * stepping one container level (for a double-click on a container's own background).
       */
      function drillIntoNode(node, event) {
        if (!node) return false
        const board = artboardIdForNode(node)
        // A leaf under the pointer IS the deepest object: one double-click selects it (and sets
        // the scope to its parent container so the following single clicks stay inside it).
        if (!isContainerLayer(node.layer)) {
          applySelection([node.id], board, containerIdForNode(node))
          beacon('deep-select', { layerId: node.id, container: containerIdForNode(node) })
          return true
        }
        // A container: descend to the deepest descendant under the pointer.
        const clientX = event && Number.isFinite(event.clientX) ? event.clientX : null
        const clientY = event && Number.isFinite(event.clientY) ? event.clientY : null
        const deepest =
          clientX !== null && clientY !== null
            ? deepestNodeAtClientPoint(node, clientX, clientY)
            : node
        if (deepest && deepest.id !== node.id) {
          applySelection([deepest.id], artboardIdForNode(deepest) || board, containerIdForNode(deepest))
          beacon('deep-select', { layerId: deepest.id, from: node.id })
          return true
        }
        const drill = drillGroupIdRef.current
        // Containers from the outermost ancestor down to the node itself.
        const containers = []
        let current = node.parent || null
        while (current) {
          if (isContainerLayer(current.layer)) containers.unshift(current)
          current = current.parent || null
        }
        if (isContainerLayer(node.layer)) containers.push(node)
        let nextIndex = 0
        if (drill) {
          const at = containers.findIndex(function (container) {
            return container.id === drill
          })
          nextIndex = at >= 0 ? at + 1 : 0
        }
        const next = containers[nextIndex] || null
        if (next) {
          // The child of `next` that leads toward the double-clicked node (or the node itself).
          let child = node
          while (child && child.parent && child.parent.id !== next.id) child = child.parent
          const childId = child && child.parent && child.parent.id === next.id ? child.id : node.id
          applySelection([childId], board, next.id)
          beacon('drill-step', {
            container: next.id,
            type: next.type,
            into: childId,
            depth: nextIndex,
          })
          return true
        }
        applySelection([node.id], board, drill)
        beacon('drill-step', { container: null, into: node.id, depth: containers.length })
        return true
      }

      /** Esc: step out of the drilled group to the group itself, else clear the selection. */
      function stepSelectionOut() {
        const drillId = drillGroupIdRef.current
        if (drillId) {
          const node = nodeForLayer(drillId)
          applySelection([drillId], node ? artboardIdForNode(node) : null, null)
          return true
        }
        if (selectedLayerIdsRef.current.length) {
          clearSelection()
          return true
        }
        return false
      }

      /** Toggle snapping on/off (Alt temporarily disables it for one drag regardless). */
      function toggleSnap() {
        const next = !snapEnabledRef.current
        snapEnabledRef.current = next
        setSnapEnabled(next)
        beacon('snap-toggle', { enabled: next })
        return next
      }

      /* ------------------------------- mutations ------------------------------- */

      function openComposerFor(layerId, artboardId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const targetArtboard = artboardId || found.artboard.id
        setSelectedLayerId(layerId)
        setSelectedArtboardId(targetArtboard)
        setCommentError('')
        setComposer({ layerId: layerId, artboardId: targetArtboard, text: '' })
      }

      /** Changed subset of `patch` for one layer (null when nothing actually changes). */
      function patchDiff(layer, patch) {
        if (!isObject(patch)) return null
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (!isObject(layer) || layer[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        return count > 0 ? changed : null
      }

      /**
       * Apply a property patch to EVERY selected layer as one op batch and one undo entry.
       * Single-layer edits (inspector, tree) keep working unchanged; multi-edit comes for free.
       */
      function commitLayer(patch) {
        const ids = selectedLayerIdsRef.current
        const current = docRef.current
        if (!current || !ids.length || !isObject(patch)) return false
        const entries = []
        const ops = []
        const inverse = []
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          const changed = patchDiff(found.layer, patch)
          if (!changed) continue
          entries.push({ layerId: found.layer.id, patch: changed })
          ops.push({ type: 'layer.update', layerId: found.layer.id, patch: changed })
          const inversePatch = inversePatchFor(found.layer, changed)
          if (Object.keys(inversePatch).length > 0) {
            inverse.push({ type: 'layer.update', layerId: found.layer.id, patch: inversePatch })
          }
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('update', ops, inverse)
        return true
      }

      function commitArtboard(patch) {
        const artboardId = selectedArtboardId
        const current = docRef.current
        if (!current || !artboardId) return
        const artboard = findArtboardById(current, artboardId)
        if (!artboard) return
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (artboard[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        if (count === 0) return
        applyDocLocal(docPatchArtboard(current, artboardId, changed))
        const ops = [{ type: 'artboard.update', artboardId: artboardId, patch: changed }]
        const inversePatch = inversePatchFor(artboard, changed)
        const inverse =
          Object.keys(inversePatch).length > 0
            ? [{ type: 'artboard.update', artboardId: artboardId, patch: inversePatch }]
            : []
        commitWithHistory('artboard', ops, inverse)
      }

      /* ------------------------------- id-based mutations (tree / inspector) ------------------------------- */

      /**
       * Patch ONE layer by id, independent of the current selection, as a single undo entry.
       * The tree and the inspector call this for inline rename, drag-reorder and per-row edits.
       */
      function updateLayer(layerId, patch) {
        const current = docRef.current
        if (!current || typeof layerId !== 'string' || !layerId || !isObject(patch)) return false
        const found = findLayerById(current, layerId)
        if (!found) return false
        const changed = patchDiff(found.layer, patch)
        if (!changed) return false
        applyDocLocal(docPatchLayers(current, [{ layerId: layerId, patch: changed }]))
        const inversePatch = inversePatchFor(found.layer, changed)
        commitWithHistory(
          'update',
          [{ type: 'layer.update', layerId: layerId, patch: changed }],
          Object.keys(inversePatch).length > 0
            ? [{ type: 'layer.update', layerId: layerId, patch: inversePatch }]
            : [],
        )
        return true
      }

      /** Inline rename of one layer (trimmed, empty names are ignored). */
      function renameLayer(layerId, name) {
        const trimmed = typeof name === 'string' ? name.trim().slice(0, 200) : ''
        if (!trimmed) return false
        return updateLayer(layerId, { name: trimmed })
      }

      /** Inline rename of an artboard (single artboard.update + one undo entry). */
      function renameArtboard(artboardId, name) {
        const current = docRef.current
        if (!current || typeof artboardId !== 'string' || !artboardId) return false
        const trimmed = typeof name === 'string' ? name.trim().slice(0, 200) : ''
        if (!trimmed) return false
        const artboard = findArtboardById(current, artboardId)
        if (!artboard || artboard.name === trimmed) return false
        const previousName =
          typeof artboard.name === 'string' && artboard.name ? artboard.name : 'Artboard'
        applyDocLocal(docPatchArtboard(current, artboardId, { name: trimmed }))
        commitWithHistory(
          'rename-artboard',
          [{ type: 'artboard.update', artboardId: artboardId, patch: { name: trimmed } }],
          [{ type: 'artboard.update', artboardId: artboardId, patch: { name: previousName } }],
        )
        beacon('artboard-rename', { artboardId: artboardId })
        return true
      }

      /** Reorder one layer within its current parent (tree drag/drop), single undo entry. */
      function reorderLayer(layerId, index) {
        const current = docRef.current
        if (!current || typeof layerId !== 'string' || !layerId) return false
        const found = findLayerById(current, layerId)
        if (!found) return false
        const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
        if (siblings.length < 2) return false
        const target = clamp(Math.round(finiteNumber(index, found.index)), 0, siblings.length - 1)
        if (target === found.index) return false
        applyDocLocal(docReorderLayer(current, layerId, target))
        commitWithHistory(
          'reorder',
          [{ type: 'layer.reorder', layerId: layerId, index: target }],
          [{ type: 'layer.reorder', layerId: layerId, index: found.index }],
        )
        beacon('layer-reorder', { layerId: layerId, index: target, source: 'tree' })
        return true
      }

      function toggleVisible(layerId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const visible = found.layer.visible === false
        patchLocalLayer(layerId, { visible: visible })
        commitWithHistory(
          'visibility',
          [{ type: 'layer.update', layerId: layerId, patch: { visible: visible } }],
          [
            {
              type: 'layer.update',
              layerId: layerId,
              patch: { visible: found.layer.visible !== false },
            },
          ],
        )
      }

      /**
       * Delete every given layer (roots only) in ONE document update + one undo entry.
       * Locked layers are protected from direct manipulation; the rest of the selection still goes.
       */
      function deleteLayersByIds(ids) {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(ids)
        if (!roots.length) return false
        const buckets = []
        const removed = []
        let blockedLocked = false
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          if (found.layer.locked === true) {
            blockedLocked = true
            continue
          }
          buckets.push({
            key: (found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id) + '#' + found.index,
            parentId: found.parentId,
            artboardId: found.artboard.id,
            index: found.index,
            ops: insertOpsForSubtree(
              found.layer,
              found.parentId ? { parentId: found.parentId } : { artboardId: found.artboard.id },
              found.index,
            ),
          })
          removed.push(found.layer.id)
        }
        if (removed.length === 0) {
          if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
          return false
        }
        applyDocLocal(docRemoveLayers(current, removed))
        const nextDoc = docRef.current
        const remaining = selectedLayerIdsRef.current.filter(function (layerId) {
          return removed.indexOf(layerId) < 0 && !!findLayerById(nextDoc, layerId)
        })
        applySelection(remaining, selectedArtboardIdRef.current, null)
        // Restore in ascending sibling order so the original indexes line up again.
        buckets.sort(function (first, second) {
          if (first.parentId !== second.parentId) return first.parentId ? -1 : 1
          return first.index - second.index
        })
        const inverse = []
        for (let index = 0; index < buckets.length; index += 1) {
          inverse.push.apply(inverse, buckets[index].ops)
        }
        commitWithHistory(
          'delete',
          removed.map(function (layerId) {
            return { type: 'layer.delete', layerId: layerId }
          }),
          inverse,
        )
        if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
        beacon('layer-delete', { count: removed.length })
        return true
      }

      function deleteLayerById(layerId) {
        return deleteLayersByIds([layerId])
      }

      function deleteSelectedLayer() {
        const ids = selectedLayerIdsRef.current
        if (!ids.length) return false
        return deleteLayersByIds(ids)
      }

      /**
       * Reorder ops that turn `list` into `target` (same members). Works for both the local
       * simulation and the Host batch because `layer.reorder` is applied sequentially.
       */
      function reorderOpsToReach(list, target) {
        const order = Array.isArray(list) ? list.slice() : []
        const goal = Array.isArray(target) ? target : []
        const ops = []
        for (let index = 0; index < goal.length; index += 1) {
          const wanted = goal[index]
          if (!wanted || !wanted.id) continue
          if (order[index] && order[index].id === wanted.id) continue
          let from = -1
          for (let scan = index; scan < order.length; scan += 1) {
            if (order[scan] && order[scan].id === wanted.id) {
              from = scan
              break
            }
          }
          if (from < 0) continue
          const moved = order.splice(from, 1)[0]
          order.splice(index, 0, moved)
          ops.push({ type: 'layer.reorder', layerId: wanted.id, index: index })
        }
        return ops
      }

      /**
       * Z-order moves for the whole selection: `front`, `forward`, `backward`, `back` (the tree's
       * up/down buttons map to forward/backward). One op batch, one undo entry.
       */
      function reorderSelection(direction) {
        const current = docRef.current
        if (!current) return false
        const mode =
          direction === 'up' || direction === 'forward'
            ? 'forward'
            : direction === 'down' || direction === 'backward'
              ? 'backward'
              : direction === 'front' || direction === 'back'
                ? direction
                : null
        if (!mode) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (!roots.length) return false
        const selectedSet = new Set(roots)
        const groups = new Map()
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          let group = groups.get(key)
          if (!group) {
            group = {
              key: key,
              list: (found.parentId ? childrenOf(found.parent) : layersOf(found.artboard)).slice(),
            }
            groups.set(key, group)
          }
        }
        let forwardOps = []
        let inverseOps = []
        groups.forEach(function (group) {
          const list = group.list
          if (list.length < 2) return
          const isSelected = function (layer) {
            return !!(layer && selectedSet.has(layer.id))
          }
          const target = list.slice()
          if (mode === 'front' || mode === 'back') {
            const picked = target.filter(isSelected)
            if (!picked.length) return
            const rest = target.filter(function (layer) { return !isSelected(layer) })
            const next = mode === 'front' ? rest.concat(picked) : picked.concat(rest)
            target.length = 0
            for (let index = 0; index < next.length; index += 1) target.push(next[index])
          } else if (mode === 'forward') {
            for (let index = target.length - 2; index >= 0; index -= 1) {
              if (!isSelected(target[index]) || isSelected(target[index + 1])) continue
              const swap = target[index]
              target[index] = target[index + 1]
              target[index + 1] = swap
            }
          } else {
            for (let index = 1; index < target.length; index += 1) {
              if (!isSelected(target[index]) || isSelected(target[index - 1])) continue
              const swap = target[index]
              target[index] = target[index - 1]
              target[index - 1] = swap
            }
          }
          forwardOps = forwardOps.concat(reorderOpsToReach(list, target))
          inverseOps = inverseOps.concat(reorderOpsToReach(target, list))
        })
        if (forwardOps.length === 0) return false
        let next = current
        for (let index = 0; index < forwardOps.length; index += 1) {
          next = docReorderLayer(next, forwardOps[index].layerId, forwardOps[index].index)
        }
        applyDocLocal(next)
        commitWithHistory(
          mode === 'front' || mode === 'back' ? 'arrange' : 'reorder',
          forwardOps,
          inverseOps,
        )
        beacon('layer-reorder', { source: 'selection', mode: mode, count: forwardOps.length })
        return true
      }

      function moveSelected(direction) {
        return reorderSelection(direction)
      }

      function arrangeSelection(mode) {
        return reorderSelection(mode)
      }

      /** layer.add must not carry `children` (the Host builds it with parentId adds). */
      function opLayerForAdd(layer) {
        if (!isObject(layer) || !isContainerLayer(layer) || !Array.isArray(layer.children)) {
          return layer
        }
        const copy = Object.assign({}, layer)
        delete copy.children
        return copy
      }

      function addLayer(type) {
        const current = docRef.current
        if (!current) return
        const artboards = artboardsOf(current)
        const selectedId = selectedLayerIdRef.current
        let parentFound = null
        if (selectedId) {
          const found = findLayerById(current, selectedId)
          if (found && found.layer && found.layer.type === 'frame') parentFound = found
        }
        let artboard = null
        if (parentFound) {
          artboard = parentFound.artboard
          if (parentFound.depth >= FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            return
          }
          if (childrenOf(parentFound.layer).length >= FRAME_MAX_CHILDREN) {
            setInlineError(strings.childLimit)
            return
          }
        } else {
          artboard =
            (selectedArtboardIdRef.current
              ? findArtboardById(current, selectedArtboardIdRef.current)
              : null) ||
            artboards.find(function (item) {
              return isObject(item)
            }) ||
            null
          if (!artboard) {
            setInlineError(strings.noArtboards)
            return
          }
        }
        const box = parentFound ? parentFound.layer : artboard
        const layer = createLayer(type, box)
        const destination = parentFound
          ? { parentId: parentFound.layer.id }
          : { artboardId: artboard.id }
        applyDocLocal(docInsertLayer(current, destination, layer))
        setSelectedLayerId(layer.id)
        setSelectedArtboardId(artboard.id)
        const op = { type: 'layer.add', layer: opLayerForAdd(layer) }
        if (destination.parentId) op.parentId = destination.parentId
        else op.artboardId = destination.artboardId
        commitWithHistory(
          type === 'frame' ? 'add-frame' : 'add-layer',
          [op],
          [{ type: 'layer.delete', layerId: layer.id }],
        )
        beacon(type === 'frame' ? 'frame-add' : 'layer-add', {
          type: type,
          parentId: destination.parentId,
          artboardId: destination.artboardId,
        })
      }

      function cloneLayerSubtree(layer, offsetX, offsetY) {
        if (!isObject(layer)) return null
        const copy = Object.assign({}, layer, { id: makeId('l') })
        if (offsetX || offsetY) {
          copy.x = Math.round(finiteNumber(layer.x, 0) + offsetX)
          copy.y = Math.round(finiteNumber(layer.y, 0) + offsetY)
        }
        if (isContainerLayer(layer)) {
          copy.children = childrenOf(layer).map(function (child) {
            return cloneLayerSubtree(child, 0, 0)
          })
        }
        return copy
      }

      /**
       * Duplicate the whole selection. Each selected root is copied with remapped subtree ids and
       * a 12,12 offset (0 inside an auto-layout parent, where x/y are derived); everything lands in
       * ONE `runOps` batch and ONE undo entry, and the copies become the new selection.
       */
      function duplicateSelected() {
        try {
          const current = docRef.current
          if (!current) return false
          const roots = rootSelectionIds(selectedLayerIdsRef.current)
          if (!roots.length) return false
          const copies = []
          const ops = []
          let boardId = null
          for (let index = 0; index < roots.length; index += 1) {
            const found = findLayerById(current, roots[index])
            if (!found) continue
            const node = nodeForLayer(found.layer.id)
            const autoParent = !!(node && node.autoParent)
            const offset = autoParent ? 0 : DUPLICATE_OFFSET
            const copy = cloneLayerSubtree(found.layer, offset, offset)
            if (!copy) continue
            const destination = found.parentId
              ? { parentId: found.parentId }
              : { artboardId: found.artboard.id }
            if (destination.parentId) {
              const parentFound = findLayerById(current, destination.parentId)
              if (!parentFound || !parentFound.layer) continue
              if (childrenOf(parentFound.layer).length + copies.length >= FRAME_MAX_CHILDREN) {
                setInlineError(strings.childLimit)
                continue
              }
              if (parentFound.depth + subtreeHeight(copy) > FRAME_MAX_DEPTH) {
                setInlineError(strings.depthLimit)
                continue
              }
            }
            // A single duplicate keeps v1 behaviour (directly above the original); several
            // duplicates from one gesture are appended so their indexes cannot fight each other.
            const insertIndex = roots.length === 1 ? found.index + 1 : null
            const subOps = insertOpsForSubtree(copy, destination, insertIndex)
            if (subOps.length === 0) continue
            if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
              setInlineError(strings.duplicateTooLarge)
              beacon('duplicate-rejected', { layerId: found.layer.id, ops: subOps.length })
              return false
            }
            ops.push.apply(ops, subOps)
            copies.push({ copy: copy, destination: destination, index: insertIndex })
            boardId = found.artboard.id
          }
          if (copies.length === 0) return false
          let next = current
          for (let index = 0; index < copies.length; index += 1) {
            next = docInsertLayers(next, copies[index].destination, [copies[index].copy], copies[index].index)
          }
          applyDocLocal(next)
          applySelection(
            copies.map(function (item) { return item.copy.id }),
            boardId,
            null,
          )
          commitWithHistory(
            'duplicate',
            ops,
            copies.map(function (item) {
              return { type: 'layer.delete', layerId: item.copy.id }
            }),
          )
          beacon('duplicate', { count: copies.length, ops: ops.length })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-failed', { message: shortError(error) })
          return false
        }
      }

      function sameIdSet(first, second) {
        if (!Array.isArray(first) || !Array.isArray(second)) return false
        if (first.length !== second.length) return false
        for (let index = 0; index < first.length; index += 1) {
          if (first[index] !== second[index]) return false
        }
        return true
      }

      /** Batched arrow-key nudge for the whole selection (one history entry per pause). */
      function nudgeSelected(dx, dy) {
        const current = docRef.current
        const ids = selectedLayerIdsRef.current
        if (!current || !ids.length) return
        const pending = nudgeRef.current
        if (pending) {
          if (sameIdSet(pending.layerIds, ids)) {
            pending.dx += dx
            pending.dy += dy
            return
          }
          flushNudge()
        }
        nudgeRef.current = {
          layerIds: ids.slice(),
          dx: dx,
          dy: dy,
          timer: setTimeout(flushNudge, NUDGE_BATCH_MS),
        }
      }

      function flushNudge() {
        try {
          const pending = nudgeRef.current
          if (!pending) return
          nudgeRef.current = null
          if (pending.timer) clearTimeout(pending.timer)
          const current = docRef.current
          if (!current) return
          const entries = []
          const ops = []
          const inverse = []
          let blockedAuto = false
          let blockedLocked = false
          for (let index = 0; index < pending.layerIds.length; index += 1) {
            const layerId = pending.layerIds[index]
            const found = findLayerById(current, layerId)
            if (!found) continue
            const node = nodeForLayer(layerId)
            if (node && node.autoParent) {
              blockedAuto = true
              continue
            }
            if (found.layer.locked === true) {
              blockedLocked = true
              continue
            }
            const previousX = finiteNumber(found.layer.x, 0)
            const previousY = finiteNumber(found.layer.y, 0)
            const nextX = Math.round(previousX + pending.dx)
            const nextY = Math.round(previousY + pending.dy)
            if (nextX === previousX && nextY === previousY) continue
            entries.push({ layerId: layerId, patch: { x: nextX, y: nextY } })
            ops.push({ type: 'layer.update', layerId: layerId, patch: { x: nextX, y: nextY } })
            inverse.push({
              type: 'layer.update',
              layerId: layerId,
              patch: { x: previousX, y: previousY },
            })
          }
          if (blockedAuto) setInlineError(strings.nudgeAutoLayout)
          if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
          if (ops.length === 0) return
          applyDocLocal(docPatchLayers(current, entries))
          commitWithHistory('nudge', ops, inverse)
          beacon('nudge', { dx: pending.dx, dy: pending.dy, count: ops.length })
        } catch (error) {
          beacon('nudge-failed', { message: shortError(error) })
        }
      }

      /* ------------------------------- selection groups, align, tidy ------------------------------- */

      /**
       * Selection roots grouped by parent container. Alignment/distribution/tidy work per parent so
       * a layer is positioned relative to the artboard (direct child) or to its parent frame.
       */
      function selectionGroups() {
        const current = docRef.current
        const groups = []
        if (!current) return groups
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        const byKey = new Map()
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const node = nodeForLayer(found.layer.id)
          if (!node) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          let group = byKey.get(key)
          if (!group) {
            const parentNode = node.parent || null
            group = {
              key: key,
              parentId: found.parentId,
              artboard: found.artboard,
              parentNode: parentNode,
              auto: !!node.autoParent,
              nodes: [],
              list: (parentNode ? childrenOf(parentNode.layer) : layersOf(found.artboard)).slice(),
              box: parentNode
                ? rectOf(0, 0, parentNode.width, parentNode.height)
                : rectOf(0, 0, found.artboard.width, found.artboard.height),
            }
            byKey.set(key, group)
            groups.push(group)
          }
          group.nodes.push(node)
        }
        return groups
      }

      /**
       * An auto-layout parent owns its children's positions, so the only sane "move" there is the
       * child order: normalize the stored order of the selected children to their visual order.
       */
      function visualOrderReorderOps(group, axis) {
        if (!group || !group.auto || !group.parentNode) return null
        const layout = normalizeLayoutObject(group.parentNode.layer.layout)
        if (!layout) return null
        const mainAxis = layout.direction === 'column' ? 'y' : 'x'
        if (axis && axis !== mainAxis) return null
        const list = group.list
        const selectedSet = new Set(group.nodes.map(function (node) { return node.id }))
        const sorted = group.nodes.slice().sort(function (first, second) {
          return mainAxis === 'y' ? first.y - second.y : first.x - second.x
        })
        const slots = []
        for (let index = 0; index < list.length; index += 1) {
          if (list[index] && selectedSet.has(list[index].id)) slots.push(index)
        }
        if (slots.length < 2) return { forward: [], inverse: [] }
        const target = list.slice()
        for (let index = 0; index < slots.length; index += 1) {
          if (sorted[index]) target[slots[index]] = sorted[index].layer
        }
        return {
          forward: reorderOpsToReach(list, target),
          inverse: reorderOpsToReach(target, list),
        }
      }

      /**
       * Align the selection's layers. `kind` is one of left, center-h, right, top, center-v,
       * bottom. Absolute parents get real x/y math (relative to the artboard or parent frame);
       * inside an auto-layout frame the main axis becomes an order change and the cross axis
       * becomes `alignSelf`, because authored x/y are ignored there.
       */
      function alignSelection(kind) {
        const spec = ALIGN_SPECS[kind]
        const current = docRef.current
        if (!current || !spec) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 2) {
          setInlineError(INTERACTION_COPY.alignNeedsTwo)
          return false
        }
        const groups = selectionGroups()
        if (!groups.length) return false
        const entries = []
        const ops = []
        const inverse = []
        let reorderForward = []
        let reorderInverse = []
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]
          const layout = group.auto ? normalizeLayoutObject(group.parentNode.layer.layout) : null
          if (layout) {
            const mainAxis = layout.direction === 'column' ? 'y' : 'x'
            if (spec.axis === mainAxis) {
              const selectedSet = new Set(group.nodes.map(function (node) { return node.id }))
              const picked = group.list.filter(function (layer) {
                return isObject(layer) && selectedSet.has(layer.id)
              })
              const rest = group.list.filter(function (layer) {
                return isObject(layer) && !selectedSet.has(layer.id)
              })
              let insertAt = 0
              if (spec.pos === 'end') insertAt = rest.length
              else if (spec.pos === 'center') insertAt = Math.floor(rest.length / 2)
              const target = rest.slice(0, insertAt).concat(picked).concat(rest.slice(insertAt))
              reorderForward = reorderForward.concat(reorderOpsToReach(group.list, target))
              reorderInverse = reorderInverse.concat(reorderOpsToReach(target, group.list))
            } else {
              const alignSelf = spec.pos === 'start' ? 'start' : spec.pos === 'end' ? 'end' : 'center'
              for (let nodeIndex = 0; nodeIndex < group.nodes.length; nodeIndex += 1) {
                const node = group.nodes[nodeIndex]
                if (node.layer.alignSelf === alignSelf) continue
                const patch = { alignSelf: alignSelf }
                entries.push({ layerId: node.id, patch: patch })
                ops.push({ type: 'layer.update', layerId: node.id, patch: patch })
                inverse.push({
                  type: 'layer.update',
                  layerId: node.id,
                  patch: inversePatchFor(node.layer, patch),
                })
              }
            }
            continue
          }
          for (let nodeIndex = 0; nodeIndex < group.nodes.length; nodeIndex += 1) {
            const node = group.nodes[nodeIndex]
            const patch = {}
            if (spec.axis === 'x') {
              const width = Math.max(1, finiteNumber(node.width, 1))
              patch.x = Math.round(
                spec.pos === 'start'
                  ? 0
                  : spec.pos === 'end'
                    ? group.box.width - width
                    : (group.box.width - width) / 2,
              )
            } else {
              const height = Math.max(1, finiteNumber(node.height, 1))
              patch.y = Math.round(
                spec.pos === 'start'
                  ? 0
                  : spec.pos === 'end'
                    ? group.box.height - height
                    : (group.box.height - height) / 2,
              )
            }
            const changed = patchDiff(node.layer, patch)
            if (!changed) continue
            entries.push({ layerId: node.id, patch: changed })
            ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
            inverse.push({
              type: 'layer.update',
              layerId: node.id,
              patch: inversePatchFor(node.layer, changed),
            })
          }
        }
        const forwardOps = ops.concat(reorderForward)
        if (forwardOps.length === 0) return false
        let next = docPatchLayers(current, entries)
        for (let index = 0; index < reorderForward.length; index += 1) {
          next = docReorderLayer(next, reorderForward[index].layerId, reorderForward[index].index)
        }
        applyDocLocal(next)
        commitWithHistory('align', forwardOps, reorderInverse.concat(inverse))
        beacon('selection-align', { kind: kind, count: forwardOps.length })
        return true
      }

      /**
       * Distribute equal gaps along `axis` ('x' horizontal / 'y' vertical), 3+ layers with the
       * same parent. Inside an auto-layout parent the gaps belong to the frame, so this normalizes
       * the child order along that frame's main axis instead (and is a no-op on the cross axis).
       */
      function distributeSelection(axis) {
        const current = docRef.current
        if (!current) return false
        const direction = axis === 'y' || axis === 'vertical' ? 'y' : 'x'
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 3) {
          setInlineError(INTERACTION_COPY.distributeNeedsThree)
          return false
        }
        const groups = selectionGroups()
        if (groups.length !== 1) {
          setInlineError(INTERACTION_COPY.alignSameParent)
          return false
        }
        const group = groups[0]
        if (group.nodes.length < 3) {
          setInlineError(INTERACTION_COPY.distributeNeedsThree)
          return false
        }
        if (group.auto) {
          const reorder = visualOrderReorderOps(group, direction)
          if (!reorder || reorder.forward.length === 0) return false
          let next = current
          for (let index = 0; index < reorder.forward.length; index += 1) {
            next = docReorderLayer(next, reorder.forward[index].layerId, reorder.forward[index].index)
          }
          applyDocLocal(next)
          commitWithHistory('distribute', reorder.forward, reorder.inverse)
          beacon('selection-distribute', { axis: direction, mode: 'order' })
          return true
        }
        const nodes = group.nodes.slice().sort(function (first, second) {
          return direction === 'x' ? first.x - second.x : first.y - second.y
        })
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        let total = 0
        for (let index = 0; index < nodes.length; index += 1) {
          total += Math.max(1, direction === 'x' ? nodes[index].width : nodes[index].height)
        }
        const span =
          (direction === 'x' ? last.x + last.width : last.y + last.height) -
          (direction === 'x' ? first.x : first.y)
        const gap = (span - total) / (nodes.length - 1)
        if (!Number.isFinite(gap)) return false
        const entries = []
        const ops = []
        const inverse = []
        let cursor = direction === 'x' ? first.x : first.y
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]
          if (index > 0) {
            const patch = {}
            patch[direction] = Math.round(cursor)
            const changed = patchDiff(node.layer, patch)
            if (changed) {
              entries.push({ layerId: node.id, patch: changed })
              ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
              inverse.push({
                type: 'layer.update',
                layerId: node.id,
                patch: inversePatchFor(node.layer, changed),
              })
            }
          }
          cursor += Math.max(1, direction === 'x' ? node.width : node.height) + gap
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('distribute', ops, inverse)
        beacon('selection-distribute', { axis: direction, mode: 'positions', gap: Math.round(gap) })
        return true
      }

      /**
       * Tidy up: arrange the selection into a single row or column with even spacing (TIDY_GAP),
       * sharing one edge. Auto-layout parents get the equivalent: their child order is normalized.
       */
      function tidySelection(direction) {
        const current = docRef.current
        if (!current) return false
        const mode = direction === 'column' ? 'column' : 'row'
        const groups = selectionGroups()
        if (!groups.length) return false
        const entries = []
        const ops = []
        const inverse = []
        let reorderForward = []
        let reorderInverse = []
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]
          if (group.auto) {
            const reorder = visualOrderReorderOps(group, mode === 'column' ? 'y' : 'x')
            if (!reorder) continue
            reorderForward = reorderForward.concat(reorder.forward)
            reorderInverse = reorderInverse.concat(reorder.inverse)
            continue
          }
          if (group.nodes.length < 2) continue
          const nodes = group.nodes.slice().sort(function (first, second) {
            return mode === 'row' ? first.x - second.x : first.y - second.y
          })
          const box = unionRects(
            group.nodes.map(function (node) {
              return rectOf(node.x, node.y, node.width, node.height)
            }),
          )
          if (!box) continue
          let cursor = mode === 'row' ? box.x : box.y
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            const patch =
              mode === 'row'
                ? { x: Math.round(cursor), y: Math.round(box.y) }
                : { x: Math.round(box.x), y: Math.round(cursor) }
            cursor += Math.max(1, mode === 'row' ? node.width : node.height) + TIDY_GAP
            const changed = patchDiff(node.layer, patch)
            if (!changed) continue
            entries.push({ layerId: node.id, patch: changed })
            ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
            inverse.push({
              type: 'layer.update',
              layerId: node.id,
              patch: inversePatchFor(node.layer, changed),
            })
          }
        }
        const forwardOps = ops.concat(reorderForward)
        if (forwardOps.length === 0) return false
        let next = docPatchLayers(current, entries)
        for (let index = 0; index < reorderForward.length; index += 1) {
          next = docReorderLayer(next, reorderForward[index].layerId, reorderForward[index].index)
        }
        applyDocLocal(next)
        commitWithHistory('tidy', forwardOps, reorderInverse.concat(inverse))
        beacon('selection-tidy', { direction: mode })
        return true
      }

      /* ------------------------------- group / ungroup ------------------------------- */

      /**
       * Group the selection with one `layer.group` op. The Host builds the group (union box, ids,
       * relative child coordinates), so the local document is not patched optimistically; the id
       * the Host assigned comes back in `applied[]` and becomes the selection.
       */
      async function groupSelection() {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 2) {
          setInlineError(INTERACTION_COPY.groupNeedsTwo)
          return false
        }
        const first = findLayerById(current, roots[0])
        if (!first) return false
        const parentKey = first.parentId ? 'p:' + first.parentId : 'a:' + first.artboard.id
        for (let index = 1; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          if (key !== parentKey) {
            // layer.group has no parentId: grouping across containers would be ambiguous.
            setInlineError(INTERACTION_COPY.groupSameParent)
            return false
          }
        }
        const op = { type: 'layer.group', layerIds: roots }
        if (!first.parentId) op.artboardId = first.artboard.id
        // The Host refuses to group auto-layout children (their x/y are derived); say it up front.
        if (first.parentId) {
          const parentFound = findLayerById(current, first.parentId)
          if (parentFound && parentFound.layer.type === 'frame' && isObject(parentFound.layer.layout)) {
            setInlineError(INTERACTION_COPY.groupAutoLayout)
            return false
          }
        }
        const result = await runOps([op])
        if (!result || result.ok === false) return false
        let groupId = null
        const applied = Array.isArray(result.applied) ? result.applied : []
        for (let index = 0; index < applied.length; index += 1) {
          if (applied[index] && applied[index].type === 'layer.group' && applied[index].id) {
            groupId = applied[index].id
            break
          }
        }
        if (!groupId) return false
        pushHistoryEntry('group', [op], [{ type: 'layer.ungroup', layerId: groupId }])
        applySelection([groupId], first.artboard.id, null)
        beacon('selection-group', { groupId: groupId, members: roots.length })
        return groupId
      }

      /**
       * Ungroup every selected group. The inverse re-creates a group from the promoted children
       * (which keep their ids), so undo restores the selection unit even though the Host assigns a
       * fresh group id and box.
       */
      function ungroupSelection() {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        const targets = []
        const promoted = []
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found || found.layer.type !== 'group') continue
          targets.push(found)
          const kids = childrenOf(found.layer)
          for (let childIndex = 0; childIndex < kids.length; childIndex += 1) {
            if (kids[childIndex] && kids[childIndex].id) promoted.push(kids[childIndex].id)
          }
        }
        if (targets.length === 0) {
          setInlineError(INTERACTION_COPY.ungroupNeedsGroup)
          return false
        }
        const ops = targets.map(function (found) {
          return { type: 'layer.ungroup', layerId: found.layer.id }
        })
        const inverse = targets.map(function (found) {
          const op = {
            type: 'layer.group',
            layerIds: childrenOf(found.layer).map(function (child) { return child.id }),
          }
          if (found.layer.name) op.name = found.layer.name
          if (!found.parentId) op.artboardId = found.artboard.id
          return op
        })
        commitWithHistory('ungroup', ops, inverse)
        applySelection(promoted, targets[0].artboard.id, null)
        beacon('selection-ungroup', { groups: targets.length, promoted: promoted.length })
        return true
      }

      /** Lock / unlock the whole selection (locked layers stay selectable; gestures are blocked). */
      function toggleLock() {
        const current = docRef.current
        const ids = selectedLayerIdsRef.current
        if (!current || !ids.length) return false
        let allLocked = true
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          if (found.layer.locked !== true) allLocked = false
        }
        const nextLocked = !allLocked
        const entries = []
        const ops = []
        const inverse = []
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          if ((found.layer.locked === true) === nextLocked) continue
          entries.push({ layerId: found.layer.id, patch: { locked: nextLocked } })
          ops.push({ type: 'layer.update', layerId: found.layer.id, patch: { locked: nextLocked } })
          inverse.push({
            type: 'layer.update',
            layerId: found.layer.id,
            patch: { locked: found.layer.locked === true },
          })
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory(nextLocked ? 'lock' : 'unlock', ops, inverse)
        beacon('selection-lock', { locked: nextLocked, count: ops.length })
        return true
      }

      /** Move every selected root into another frame/group or back to an artboard root. */
      function reparentSelection(destination) {
        const current = docRef.current
        if (!current || !isObject(destination)) return false
        const targetParentId =
          typeof destination.parentId === 'string' && destination.parentId
            ? destination.parentId
            : null
        const targetArtboardId =
          typeof destination.artboardId === 'string' && destination.artboardId
            ? destination.artboardId
            : null
        if (!targetParentId && !targetArtboardId) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (!roots.length) return false
        const ops = []
        const inverse = []
        let next = current
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(next, roots[index])
          if (!found) continue
          const sameParent = targetParentId
            ? targetParentId === found.parentId
            : !found.parentId && targetArtboardId === found.artboard.id
          if (sameParent) continue
          let insertIndex = 0
          if (targetParentId) {
            const parentFound = findLayerById(next, targetParentId)
            if (!parentFound || !isContainerLayer(parentFound.layer)) {
              setInlineError(strings.reparentFailed)
              continue
            }
            if (isContainerLayer(found.layer) && subtreeContains(found.layer, targetParentId)) {
              setInlineError(strings.reparentFailed)
              continue
            }
            if (parentFound.depth + subtreeHeight(found.layer) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              continue
            }
            insertIndex = childrenOf(parentFound.layer).length
          } else {
            const board = findArtboardById(next, targetArtboardId)
            if (!board) {
              setInlineError(strings.reparentFailed)
              continue
            }
            insertIndex = layersOf(board).length
          }
          const moveDestination = targetParentId
            ? { parentId: targetParentId }
            : { artboardId: targetArtboardId }
          const moved = docMoveLayer(next, found.layer.id, moveDestination, insertIndex)
          if (moved === next) continue
          next = moved
          const op = { type: 'layer.move_to', layerId: found.layer.id, index: insertIndex }
          if (targetParentId) op.parentId = targetParentId
          else op.artboardId = targetArtboardId
          ops.push(op)
          inverse.push.apply(inverse, inverseMoveToOps(found))
        }
        if (ops.length === 0) return false
        applyDocLocal(next)
        inverse.reverse()
        commitWithHistory('reparent', ops, inverse)
        if (targetArtboardId) setSelectedArtboardId(targetArtboardId)
        beacon('selection-reparent', { count: ops.length })
        return true
      }

      /* ------------------------------- clipboard ------------------------------- */

      function writeClipboardText(text) {
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return
          const pending = nav.clipboard.writeText(text)
          if (pending && typeof pending.catch === 'function') {
            pending.catch(function () {
              /* OS clipboard writes are best-effort; the in-memory tree still works */
            })
          }
        } catch (error) {
          /* ignore */
        }
      }

      function readClipboardText() {
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (!nav || !nav.clipboard || typeof nav.clipboard.readText !== 'function') {
            return Promise.resolve('')
          }
          const pending = nav.clipboard.readText()
          if (pending && typeof pending.then === 'function') {
            return pending.catch(function () { return '' })
          }
          return Promise.resolve('')
        } catch (error) {
          return Promise.resolve('')
        }
      }

      function parseClipboardPayload(text) {
        if (typeof text !== 'string' || !text.trim()) return null
        try {
          const parsed = JSON.parse(text)
          if (!isObject(parsed)) return null
          if (parsed.kind !== CLIPBOARD_KIND) return null
          if (!Array.isArray(parsed.layers) || parsed.layers.length === 0) return null
          return parsed
        } catch (error) {
          return null
        }
      }

      /** Copy the selection into the internal clipboard ref + the OS clipboard as JSON. */
      function copySelection() {
        try {
          const current = docRef.current
          if (!current) return false
          const roots = rootSelectionIds(selectedLayerIdsRef.current)
          if (!roots.length) return false
          const layers = []
          for (let index = 0; index < roots.length; index += 1) {
            const found = findLayerById(current, roots[index])
            if (found) layers.push(cloneLayerSubtree(found.layer, 0, 0))
          }
          if (!layers.length) return false
          const payload = { kind: CLIPBOARD_KIND, version: 1, layers: layers }
          clipboardRef.current = payload
          let text = ''
          try {
            text = JSON.stringify(payload)
          } catch (error) {
            text = ''
          }
          if (text) writeClipboardText(text)
          beacon('clipboard-copy', { count: layers.length })
          return true
        } catch (error) {
          beacon('clipboard-copy-failed', { message: shortError(error) })
          return false
        }
      }

      function cutSelection() {
        if (!copySelection()) return false
        deleteSelectedLayer()
        return true
      }

      /** Destination for a paste: the selected container, else the primary layer's parent/board. */
      function pasteDestination() {
        const current = docRef.current
        if (!current) return null
        const primaryId = selectedLayerIdRef.current
        const primaryNode = primaryId ? nodeForLayer(primaryId) : null
        const primaryFound = primaryId ? findLayerById(current, primaryId) : null
        if (primaryNode && isContainerLayer(primaryNode.layer)) {
          return { parentId: primaryNode.layer.id, parentNode: primaryNode }
        }
        if (primaryFound && primaryFound.parentId) {
          return { parentId: primaryFound.parentId, parentNode: nodeForLayer(primaryFound.parentId) }
        }
        if (primaryFound) return { artboardId: primaryFound.artboard.id, parentNode: null }
        let board = selectedArtboardIdRef.current
          ? findArtboardById(current, selectedArtboardIdRef.current)
          : null
        if (!board) board = artboardsOf(current).find(function (artboard) { return isObject(artboard) }) || null
        if (!board) return null
        return { artboardId: board.id, parentNode: null }
      }

      /** Insert cloned clipboard layers into the paste destination (one history entry). */
      function insertPastedLayers(layers) {
        const current = docRef.current
        if (!current || !Array.isArray(layers) || !layers.length) return false
        const destination = pasteDestination()
        if (!destination) {
          setInlineError(strings.noArtboards)
          return false
        }
        const destinationNode = destination.parentNode || null
        const destinationLayer = destinationNode
          ? destinationNode.layer
          : destination.artboardId
            ? findArtboardById(current, destination.artboardId)
            : null
        if (!destinationLayer) return false
        if (destinationNode) {
          if (destinationNode.depth >= FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            return false
          }
          if (
            childrenOf(destinationLayer).length + layers.length >
            FRAME_MAX_CHILDREN
          ) {
            setInlineError(strings.childLimit)
            return false
          }
        }
        const autoDestination =
          destinationNode &&
          destinationNode.layer.type === 'frame' &&
          !!normalizeLayoutObject(destinationNode.layer.layout)
        const offset = autoDestination ? 0 : PASTE_OFFSET
        const copies = []
        const ops = []
        for (let index = 0; index < layers.length; index += 1) {
          const clone = cloneLayerSubtree(layers[index], offset, offset)
          if (!clone) continue
          if (destinationNode && destinationNode.depth + subtreeHeight(clone) > FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            continue
          }
          const subOps = insertOpsForSubtree(
            clone,
            destination.parentId ? { parentId: destination.parentId } : { artboardId: destination.artboardId },
            null,
          )
          if (subOps.length === 0) continue
          if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
            setInlineError(INTERACTION_COPY.pasteLimit)
            return false
          }
          ops.push.apply(ops, subOps)
          copies.push(clone)
        }
        if (copies.length === 0) return false
        const next = docInsertLayers(
          current,
          destination.parentId ? { parentId: destination.parentId } : { artboardId: destination.artboardId },
          copies,
        )
        applyDocLocal(next)
        const boardId =
          destination.artboardId ||
          (destinationNode ? artboardIdForNode(destinationNode) : null) ||
          selectedArtboardIdRef.current
        applySelection(
          copies.map(function (clone) { return clone.id }),
          boardId,
          null,
        )
        commitWithHistory(
          'paste',
          ops,
          copies.map(function (clone) {
            return { type: 'layer.delete', layerId: clone.id }
          }),
        )
        beacon('clipboard-paste', { count: copies.length, ops: ops.length })
        return true
      }

      /**
       * Paste layers from the internal clipboard (survives in-tab), falling back to the JSON we
       * wrote to the OS clipboard so a reload or another tab can still paste.
       */
      function pasteSelection() {
        let payload = clipboardRef.current
        if (!isObject(payload) || !Array.isArray(payload.layers) || payload.layers.length === 0) {
          return readClipboardText().then(function (text) {
            const parsed = parseClipboardPayload(text)
            if (!parsed) {
              setInlineError(INTERACTION_COPY.pasteEmpty)
              return false
            }
            clipboardRef.current = parsed
            return insertPastedLayers(parsed.layers)
          })
        }
        return Promise.resolve(insertPastedLayers(payload.layers))
      }

      /* ------------------------------- presets ------------------------------- */

      /**
       * Toolbar action for the chrome agent: a ready-made button (auto-layout frame + label) in
       * the selected container/artboard, one history entry.
       */
      function addButtonPreset() {
        try {
          const current = docRef.current
          if (!current) return false
          const boards = artboardsOf(current)
          const primaryId = selectedLayerIdRef.current
          const primaryNode = primaryId ? nodeForLayer(primaryId) : null
          const primaryFound = primaryId ? findLayerById(current, primaryId) : null
          let artboard = primaryFound ? primaryFound.artboard : null
          if (!artboard && selectedArtboardIdRef.current) {
            artboard = findArtboardById(current, selectedArtboardIdRef.current)
          }
          if (!artboard) artboard = boards.find(function (board) { return isObject(board) }) || null
          if (!artboard) {
            setInlineError(strings.noArtboards)
            return false
          }
          const containerNode =
            primaryNode && isContainerLayer(primaryNode.layer) ? primaryNode : null
          const destination = containerNode
            ? { parentId: containerNode.layer.id }
            : { artboardId: artboard.id }
          if (containerNode) {
            if (containerNode.depth >= FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return false
            }
            if (childrenOf(containerNode.layer).length + 1 > FRAME_MAX_CHILDREN) {
              setInlineError(strings.childLimit)
              return false
            }
          }
          const preset = createButtonPresetLayers(containerNode ? containerNode.layer : artboard)
          const frameOp = { type: 'layer.add', layer: opLayerForAdd(preset.frame) }
          if (destination.parentId) frameOp.parentId = destination.parentId
          else frameOp.artboardId = destination.artboardId
          const textOp = {
            type: 'layer.add',
            parentId: preset.frame.id,
            layer: preset.text,
          }
          let next = docInsertLayer(current, destination, preset.frame)
          next = docInsertLayer(next, { parentId: preset.frame.id }, preset.text)
          applyDocLocal(next)
          applySelection([preset.frame.id], artboard.id, null)
          commitWithHistory('add-button', [frameOp, textOp], [
            { type: 'layer.delete', layerId: preset.frame.id },
          ])
          beacon('button-preset-add', { artboardId: artboard.id })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('button-preset-failed', { message: shortError(error) })
          return false
        }
      }

      function commitShadow(value) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        if (!found) return
        const text = typeof value === 'string' ? value.trim() : ''
        if (!text) {
          commitLayer({ shadow: null })
          return
        }
        if (text.length > 200 || /[\n\r{};]/.test(text)) {
          setInlineError(strings.shadowInvalid)
          beacon('shadow-rejected', { length: text.length })
          return
        }
        commitLayer({ shadow: text })
      }

      function clearShadow() {
        commitLayer({ shadow: null })
      }

      /** Move an existing layer under another frame or back to an artboard root (append). */
      function reparentLayer(layerId, destination) {
        try {
          if (!isObject(destination)) return
          const current = docRef.current
          if (!current) return
          const found = findLayerById(current, layerId)
          if (!found) return
          const targetParentId =
            typeof destination.parentId === 'string' && destination.parentId
              ? destination.parentId
              : null
          const targetArtboardId =
            typeof destination.artboardId === 'string' && destination.artboardId
              ? destination.artboardId
              : null
          if (!targetParentId && !targetArtboardId) return
          const sameParent = targetParentId
            ? targetParentId === found.parentId
            : !found.parentId && targetArtboardId === found.artboard.id
          if (sameParent) return
          let destList = null
          let destArtboard = null
          if (targetParentId) {
            const parentFound = findLayerById(current, targetParentId)
            if (!parentFound || !parentFound.layer || parentFound.layer.type !== 'frame') {
              setInlineError(strings.reparentFailed)
              return
            }
            if (found.layer.type === 'frame' && subtreeContains(found.layer, targetParentId)) {
              setInlineError(strings.reparentFailed)
              return
            }
            if (parentFound.depth >= FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return
            }
            if (parentFound.depth + subtreeHeight(found.layer) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return
            }
            destList = childrenOf(parentFound.layer)
            destArtboard = parentFound.artboard
          } else {
            const board = findArtboardById(current, targetArtboardId)
            if (!board) {
              setInlineError(strings.reparentFailed)
              return
            }
            destList = layersOf(board)
            destArtboard = board
          }
          if (targetParentId && destList.length >= FRAME_MAX_CHILDREN) {
            setInlineError(strings.childLimit)
            return
          }
          const index = destList.length
          applyDocLocal(
            docMoveLayer(
              current,
              layerId,
              targetParentId ? { parentId: targetParentId } : { artboardId: targetArtboardId },
              index,
            ),
          )
          const op = { type: 'layer.move_to', layerId: layerId, index: index }
          if (targetParentId) op.parentId = targetParentId
          else op.artboardId = targetArtboardId
          commitWithHistory('reparent', [op], inverseMoveToOps(found))
          if (destArtboard) setSelectedArtboardId(destArtboard.id)
          beacon('reparent', {
            layerId: layerId,
            parentId: targetParentId || undefined,
            artboardId: targetArtboardId || undefined,
          })
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('reparent-failed', { message: shortError(error) })
        }
      }

      function currentFrameForLayout() {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        return found && found.layer && found.layer.type === 'frame' ? found : null
      }

      /** Toggle a frame between absolute mode (layout:null) and CSS auto layout. */
      function setFrameAutoLayout(enabled) {
        const found = currentFrameForLayout()
        if (!found) return
        if (!enabled) {
          if (!isObject(found.layer.layout)) return
          commitLayer({ layout: null })
          beacon('layout-change', { layerId: found.layer.id, mode: 'off' })
          return
        }
        if (isObject(found.layer.layout)) return
        commitLayer({ layout: defaultLayoutObject() })
        beacon('layout-change', { layerId: found.layer.id, mode: 'on' })
      }

      /** Patch one or more layout fields in a single layer.update (layout replaces wholesale). */
      function patchFrameLayout(patch) {
        const found = currentFrameForLayout()
        if (!found) return
        const base = normalizeLayoutObject(found.layer.layout) || defaultLayoutObject()
        const next = Object.assign({}, base, isObject(patch) ? patch : {})
        if (patch && isObject(patch.padding)) {
          next.padding = Object.assign({}, base.padding, patch.padding)
        }
        commitLayer({ layout: next })
        beacon('layout-change', {
          layerId: found.layer.id,
          mode: 'update',
          direction: next.direction,
        })
      }

      function addArtboard() {
        const current = docRef.current
        if (!current) return
        if (artboardsOf(current).length >= 50) {
          setInlineError(strings.noArtboards)
          return
        }
        const artboard = createArtboard(current)
        applyDocLocal(docInsertArtboard(current, artboard))
        setSelectedArtboardId(artboard.id)
        setSelectedLayerId(null)
        setComposer(null)
        fitPendingRef.current = true
        commitWithHistory(
          'add-artboard',
          [{ type: 'artboard.add', artboard: artboard }],
          [{ type: 'artboard.delete', artboardId: artboard.id }],
        )
      }

      /**
       * Delete an artboard (and its subtree, plus the comments anchored to it). Undo re-creates
       * the board and re-inserts every layer with its original id and props.
       */
      function deleteArtboard(artboardId) {
        const current = docRef.current
        if (!current) return false
        const targetId = typeof artboardId === 'string' && artboardId ? artboardId : selectedArtboardIdRef.current
        if (!targetId) return false
        const board = findArtboardById(current, targetId)
        if (!board) return false
        const boards = artboardsOf(current)
        const index = boards.findIndex(function (item) {
          return item && item.id === targetId
        })
        // Undo: re-add the artboard, then re-insert its layers (subtrees included) in order.
        const inverse = [
          {
            type: 'artboard.add',
            artboard: {
              name: board.name,
              width: board.width,
              height: board.height,
              background: board.background,
              x: board.x,
              y: board.y,
            },
            index: index >= 0 ? index : undefined,
          },
        ]
        const topLayers = layersOf(board)
        for (let layerIndex = 0; layerIndex < topLayers.length; layerIndex += 1) {
          const layer = topLayers[layerIndex]
          if (!isObject(layer)) continue
          inverse.push.apply(inverse, insertOpsForSubtree(layer, { artboardId: targetId }, layerIndex))
        }
        if (
          selectedArtboardIdRef.current === targetId ||
          (selectedLayerIdRef.current && artboardIdForLayer(selectedLayerIdRef.current) === targetId)
        ) {
          applySelection([], null, null)
        }
        commitWithHistory(
          'delete-artboard',
          [{ type: 'artboard.delete', artboardId: targetId }],
          inverse,
        )
        beacon('delete-artboard', { artboardId: targetId, layers: topLayers.length })
        return true
      }

      function setCommentStatus(commentId, commentStatus) {
        const current = docRef.current
        if (!current) return
        applyDocLocal(docPatchComment(current, commentId, { status: commentStatus }))
        runOps([{ type: 'comment.update', commentId: commentId, status: commentStatus }])
      }

      function deleteCommentById(commentId) {
        const current = docRef.current
        if (!current) return
        applyDocLocal(docRemoveComment(current, commentId))
        runOps([{ type: 'comment.delete', commentId: commentId }])
      }

      /* ------------------------------- comment composer -> chat ------------------------------- */

      async function sendCommentChat(details) {
        const sessions = runtime.sessions
        if (!sessions || typeof sessions.using !== 'function') {
          throw new Error(strings.sessionUnavailable)
        }
        const text = buildCommentMessage(details, strings)
        const outcome = await sessions.using(
          sessionId,
          { source: 'controllerOperation' },
          async function (reference) {
            const session = reference && reference.binding ? reference.binding.session : null
            if (!session || typeof session.prompt !== 'function') {
              throw new Error(strings.sessionUnavailable)
            }
            const result = await session.prompt([{ type: 'text', text: text }], 'queue')
            if (result && result.ok === false) {
              const detail = result.error || {}
              throw new Error(detail.message || detail.code || 'prompt rejected')
            }
            return true
          },
        )
        beacon('chat-sent', { ok: true })
        return outcome
      }

      async function submitComment() {
        const active = composer
        if (!active) return
        const text = String(active.text || '').trim()
        if (!text) return
        setCommentBusy(true)
        setCommentError('')
        try {
          const result = await runOps([
            {
              type: 'comment.add',
              artboardId: active.artboardId,
              layerId: active.layerId,
              text: text,
            },
          ])
          if (!result.ok) {
            const first = result.errors && result.errors[0]
            setCommentError((first && (first.message || first.code)) || strings.postFailed)
            return
          }
          let commentId = null
          const applied = result.applied || []
          for (let index = 0; index < applied.length; index += 1) {
            if (applied[index] && applied[index].type === 'comment.add' && applied[index].id) {
              commentId = applied[index].id
              break
            }
          }
          const current = docRef.current
          const found = current ? findLayerById(current, active.layerId) : null
          const computed = treeRef.current && treeRef.current.byId
            ? treeRef.current.byId.get(active.layerId) || null
            : null
          setComposer(null)
          setCommentMode(false)
          try {
            await sendCommentChat({
              boardPath: boardPath,
              version: current && current.version,
              artboard: found ? found.artboard : null,
              layer: found ? found.layer : null,
              parentId: found ? found.parentId : null,
              renderedRect: computed ? computed.worldRect : null,
              commentId: commentId,
              text: text,
            })
          } catch (error) {
            const message = messageOf(error)
            setInlineError(strings.chatFailed + ': ' + message)
            beacon('chat-failed', { message: message.slice(0, 200) })
            report({
              sessionId: sessionId,
              kind: 'error',
              message: 'chat request failed: ' + message.slice(0, 2000),
            })
          }
        } catch (error) {
          const message = messageOf(error)
          setCommentError(message)
          beacon('comment-failed', { message: message.slice(0, 200) })
          beacon('error', { message: message.slice(0, 200) })
        } finally {
          setCommentBusy(false)
        }
      }

      /* ------------------------------- pointer gestures ------------------------------- */

      /**
       * v2 batch API (CONTRACT §6): send ONE chat message for many comments. The builder lives in
       * 53-batch.js and is hoisted; the editor contributes the live document/context.
       */
      function submitCommentsFor(commentIds) {
        return submitComments(commentIds, {
          doc: docRef.current,
          tree: treeRef.current,
          version: versionRef.current,
          boardPath: boardPath,
          strings: strings,
          editor: { sendCommentChat: sendCommentChat, runOps: runOps },
          actions: { selectLayer: selectLayer, selectArtboard: selectArtboard },
        })
      }

      /** Patch for a layer gesture. `resize-auto` children only get width/height (never x/y). */
      function gesturePatch(gesture, dx, dy) {
        const origin = gesture.origin
        if (gesture.kind === 'drag') {
          return {
            x: Math.round(origin.x + dx),
            y: Math.round(origin.y + dy),
          }
        }
        let x = origin.x
        let y = origin.y
        let width = origin.width
        let height = origin.height
        const handle = String(gesture.handle || '')
        if (handle.indexOf('e') >= 0) width = origin.width + dx
        if (handle.indexOf('w') >= 0) {
          width = origin.width - dx
          x = origin.x + dx
        }
        if (handle.indexOf('s') >= 0) height = origin.height + dy
        if (handle.indexOf('n') >= 0) {
          height = origin.height - dy
          y = origin.y + dy
        }
        if (width < MIN_LAYER_SIZE) {
          if (handle.indexOf('w') >= 0) x = origin.x + origin.width - MIN_LAYER_SIZE
          width = MIN_LAYER_SIZE
        }
        if (height < MIN_LAYER_SIZE) {
          if (handle.indexOf('n') >= 0) y = origin.y + origin.height - MIN_LAYER_SIZE
          height = MIN_LAYER_SIZE
        }
        if (gesture.kind === 'resize-auto') {
          // Auto-layout children keep authored width/height only; their x/y are derived.
          return { width: Math.round(width), height: Math.round(height) }
        }
        return {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        }
      }

      /**
       * Layers that take part in one drag: the whole selection when the grabbed layer is part of
       * it, otherwise just the grabbed layer. Auto-layout children (their x/y are derived) and
       * locked layers are left out; `blocked*` flags let the caller surface why.
       */
      function gestureMembersFor(grabbedId, multi) {
        const current = docRef.current
        const result = { members: [], blockedLocked: false, blockedAuto: false }
        if (!current) return result
        let ids = multi ? rootSelectionIds(selectedLayerIdsRef.current) : [grabbedId]
        if (ids.indexOf(grabbedId) < 0) ids = [grabbedId]
        for (let index = 0; index < ids.length; index += 1) {
          const layerId = ids[index]
          const found = findLayerById(current, layerId)
          if (!found) continue
          const node = nodeForLayer(layerId)
          if (node && node.autoParent) {
            result.blockedAuto = true
            continue
          }
          if (found.layer.locked === true) {
            result.blockedLocked = true
            continue
          }
          result.members.push({
            layerId: layerId,
            parentId: found.parentId,
            artboardId: found.artboard.id,
            origin: {
              x: finiteNumber(found.layer.x, 0),
              y: finiteNumber(found.layer.y, 0),
              width: Math.max(1, finiteNumber(found.layer.width, 1)),
              height: Math.max(1, finiteNumber(found.layer.height, 1)),
            },
          })
        }
        return result
      }

      /** Layer update entries for the current gesture delta (absolute, so preview is idempotent). */
      function gesturePatchEntries(gesture) {
        if (!gesture || !Array.isArray(gesture.members)) return []
        const dx = finiteNumber(gesture.dx, 0)
        const dy = finiteNumber(gesture.dy, 0)
        const entries = []
        if (gesture.kind === 'drag') {
          for (let index = 0; index < gesture.members.length; index += 1) {
            const member = gesture.members[index]
            entries.push({
              layerId: member.layerId,
              patch: {
                x: Math.round(member.origin.x + dx),
                y: Math.round(member.origin.y + dy),
              },
            })
          }
          return entries
        }
        // Resize handles sit on the union box of the selection: scale every member about it.
        const patch = gesturePatch(gesture, dx, dy)
        if (patch && gesture.members.length <= 1) {
          entries.push({ layerId: gesture.layerId, patch: patch })
          return entries
        }
        return resizeEntries(gesture, dx, dy)
      }

      /**
       * Scale every member about the union box the handles are drawn on. Members can have
       * different parents, so the scale runs in artboard space and the parent offset is
       * subtracted back out per patch.
       */
      function resizeEntries(gesture, dx, dy) {
        const box = isObject(gesture.selectionBox) ? gesture.selectionBox : null
        const members = Array.isArray(gesture.members) ? gesture.members : []
        if (!box || !members.length || !(box.width > 0) || !(box.height > 0)) return []
        const handle = String(gesture.handle || '')
        let left = box.x
        let top = box.y
        let width = box.width
        let height = box.height
        if (handle.indexOf('e') >= 0) width = box.width + dx
        if (handle.indexOf('w') >= 0) width = box.width - dx
        if (handle.indexOf('s') >= 0) height = box.height + dy
        if (handle.indexOf('n') >= 0) height = box.height - dy
        width = Math.max(MIN_LAYER_SIZE, width)
        height = Math.max(MIN_LAYER_SIZE, height)
        if (handle.indexOf('w') >= 0) left = box.x + box.width - width
        if (handle.indexOf('n') >= 0) top = box.y + box.height - height
        const scaleX = width / box.width
        const scaleY = height / box.height
        const out = []
        for (let index = 0; index < members.length; index += 1) {
          const member = members[index]
          const node = nodeForLayer(member.layerId)
          if (!node || !node.worldRect) continue
          const parentNode = node.parent || null
          const baseX = parentNode && parentNode.worldRect ? parentNode.worldRect.x : 0
          const baseY = parentNode && parentNode.worldRect ? parentNode.worldRect.y : 0
          out.push({
            layerId: member.layerId,
            patch: {
              x: Math.round(left + (node.worldRect.x - box.x) * scaleX - baseX),
              y: Math.round(top + (node.worldRect.y - box.y) * scaleY - baseY),
              width: Math.round(Math.max(MIN_LAYER_SIZE, node.worldRect.width * scaleX)),
              height: Math.round(Math.max(MIN_LAYER_SIZE, node.worldRect.height * scaleY)),
            },
          })
        }
        return out
      }

      function cancelGestureFrame() {
        const frame = gestureFrameRef.current
        if (frame !== null && typeof cancelAnimationFrame === 'function') {
          try {
            cancelAnimationFrame(frame)
          } catch (error) {
            /* ignore */
          }
        }
        gestureFrameRef.current = null
      }

      /** Coalesce pointer previews to one document update per animation frame (N=50 stays smooth). */
      function scheduleGesturePreview() {
        if (gestureFrameRef.current !== null) return
        if (typeof requestAnimationFrame !== 'function') {
          flushGesturePreview()
          return
        }
        gestureFrameRef.current = requestAnimationFrame(function () {
          gestureFrameRef.current = null
          flushGesturePreview()
        })
      }

      function flushGesturePreview() {
        const gesture = gestureRef.current
        const current = docRef.current
        if (!gesture || !current) return
        const entries = gesturePatchEntries(gesture)
        if (!entries.length) return
        applyDocLocal(docPatchLayers(current, entries))
      }

      function beginGesture(event, node, handle, unionBox) {
        if (!node || !isObject(node.layer)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const current = docRef.current
        const found = current ? findLayerById(current, node.layer.id) : null
        if (!found) return
        // Commit any batched arrow-key nudge before a pointer gesture starts.
        flushNudge()
        const autoParent = !!node.autoParent
        // Locked layers stay selectable, but direct manipulation is refused (CONTRACT §1).
        if (!autoParent && found.layer.locked === true) {
          setInlineError(INTERACTION_COPY.locked)
          beacon('gesture-blocked', { layerId: found.layer.id, reason: 'locked' })
          return
        }
        const selectedIds = selectedLayerIdsRef.current
        // A handle sits on the union box of the WHOLE selection, so a handle drag must carry
        // every member, not only the primary layer.
        const multi = !autoParent && selectedIds.length > 1 && selectedIds.indexOf(found.layer.id) >= 0
        const collected = gestureMembersFor(found.layer.id, multi)
        const members = collected.members
        if (members.length === 0) {
          if (collected.blockedLocked) setInlineError(INTERACTION_COPY.locked)
          else if (collected.blockedAuto) setInlineError(strings.nudgeAutoLayout)
          return
        }
        if (collected.blockedLocked) setInlineError(INTERACTION_COPY.locked)
        event.preventDefault()
        event.stopPropagation()
        const target = event.currentTarget
        try {
          if (target && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(event.pointerId)
          }
        } catch (error) {
          /* pointer capture is best-effort */
        }
        // Snapping targets are captured once: siblings of the grabbed layer plus the parent box
        // and the artboard box. They do not move while the gesture runs.
        const snapStatic = []
        const memberIds = new Set(
          members.map(function (member) { return member.layerId }),
        )
        const primaryNode = nodeForLayer(found.layer.id)
        const siblingNodes = siblingNodesOf(primaryNode)
        for (let index = 0; index < siblingNodes.length; index += 1) {
          const sibling = siblingNodes[index]
          if (!sibling || memberIds.has(sibling.id)) continue
          if (sibling.layer && sibling.layer.visible === false) continue
          snapStatic.push(sibling.worldRect)
        }
        const parentNode = primaryNode ? primaryNode.parent || null : null
        let frameRect = rectOf(0, 0, found.artboard.width, found.artboard.height)
        if (parentNode && parentNode.worldRect) frameRect = parentNode.worldRect
        const movingNodes = members
          .map(function (member) { return nodeForLayer(member.layerId) })
          .filter(function (item) { return !!item })
        const selectionBox =
          unionRects(
            movingNodes.map(function (item) {
              return item.worldRect
            }),
          ) || rectOf(0, 0, 1, 1)
        gestureRef.current = {
          pointerId: event.pointerId,
          kind: handle
            ? autoParent
              ? 'resize-auto'
              : 'resize'
            : autoParent
              ? 'reorder'
              : 'drag',
          handle: handle || null,
          layerId: found.layer.id,
          artboardId: found.artboard.id,
          parentId: found.parentId,
          autoParent: autoParent,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          clientX: finiteNumber(event.clientX, 0),
          clientY: finiteNumber(event.clientY, 0),
          origin: {
            x: finiteNumber(found.layer.x, 0),
            y: finiteNumber(found.layer.y, 0),
            width: Math.max(1, finiteNumber(found.layer.width, 1)),
            height: Math.max(1, finiteNumber(found.layer.height, 1)),
          },
          members: members,
          multi: members.length > 1,
          selectionBox: unionBox || selectionBox,
          snapStatic: snapStatic,
          frameRect: frameRect,
          dx: null,
          dy: null,
          guidesActive: false,
          moved: false,
        }
        setGestureActive(true)
      }

      function layerPointerDown(event, node) {
        if (!node || !isObject(node.layer)) return
        // Middle-drag and space+drag pan the canvas instead of manipulating the layer.
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const found = docRef.current ? findLayerById(docRef.current, node.layer.id) : null
        if (!found) return
        if (commentMode) {
          event.preventDefault()
          event.stopPropagation()
          openComposerFor(found.layer.id, found.artboard.id)
          return
        }
        // Double-click (two pointerdowns on the same layer inside DOUBLE_CLICK_MS) drills into
        // the containing group and selects the child — no drag starts on the second press.
        const now = Date.now()
        const previous = lastLayerPointerRef.current
        const isDouble = !!(
          previous &&
          previous.layerId === found.layer.id &&
          now - previous.time < DOUBLE_CLICK_MS
        )
        lastLayerPointerRef.current = { layerId: found.layer.id, time: now }
        if (isDouble) {
          lastLayerPointerRef.current = null
          event.preventDefault()
          event.stopPropagation()
          drillIntoNode(node, event)
          return
        }
        const additive = !!(event.shiftKey || event.ctrlKey || event.metaKey)
        if (additive) {
          // Shift / Ctrl / Cmd+click toggles membership; it never starts a drag.
          selectLayer(found.layer.id, found.artboard.id, { additive: true })
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const targetNode = selectionTargetForNode(node, drillGroupIdRef.current) || node
        const targetId = targetNode.id || found.layer.id
        const currentIds = selectedLayerIdsRef.current
        if (currentIds.indexOf(targetId) >= 0) {
          // Pressing on a layer that is already selected keeps the whole selection (Figma-like) so
          // the press can drag every selected layer; the pressed one becomes the primary.
          if (currentIds.length > 1) {
            const nextIds = currentIds
              .filter(function (layerId) { return layerId !== targetId })
              .concat([targetId])
            applySelection(nextIds, artboardIdForNode(targetNode) || found.artboard.id, drillGroupIdRef.current)
          }
        } else {
          // Plain click replaces the selection with the Figma-like target (group or child).
          selectLayer(found.layer.id, found.artboard.id)
        }
        const gestureNode = nodeForLayer(targetId) || targetNode || node
        beginGesture(event, gestureNode, null)
      }

      function handlePointerDown(event, handle) {
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const tree = treeRef.current
        const layerId = selectedLayerIdRef.current
        const node = tree && layerId && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        // The renderer draws ONE union box for the whole selection (60-render.js SelectionBox) and
        // publishes its rect in artboard canvas units on the box element.
        let unionBox = null
        const target = event && event.currentTarget
        const boxEl =
          target && typeof target.closest === 'function' ? target.closest('.dc-sel-box') : null
        if (boxEl) {
          try {
            unionBox = JSON.parse(boxEl.getAttribute('data-selection-bounds') || 'null')
          } catch (error) {
            unionBox = null
          }
        }
        beginGesture(event, node, handle, unionBox)
      }

      /**
       * Alt+drag (Figma): leave the originals where they were and drop duplicates at the pointer.
       * One document update + one history entry; the copies become the selection.
       */
      function applyAltDragDuplicate(gesture, dx, dy) {
        try {
          const current = docRef.current
          if (!current) return false
          const members = Array.isArray(gesture.members) ? gesture.members : []
          if (!members.length) return false
          // The drag preview moved the originals locally; put them back before copying.
          const restore = members.map(function (member) {
            return { layerId: member.layerId, patch: { x: member.origin.x, y: member.origin.y } }
          })
          let next = docPatchLayers(current, restore)
          const copies = []
          const ops = []
          for (let index = 0; index < members.length; index += 1) {
            const member = members[index]
            const found = findLayerById(next, member.layerId)
            if (!found) continue
            const copy = cloneLayerSubtree(found.layer, 0, 0)
            if (!copy) continue
            copy.x = Math.round(member.origin.x + dx)
            copy.y = Math.round(member.origin.y + dy)
            const destination = found.parentId
              ? { parentId: found.parentId }
              : { artboardId: found.artboard.id }
            const subOps = insertOpsForSubtree(copy, destination, null)
            if (subOps.length === 0) continue
            if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
              setInlineError(strings.duplicateTooLarge)
              return false
            }
            ops.push.apply(ops, subOps)
            copies.push({ copy: copy, destination: destination })
          }
          if (copies.length === 0) return false
          for (let index = 0; index < copies.length; index += 1) {
            next = docInsertLayers(next, copies[index].destination, [copies[index].copy])
          }
          applyDocLocal(next)
          applySelection(
            copies.map(function (item) { return item.copy.id }),
            gesture.artboardId,
            null,
          )
          commitWithHistory(
            'duplicate-drag',
            ops,
            copies.map(function (item) {
              return { type: 'layer.delete', layerId: item.copy.id }
            }),
          )
          beacon('duplicate-drag', { count: copies.length, ops: ops.length })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-drag-failed', { message: shortError(error) })
          return false
        }
      }

      /** Insertion index inside an auto-layout parent, from the pointer's main-axis position. */
      function computeReorderIndex(gesture, clientX, clientY) {
        const current = docRef.current
        if (!current) return null
        const found = findLayerById(current, gesture.layerId)
        if (!found || !found.parent) return null
        const tree = treeRef.current
        const parentNode = tree && tree.byId ? tree.byId.get(found.parent.id) || null : null
        if (!parentNode) return null
        const layoutValue = normalizeLayoutObject(found.parent.layout)
        if (!layoutValue) return null
        const layoutInfo = computeLayout(current)
        const entry = layoutInfo.entryById.get(found.artboard.id) || null
        const point = screenToCanvas(clientX, clientY)
        const originX = entry ? entry.frameX : 0
        const originY = entry ? entry.frameY : 0
        const relX = point.x - originX - parentNode.worldRect.x
        const relY = point.y - originY - parentNode.worldRect.y
        const mainPosition = layoutValue.direction === 'column' ? relY : relX
        const siblings = childrenOf(found.parent)
        let index = 0
        for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
          const sibling = siblings[siblingIndex]
          if (!isObject(sibling) || sibling.id === gesture.layerId) continue
          const siblingNode = tree && tree.byId ? tree.byId.get(sibling.id) || null : null
          if (!siblingNode) continue
          const center =
            layoutValue.direction === 'column'
              ? siblingNode.y + siblingNode.height / 2
              : siblingNode.x + siblingNode.width / 2
          if (center < mainPosition) index += 1
        }
        return clamp(index, 0, Math.max(0, siblings.length - 1))
      }

      /* ------------------------------- marquee selection ------------------------------- */

      /** Ids a marquee rect selects in an artboard (container-aware, group-collapsed). */
      function marqueeSelectionIds(artboardId, rect) {
        const tree = treeRef.current
        if (!tree || !Array.isArray(tree.artboards) || !isObject(rect)) return []
        const entry = tree.artboards.find(function (item) {
          return item && item.artboard && item.artboard.id === artboardId
        })
        if (!entry) return []
        const ids = []
        const seen = new Set()
        const drill = drillGroupIdRef.current
        function addTarget(node) {
          const target = selectionTargetForNode(node, drill) || node
          if (!target || !target.id || seen.has(target.id)) return
          seen.add(target.id)
          ids.push(target.id)
        }
        function visit(nodes) {
          const list = Array.isArray(nodes) ? nodes : []
          for (let index = 0; index < list.length; index += 1) {
            const node = list[index]
            if (!node || !node.layer || node.layer.visible === false) continue
            if (!rectsIntersect(rect, node.worldRect)) continue
            const container = isContainerLayer(node.layer)
            // A fully covered container is selected as a unit (a whole frame/group, Figma-like).
            if (!container || rectContainsRect(rect, node.worldRect)) {
              addTarget(node)
              continue
            }
            const before = ids.length
            visit(node.children)
            if (ids.length === before) addTarget(node)
          }
        }
        visit(entry.layers)
        return ids
      }

      function removeMarqueeListeners(active) {
        if (!active || typeof window === 'undefined' || typeof window.removeEventListener !== 'function') {
          return
        }
        try {
          window.removeEventListener('pointermove', active.onMove)
          window.removeEventListener('pointerup', active.onUp)
          window.removeEventListener('pointercancel', active.onCancel)
        } catch (error) {
          /* ignore */
        }
      }

      function marqueeMove(active, event) {
        if (!event || !active || event.pointerId !== active.pointerId) return
        const total =
          Math.abs(finiteNumber(event.clientX, active.startX) - active.startX) +
          Math.abs(finiteNumber(event.clientY, active.startY) - active.startY)
        if (!active.moved && total < PAN_START_THRESHOLD) return
        active.moved = true
        setGestureActive(true)
        const point = screenToCanvas(event.clientX, event.clientY)
        const rect = rectFromPoints(active.start, {
          x: point.x - active.originX,
          y: point.y - active.originY,
        })
        setMarquee({
          artboardId: active.artboardId,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
      }

      function endMarquee(active, cancelled) {
        removeMarqueeListeners(active)
        if (marqueeRef.current === active) marqueeRef.current = null
        setMarquee(null)
        setGestureActive(false)
      }

      /**
       * Ids a marquee rect selects across EVERY artboard. `rect` is expressed in the reference
       * artboard's local coordinates (so a drag that starts on the empty canvas still has a
       * stable origin); each board's own local rect is derived from the layout offsets.
       */
      function marqueeSelectionIdsAcross(referenceArtboardId, rect) {
        const tree = treeRef.current
        const current = docRef.current
        if (!tree || !current || !isObject(rect)) return []
        const layoutInfo = computeLayout(current)
        const reference = layoutInfo.entryById.get(referenceArtboardId) || null
        if (!reference) return []
        const boards = Array.isArray(tree.artboards) ? tree.artboards : []
        const ids = []
        const seen = new Set()
        for (let index = 0; index < boards.length; index += 1) {
          const entry = boards[index]
          if (!entry || !entry.artboard) continue
          const boardEntry = layoutInfo.entryById.get(entry.artboard.id) || null
          if (!boardEntry) continue
          const localRect = {
            x: rect.x - (boardEntry.frameX - reference.frameX),
            y: rect.y - (boardEntry.frameY - reference.frameY),
            width: rect.width,
            height: rect.height,
          }
          const boardIds = marqueeSelectionIds(entry.artboard.id, localRect)
          for (let boardIndex = 0; boardIndex < boardIds.length; boardIndex += 1) {
            const layerId = boardIds[boardIndex]
            if (seen.has(layerId)) continue
            seen.add(layerId)
            ids.push(layerId)
          }
        }
        return ids
      }

      function marqueeUp(active, event) {
        if (!active || !event || event.pointerId !== active.pointerId) return
        endMarquee(active, false)
        if (!active.moved) {
          // A plain click on the background: inside an artboard it selects the artboard, on the
          // empty canvas it clears the selection (same as v1).
          if (active.crossArtboards) clearSelection()
          else selectArtboard(active.artboardId)
          return
        }
        const point = screenToCanvas(event.clientX, event.clientY)
        const rect = rectFromPoints(active.start, {
          x: point.x - active.originX,
          y: point.y - active.originY,
        })
        const ids = active.crossArtboards
          ? marqueeSelectionIdsAcross(active.artboardId, rect)
          : marqueeSelectionIds(active.artboardId, rect)
        const existing = selectedLayerIdsRef.current
        const nextIds = active.additive
          ? existing.concat(
              ids.filter(function (layerId) { return existing.indexOf(layerId) < 0 }),
            )
          : ids
        // The selected artboard follows the first hit so `Move`/align actions have a parent.
        const boardId = active.crossArtboards
          ? artboardIdForLayer(nextIds[0]) || active.artboardId
          : active.artboardId
        applySelection(nextIds, boardId, drillGroupIdRef.current)
        beacon('marquee-select', {
          count: ids.length,
          additive: active.additive,
          crossArtboards: !!active.crossArtboards,
        })
      }

      function marqueeCancel(active, event) {
        if (!active || !event || event.pointerId !== active.pointerId) return
        endMarquee(active, true)
      }

      function beginMarquee(event, artboardId, options) {
        if (!event || event.button !== 0 || marqueeRef.current) return false
        const current = docRef.current
        if (!current) return false
        const opts = isObject(options) ? options : {}
        const layoutInfo = computeLayout(current)
        const boards = artboardsOf(current)
        // Reference frame: the artboard the drag started in, or the first board when the drag
        // starts on the empty canvas (the rect may then extend over any number of boards).
        let referenceId = artboardId || ''
        if (!referenceId || !layoutInfo.entryById.get(referenceId)) {
          const first = boards.find(function (board) {
            return isObject(board) && layoutInfo.entryById.get(board.id)
          })
          referenceId = first ? first.id : ''
        }
        const entry = referenceId ? layoutInfo.entryById.get(referenceId) || null : null
        if (!entry) return false
        const point = screenToCanvas(event.clientX, event.clientY)
        const active = {
          pointerId: event.pointerId,
          artboardId: referenceId,
          crossArtboards: opts.crossArtboards === true || !artboardId,
          additive: !!event.shiftKey,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          originX: entry.frameX,
          originY: entry.frameY,
          start: { x: point.x - entry.frameX, y: point.y - entry.frameY },
          moved: false,
          onMove: null,
          onUp: null,
          onCancel: null,
        }
        active.onMove = function (moveEvent) { marqueeMove(active, moveEvent) }
        active.onUp = function (upEvent) { marqueeUp(active, upEvent) }
        active.onCancel = function (cancelEvent) { marqueeCancel(active, cancelEvent) }
        marqueeRef.current = active
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('pointermove', active.onMove)
          window.addEventListener('pointerup', active.onUp)
          window.addEventListener('pointercancel', active.onCancel)
        }
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
        return true
      }

      function cancelMarquee() {
        const active = marqueeRef.current
        if (!active) return false
        endMarquee(active, true)
        return true
      }

      function artboardPointerDown(event, artboardId) {
        if (!event || spaceHeldRef.current || isMiddlePointer(event)) return
        if (commentMode) return
        const target = event.target
        if (!target || !target.classList) return
        if (
          target.classList.contains('dc-board-frame') ||
          target.classList.contains('dc-board-inner')
        ) {
          beginMarquee(event, artboardId)
        }
      }

      function gestureMove(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gesture.clientX = finiteNumber(event.clientX, 0)
        gesture.clientY = finiteNumber(event.clientY, 0)
        const total =
          Math.abs(gesture.clientX - gesture.startX) + Math.abs(gesture.clientY - gesture.startY)
        if (!gesture.moved && total < PAN_START_THRESHOLD) return
        gesture.moved = true
        // Auto-layout children reorder on drop; nothing is patched while dragging.
        if (gesture.kind === 'reorder') return
        // Screen pixels -> canvas units: always divide by the camera zoom. Nested parents
        // have no extra scale, so this is also the parent-relative delta.
        const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1
        const rawDx = screenDeltaToCanvas(gesture.clientX - gesture.startX, zoom)
        const rawDy = screenDeltaToCanvas(gesture.clientY - gesture.startY, zoom)
        let dx = rawDx
        let dy = rawDy
        // Snap guides: edges/centers of siblings and of the parent/artboard box, Alt disables.
        const canSnap =
          gesture.kind === 'drag' && snapEnabledRef.current && !event.altKey && !spaceHeldRef.current
        if (canSnap) {
          const snapped = snapMovingBox(
            gesture.selectionBox,
            gesture.snapStatic,
            gesture.frameRect,
            rawDx,
            rawDy,
            SNAP_THRESHOLD_SCREEN / zoom,
          )
          dx = snapped.dx
          dy = snapped.dy
          const active = snapped.guides.length > 0
          if (active !== gesture.guidesActive) {
            gesture.guidesActive = active
            setSnapGuides(active ? snapped.guides : [])
            setSnapGuidesArtboardId(active ? gesture.artboardId : null)
          } else if (active) {
            setSnapGuides(snapped.guides)
          }
        } else if (gesture.guidesActive) {
          gesture.guidesActive = false
          setSnapGuides([])
          setSnapGuidesArtboardId(null)
        }
        gesture.dx = dx
        gesture.dy = dy
        scheduleGesturePreview()
      }

      function releaseCapture(event) {
        try {
          const target = event.currentTarget
          if (target && typeof target.releasePointerCapture === 'function') {
            target.releasePointerCapture(event.pointerId)
          }
        } catch (error) {
          /* capture may already be released */
        }
      }

      function gestureUp(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        cancelGestureFrame()
        setGestureActive(false)
        releaseCapture(event)
        setSnapGuides([])
        setSnapGuidesArtboardId(null)
        if (!gesture.moved) return
        if (gesture.kind === 'reorder') {
          const index = computeReorderIndex(
            gesture,
            finiteNumber(event.clientX, gesture.clientX),
            finiteNumber(event.clientY, gesture.clientY),
          )
          const current = docRef.current
          if (!current || index === null) return
          const found = findLayerById(current, gesture.layerId)
          if (!found) return
          const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
          const target = clamp(index, 0, Math.max(0, siblings.length - 1))
          if (target === found.index) return
          applyDocLocal(docReorderLayer(current, gesture.layerId, target))
          commitWithHistory(
            'reorder',
            [{ type: 'layer.reorder', layerId: gesture.layerId, index: target }],
            [{ type: 'layer.reorder', layerId: gesture.layerId, index: found.index }],
          )
          beacon('layer-reorder', { layerId: gesture.layerId, index: target, source: 'drag' })
          return
        }
        const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1
        // Prefer the previewed (snapped) delta; fall back to the release coordinates.
        let dx = typeof gesture.dx === 'number' ? gesture.dx : NaN
        let dy = typeof gesture.dy === 'number' ? gesture.dy : NaN
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          dx = screenDeltaToCanvas(
            finiteNumber(event.clientX, gesture.clientX) - gesture.startX,
            zoom,
          )
          dy = screenDeltaToCanvas(
            finiteNumber(event.clientY, gesture.clientY) - gesture.startY,
            zoom,
          )
          gesture.dx = dx
          gesture.dy = dy
        }
        // Alt+drag duplicates the selection on drop and leaves the originals in place.
        if (gesture.kind === 'drag' && event.altKey) {
          applyAltDragDuplicate(gesture, dx, dy)
          return
        }
        const entries = gesturePatchEntries(gesture)
        if (!entries.length) return
        const ops = []
        const inverse = []
        for (let index = 0; index < entries.length; index += 1) {
          ops.push({ type: 'layer.update', layerId: entries[index].layerId, patch: entries[index].patch })
        }
        for (let index = 0; index < gesture.members.length; index += 1) {
          const member = gesture.members[index]
          const inversePatch =
            gesture.kind === 'resize-auto'
              ? { width: member.origin.width, height: member.origin.height }
              : gesture.kind === 'drag'
                ? { x: member.origin.x, y: member.origin.y }
                : {
                    x: member.origin.x,
                    y: member.origin.y,
                    width: member.origin.width,
                    height: member.origin.height,
                  }
          inverse.push({ type: 'layer.update', layerId: member.layerId, patch: inversePatch })
        }
        // A pending animation frame may not have run yet; make the final state visible now.
        const current = docRef.current
        if (current) applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('gesture', ops, inverse)
        beacon('gesture', { kind: gesture.kind, count: ops.length })
      }

      function gestureCancel(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        cancelGestureFrame()
        setGestureActive(false)
        setSnapGuides([])
        setSnapGuidesArtboardId(null)
        releaseCapture(event)
        if (!gesture.moved) return
        // A cancelled reorder left the document untouched.
        if (gesture.kind === 'reorder') return
        const current = docRef.current
        if (!current) return
        // The Host never saw the preview (it only existed locally), so restoring locally is
        // enough: no runOps, no history entry.
        const restore = gesture.members.map(function (member) {
          return {
            layerId: member.layerId,
            patch:
              gesture.kind === 'resize-auto'
                ? { width: member.origin.width, height: member.origin.height }
                : gesture.kind === 'drag'
                  ? { x: member.origin.x, y: member.origin.y }
                  : {
                      x: member.origin.x,
                      y: member.origin.y,
                      width: member.origin.width,
                      height: member.origin.height,
                    },
          }
        })
        if (restore.length) applyDocLocal(docPatchLayers(current, restore))
      }

      /* ------------------------------- pan: middle drag, space+drag, empty background ------------------------------- */

      function isMiddlePointer(event) {
        return !!event && event.pointerType === 'mouse' && event.button === 1
      }

      function beginPan(event, clickCandidate) {
        if (!event || panRef.current) return
        const cam = cameraRef.current
        panRef.current = {
          pointerId: event.pointerId,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          originX: cam.x,
          originY: cam.y,
          zoom: cam.zoom,
          moved: false,
          clickCandidate: !!clickCandidate,
        }
        setPanning(true)
        try {
          const target = event.currentTarget
          if (target && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(event.pointerId)
          }
        } catch (error) {
          /* pointer capture is best-effort */
        }
      }

      function releasePanCapture(event) {
        try {
          const target = event && event.currentTarget
          if (
            target &&
            typeof target.releasePointerCapture === 'function' &&
            event.pointerId !== undefined
          ) {
            target.releasePointerCapture(event.pointerId)
          }
        } catch (error) {
          /* capture may already be released */
        }
      }

      function canvasPointerDown(event) {
        if (!event) return
        const middle = isMiddlePointer(event)
        const spacePan = spaceHeldRef.current
        if (!middle && !spacePan) {
          if (event.button !== 0) return
          const target = event.target
          let blank = false
          try {
            if (target && typeof target.closest === 'function') {
              // Pan only from empty canvas: not from the artboards, pins, handles,
              // composer or interactive controls inside the canvas.
              blank = !target.closest(
                '.dc-board-wrap, .dc-composer, .dc-pin, .dc-sel-handle, button, input, textarea, select, a',
              )
            } else if (target && target.classList) {
              blank =
                target.classList.contains('dc-canvas') ||
                target.classList.contains('dc-stage') ||
                target.classList.contains('dc-center')
            }
          } catch (error) {
            blank = false
          }
          // Figma: a left drag on the empty canvas draws a selection marquee (it may start
          // outside every artboard and still catch layers inside them). Panning stays on
          // space+drag and middle-drag. Hits on an artboard or a layer are handled by their own
          // pointer handlers, so nothing else starts here.
          if (!blank) return
          if (beginMarquee(event, null, { crossArtboards: true })) return
          return
        }
        if (panRef.current) return
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
        } catch (error) {
          /* ignore */
        }
        beginPan(event, !spacePan && !middle)
      }

      function canvasPointerMove(event) {
        const pan = panRef.current
        if (!pan || !event || pan.pointerId !== event.pointerId) return
        const dx = finiteNumber(event.clientX, 0) - pan.startX
        const dy = finiteNumber(event.clientY, 0) - pan.startY
        if (!pan.moved && Math.abs(dx) + Math.abs(dy) < PAN_START_THRESHOLD) return
        pan.moved = true
        setCameraValue({
          x: roundTo(pan.originX + dx, 1),
          y: roundTo(pan.originY + dy, 1),
          zoom: pan.zoom,
        })
      }

      function endPan(event, cancelled) {
        const pan = panRef.current
        if (!pan || !event || pan.pointerId !== event.pointerId) return
        panRef.current = null
        setPanning(false)
        releasePanCapture(event)
        if (cancelled) {
          if (pan.moved) setCameraValue({ x: pan.originX, y: pan.originY, zoom: pan.zoom })
          return
        }
        // A click on empty background keeps its old meaning: clear the selection.
        if (!pan.moved && pan.clickCandidate) clearSelection()
      }

      function canvasPointerUp(event) {
        endPan(event, false)
      }

      function canvasPointerCancel(event) {
        endPan(event, true)
      }

      function cancelPan() {
        const pan = panRef.current
        if (!pan) return
        panRef.current = null
        setPanning(false)
        if (pan.moved) setCameraValue({ x: pan.originX, y: pan.originY, zoom: pan.zoom })
      }

      function holdSpace() {
        if (spaceHeldRef.current) return
        spaceHeldRef.current = true
        setSpaceHeld(true)
      }

      function releaseSpace() {
        if (!spaceHeldRef.current) return
        spaceHeldRef.current = false
        setSpaceHeld(false)
      }

      /* ------------------------------- wheel: zoom about cursor / pan ------------------------------- */

      React.useEffect(
        function () {
          const node = canvasRef.current
          if (!node || typeof node.addEventListener !== 'function') return undefined
          function handleWheel(event) {
            if (!event) return
            const target = event.target
            // Let the comment composer's textarea keep its native wheel scrolling.
            try {
              if (target && typeof target.closest === 'function' && target.closest('.dc-composer')) {
                return
              }
            } catch (error) {
              /* ignore */
            }
            try {
              if (typeof event.preventDefault === 'function') event.preventDefault()
            } catch (error) {
              /* ignore */
            }
            if (panRef.current) return
            const viewport = canvasViewport()
            const cam = cameraRef.current
            const unit =
              event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, viewport.height) : 1
            const deltaX = finiteNumber(event.deltaX, 0) * unit
            const deltaY = finiteNumber(event.deltaY, 0) * unit
            if (event.ctrlKey || event.metaKey) {
              // Chromium reports a trackpad pinch as ctrl+wheel, so this also covers pinch zoom.
              const cursorX =
                finiteNumber(event.clientX, viewport.left + viewport.width / 2) - viewport.left
              const cursorY =
                finiteNumber(event.clientY, viewport.top + viewport.height / 2) - viewport.top
              const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
              zoomAboutViewportPoint(cursorX, cursorY, cam.zoom * factor)
              return
            }
            let panX = deltaX
            let panY = deltaY
            if (event.shiftKey && panX === 0) {
              panX = panY
              panY = 0
            }
            if (panX === 0 && panY === 0) return
            setCameraValue({ x: cam.x - panX, y: cam.y - panY, zoom: cam.zoom })
          }
          node.addEventListener('wheel', handleWheel, { passive: false })
          return function () {
            try {
              node.removeEventListener('wheel', handleWheel)
            } catch (error) {
              /* node may already be gone */
            }
          }
        },
        [doc],
      )

      /* ------------------------------- keyboard + clipboard ------------------------------- */

      React.useEffect(
        function () {
          if (!sessionId) return undefined
          function editableTarget(target) {
            if (!target) return false
            const tag = String(target.tagName || '').toUpperCase()
            return (
              tag === 'INPUT' ||
              tag === 'TEXTAREA' ||
              tag === 'SELECT' ||
              !!target.isContentEditable
            )
          }
          function onKeyDown(event) {
            const target = event.target
            const tag = target ? String(target.tagName || '').toUpperCase() : ''
            if (editableTarget(target)) return
            // Feature parts register shortcuts here (see EXTENSIONS.keys in 00-core.js);
            // they run before the built-in bindings so a feature may claim an unused combo.
            if (EXTENSIONS.keys.length) {
              for (let index = 0; index < EXTENSIONS.keys.length; index += 1) {
                const entry = EXTENSIONS.keys[index]
                try {
                  if (!entry.match(event)) continue
                  if (entry.run(event, extensionApi) === false) continue
                  event.preventDefault()
                  return
                } catch (error) {
                  beacon('key-extension-failed', {
                    id: String(entry && entry.id),
                    message: shortError(error),
                  })
                }
              }
            }
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
              const shortcut = String(event.key || '').toLowerCase()
              if (shortcut === 'z') {
                event.preventDefault()
                if (event.shiftKey) redoOnce()
                else undoOnce()
                return
              }
              if (shortcut === 'y') {
                event.preventDefault()
                redoOnce()
                return
              }
              if (shortcut === 'd') {
                event.preventDefault()
                duplicateSelected()
                return
              }
              if (shortcut === 'a') {
                event.preventDefault()
                selectAllInArtboard()
                return
              }
              if (shortcut === 'c') {
                event.preventDefault()
                copySelection()
                return
              }
              if (shortcut === 'x') {
                event.preventDefault()
                cutSelection()
                return
              }
              if (shortcut === 'v') {
                event.preventDefault()
                const pending = pasteSelection()
                if (pending && typeof pending.catch === 'function') {
                  pending.catch(function () {
                    /* paste is best-effort; errors surface through inlineError */
                  })
                }
                return
              }
              if (shortcut === 'g') {
                event.preventDefault()
                if (event.shiftKey) {
                  ungroupSelection()
                } else {
                  const pending = groupSelection()
                  if (pending && typeof pending.catch === 'function') {
                    pending.catch(function () {
                      /* group errors surface through inlineError */
                    })
                  }
                }
                return
              }
              if (event.key === ']' || event.key === '}') {
                event.preventDefault()
                arrangeSelection(event.shiftKey ? 'front' : 'forward')
                return
              }
              if (event.key === '[' || event.key === '{') {
                event.preventDefault()
                arrangeSelection(event.shiftKey ? 'back' : 'backward')
                return
              }
            }
            if (
              event.key === 'ArrowLeft' ||
              event.key === 'ArrowRight' ||
              event.key === 'ArrowUp' ||
              event.key === 'ArrowDown'
            ) {
              if (!selectedLayerIdRef.current) return
              const step = event.shiftKey ? 10 : 1
              let dx = 0
              let dy = 0
              if (event.key === 'ArrowLeft') dx = -step
              else if (event.key === 'ArrowRight') dx = step
              else if (event.key === 'ArrowUp') dy = -step
              else dy = step
              event.preventDefault()
              nudgeSelected(dx, dy)
              return
            }
            if (event.code === 'Space' || event.key === ' ') {
              // Space-held turns the next left drag into a pan; only claim the key while
              // the pointer is over the canvas or focus is inside the canvas app, and
              // leave BUTTON/A activation alone.
              if (tag === 'BUTTON' || tag === 'A') return
              const appNode = appRef.current
              const active = typeof document !== 'undefined' ? document.activeElement : null
              const focusInApp =
                !!appNode && !!active && typeof appNode.contains === 'function' && appNode.contains(active)
              if (!canvasHoverRef.current && !focusInApp) return
              holdSpace()
              if (typeof event.preventDefault === 'function') event.preventDefault()
              return
            }
            if (event.key === 'Escape') {
              releaseSpace()
              cancelPan()
              if (cancelMarquee()) {
                if (typeof event.preventDefault === 'function') event.preventDefault()
                return
              }
              // The composer textarea handles its own Escape (and stops propagation).
              if (composer) {
                setComposer(null)
                return
              }
              // Esc steps out of a drilled group to the group, else clears the selection.
              stepSelectionOut()
              return
            }
            if (event.key === 'Enter') {
              // Never steal Enter from a focused control (buttons, links, inputs are filtered).
              if (tag === 'BUTTON' || tag === 'A') return
              if (drillIntoSelection()) {
                if (typeof event.preventDefault === 'function') event.preventDefault()
              }
              return
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              if (selectedLayerIdsRef.current.length) {
                event.preventDefault()
                deleteSelectedLayer()
                return
              }
              // Nothing selected but an artboard is: Delete removes the artboard (item 3).
              if (selectedArtboardIdRef.current) {
                event.preventDefault()
                deleteArtboard(selectedArtboardIdRef.current)
              }
              return
            }
            if (event.key === 'c' || event.key === 'C') {
              const layerId = selectedLayerIdRef.current
              if (layerId && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault()
                openComposerFor(layerId, null)
              }
            }
          }
          function onKeyUp(event) {
            if (event.code === 'Space' || event.key === ' ') releaseSpace()
          }
          function onWindowBlur() {
            releaseSpace()
            cancelPan()
          }
          function onPaste(event) {
            try {
              const node = canvasRef.current
              const target = event.target
              if (editableTarget(target)) return
              // Paste applies when focus is on the canvas app (canvas, toolbar, body); typing
              // into the chat composer or any input keeps its native paste.
              const appNode = appRef.current
              let targetOk = !target || target === document.body || target === document.documentElement
              if (!targetOk && appNode && target && typeof appNode.contains === 'function') {
                targetOk = appNode.contains(target)
              }
              if (!targetOk && node && target && typeof node.contains === 'function') {
                targetOk = node.contains(target)
              }
              if (!node || !targetOk) return
              const data = event.clipboardData
              if (!data) return
              const viewport = canvasViewport()
              const point = screenToCanvas(
                viewport.left + viewport.width / 2,
                viewport.top + viewport.height / 2,
              )
              const items = data.items || []
              for (let index = 0; index < items.length; index += 1) {
                const item = items[index]
                if (!item || item.kind !== 'file' || typeof item.getAsFile !== 'function') continue
                if (!imageFileType({ type: item.type, name: '' })) continue
                const file = item.getAsFile()
                if (!file) continue
                if (typeof event.preventDefault === 'function') event.preventDefault()
                handleImageFile(file, 'paste', point)
                return
              }
              const files = data.files || []
              for (let index = 0; index < files.length; index += 1) {
                if (!imageFileType(files[index])) continue
                if (typeof event.preventDefault === 'function') event.preventDefault()
                handleImageFile(files[index], 'paste', point)
                return
              }
            } catch (error) {
              beacon('image-paste-failed', { message: shortError(error) })
            }
          }
          document.addEventListener('keydown', onKeyDown)
          document.addEventListener('keyup', onKeyUp)
          document.addEventListener('paste', onPaste)
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('blur', onWindowBlur)
          }
          return function () {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
            document.removeEventListener('paste', onPaste)
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener('blur', onWindowBlur)
            }
            if (nudgeRef.current && nudgeRef.current.timer) {
              clearTimeout(nudgeRef.current.timer)
              nudgeRef.current = null
            }
          }
        },
        [sessionId],
      )

      /* ------------------------------- image input ------------------------------- */

      function openImagePicker(source) {
        try {
          imagePickSourceRef.current = source || 'toolbar'
          beacon('image-picker', { source: imagePickSourceRef.current })
          const input = imageInputRef.current
          if (!input) return
          try {
            input.value = ''
          } catch (error) {
            /* some browsers reject value writes; the click below still works */
          }
          if (typeof input.click === 'function') input.click()
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('image-picker-failed', { message: shortError(error) })
        }
      }

      function placeImageInArtboard(artboard, localPoint, naturalWidth, naturalHeight) {
        const boardWidth = Math.max(1, finiteNumber(artboard.width, 1))
        const boardHeight = Math.max(1, finiteNumber(artboard.height, 1))
        const naturalW = naturalWidth > 0 ? naturalWidth : 320
        const naturalH = naturalHeight > 0 ? naturalHeight : 200
        const maxWidth = Math.max(32, Math.round(boardWidth * IMAGE_MAX_WIDTH_RATIO))
        // Natural size capped to ~40% of the artboard width (and to the artboard height).
        const scale = Math.min(1, maxWidth / naturalW, boardHeight / naturalH)
        const width = Math.max(16, Math.round(naturalW * scale))
        const height = Math.max(16, Math.round(naturalH * scale))
        const layer = createLayer('image', artboard)
        layer.width = width
        layer.height = height
        layer.fit = 'cover'
        if (localPoint) {
          layer.x = Math.round(
            clamp(localPoint.x - width / 2, 0, Math.max(0, boardWidth - width)),
          )
          layer.y = Math.round(
            clamp(localPoint.y - height / 2, 0, Math.max(0, boardHeight - height)),
          )
        } else {
          layer.x = Math.round((boardWidth - width) / 2)
          layer.y = Math.round((boardHeight - height) / 2)
        }
        return layer
      }

      function replaceSelectedImage(dataUrl) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        if (!found || found.layer.type !== 'image') return false
        const previousSrc = typeof found.layer.src === 'string' ? found.layer.src : ''
        patchLocalLayer(layerId, { src: dataUrl })
        commitWithHistory(
          'image-replace',
          [{ type: 'layer.update', layerId: layerId, patch: { src: dataUrl } }],
          [{ type: 'layer.update', layerId: layerId, patch: { src: previousSrc } }],
        )
        return true
      }

      function applyImageFile(file, source, dataUrl, naturalWidth, naturalHeight, canvasPoint) {
        const current = docRef.current
        if (!current) return
        if (source === 'inspector' && replaceSelectedImage(dataUrl)) {
          beacon('image-add', {
            source: source,
            mode: 'replace',
            bytes: finiteNumber(file && file.size, 0),
            width: naturalWidth,
            height: naturalHeight,
          })
          return
        }
        const layout = computeLayout(current)
        let targetArtboard = null
        let localPoint = null
        if (canvasPoint) {
          const hit = layoutEntryAt(layout, canvasPoint.x, canvasPoint.y)
          if (hit) {
            targetArtboard = hit.artboard
            localPoint = {
              x: finiteNumber(canvasPoint.x, 0) - hit.frameX,
              y: finiteNumber(canvasPoint.y, 0) - hit.frameY,
            }
          }
        }
        if (!targetArtboard && selectedArtboardIdRef.current) {
          targetArtboard = findArtboardById(current, selectedArtboardIdRef.current)
        }
        if (!targetArtboard) {
          targetArtboard =
            artboardsOf(current).find(function (artboard) {
              return isObject(artboard)
            }) || null
        }
        if (!targetArtboard) {
          setInlineError(strings.imageNoArtboard)
          beacon('image-rejected', { source: source, reason: 'no-artboard' })
          return
        }
        // Images dropped/pasted onto a group or frame land INSIDE that container; with no
        // pointer position, a selected container is the target as well.
        let dropContainer = null
        if (localPoint) {
          const drop = imageDropContainerAt(treeRef.current, targetArtboard.id, localPoint)
          if (drop && drop.node && drop.node.depth < FRAME_MAX_DEPTH) {
            if (childrenOf(drop.node.layer).length < FRAME_MAX_CHILDREN) dropContainer = drop
          }
        }
        if (!dropContainer) {
          const primaryId = selectedLayerIdRef.current
          const primaryNode = primaryId ? nodeForLayer(primaryId) : null
          if (
            primaryNode &&
            isContainerLayer(primaryNode.layer) &&
            primaryNode.depth < FRAME_MAX_DEPTH &&
            childrenOf(primaryNode.layer).length < FRAME_MAX_CHILDREN
          ) {
            dropContainer = {
              node: primaryNode,
              localPoint: { x: primaryNode.width / 2, y: primaryNode.height / 2 },
            }
          }
        }
        const containerBox = dropContainer ? dropContainer.node.layer : targetArtboard
        const boxWidth = Math.max(1, finiteNumber(containerBox.width, targetArtboard.width))
        const boxHeight = Math.max(1, finiteNumber(containerBox.height, targetArtboard.height))
        const layer = placeImageInArtboard(
          Object.assign({}, containerBox, { width: boxWidth, height: boxHeight }),
          dropContainer ? dropContainer.localPoint : localPoint,
          naturalWidth,
          naturalHeight,
        )
        layer.src = dataUrl
        const destination = dropContainer
          ? { parentId: dropContainer.node.layer.id }
          : { artboardId: targetArtboard.id }
        applyDocLocal(docInsertLayer(current, destination, layer))
        applySelection([layer.id], targetArtboard.id, null)
        const addOp = { type: 'layer.add', layer: layer }
        if (destination.parentId) addOp.parentId = destination.parentId
        else addOp.artboardId = destination.artboardId
        commitWithHistory('image-add', [addOp], [{ type: 'layer.delete', layerId: layer.id }])
        beacon('image-add', {
          source: source,
          mode: 'add',
          parentId: destination.parentId,
          bytes: finiteNumber(file && file.size, 0),
          width: layer.width,
          height: layer.height,
        })
      }

      function handleImageFile(file, source, canvasPoint) {
        try {
          if (!file) return
          const kind = String(source || 'toolbar')
          const type = imageFileType(file)
          if (!type) {
            setInlineError(strings.imageBadType)
            beacon('image-rejected', {
              source: kind,
              reason: 'unsupported-type',
              type: String(file.type || '').slice(0, 60),
              name: String(file.name || '').slice(0, 80),
            })
            return
          }
          const bytes = finiteNumber(file.size, 0)
          if (bytes > IMAGE_MAX_BYTES) {
            setInlineError(strings.imageTooLarge)
            beacon('image-rejected', {
              source: kind,
              reason: 'too-large',
              bytes: bytes,
              type: type,
            })
            return
          }
          if (!docRef.current || artboardsOf(docRef.current).length === 0) {
            setInlineError(strings.imageNoArtboard)
            beacon('image-rejected', { source: kind, reason: 'no-artboard' })
            return
          }
          readFileAsDataUrl(file)
            .then(function (dataUrl) {
              // Defense in depth: some clipboard files report no size, so also cap the
              // encoded payload (base64 inflates ~4/3) before it goes into the board.
              if (dataUrl.length > Math.ceil(IMAGE_MAX_BYTES * 1.4)) {
                setInlineError(strings.imageTooLarge)
                beacon('image-rejected', {
                  source: kind,
                  reason: 'too-large',
                  bytes: dataUrl.length,
                  type: type,
                })
                return null
              }
              return measureImageSize(dataUrl).then(function (size) {
                applyImageFile(file, kind, dataUrl, size.width, size.height, canvasPoint)
              })
            })
            .catch(function (error) {
              setInlineError(strings.imageReadFailed)
              beacon('image-rejected', {
                source: kind,
                reason: 'read-failed',
                message: shortError(error),
              })
            })
        } catch (error) {
          setInlineError(strings.imageReadFailed)
          beacon('image-rejected', {
            source: String(source || 'toolbar'),
            reason: 'threw',
            message: shortError(error),
          })
        }
      }

      function onImageInputChange(event) {
        try {
          const input = event && event.target
          const files = input && input.files
          const file = files && files[0]
          try {
            if (input) input.value = ''
          } catch (error) {
            /* ignore */
          }
          if (!file) return
          const source = imagePickSourceRef.current || 'toolbar'
          handleImageFile(file, source, null)
        } catch (error) {
          beacon('image-input-failed', { message: shortError(error) })
        }
      }

      function canvasDragOver(event) {
        if (!event) return
        try {
          const transfer = event.dataTransfer
          const types = transfer && transfer.types
          let hasFiles = false
          if (types) {
            for (let index = 0; index < types.length; index += 1) {
              if (String(types[index]) === 'Files') {
                hasFiles = true
                break
              }
            }
          }
          if (!hasFiles) return
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (transfer) transfer.dropEffect = 'copy'
          if (!dragOver) setDragOver(true)
        } catch (error) {
          /* drag signals are best-effort */
        }
      }

      function canvasDragLeave(event) {
        try {
          const node = event && event.currentTarget
          const related = event && event.relatedTarget
          if (node && related && typeof node.contains === 'function' && node.contains(related)) {
            return
          }
        } catch (error) {
          /* ignore */
        }
        setDragOver(false)
      }

      function canvasDrop(event) {
        if (!event) return
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
        } catch (error) {
          /* ignore */
        }
        setDragOver(false)
        try {
          const transfer = event.dataTransfer
          if (!transfer) return
          let file = null
          const files = transfer.files || []
          for (let index = 0; index < files.length; index += 1) {
            if (imageFileType(files[index])) {
              file = files[index]
              break
            }
          }
          if (!file && files.length > 0) file = files[0]
          if (!file) return
          const point = screenToCanvas(event.clientX, event.clientY)
          handleImageFile(file, 'drop', point)
        } catch (error) {
          beacon('image-drop-failed', { message: shortError(error) })
        }
      }

      /* ------------------------------- inline error auto-dismiss ------------------------------- */

      React.useEffect(
        function () {
          if (!inlineError) return undefined
          const timer = setTimeout(function () {
            setInlineError('')
          }, 12000)
          return function () {
            clearTimeout(timer)
          }
        },
        [inlineError],
      )

      /* ------------------------------- derived render data ------------------------------- */

      const tree = React.useMemo(
        function () {
          return buildComputedTree(doc)
        },
        [doc],
      )
      treeRef.current = tree
      const selectedNode =
        selectedLayerId && tree && tree.byId ? tree.byId.get(selectedLayerId) || null : null

      // Computed nodes for every selected layer (ordered, primary last). The renderer draws one
      // outline per node; the shell/inspector use it for multi-selection affordances.
      const selectedNodes = React.useMemo(
        function () {
          if (!tree || !tree.byId || !selectedLayerIds.length) return []
          const nodes = []
          for (let index = 0; index < selectedLayerIds.length; index += 1) {
            const node = tree.byId.get(selectedLayerIds[index])
            if (node) nodes.push(node)
          }
          return nodes
        },
        [tree, selectedLayerIds],
      )

      const commentIndex = React.useMemo(
        function () {
          const openCounts = new Map()
          const pinsByArtboard = new Map()
          const comments = commentsOf(doc)
          for (let index = 0; index < comments.length; index += 1) {
            const comment = comments[index]
            if (!isObject(comment) || comment.status === 'resolved') continue
            if (typeof comment.layerId !== 'string') continue
            openCounts.set(comment.layerId, (openCounts.get(comment.layerId) || 0) + 1)
          }
          const nodes = tree && Array.isArray(tree.allNodes) ? tree.allNodes : []
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            const count = node && node.layer ? openCounts.get(node.layer.id) : 0
            if (!count) continue
            const boardId = node.artboard && node.artboard.id ? node.artboard.id : ''
            if (!boardId) continue
            let pins = pinsByArtboard.get(boardId)
            if (!pins) {
              pins = []
              pinsByArtboard.set(boardId, pins)
            }
            pins.push({ node: node, count: count })
          }
          return { openCounts: openCounts, pinsByArtboard: pinsByArtboard }
        },
        [doc, tree],
      )

      const selectedComments = React.useMemo(
        function () {
          if (!doc || !selectedLayerId) return []
          return commentsOf(doc)
            .filter(function (comment) {
              return isObject(comment) && comment.layerId === selectedLayerId
            })
            .slice()
            .sort(function (first, second) {
              if ((first.status === 'resolved') !== (second.status === 'resolved')) {
                return first.status === 'resolved' ? 1 : -1
              }
              return 0
            })
        },
        [doc, selectedLayerId],
      )

      const layout = React.useMemo(
        function () {
          return computeLayout(doc)
        },
        [doc],
      )

      // The comment composer is positioned in viewport pixels (not canvas units) so it
      // stays readable at any zoom; the anchor is the targeted layer's bottom-right corner.
      let composerPlacement = null
      if (composer && doc && tree) {
        const node = tree.byId ? tree.byId.get(composer.layerId) || null : null
        const entry = node ? layout.entryById.get(node.artboard.id) || null : null
        if (node && entry) {
          const viewport = canvasViewport()
          const right = projectToViewport(
            entry.frameX + node.worldRect.x + node.worldRect.width,
            entry.frameY + node.worldRect.y + node.worldRect.height,
          )
          const maxLeft = Math.max(8, viewport.width - 268)
          const maxTop = Math.max(8, viewport.height - 52)
          composerPlacement = {
            left: Math.round(clamp(right.x + 8, 8, maxLeft)),
            top: Math.round(clamp(right.y + 8, 8, maxTop)),
            target: node.layer,
          }
        }
      }

      const handlers = {
        layerPointerDown: layerPointerDown,
        handlePointerDown: handlePointerDown,
        gestureMove: gestureMove,
        gestureUp: gestureUp,
        gestureCancel: gestureCancel,
        selectArtboard: selectArtboard,
        artboardPointerDown: artboardPointerDown,
        screenToCanvas: screenToCanvas,
        reparent: reparentLayer,
        panCameraBy: function (dx, dy) {
          const cam = cameraRef.current
          setCameraValue({ x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom })
        },
        pinClick: function (layerId, artboardId) {
          selectLayer(layerId, artboardId)
          setInspectorOpen(true)
          if (commentMode) openComposerFor(layerId, artboardId)
        },
        composerChange: function (text) {
          setComposer(function (previous) {
            return previous ? Object.assign({}, previous, { text: text }) : previous
          })
        },
        composerCancel: function () {
          setComposer(null)
        },
        composerSend: function () {
          submitComment()
        },
      }

      const statusLabels = {
        synced: strings.synced,
        saving: strings.saving,
        offline: strings.offline,
        revising: strings.revising,
      }

      /* ------------------------------- public API ------------------------------- */

      // Curated action surface handed to feature parts (key handlers, app panels, panels that
      // were registered through EXTENSIONS in 00-core.js). Everything here is stable API.
      const extensionApi = {
        doc: doc,
        tree: tree,
        camera: camera,
        strings: strings,
        selection: {
          layerIds: selectedLayerIds.slice(),
          primaryLayerId: selectedLayerId,
          artboardId: selectedArtboardId,
          drillGroupId: drillGroupId,
        },
        selectedLayerId: selectedLayerId,
        selectedLayerIds: selectedLayerIds.slice(),
        selectedArtboardId: selectedArtboardId,
        selectedNode: selectedNode,
        selectedNodes: selectedNodes,
        drillGroupId: drillGroupId,
        marquee: marquee,
        snapGuides: snapGuides,
        snapGuidesArtboardId: snapGuidesArtboardId,
        snapEnabled: snapEnabled,
        setSnapEnabled: setSnapEnabled,
        toggleSnap: toggleSnap,
        selectLayer: selectLayer,
        selectLayers: selectLayers,
        selectAll: selectAllInArtboard,
        selectArtboard: selectArtboard,
        clearSelection: clearSelection,
        stepSelectionOut: stepSelectionOut,
        drillIntoSelection: drillIntoSelection,
        drillIntoNode: drillIntoNode,
        commitLayer: commitLayer,
        commitArtboard: commitArtboard,
        updateLayer: updateLayer,
        renameLayer: renameLayer,
        renameArtboard: renameArtboard,
        reorderLayer: reorderLayer,
        addLayer: addLayer,
        deleteArtboard: deleteArtboard,
        addButtonPreset: addButtonPreset,
        deleteSelected: deleteSelectedLayer,
        duplicateSelected: duplicateSelected,
        groupSelection: groupSelection,
        ungroupSelection: ungroupSelection,
        alignSelection: alignSelection,
        distributeSelection: distributeSelection,
        tidySelection: tidySelection,
        arrangeSelection: arrangeSelection,
        reorderSelection: reorderSelection,
        moveSelected: moveSelected,
        reparentSelection: reparentSelection,
        toggleLock: toggleLock,
        copySelection: copySelection,
        cutSelection: cutSelection,
        pasteSelection: pasteSelection,
        nudgeSelection: nudgeSelected,
        undo: undoOnce,
        redo: redoOnce,
        canUndo: function () {
          return historyRef.current.undo.length > 0
        },
        canRedo: function () {
          return historyRef.current.redo.length > 0
        },
        setInlineError: setInlineError,
        setInspectorOpen: setInspectorOpen,
        setTreeOpen: setTreeOpen,
        openComposerFor: openComposerFor,
        setCommentStatus: setCommentStatus,
        deleteComment: deleteCommentById,
        submitComment: submitComment,
        sendCommentChat: sendCommentChat,
        submitComments: submitCommentsFor,
        zoom: camera ? camera.zoom : 1,
        fitCamera: fitCamera,
        zoomCameraBy: zoomCameraBy,
        runOps: runOps,
        applyDocLocal: applyDocLocal,
      }

      return {
        strings: strings,
        doc: doc,
        setDoc: setDoc,
        version: version,
        setVersion: setVersion,
        boardPath: boardPath,
        setBoardPath: setBoardPath,
        loading: loading,
        setLoading: setLoading,
        loadError: loadError,
        setLoadError: setLoadError,
        status: status,
        setStatus: setStatus,
        inlineError: inlineError,
        setInlineError: setInlineError,
        selectedLayerId: selectedLayerId,
        setSelectedLayerId: setSelectedLayerId,
        selectedLayerIds: selectedLayerIds,
        setSelectedLayerIds: setSelectedLayerIds,
        selectedArtboardId: selectedArtboardId,
        setSelectedArtboardId: setSelectedArtboardId,
        drillGroupId: drillGroupId,
        setDrillGroupId: setDrillGroupId,
        marquee: marquee,
        snapGuides: snapGuides,
        snapGuidesArtboardId: snapGuidesArtboardId,
        snapEnabled: snapEnabled,
        setSnapEnabled: setSnapEnabled,
        toggleSnap: toggleSnap,
        camera: camera,
        setCamera: setCamera,
        panning: panning,
        setPanning: setPanning,
        spaceHeld: spaceHeld,
        setSpaceHeld: setSpaceHeld,
        dragOver: dragOver,
        setDragOver: setDragOver,
        commentMode: commentMode,
        setCommentMode: setCommentMode,
        composer: composer,
        setComposer: setComposer,
        commentBusy: commentBusy,
        setCommentBusy: setCommentBusy,
        commentError: commentError,
        setCommentError: setCommentError,
        gestureActive: gestureActive,
        setGestureActive: setGestureActive,
        treeOpen: treeOpen,
        setTreeOpen: setTreeOpen,
        inspectorOpen: inspectorOpen,
        setInspectorOpen: setInspectorOpen,
        docRef: docRef,
        versionRef: versionRef,
        cameraRef: cameraRef,
        panRef: panRef,
        spaceHeldRef: spaceHeldRef,
        imageInputRef: imageInputRef,
        imagePickSourceRef: imagePickSourceRef,
        selectedLayerIdRef: selectedLayerIdRef,
        selectedArtboardIdRef: selectedArtboardIdRef,
        gestureRef: gestureRef,
        treeRef: treeRef,
        inFlightRef: inFlightRef,
        lastLocalVersionRef: lastLocalVersionRef,
        statusTimerRef: statusTimerRef,
        disposedRef: disposedRef,
        mountReportedRef: mountReportedRef,
        fitPendingRef: fitPendingRef,
        canvasRef: canvasRef,
        appRef: appRef,
        canvasHoverRef: canvasHoverRef,
        historyRef: historyRef,
        applyingHistoryRef: applyingHistoryRef,
        nudgeRef: nudgeRef,
        applyDoc: applyDoc,
        applyDocLocal: applyDocLocal,
        patchLocalLayer: patchLocalLayer,
        canvasViewport: canvasViewport,
        screenToCanvas: screenToCanvas,
        projectToViewport: projectToViewport,
        setCameraValue: setCameraValue,
        zoomAboutViewportPoint: zoomAboutViewportPoint,
        zoomCameraBy: zoomCameraBy,
        computeFitCamera: computeFitCamera,
        fitCamera: fitCamera,
        runOps: runOps,
        retryNow: retryNow,
        historyState: historyState,
        pushHistoryEntry: pushHistoryEntry,
        dropHistoryEntry: dropHistoryEntry,
        commitWithHistory: commitWithHistory,
        inversePatchFor: inversePatchFor,
        insertOpsForSubtree: insertOpsForSubtree,
        inverseMoveToOps: inverseMoveToOps,
        undoOnce: undoOnce,
        redoOnce: redoOnce,
        selectLayer: selectLayer,
        selectArtboard: selectArtboard,
        clearSelection: clearSelection,
        openComposerFor: openComposerFor,
        commitLayer: commitLayer,
        commitArtboard: commitArtboard,
        updateLayer: updateLayer,
        renameLayer: renameLayer,
        renameArtboard: renameArtboard,
        reorderLayer: reorderLayer,
        toggleVisible: toggleVisible,
        deleteLayerById: deleteLayerById,
        deleteSelectedLayer: deleteSelectedLayer,
        moveSelected: moveSelected,
        opLayerForAdd: opLayerForAdd,
        addLayer: addLayer,
        cloneLayerSubtree: cloneLayerSubtree,
        duplicateSelected: duplicateSelected,
        nudgeSelected: nudgeSelected,
        flushNudge: flushNudge,
        commitShadow: commitShadow,
        clearShadow: clearShadow,
        reparentLayer: reparentLayer,
        currentFrameForLayout: currentFrameForLayout,
        setFrameAutoLayout: setFrameAutoLayout,
        patchFrameLayout: patchFrameLayout,
        addArtboard: addArtboard,
        deleteArtboard: deleteArtboard,
        setCommentStatus: setCommentStatus,
        deleteCommentById: deleteCommentById,
        sendCommentChat: sendCommentChat,
        submitComment: submitComment,
        // v2 batch API: one chat message for many comments (helper lives in 53-batch.js).
        submitComments: submitCommentsFor,
        gesturePatch: gesturePatch,
        beginGesture: beginGesture,
        layerPointerDown: layerPointerDown,
        handlePointerDown: handlePointerDown,
        computeReorderIndex: computeReorderIndex,
        artboardPointerDown: artboardPointerDown,
        gestureMove: gestureMove,
        releaseCapture: releaseCapture,
        gestureUp: gestureUp,
        gestureCancel: gestureCancel,
        isMiddlePointer: isMiddlePointer,
        beginPan: beginPan,
        releasePanCapture: releasePanCapture,
        canvasPointerDown: canvasPointerDown,
        canvasPointerMove: canvasPointerMove,
        endPan: endPan,
        canvasPointerUp: canvasPointerUp,
        canvasPointerCancel: canvasPointerCancel,
        cancelPan: cancelPan,
        holdSpace: holdSpace,
        releaseSpace: releaseSpace,
        openImagePicker: openImagePicker,
        placeImageInArtboard: placeImageInArtboard,
        replaceSelectedImage: replaceSelectedImage,
        applyImageFile: applyImageFile,
        handleImageFile: handleImageFile,
        onImageInputChange: onImageInputChange,
        canvasDragOver: canvasDragOver,
        canvasDragLeave: canvasDragLeave,
        canvasDrop: canvasDrop,
        tree: tree,
        selectedNode: selectedNode,
        selectedNodes: selectedNodes,
        // v2 selection / interaction surface (consumed by the shell, selection bar, renderer).
        selectLayers: selectLayers,
        selectAllInArtboard: selectAllInArtboard,
        drillIntoSelection: drillIntoSelection,
        drillIntoNode: drillIntoNode,
        stepSelectionOut: stepSelectionOut,
        toggleSnap: toggleSnap,
        groupSelection: groupSelection,
        ungroupSelection: ungroupSelection,
        alignSelection: alignSelection,
        distributeSelection: distributeSelection,
        tidySelection: tidySelection,
        arrangeSelection: arrangeSelection,
        reorderSelection: reorderSelection,
        reparentSelection: reparentSelection,
        toggleLock: toggleLock,
        copySelection: copySelection,
        cutSelection: cutSelection,
        pasteSelection: pasteSelection,
        addButtonPreset: addButtonPreset,
        rootSelectionIds: rootSelectionIds,
        selectionBounds: selectionBounds,
        selectionGroups: selectionGroups,
        reorderOpsToReach: reorderOpsToReach,
        marqueeSelectionIds: marqueeSelectionIds,
        beginMarquee: beginMarquee,
        cancelMarquee: cancelMarquee,
        applySelection: applySelection,
        nodeForLayer: nodeForLayer,
        selectionTargetForNode: selectionTargetForNode,
        gesturePatchEntries: gesturePatchEntries,
        scheduleGesturePreview: scheduleGesturePreview,
        flushGesturePreview: flushGesturePreview,
        cancelGestureFrame: cancelGestureFrame,
        gestureMembersFor: gestureMembersFor,
        applyAltDragDuplicate: applyAltDragDuplicate,
        writeClipboardText: writeClipboardText,
        readClipboardText: readClipboardText,
        parseClipboardPayload: parseClipboardPayload,
        insertPastedLayers: insertPastedLayers,
        pasteDestination: pasteDestination,
        patchDiff: patchDiff,
        siblingRangeIds: siblingRangeIds,
        siblingNodesOf: siblingNodesOf,
        selectionNodes: selectionNodes,
        artboardIdForLayer: artboardIdForLayer,
        clipboardRef: clipboardRef,
        marqueeRef: marqueeRef,
        gestureFrameRef: gestureFrameRef,
        selectedLayerIdsRef: selectedLayerIdsRef,
        drillGroupIdRef: drillGroupIdRef,
        snapEnabledRef: snapEnabledRef,
        lastLayerPointerRef: lastLayerPointerRef,
        snapGuidesArtboardId: snapGuidesArtboardId,
        commentIndex: commentIndex,
        selectedComments: selectedComments,
        layout: layout,
        composerPlacement: composerPlacement,
        handlers: handlers,
        statusLabels: statusLabels,
      }
    }
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

    function sessionIdOf(props) {
      if (!props) return ''
      if (typeof props.sessionId === 'string' && props.sessionId) return props.sessionId
      if (props.session && typeof props.session.id === 'string') return props.session.id
      return ''
    }

    function DesignCanvasBody(props) {
      const sessionId = sessionIdOf(props)
      const strings = currentStrings()
      try {
        if (!sessionId) {
          return h(
            'div',
            { className: 'dc-app' },
            h(StyleTag, { key: 'style' }),
            h(
              'div',
              { className: 'dc-center' },
              h(Glyph, { name: 'comment', size: 20 }),
              h('div', { className: 'dc-center-text' }, strings.noSession),
              h('div', { className: 'dc-center-hint' }, strings.noSessionHint),
            ),
          )
        }
        return h(
          CanvasErrorBoundary,
          { sessionId: sessionId, strings: strings },
          h(CanvasRoot, { sessionId: sessionId, strings: strings }),
        )
      } catch (error) {
        beacon('render-error', { message: shortError(error) })
        beacon('error', { message: shortError(error) })
        report({
          sessionId: sessionId,
          kind: 'error',
          message: 'body render failed: ' + messageOf(error).slice(0, 2000),
        })
        return h(
          'div',
          { className: 'dc-fallback' },
          h(StyleTag, { key: 'style' }),
          h('div', { className: 'dc-fallback-title' }, strings.renderFailed),
          h('div', { className: 'dc-fallback-text' }, messageOf(error)),
        )
      }
    }

    function ConversationCanvasButton() {
      const strings = currentStrings()
      function openCanvas() {
        try {
          const sidebarRight = runtime.sidebarRight
          if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
            beacon('open-tab-unavailable')
            return
          }
          sidebarRight.openTab(KIND)
          beacon('open-tab', { source: 'composer' })
        } catch (error) {
          beacon('open-tab-failed', { message: shortError(error) })
        }
      }
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-open-btn',
          title: strings.openCanvas,
          'aria-label': strings.openCanvas,
          onClick: openCanvas,
        },
        h(Glyph, { name: 'canvas', size: 14 }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Slot / tab registration helpers
     * ---------------------------------------------------------------------------------------- */

    function registerSlot(ctx, name, options, component, label) {
      try {
        if (ctx.slots && typeof ctx.slots.inject === 'function') {
          return ctx.slots.inject(name, function () {
            return ctx.slots.register(options, component)
          })
        }
        return ctx.effect(function () {
          return ctx.slots.register(options, component)
        }, label)
      } catch (error) {
        beacon('slot-register-failed', { name: name, message: shortError(error) })
        return function () {}
      }
    }

    /**
     * Open the canvas tab once per browser page lifetime, so the feature is discoverable
     * without the user hunting for the guide card. Deferred because the right sidebar and
     * the session store settle after this plugin activates.
     */
    function autoOpenOnce(ctx) {
      try {
        if (typeof sessionStorage === 'undefined') return
        if (sessionStorage.getItem(FEATURE_KEY)) return
        const sidebarRight = ctx.get('sidebarRight')
        if (!sidebarRight || typeof sidebarRight.openTab !== 'function') return
        const timer = setTimeout(function () {
          try {
            if (sessionStorage.getItem(FEATURE_KEY)) return
            sidebarRight.openTab(KIND)
            sessionStorage.setItem(FEATURE_KEY, '1')
            beacon('auto-opened', { kind: KIND })
          } catch (error) {
            beacon('auto-open-failed', { message: shortError(error) })
          }
        }, 1200)
        ctx.effect(function () {
          return function () {
            clearTimeout(timer)
          }
        }, 'design-canvas auto-open timer')
      } catch (error) {
        beacon('auto-open-setup-failed', { message: shortError(error) })
      }
    }

    /* ------------------------------------------------------------------------------------------
     * Internal test surface
     *
     * The browser half is one module scope with no exports, so `tests/client.test.mjs` needs a
     * deliberate handle to reach the pure helpers (layout math, doc helpers, code generators,
     * comment message builder). This is internal and unsupported: nothing in the plugin reads
     * it, and the public contract is the tab body + the Host API.
     * ---------------------------------------------------------------------------------------- */

    function testSurface() {
      const surface = {
        // document helpers
        isObject: isObject,
        finiteNumber: finiteNumber,
        clamp: clamp,
        roundTo: roundTo,
        findLayerById: findLayerById,
        docPatchLayer: docPatchLayer,
        docInsertLayer: docInsertLayer,
        docRemoveLayer: docRemoveLayer,
        docMoveLayer: docMoveLayer,
        docReorderLayer: docReorderLayer,
        countLayers: countLayers,
        // layout
        computeLayout: computeLayout,
        computeFrameChildBoxes: computeFrameChildBoxes,
        buildComputedTree: buildComputedTree,
        normalizeLayoutObject: normalizeLayoutObject,
        layoutSummaryText: layoutSummaryText,
        defaultLayoutObject: defaultLayoutObject,
        // defaults
        defaultGeometryFor: defaultGeometryFor,
        createLayer: createLayer,
        // camera
        defaultCamera: defaultCamera,
        normalizeCamera: normalizeCamera,
        // comments
        buildCommentMessage: buildCommentMessage,
        // copy/locale
        stringsFor: stringsFor,
        currentLocaleId: currentLocaleId,
        // extension registries
        EXTENSIONS: EXTENSIONS,
        registerToolbar: registerToolbar,
        registerAppPanel: registerAppPanel,
        registerInspectorSection: registerInspectorSection,
        registerSelectionTool: registerSelectionTool,
        registerKeyHandler: registerKeyHandler,
        registerCommand: registerCommand,
      }

      // Code generators are contributed by the export part (43-export-code.js). `typeof` keeps
      // this surface safe while that part is still a stub.
      surface.renderHtml = typeof renderHtml === 'function' ? renderHtml : null
      surface.renderReact = typeof renderReact === 'function' ? renderReact : null
      surface.renderSvg = typeof renderSvg === 'function' ? renderSvg : null
      surface.renderJson = typeof renderJson === 'function' ? renderJson : null
      surface.renderPngDataUrl = typeof renderPngDataUrl === 'function' ? renderPngDataUrl : null
      surface.exportOptions = typeof resolveExportOptions === 'function' ? resolveExportOptions : null
      surface.renderExport = typeof renderExport === 'function' ? renderExport : null
      surface.exportFileInfo = typeof exportFileInfo === 'function' ? exportFileInfo : null
      surface.sanitizeFileName = typeof sanitizeFileName === 'function' ? sanitizeFileName : null
      return surface
    }

    /* ------------------------------------------------------------------------------------------
     * Plugin definition
     * ---------------------------------------------------------------------------------------- */

    return {
      // Wait for the client services read below; otherwise apply() can run before
      // the sidebar/session/locale providers mount and every ctx.get() is undefined.
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'locale'],
      __test: testSurface,
      apply(ctx) {
        beacon('apply-start')
        const tabs = ctx.get('sidebarRightTabs')
        const sidebarRight = ctx.get('sidebarRight')
        const sessions = ctx.get('sessions')
        const locale = ctx.get('locale')
        const services = {
          sidebarRightTabs: Boolean(tabs),
          sidebarRight: Boolean(sidebarRight),
          sessions: Boolean(sessions),
          locale: Boolean(locale),
        }
        runtime.services = services
        runtime.sidebarRight = sidebarRight || null
        runtime.sessions = sessions || null
        runtime.locale = locale || null
        beacon('services', services)

        try {
          registerSlot(
            ctx,
            'sidebar.right.pane.tab',
            { name: 'sidebar.right.pane.tab', key: PLUGIN_ID },
            DesignCanvasBody,
            'design-canvas tab body',
          )
          beacon('body-registered')

          if (tabs && typeof tabs.register === 'function') {
            try {
              ctx.effect(function () {
                return tabs.register({
                  id: PLUGIN_ID,
                  kind: KIND,
                  title: function () {
                    // The tab shows the design (project) name once a document has loaded, so
                    // renaming the project renames the panel too.
                    const designName = runtime.designName
                    if (designName) return designName
                    return stringsFor(currentLocaleId()).pluginTitle
                  },
                  guide: [
                    {
                      id: KIND,
                      title: stringsFor(currentLocaleId()).guideTitle,
                      description: stringsFor(currentLocaleId()).guideDescription,
                    },
                  ],
                })
              }, 'design-canvas tab type')
              beacon('tabs-registered')
            } catch (error) {
              beacon('tabs-failed', { message: shortError(error) })
            }
          } else {
            beacon('tabs-unavailable')
          }

          registerSlot(
            ctx,
            'conversation.input.left',
            { name: 'conversation.input.left', id: 'design-canvas-open' },
            ConversationCanvasButton,
            'design-canvas composer button',
          )

          beacon('apply-ok', services)
          report({ sessionId: '', kind: 'boot', services: services })
          autoOpenOnce(ctx)
        } catch (error) {
          beacon('apply-failed', { message: shortError(error) })
          try {
            report({
              sessionId: '',
              kind: 'error',
              message: 'plugin apply failed: ' + messageOf(error).slice(0, 2000),
            })
          } catch (ignored) {
            /* diagnostics must never mask the real failure */
          }
          throw error
        }
      },
    }
  },
})
