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

    /** Children array of any container: an artboard (`layers`) or a frame (`children`). */
    function childrenOf(container) {
      if (!isObject(container)) return []
      if (container.type === 'frame') {
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
        if (layer.type === 'frame') {
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

    function collectLayerIds(layer, target) {
      if (!isObject(layer) || !(target instanceof Set)) return target
      if (typeof layer.id === 'string' && layer.id) target.add(layer.id)
      if (layer.type === 'frame') {
        const kids = childrenOf(layer)
        for (let index = 0; index < kids.length; index += 1) collectLayerIds(kids[index], target)
      }
      return target
    }

    function subtreeContains(layer, layerId) {
      if (!isObject(layer) || typeof layerId !== 'string' || !layerId) return false
      if (layer.id === layerId) return true
      if (layer.type !== 'frame') return false
      const kids = childrenOf(layer)
      for (let index = 0; index < kids.length; index += 1) {
        if (subtreeContains(kids[index], layerId)) return true
      }
      return false
    }

    /** Nested-frame height of a subtree (a leaf layer is 1, matching Host depth rules). */
    function subtreeHeight(layer) {
      if (!isObject(layer) || layer.type !== 'frame') return 1
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
          if (layer.type === 'frame') countList(childrenOf(layer))
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
        if (result.type === 'frame') {
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
        if (layer.type === 'frame') {
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

    function defaultLayoutObject() {
      return {
        direction: 'row',
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        align: 'stretch',
        justify: 'start',
        wrap: false,
      }
    }

    /** Normalize a stored layout into a complete object (Host fills defaults; be defensive). */
    function normalizeLayoutObject(layout) {
      if (!isObject(layout)) return null
      const base = defaultLayoutObject()
      const rawPadding = isObject(layout.padding) ? layout.padding : {}
      const padding = {}
      for (let index = 0; index < PADDING_SIDES.length; index += 1) {
        const side = PADDING_SIDES[index]
        padding[side] = Math.max(0, finiteNumber(rawPadding[side], 0))
      }
      return {
        direction: LAYOUT_DIRECTIONS.indexOf(layout.direction) >= 0 ? layout.direction : base.direction,
        gap: Math.max(0, finiteNumber(layout.gap, base.gap)),
        padding: padding,
        align: LAYOUT_ALIGNS.indexOf(layout.align) >= 0 ? layout.align : base.align,
        justify: LAYOUT_JUSTIFIES.indexOf(layout.justify) >= 0 ? layout.justify : base.justify,
        wrap: layout.wrap === true,
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
      return (
        'layout=' +
        normalized.direction +
        ' gap=' +
        roundTo(normalized.gap, 2) +
        ' pad=' +
        paddingSummary(normalized.padding) +
        ' align=' +
        normalized.align +
        ' justify=' +
        normalized.justify +
        (normalized.wrap ? ' wrap' : '')
      )
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

      const items = []
      const list = Array.isArray(children) ? children : []
      for (let index = 0; index < list.length; index += 1) {
        const layer = list[index]
        // Hidden layers behave like display:none: they neither render nor take layout space.
        if (!isObject(layer) || layer.visible === false) continue
        const baseWidth = Math.max(1, finiteNumber(layer.width, CHILD_DEFAULT_WIDTH))
        const baseHeight = Math.max(1, finiteNumber(layer.height, CHILD_DEFAULT_HEIGHT))
        items.push({
          layer: layer,
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
          const needed = run.usedMain + layout.gap + item.baseMain
          if (needed > contentMain) {
            runs.push(run)
            run = null
          }
        }
        if (!run) run = { items: [], usedMain: 0 }
        if (run.items.length > 0) run.usedMain += layout.gap
        run.usedMain += item.baseMain
        run.items.push(item)
      }
      if (run && run.items.length > 0) runs.push(run)
      const boxes = new Map()
      if (runs.length === 0) return boxes

      // A single line fills the container's cross axis (CSS single-line flexbox behaviour);
      // wrapped lines keep their own cross size (tallest child of the line).
      const singleLine = runs.length === 1

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        const count = current.items.length
        const gapTotal = layout.gap * Math.max(0, count - 1)
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
            growItems[growIndex].main = growItems[growIndex].baseMain + share
          }
        }
        current.usedMain =
          current.items.reduce(function (sum, item) {
            return sum + item.main
          }, 0) + gapTotal
        const leftover = Math.max(0, contentMain - current.usedMain)
        current.startOffset =
          layout.justify === 'center' ? leftover / 2 : layout.justify === 'end' ? leftover : 0
        current.extraGap =
          layout.justify === 'space-between' && count > 1 ? leftover / (count - 1) : 0
        let tallest = 0
        for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
          tallest = Math.max(tallest, current.items[itemIndex].baseCross)
        }
        current.crossSize = singleLine ? contentCross : Math.max(1, tallest)
      }

      let crossCursor = 0
      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const current = runs[runIndex]
        let mainCursor = current.startOffset
        for (let itemIndex = 0; itemIndex < current.items.length; itemIndex += 1) {
          const item = current.items[itemIndex]
          const alignSelfRaw = item.layer.alignSelf
          const crossAlign =
            LAYOUT_ALIGNS.indexOf(alignSelfRaw) >= 0 ? alignSelfRaw : layout.align
          const crossSize = crossAlign === 'stretch' ? current.crossSize : item.baseCross
          let crossOffset = 0
          if (crossAlign === 'center') crossOffset = (current.crossSize - crossSize) / 2
          else if (crossAlign === 'end') crossOffset = current.crossSize - crossSize
          boxes.set(item.layer, {
            x: isRow ? pad.left + mainCursor : pad.left + crossCursor + crossOffset,
            y: isRow ? pad.top + crossCursor + crossOffset : pad.top + mainCursor,
            width: isRow ? item.main : crossSize,
            height: isRow ? crossSize : item.main,
          })
          mainCursor += item.main + layout.gap + current.extraGap
        }
        crossCursor += current.crossSize + layout.gap
      }
      return boxes
    }

    /**
     * One immutable snapshot of the rendered document:
     *   { artboards: [{ artboard, layers: nodes }], byId: Map<layerId, node>, allNodes: node[] }
     * A node is { id, layer, type, artboard, parent, parentId, index, depth, x, y, width,
     * height, worldRect, autoParent, children }. x/y are relative to the parent (computed for
     * auto-layout children); worldRect is relative to the artboard's top-left.
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
          const offsetX = box ? finiteNumber(box.x, 0) : finiteNumber(layer.x, 0)
          const offsetY = box ? finiteNumber(box.y, 0) : finiteNumber(layer.y, 0)
          const width = Math.max(1, finiteNumber(box ? box.width : layer.width, 1))
          const height = Math.max(1, finiteNumber(box ? box.height : layer.height, 1))
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
            children: null,
          }
          byId.set(node.id, node)
          allNodes.push(node)
          if (layer.type === 'frame') {
            const layout = normalizeLayoutObject(layer.layout)
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
     * Layer defaults
     * ---------------------------------------------------------------------------------------- */

    const LAYER_TYPE_LABELS = {
      rect: 'rect',
      ellipse: 'ellipse',
      text: 'text',
      image: 'image',
      frame: 'frame',
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
      } else if (type === 'frame') {
        base.fill = '#f3f4f6'
        base.radius = 8
        base.borderWidth = 1
        base.borderColor = '#d1d5db'
        base.clip = false
        base.layout = null
        base.children = []
      }
      return base
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
     * Chat message for an element comment
     * ---------------------------------------------------------------------------------------- */

    function compactLayerProps(layer) {
      try {
        const json = JSON.stringify(layer)
        return json.length > 1200 ? json.slice(0, 1197) + '...' : json
      } catch (error) {
        return '{}'
      }
    }

    function buildCommentMessage(details, strings) {
      const layer = details.layer
      const artboard = details.artboard
      const lines = ['Design canvas revision request — apply it now.', '']
      lines.push(
        'Board: ' +
          (details.boardPath || 'design-board.json') +
          (details.version ? ' (version ' + details.version + ')' : ''),
      )
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
      }
      if (layer) {
        lines.push(
          'Target layer: "' +
            (layer.name || layer.id) +
            '" (' +
            layer.id +
            '), type ' +
            String(layer.type),
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
        if (typeof details.parentId === 'string' && details.parentId) {
          lines.push('Parent: frame "' + details.parentId + '" (nested layer)')
        }
        if (isObject(details.renderedRect)) {
          lines.push(
            'Rendered rect (relative to artboard): x=' +
              Math.round(finiteNumber(details.renderedRect.x, 0)) +
              ' y=' +
              Math.round(finiteNumber(details.renderedRect.y, 0)) +
              ' width=' +
              Math.round(finiteNumber(details.renderedRect.width, 0)) +
              ' height=' +
              Math.round(finiteNumber(details.renderedRect.height, 0)),
          )
        }
        if (layer.type === 'frame') {
          lines.push('Frame layout: ' + layoutSummaryText(layer.layout))
        }
        lines.push('Current props: ' + compactLayerProps(layer))
      }
      if (details.commentId) lines.push('Comment id: ' + details.commentId + ' (status open)')
      lines.push('Comment: ' + details.text)
      lines.push('')
      lines.push('How to handle this — decide and act, do not ask clarifying questions:')
      lines.push(
        '1. Skip design_read when the props above are enough; otherwise call it once with include:"summary".',
      )
      lines.push(
        '2. design_apply the minimal ops that satisfy the comment (prefer layer.update for styling, layer.add for new elements); leave unrelated layers untouched and keep everything inside the artboard.',
      )
      lines.push(
        '3. design_apply a comment.update with commentId "' +
          String(details.commentId || '') +
          '" and status "resolved".',
      )
      lines.push(
        '4. Reply with one short sentence describing the change. Prefer a reasonable interpretation over asking for clarification.',
      )
      return lines.join('\n')
    }

    /* ------------------------------------------------------------------------------------------
     * Glyphs (inline SVG, 16×16 stroke set)
     * ---------------------------------------------------------------------------------------- */

    const ICON_PATHS = {
      plus: ['M8 3v10', 'M3 8h10'],
      minus: ['M3 8h10'],
      fit: ['M3 6V3h3', 'M13 6V3h-3', 'M3 10v3h3', 'M13 10v3h-3'],
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
      send: ['M14 2L2 7l4.5 2L9 13.5 14 2z', 'M6.5 9L14 2'],
      retry: ['M12.5 8a4.5 4.5 0 1 1-1.6-3.4', 'M12.5 3v3h-3'],
      dot: ['M8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
    }

    function Glyph(props) {
      const spec = ICON_PATHS[props.name] || ICON_PATHS.dot
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
        spec.map(function (path, index) {
          return h('path', { key: index, d: path })
        }),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Styles (chrome only; theme tokens only)
     * ---------------------------------------------------------------------------------------- */

    const CSS_TEXT = `
.dc-app { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; font-size: 12px; line-height: 1.3; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); overflow: hidden; }
.dc-app * { box-sizing: border-box; }
.dc-header { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-width: 0; padding: 5px 8px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-head-main { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; overflow: hidden; }
.dc-board { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.dc-version { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 0 4px; }
.dc-status { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: var(--dsw-alias-state-idle-primary); }
.dc-dot-synced { background: var(--dsw-alias-state-success-primary); }
.dc-dot-saving { background: var(--dsw-alias-state-warn-primary); }
.dc-dot-offline { background: var(--dsw-alias-state-error-primary); }
.dc-dot-revising { background: var(--dsw-alias-brand-primary); }
.dc-retry { border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 10px; cursor: pointer; padding: 0 2px; text-decoration: underline; }
.dc-head-actions { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.dc-zoom-group { display: inline-flex; align-items: center; gap: 1px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px; background: var(--dsw-alias-bg-base); }
.dc-zoom-label { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; min-width: 30px; padding: 1px 2px; cursor: pointer; font-variant-numeric: tabular-nums; }
.dc-zoom-label:hover { color: var(--dsw-alias-label-primary); }
.dc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; flex: 0 0 auto; padding: 3px 8px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-tool-group { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
.dc-spacer { flex: 1 1 auto; }
.dc-tool { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.dc-tool:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tool.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-border-l1); }
.dc-tool:disabled { opacity: 0.4; cursor: default; }
.dc-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-ibtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-ibtn.dc-active { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dc-ibtn:disabled { opacity: 0.4; cursor: default; }
.dc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.dc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-btn-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-bg-base); font-weight: 600; }
.dc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.88; }
.dc-btn-wide { width: 100%; }
.dc-banner { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 3px 8px; font-size: 11px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-banner-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-banner-close { border: none; background: transparent; color: inherit; cursor: pointer; padding: 0 2px; }
.dc-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dc-left { display: flex; flex-direction: column; flex: 0 0 150px; width: 150px; min-height: 0; background: var(--dsw-alias-bg-layer-1); border-right: 1px solid var(--dsw-alias-border-l1); }
.dc-right { display: flex; flex-direction: column; flex: 0 0 172px; width: 172px; min-height: 0; background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--dsw-alias-border-l1); overflow: auto; }
.dc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex: 0 0 auto; padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); }
.dc-tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 3px; display: flex; flex-direction: column; gap: 1px; }
.dc-tree-group { display: flex; flex-direction: column; gap: 1px; margin-bottom: 4px; }
.dc-tree-ab { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; cursor: pointer; text-align: left; }
.dc-tree-ab:hover { background: var(--dsw-alias-bg-layer-2); }
.dc-tree-ab.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tree-row { display: flex; align-items: center; gap: 3px; padding: 2px 3px 2px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dc-tree-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dc-tree-row.dc-sel { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-tree-row.dc-drop-into, .dc-tree-ab.dc-drop-into { outline: 1px dashed var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dc-tree-caret { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 14px; height: 14px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-tree-caret:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dc-tree-caret:disabled { opacity: 0.3; cursor: default; }
.dc-layer-frame { overflow: visible; }
.dc-layer-auto { cursor: grab; }
.dc-geo-note { font-size: 10px; line-height: 1.35; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dc-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-tree-meta { flex: 0 0 auto; font-size: 9px; color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dc-tree-type { display: inline-flex; flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dc-eye { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dc-eye:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dc-eye.dc-off { opacity: 0.45; }
.dc-badge { flex: 0 0 auto; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-bg-base); font-size: 9px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.dc-panel-foot { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 3px 4px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dc-muted { color: var(--dsw-alias-label-secondary); font-size: 11px; opacity: 0.85; }
.dc-pad { padding: 8px; }
.dc-canvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); touch-action: none; }
.dc-canvas.dc-gesture-active { user-select: none; }
.dc-canvas.dc-space-pan { cursor: grab; }
.dc-canvas.dc-panning { cursor: grabbing; user-select: none; }
.dc-canvas.dc-drag-over { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -3px; }
.dc-stage { position: absolute; left: 0; top: 0; min-width: 0; min-height: 0; transform-origin: 0 0; will-change: transform; pointer-events: none; }
.dc-board-wrap { position: absolute; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.dc-file-input { display: none; }
.dc-board-label { display: flex; align-items: baseline; gap: 8px; padding: 0 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dc-board-name { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dc-board-size { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dc-board-frame { position: relative; background: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--dsw-alias-border-l1); }
.dc-board-frame.dc-board-frame-selected { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14), 0 0 0 1px var(--dsw-alias-brand-primary); }
.dc-board-inner { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.dc-layer { position: absolute; margin: 0; padding: 0; overflow: hidden; user-select: none; }
.dc-layer-text { display: block; overflow: hidden; word-break: break-word; white-space: pre-wrap; }
.dc-comment-mode .dc-layer { cursor: crosshair; }
.dc-gesture-active .dc-layer { cursor: default; }
.dc-sel-box { position: absolute; z-index: 20; box-sizing: border-box; border: 1px solid var(--dsw-alias-brand-primary); pointer-events: none; }
.dc-sel-handle { position: absolute; z-index: 21; width: 8px; height: 8px; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-brand-primary); border-radius: 2px; pointer-events: auto; }
.dc-pin { position: absolute; z-index: 25; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 1px solid var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-size: 10px; font-weight: 700; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box; }
.dc-pin:hover { opacity: 0.9; }
.dc-composer { position: absolute; z-index: 40; width: 260px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.dc-composer-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-composer-error { font-size: 10px; color: var(--dsw-alias-state-error-primary); }
.dc-composer-actions { display: flex; justify-content: flex-end; gap: 4px; }
.dc-textarea { width: 100%; min-height: 56px; resize: vertical; padding: 4px 5px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; box-sizing: border-box; }
.dc-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dc-section { display: flex; flex-direction: column; gap: 5px; padding: 6px 7px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dc-section-title { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dsw-alias-label-secondary); }
.dc-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.dc-field { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1 1 auto; }
.dc-field-col { flex-direction: column; align-items: stretch; gap: 3px; }
.dc-field-label { flex: 0 0 auto; min-width: 12px; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dc-input { width: 100%; min-width: 0; height: 20px; padding: 0 4px; font: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; box-sizing: border-box; }
.dc-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dc-input::-webkit-outer-spin-button, .dc-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dc-num { text-align: right; }
.dc-select { padding-right: 2px; }
.dc-swatch { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; background: transparent; cursor: pointer; }
.dc-swatch::-webkit-color-swatch-wrapper { padding: 1px; }
.dc-swatch::-webkit-color-swatch { border: none; border-radius: 2px; }
.dc-seg { display: flex; flex: 1 1 auto; min-width: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; }
.dc-seg-btn { flex: 1 1 0; min-width: 0; height: 19px; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; }
.dc-seg-btn.dc-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dc-comment { display: flex; flex-direction: column; gap: 3px; padding: 4px 5px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); }
.dc-comment.dc-resolved { opacity: 0.6; }
.dc-comment-text { font-size: 11px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word; }
.dc-comment-meta { display: flex; align-items: center; gap: 5px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.dc-comment-status { text-transform: uppercase; letter-spacing: 0.04em; }
.dc-comment-actions { display: flex; align-items: center; gap: 6px; }
.dc-link { padding: 0; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 10px; cursor: pointer; }
.dc-link:hover { text-decoration: underline; }
.dc-link.dc-danger { color: var(--dsw-alias-state-error-primary); }
.dc-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px; text-align: center; }
.dc-center-text { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); max-width: 260px; overflow-wrap: anywhere; }
.dc-center-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 260px; overflow-wrap: anywhere; }
.dc-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: dc-spin 0.9s linear infinite; }
@keyframes dc-spin { to { transform: rotate(360deg); } }
.dc-fallback { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; height: 100%; padding: 16px; box-sizing: border-box; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.dc-fallback-title { font-size: 13px; font-weight: 600; }
.dc-fallback-text { font-size: 11px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.dc-open-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dc-open-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dc-open-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

    function StyleTag() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS_TEXT } })
    }

    /* ------------------------------------------------------------------------------------------
     * Small UI primitives
     * ---------------------------------------------------------------------------------------- */

    function IconButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-ibtn' + (props.active ? ' dc-active' : ''),
          title: props.title,
          'aria-label': props.title,
          disabled: !!props.disabled,
          onClick: props.onClick,
          onPointerDown: props.onPointerDown,
        },
        props.children || h(Glyph, { name: props.icon, size: props.size || 14 }),
      )
    }

    function ToolButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dc-tool' + (props.active ? ' dc-active' : ''),
          title: props.title || props.label,
          'aria-label': props.title || props.label,
          disabled: !!props.disabled,
          onClick: props.onClick,
        },
        props.icon ? h(Glyph, { name: props.icon, size: 12 }) : null,
        props.label ? h('span', null, props.label) : null,
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
          { className: 'dc-seg' },
          (props.options || []).map(function (option) {
            return h(
              'button',
              {
                key: option.value,
                type: 'button',
                title: option.title || option.label,
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
     * Layer tree
     * ---------------------------------------------------------------------------------------- */

    function LayerTree(props) {
      const strings = props.strings
      const tree = props.tree
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const openCounts = props.openCounts
      const actions = props.actions
      const computedArtboards = tree && Array.isArray(tree.artboards) ? tree.artboards : []
      const collapsedState = React.useState({})
      const collapsed = collapsedState[0]
      const setCollapsed = collapsedState[1]
      const dropState = React.useState(null)
      const dropTarget = dropState[0]
      const setDropTarget = dropState[1]
      const dragRef = React.useRef(null)

      function toggleCollapsed(layerId) {
        setCollapsed(function (previous) {
          const next = Object.assign({}, previous)
          next[layerId] = previous[layerId] !== true
          return next
        })
      }

      function handleDragStart(layerId, event) {
        dragRef.current = layerId
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
        setDropTarget(null)
      }

      function stopEvent(event) {
        try {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
      }

      function dragOverTarget(token, event) {
        stopEvent(event)
        try {
          if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        } catch (error) {
          /* ignore */
        }
        if (dragRef.current) {
          setDropTarget(function (previous) {
            return previous === token ? previous : token
          })
        }
      }

      function dropIntoFrame(frameId, event) {
        stopEvent(event)
        const dragged = dragRef.current
        clearDrag()
        if (dragged && dragged !== frameId) actions.reparent(dragged, { parentId: frameId })
      }

      function dropIntoArtboard(artboardId, event) {
        stopEvent(event)
        const dragged = dragRef.current
        clearDrag()
        if (dragged) actions.reparent(dragged, { artboardId: artboardId })
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
        const layer = node.layer
        const isFrame = layer.type === 'frame'
        const childNodes = Array.isArray(node.children) ? node.children : []
        const hasChildren = isFrame && childNodes.length > 0
        const open = collapsed[layer.id] !== true
        const count = openCounts.get(layer.id) || 0
        const isSelected = selectedLayerId === layer.id
        const isDropTarget = dropTarget === 'frame:' + layer.id
        const row = h(
          'div',
          {
            key: String(layer.id),
            className:
              'dc-tree-row' + (isSelected ? ' dc-sel' : '') + (isDropTarget ? ' dc-drop-into' : ''),
            style: { paddingLeft: 6 + depth * 12 },
            title: layer.name || layer.id,
            draggable: true,
            'data-layer-id': layer.id,
            onDragStart: function (event) {
              handleDragStart(layer.id, event)
            },
            onDragEnd: clearDrag,
            onDragOver: isFrame
              ? function (event) {
                  dragOverTarget('frame:' + layer.id, event)
                }
              : undefined,
            onDragLeave: isFrame
              ? function () {
                  setDropTarget(function (previous) {
                    return previous === 'frame:' + layer.id ? null : previous
                  })
                }
              : undefined,
            onDrop: isFrame
              ? function (event) {
                  dropIntoFrame(layer.id, event)
                }
              : undefined,
            onClick: function () {
              actions.selectLayer(layer.id, node.artboard.id)
            },
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dc-tree-caret',
              disabled: !hasChildren,
              title: hasChildren ? (open ? strings.collapse : strings.expand) : '',
              'aria-label': hasChildren ? (open ? strings.collapse : strings.expand) : layer.name || '',
              onClick: function (event) {
                event.stopPropagation()
                if (hasChildren) toggleCollapsed(layer.id)
              },
            },
            h(Glyph, { name: hasChildren && open ? 'chevronDown' : 'chevronRight', size: 10 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-eye' + (layer.visible === false ? ' dc-off' : ''),
              title: layer.visible === false ? strings.show : strings.hide,
              'aria-label': layer.name || layer.id,
              onClick: function (event) {
                event.stopPropagation()
                actions.toggleVisible(layer.id)
              },
            },
            h(Glyph, {
              name: layer.visible === false ? 'eyeOff' : 'eye',
              size: 11,
            }),
          ),
          h(
            'span',
            { className: 'dc-tree-type' },
            h(Glyph, { name: layerTypeLabel(layer.type), size: 10 }),
          ),
          h(
            'span',
            { className: 'dc-tree-name' },
            layer.name || layerFactoryName(layer.type),
          ),
          count > 0
            ? h('span', { className: 'dc-badge', title: strings.comments }, String(count))
            : null,
        )
        const rows = [row]
        if (hasChildren && open) rows.push(renderLayerRows(childNodes, depth + 1))
        return rows
      }

      return h(
        'aside',
        { className: 'dc-left', 'aria-label': strings.layers },
        h(
          'div',
          { className: 'dc-panel-head' },
          h('span', null, strings.layers),
          h(IconButton, {
            title: strings.hide,
            icon: 'chevronLeft',
            size: 12,
            onClick: actions.toggleTree,
          }),
        ),
        h(
          'div',
          { className: 'dc-tree' },
          computedArtboards.length === 0
            ? h('div', { className: 'dc-muted dc-pad' }, strings.noArtboards)
            : computedArtboards.map(function (entry) {
                const artboard = entry.artboard
                const artboardSelected = !selectedLayerId && selectedArtboardId === artboard.id
                const isDropTarget = dropTarget === 'artboard:' + artboard.id
                return h(
                  'div',
                  { className: 'dc-tree-group', key: String(artboard.id) },
                  h(
                    'button',
                    {
                      type: 'button',
                      className:
                        'dc-tree-ab' +
                        (artboardSelected ? ' dc-sel' : '') +
                        (isDropTarget ? ' dc-drop-into' : ''),
                      title: artboard.name || artboard.id,
                      'data-artboard-id': artboard.id,
                      onClick: function () {
                        actions.selectArtboard(artboard.id)
                      },
                      onDragOver: function (event) {
                        dragOverTarget('artboard:' + artboard.id, event)
                      },
                      onDragLeave: function () {
                        setDropTarget(function (previous) {
                          return previous === 'artboard:' + artboard.id ? null : previous
                        })
                      },
                      onDrop: function (event) {
                        dropIntoArtboard(artboard.id, event)
                      },
                    },
                    h(Glyph, { name: 'frame', size: 11 }),
                    h('span', { className: 'dc-tree-name' }, artboard.name || artboard.id),
                    h('span', { className: 'dc-tree-meta' }, String(layersOf(artboard).length)),
                  ),
                  renderLayerRows(entry.layers, 0),
                )
              }),
        ),
        h(
          'div',
          { className: 'dc-panel-foot' },
          h(IconButton, {
            title: strings.moveUp,
            icon: 'up',
            size: 13,
            disabled: !selectedLayerId,
            onClick: function () {
              actions.moveSelected('up')
            },
          }),
          h(IconButton, {
            title: strings.moveDown,
            icon: 'down',
            size: 13,
            disabled: !selectedLayerId,
            onClick: function () {
              actions.moveSelected('down')
            },
          }),
          h(IconButton, {
            title: strings.delete,
            icon: 'trash',
            size: 13,
            disabled: !selectedLayerId,
            onClick: actions.deleteSelected,
          }),
        ),
      )
    }

    function layerFactoryName(type) {
      if (type === 'rect') return 'Rectangle'
      if (type === 'ellipse') return 'Ellipse'
      if (type === 'text') return 'Text'
      if (type === 'image') return 'Image'
      if (type === 'frame') return 'Frame'
      return 'Layer'
    }

    /* ------------------------------------------------------------------------------------------
     * Inspector
     * ---------------------------------------------------------------------------------------- */

    function CommentThread(props) {
      const strings = props.strings
      const comments = props.comments
      const actions = props.actions
      const openCount = comments.filter(function (comment) {
        return comment && comment.status !== 'resolved'
      }).length
      return h(
        'div',
        { className: 'dc-section' },
        h(
          'div',
          { className: 'dc-section-title' },
          strings.comments + ' (' + openCount + '/' + comments.length + ')',
        ),
        comments.length === 0
          ? h('div', { className: 'dc-muted' }, strings.noComments)
          : comments.map(function (comment) {
              if (!isObject(comment)) return null
              const resolved = comment.status === 'resolved'
              return h(
                'div',
                { key: String(comment.id), className: 'dc-comment' + (resolved ? ' dc-resolved' : '') },
                h('div', { className: 'dc-comment-text' }, comment.text || ''),
                h(
                  'div',
                  { className: 'dc-comment-meta' },
                  h('span', { className: 'dc-comment-status' }, resolved ? strings.resolved : strings.open),
                  comment.author ? h('span', null, comment.author) : null,
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
                            actions.reopenComment(comment.id)
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
                            actions.resolveComment(comment.id)
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
                      onClick: function () {
                        actions.deleteComment(comment.id)
                      },
                    },
                    strings.delete,
                  ),
                ),
              )
            }),
        props.canAdd
          ? h(
              'button',
              { type: 'button', className: 'dc-btn dc-btn-wide', onClick: actions.openComposer },
              strings.addComment,
            )
          : null,
      )
    }

    function Inspector(props) {
      const strings = props.strings
      const doc = props.doc
      const tree = props.tree
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const comments = props.comments
      const actions = props.actions
      const found = selectedLayerId ? findLayerById(doc, selectedLayerId) : null
      const layer = found ? found.layer : null
      const selectedNode =
        selectedLayerId && tree && tree.byId ? tree.byId.get(selectedLayerId) || null : null
      const artboard = found
        ? found.artboard
        : selectedArtboardId
          ? findArtboardById(doc, selectedArtboardId)
          : null

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
      ]
      const onOffOptions = [
        { value: false, label: strings.off },
        { value: true, label: strings.on },
      ]
      const alignSelfOptions = [
        { value: 'inherit', label: strings.inherit },
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
      ]

      function buildParentOptions() {
        const options = []
        if (!tree || !Array.isArray(tree.artboards)) return options
        function pushFrames(nodes, depth) {
          if (!Array.isArray(nodes)) return
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            if (!node || !node.layer || node.layer.type !== 'frame') continue
            if (layer) {
              if (node.id === layer.id) continue
              if (layer.type === 'frame' && subtreeContains(layer, node.id)) continue
            }
            options.push({
              value: 'frame:' + node.id,
              label:
                (depth > 0 ? '· '.repeat(depth) : '') +
                (node.layer.name || node.layer.id),
            })
            pushFrames(node.children, depth + 1)
          }
        }
        tree.artboards.forEach(function (entry) {
          options.push({
            value: 'artboard:' + entry.artboard.id,
            label: entry.artboard.name || entry.artboard.id,
          })
          pushFrames(entry.layers, 1)
        })
        return options
      }

      function handleMoveInto(value) {
        const token = String(value || '')
        if (token.indexOf('frame:') === 0) {
          actions.reparent(layer.id, { parentId: token.slice(6) })
        } else if (token.indexOf('artboard:') === 0) {
          actions.reparent(layer.id, { artboardId: token.slice(9) })
        }
      }

      const parentToken = found
        ? found.parentId
          ? 'frame:' + found.parentId
          : 'artboard:' + found.artboard.id
        : ''

      const header = h(
        'div',
        { className: 'dc-panel-head' },
        h('span', null, layer ? strings.layer : artboard ? strings.artboard : strings.inspector),
        h(IconButton, {
          title: strings.hide,
          icon: 'chevronRight',
          size: 12,
          onClick: actions.toggleInspector,
        }),
      )

      if (!layer && !artboard) {
        return h(
          'aside',
          { className: 'dc-right', 'aria-label': strings.inspector },
          header,
          h(
            'div',
            { className: 'dc-section' },
            h('div', { className: 'dc-muted' }, strings.selectHint),
          ),
        )
      }

      if (!layer) {
        return h(
          'aside',
          { className: 'dc-right', 'aria-label': strings.inspector },
          header,
          h(
            'div',
            { className: 'dc-section' },
            h('div', { className: 'dc-section-title' }, strings.artboard),
            h(TextField, {
              label: strings.name,
              value: artboard.name || '',
              onCommit: function (value) {
                actions.commitArtboard({ name: value })
              },
            }),
            h(
              'div',
              { className: 'dc-row' },
              h('span', { className: 'dc-field-label' }, artboard.id || ''),
            ),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.width,
                value: finiteNumber(artboard.width, 1),
                min: 1,
                onCommit: function (value) {
                  actions.commitArtboard({ width: value })
                },
              }),
              h(NumField, {
                label: strings.height,
                value: finiteNumber(artboard.height, 1),
                min: 1,
                onCommit: function (value) {
                  actions.commitArtboard({ height: value })
                },
              }),
            ),
            h(SwatchField, {
              label: strings.background,
              value: artboard.background || '#ffffff',
              onCommit: function (value) {
                actions.commitArtboard({ background: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
          ),
        )
      }

      const sections = []
      sections.push(
        h(
          'div',
          { className: 'dc-section', key: 'element' },
          h('div', { className: 'dc-section-title' }, strings.element),
          h(
            'div',
            { className: 'dc-row', title: layer.id },
            h(Glyph, { name: layerTypeLabel(layer.type), size: 12 }),
            h(
              'span',
              { className: 'dc-muted' },
              layerFactoryName(layer.type) + ' · ' + String(layer.id),
            ),
          ),
          h(TextField, {
            label: strings.name,
            value: layer.name || '',
            onCommit: function (value) {
              actions.commitLayer({ name: value })
            },
          }),
          selectedNode && selectedNode.autoParent
            ? h(
                'div',
                { className: 'dc-geo-note' },
                strings.derivedGeometry +
                  ': x=' +
                  Math.round(selectedNode.x) +
                  ' y=' +
                  Math.round(selectedNode.y) +
                  ' w=' +
                  Math.round(selectedNode.width) +
                  ' h=' +
                  Math.round(selectedNode.height),
              )
            : null,
          selectedNode && selectedNode.autoParent
            ? h(
                'div',
                { className: 'dc-grid2' },
                h(NumField, {
                  label: strings.width,
                  value: finiteNumber(layer.width, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ width: value })
                  },
                }),
                h(NumField, {
                  label: strings.height,
                  value: finiteNumber(layer.height, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ height: value })
                  },
                }),
              )
            : h(
                'div',
                { className: 'dc-grid2' },
                h(NumField, {
                  label: strings.x,
                  value: finiteNumber(layer.x, 0),
                  onCommit: function (value) {
                    actions.commitLayer({ x: value })
                  },
                }),
                h(NumField, {
                  label: strings.y,
                  value: finiteNumber(layer.y, 0),
                  onCommit: function (value) {
                    actions.commitLayer({ y: value })
                  },
                }),
                h(NumField, {
                  label: strings.width,
                  value: finiteNumber(layer.width, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ width: value })
                  },
                }),
                h(NumField, {
                  label: strings.height,
                  value: finiteNumber(layer.height, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ height: value })
                  },
                }),
              ),
          h(NumField, {
            label: strings.opacity,
            value: finiteNumber(layer.opacity, 1),
            min: 0,
            max: 1,
            step: 0.05,
            decimals: 2,
            integer: false,
            onCommit: function (value) {
              actions.commitLayer({ opacity: value })
            },
          }),
        ),
      )

      if (layer.type === 'rect' || layer.type === 'ellipse' || layer.type === 'frame') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'appearance' },
            h('div', { className: 'dc-section-title' }, strings.appearance),
            h(SwatchField, {
              label: strings.fill,
              value: layer.fill || '#e5e7eb',
              onCommit: function (value) {
                actions.commitLayer({ fill: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
            layer.type === 'rect' || layer.type === 'frame'
              ? h(NumField, {
                  label: strings.radius,
                  value: finiteNumber(layer.radius, 0),
                  min: 0,
                  onCommit: function (value) {
                    actions.commitLayer({ radius: value })
                  },
                })
              : null,
            h(NumField, {
              label: strings.borderWidth,
              value: finiteNumber(layer.borderWidth, 0),
              min: 0,
              onCommit: function (value) {
                actions.commitLayer({ borderWidth: value })
              },
            }),
            h(SwatchField, {
              label: strings.borderColor,
              value: layer.borderColor || '#9ca3af',
              onCommit: function (value) {
                actions.commitLayer({ borderColor: value })
              },
            }),
            layer.type === 'frame'
              ? h(Segmented, {
                  label: strings.clip,
                  value: layer.clip === true,
                  options: onOffOptions,
                  onCommit: function (value) {
                    actions.commitLayer({ clip: !!value })
                  },
                })
              : null,
          ),
        )
      } else if (layer.type === 'text') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'text' },
            h('div', { className: 'dc-section-title' }, strings.textSection),
            h(TextAreaField, {
              label: strings.content,
              value: layer.text || '',
              rows: 3,
              onCommit: function (value) {
                actions.commitLayer({ text: value })
              },
            }),
            h(SwatchField, {
              label: strings.color,
              value: layer.color || '#111827',
              onCommit: function (value) {
                actions.commitLayer({ color: value })
              },
            }),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.fontSize,
                value: finiteNumber(layer.fontSize, 16),
                min: 1,
                onCommit: function (value) {
                  actions.commitLayer({ fontSize: value })
                },
              }),
              h(NumField, {
                label: strings.lineHeight,
                value: finiteNumber(layer.lineHeight, finiteNumber(layer.fontSize, 16) * 1.4),
                min: 1,
                onCommit: function (value) {
                  actions.commitLayer({ lineHeight: value })
                },
              }),
            ),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.letterSpacing,
                title: strings.letterSpacing,
                value: finiteNumber(layer.letterSpacing, 0),
                min: -20,
                max: 40,
                step: 0.5,
                decimals: 1,
                integer: false,
                onCommit: function (value) {
                  actions.commitLayer({ letterSpacing: value })
                },
              }),
              h(SelectField, {
                label: strings.textTransform,
                title: strings.textTransform,
                value:
                  layer.textTransform === 'uppercase' || layer.textTransform === 'lowercase'
                    ? layer.textTransform
                    : 'none',
                options: [
                  { value: 'none', label: strings.none },
                  { value: 'uppercase', label: strings.uppercase },
                  { value: 'lowercase', label: strings.lowercase },
                ],
                onCommit: function (value) {
                  actions.commitLayer({ textTransform: value })
                },
              }),
            ),
            h(SelectField, {
              label: strings.fontWeight,
              value: finiteNumber(layer.fontWeight, 400),
              numeric: true,
              options: [
                { value: 400, label: '400' },
                { value: 500, label: '500' },
                { value: 600, label: '600' },
                { value: 700, label: '700' },
              ],
              onCommit: function (value) {
                actions.commitLayer({ fontWeight: value })
              },
            }),
            h(Segmented, {
              label: strings.align,
              value: layer.align || 'left',
              options: [
                { value: 'left', label: strings.left },
                { value: 'center', label: strings.center },
                { value: 'right', label: strings.right },
              ],
              onCommit: function (value) {
                actions.commitLayer({ align: value })
              },
            }),
            h(TextField, {
              label: strings.fontFamily,
              value: layer.fontFamily || DEFAULT_FONT,
              onCommit: function (value) {
                actions.commitLayer({ fontFamily: value })
              },
            }),
          ),
        )
      } else if (layer.type === 'image') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'image' },
            h('div', { className: 'dc-section-title' }, strings.imageSection),
            h(TextField, {
              label: strings.src,
              value: layer.src || '',
              placeholder: 'https://…',
              onCommit: function (value) {
                actions.commitLayer({ src: value })
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.chooseFile,
                onClick: function () {
                  actions.chooseImageFile()
                },
              },
              strings.chooseFile,
            ),
            h(SelectField, {
              label: strings.fit,
              value: layer.fit || 'cover',
              options: [
                { value: 'cover', label: strings.cover },
                { value: 'contain', label: strings.contain },
                { value: 'fill', label: strings.fillFit },
              ],
              onCommit: function (value) {
                actions.commitLayer({ fit: value })
              },
            }),
            h(NumField, {
              label: strings.radius,
              value: finiteNumber(layer.radius, 0),
              min: 0,
              onCommit: function (value) {
                actions.commitLayer({ radius: value })
              },
            }),
          ),
        )
      }

      sections.push(
        h(
          'div',
          { className: 'dc-section', key: 'effects' },
          h('div', { className: 'dc-section-title' }, strings.effects),
          h(
            'div',
            { className: 'dc-row' },
            h(TextField, {
              label: strings.shadow,
              value: typeof layer.shadow === 'string' ? layer.shadow : '',
              placeholder: strings.shadowPlaceholder,
              onCommit: function (value) {
                actions.commitShadow(value)
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                title: strings.clear,
                disabled: typeof layer.shadow !== 'string',
                onClick: actions.clearShadow,
              },
              strings.clear,
            ),
          ),
        ),
      )

      if (layer.type === 'frame') {
        const layoutValue = isObject(layer.layout) ? normalizeLayoutObject(layer.layout) : null
        const layoutChildren = [
          h(
            'div',
            { key: 'layout-state', className: 'dc-geo-note' },
            layoutSummaryText(layer.layout),
          ),
        ]
        if (layoutValue) {
          layoutChildren.push(
            h(Segmented, {
              key: 'direction',
              label: strings.direction,
              value: layoutValue.direction,
              options: [
                { value: 'row', label: strings.row },
                { value: 'column', label: strings.column },
              ],
              onCommit: function (value) {
                actions.patchLayout({ direction: value })
              },
            }),
            h(NumField, {
              key: 'gap',
              label: strings.gap,
              value: layoutValue.gap,
              min: 0,
              onCommit: function (value) {
                actions.patchLayout({ gap: value })
              },
            }),
            h('div', { key: 'pad-title', className: 'dc-section-title' }, strings.padding),
            h(
              'div',
              { key: 'pad-row-1', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-top',
                label: strings.paddingTop,
                title: strings.padding + ' top',
                value: layoutValue.padding.top,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { top: value } })
                },
              }),
              h(NumField, {
                key: 'pad-right',
                label: strings.paddingRight,
                title: strings.padding + ' right',
                value: layoutValue.padding.right,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { right: value } })
                },
              }),
            ),
            h(
              'div',
              { key: 'pad-row-2', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-bottom',
                label: strings.paddingBottom,
                title: strings.padding + ' bottom',
                value: layoutValue.padding.bottom,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { bottom: value } })
                },
              }),
              h(NumField, {
                key: 'pad-left',
                label: strings.paddingLeft,
                title: strings.padding + ' left',
                value: layoutValue.padding.left,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { left: value } })
                },
              }),
            ),
            h(SelectField, {
              key: 'align',
              label: strings.align,
              value: layoutValue.align,
              options: alignOptions,
              onCommit: function (value) {
                actions.patchLayout({ align: value })
              },
            }),
            h(SelectField, {
              key: 'justify',
              label: strings.justify,
              value: layoutValue.justify,
              options: justifyOptions,
              onCommit: function (value) {
                actions.patchLayout({ justify: value })
              },
            }),
            h(Segmented, {
              key: 'wrap',
              label: strings.wrap,
              value: layoutValue.wrap === true,
              options: onOffOptions,
              onCommit: function (value) {
                actions.patchLayout({ wrap: !!value })
              },
            }),
            h(
              'button',
              {
                key: 'disable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                onClick: actions.disableLayout,
              },
              strings.disableAutoLayout,
            ),
          )
        } else {
          layoutChildren.push(
            h(
              'button',
              {
                key: 'enable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                onClick: actions.enableLayout,
              },
              strings.enableAutoLayout,
            ),
          )
        }
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'layout' },
            h('div', { className: 'dc-section-title' }, strings.layout),
            layoutChildren,
          ),
        )
      }

      if (selectedNode && selectedNode.autoParent) {
        const alignSelfValue = typeof layer.alignSelf === 'string' ? layer.alignSelf : 'inherit'
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'autolayout' },
            h('div', { className: 'dc-section-title' }, strings.inAutoLayout),
            h(Segmented, {
              label: strings.grow,
              value: layer.grow === true,
              options: onOffOptions,
              onCommit: function (value) {
                actions.commitLayer({ grow: !!value })
              },
            }),
            h(SelectField, {
              label: strings.alignSelf,
              value: alignSelfValue,
              options: alignSelfOptions,
              onCommit: function (value) {
                actions.commitLayer({ alignSelf: value === 'inherit' ? null : value })
              },
            }),
          ),
        )
      }

      const parentOptions = buildParentOptions()
      if (parentOptions.length > 0) {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'structure' },
            h('div', { className: 'dc-section-title' }, strings.structure),
            h(
              'div',
              { className: 'dc-geo-note' },
              strings.parent +
                ': ' +
                (found && found.parentId
                  ? found.parentId
                  : found
                    ? found.artboard.name || found.artboard.id
                    : ''),
            ),
            h(SelectField, {
              label: strings.moveInto,
              value: parentToken,
              options: parentOptions,
              onCommit: handleMoveInto,
            }),
          ),
        )
      }

      sections.push(
        h(CommentThread, {
          key: 'comments',
          strings: strings,
          comments: comments,
          canAdd: true,
          actions: {
            resolveComment: actions.resolveComment,
            reopenComment: actions.reopenComment,
            deleteComment: actions.deleteComment,
            openComposer: actions.openComposer,
          },
        }),
      )

      return h(
        'aside',
        { className: 'dc-right', 'aria-label': strings.inspector },
        header,
        sections,
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas: artboards, layers, selection overlay, pins, inline composer
     * ---------------------------------------------------------------------------------------- */

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

    function textLineHeight(layer) {
      const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
      const lineHeight = finiteNumber(layer.lineHeight, fontSize * 1.4)
      if (lineHeight > 4) return String(roundTo(lineHeight, 2)) + 'px'
      return String(roundTo(lineHeight, 2))
    }

    /**
     * Recursive layer renderer. Receives a computed node (see buildComputedTree) so nested
     * frame children paint at their derived positions; frame boxes clip when `clip` is true.
     * Unknown/future types fall through to a neutral transparent box.
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
      return h(
        'div',
        {
          className:
            'dc-layer dc-layer-' +
            String(layer.type) +
            (node.autoParent ? ' dc-layer-auto' : ''),
          'data-layer-id': layer.id,
          'data-parent-id': node.parentId || '',
          style: style,
          title: layer.name || layer.id,
          onPointerDown: function (event) {
            handlers.layerPointerDown(event, node)
          },
          onPointerMove: function (event) {
            handlers.gestureMove(event)
          },
          onPointerUp: function (event) {
            handlers.gestureUp(event)
          },
          onPointerCancel: function (event) {
            handlers.gestureCancel(event)
          },
        },
        children && children.length ? children : null,
      )
    }

    /** Selection outline + 8 handles for a world rect (canvas units relative to the artboard). */
    function SelectionOverlay(props) {
      const rect = isObject(props.rect) ? props.rect : {}
      const zoom = finiteNumber(props.zoom, 1) > 0 ? finiteNumber(props.zoom, 1) : 1
      const handlers = props.handlers
      // The overlay lives in canvas units inside the camera-scaled stage; sizes are
      // divided by the camera zoom so handles and the outline keep a constant
      // on-screen size (and stay usable at 10% just like at 400%).
      const inverse = 1 / zoom
      return h(
        'div',
        {
          className: 'dc-sel-box',
          style: {
            left: finiteNumber(rect.x, 0),
            top: finiteNumber(rect.y, 0),
            width: Math.max(1, finiteNumber(rect.width, 1)),
            height: Math.max(1, finiteNumber(rect.height, 1)),
            borderWidth: 1 * inverse,
          },
        },
        HANDLES.map(function (handle) {
          return h('div', {
            key: handle.id,
            className: 'dc-sel-handle',
            'data-handle': handle.id,
            style: {
              left: handle.fx * 100 + '%',
              top: handle.fy * 100 + '%',
              width: 8 * inverse,
              height: 8 * inverse,
              borderWidth: 1 * inverse,
              cursor: handle.cursor,
              transform: 'translate(-50%, -50%)',
            },
            onPointerDown: function (event) {
              handlers.handlePointerDown(event, handle.id)
            },
            onPointerMove: function (event) {
              handlers.gestureMove(event)
            },
            onPointerUp: function (event) {
              handlers.gestureUp(event)
            },
            onPointerCancel: function (event) {
              handlers.gestureCancel(event)
            },
          })
        }),
      )
    }

    function ArtboardView(props) {
      const artboard = props.artboard
      const entry = props.entry || null
      const zoom = finiteNumber(props.zoom, 1) > 0 ? finiteNumber(props.zoom, 1) : 1
      const strings = props.strings
      const handlers = props.handlers
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const selectedNode = props.selectedNode || null
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const pins = props.pins
      const width = Math.max(1, finiteNumber(artboard.width, 1))
      const height = Math.max(1, finiteNumber(artboard.height, 1))
      // Everything inside the board frame is canvas units; only overlay chrome
      // (handles, pins) divides by the zoom to stay a constant screen size.
      const inverse = 1 / zoom
      const artboardSelected = !selectedLayerId && selectedArtboardId === artboard.id
      const selectionForThisBoard =
        selectedNode && selectedNode.artboard && selectedNode.artboard.id === artboard.id
          ? selectedNode.worldRect
          : null

      const children = [
        h(
          'div',
          { className: 'dc-board-label', key: 'label' },
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
            style: { width: width, height: height, background: artboard.background || '#ffffff' },
            onPointerDown: function (event) {
              handlers.artboardPointerDown(event, artboard.id)
            },
          },
          h(
            'div',
            {
              className: 'dc-board-inner',
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
          selectionForThisBoard
            ? h(SelectionOverlay, {
                key: 'selection',
                rect: selectionForThisBoard,
                zoom: zoom,
                handlers: handlers,
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
                      width: 18 * inverse,
                      height: 18 * inverse,
                      minWidth: 18 * inverse,
                      padding: '0 ' + 4 * inverse + 'px',
                      borderRadius: 9 * inverse,
                      borderWidth: 1 * inverse,
                      fontSize: 10 * inverse,
                      lineHeight: 1,
                    },
                    title: strings.pinTitle,
                    'aria-label': strings.pinTitle,
                    onClick: function (event) {
                      event.stopPropagation()
                      handlers.pinClick(pinNode.layer.id, artboard.id)
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

    function CanvasRoot(props) {
      const sessionId = props.sessionId
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
      const [selectedLayerId, setSelectedLayerId] = React.useState(null)
      const [selectedArtboardId, setSelectedArtboardId] = React.useState(null)
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

      const docRef = React.useRef(null)
      const versionRef = React.useRef(0)
      const cameraRef = React.useRef(defaultCamera())
      const panRef = React.useRef(null)
      const spaceHeldRef = React.useRef(false)
      const imageInputRef = React.useRef(null)
      const imagePickSourceRef = React.useRef('toolbar')
      const selectedLayerIdRef = React.useRef(null)
      const selectedArtboardIdRef = React.useRef(null)
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
          selectedLayerIdRef.current = selectedLayerId
          selectedArtboardIdRef.current = selectedArtboardId
        },
        [selectedLayerId, selectedArtboardId],
      )

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
            if (gestureRef.current) return
            if (inFlightRef.current > 0) return
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                setStatus(function (previous) {
                  return previous === 'offline' ? 'synced' : previous
                })
                if (!data || !data.doc) return
                if (data.path) setBoardPath(String(data.path))
                const remoteVersion = typeof data.version === 'number' ? data.version : 0
                if (remoteVersion <= versionRef.current) return
                const external = remoteVersion !== lastLocalVersionRef.current
                applyDoc(data.doc, remoteVersion)
                beacon('state-loaded', { version: remoteVersion, external: external })
                if (external) {
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
          if (selectedLayerId && !findLayerById(doc, selectedLayerId)) setSelectedLayerId(null)
          if (selectedArtboardId && !findArtboardById(doc, selectedArtboardId)) setSelectedArtboardId(null)
          if (composer && !findLayerById(doc, composer.layerId)) setComposer(null)
        },
        [doc, selectedLayerId, selectedArtboardId, composer],
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
            // Absent props: only nullable/boolean defaults can be restored exactly.
            if (key === 'shadow' || key === 'layout' || key === 'alignSelf') inverse[key] = null
            else if (key === 'visible') inverse[key] = true
            else if (key === 'grow' || key === 'clip') inverse[key] = false
            else if (key === 'opacity') inverse[key] = 1
            else if (key === 'letterSpacing') inverse[key] = 0
            else if (key === 'textTransform') inverse[key] = 'none'
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

      /* ------------------------------- mutations ------------------------------- */

      function selectLayer(layerId, artboardId) {
        setSelectedLayerId(layerId)
        if (artboardId) setSelectedArtboardId(artboardId)
        setComposer(function (previous) {
          return previous && previous.layerId !== layerId ? null : previous
        })
      }

      function selectArtboard(artboardId) {
        setSelectedArtboardId(artboardId)
        setSelectedLayerId(null)
        setComposer(null)
      }

      function clearSelection() {
        setSelectedLayerId(null)
        setComposer(null)
      }

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

      function commitLayer(patch) {
        const layerId = selectedLayerIdRef.current
        if (!layerId) return
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (found.layer[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        if (count === 0) return
        patchLocalLayer(layerId, changed)
        const ops = [{ type: 'layer.update', layerId: layerId, patch: changed }]
        const inversePatch = inversePatchFor(found.layer, changed)
        const inverse =
          Object.keys(inversePatch).length > 0
            ? [{ type: 'layer.update', layerId: layerId, patch: inversePatch }]
            : []
        commitWithHistory('update', ops, inverse)
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

      function deleteLayerById(layerId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!current || !found) return
        const insertOps = insertOpsForSubtree(
          found.layer,
          found.parentId ? { parentId: found.parentId } : { artboardId: found.artboard.id },
          found.index,
        )
        applyDocLocal(docRemoveLayer(current, layerId))
        if (selectedLayerIdRef.current === layerId) setSelectedLayerId(null)
        setComposer(function (previous) {
          return previous && previous.layerId === layerId ? null : previous
        })
        commitWithHistory('delete', [{ type: 'layer.delete', layerId: layerId }], insertOps)
      }

      function deleteSelectedLayer() {
        if (selectedLayerIdRef.current) deleteLayerById(selectedLayerIdRef.current)
      }

      function moveSelected(direction) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        if (!current || !layerId) return
        const found = findLayerById(current, layerId)
        if (!found) return
        const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
        const last = siblings.length - 1
        const target = clamp(found.index + (direction === 'up' ? 1 : -1), 0, last)
        if (target === found.index) return
        applyDocLocal(docReorderLayer(current, layerId, target))
        commitWithHistory(
          'reorder',
          [{ type: 'layer.reorder', layerId: layerId, index: target }],
          [{ type: 'layer.reorder', layerId: layerId, index: found.index }],
        )
        beacon('layer-reorder', { layerId: layerId, index: target, source: 'buttons' })
      }

      /** layer.add must not carry `children` (the Host builds it with parentId adds). */
      function opLayerForAdd(layer) {
        if (!isObject(layer) || layer.type !== 'frame' || !Array.isArray(layer.children)) {
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
        if (layer.type === 'frame') {
          copy.children = childrenOf(layer).map(function (child) {
            return cloneLayerSubtree(child, 0, 0)
          })
        }
        return copy
      }

      /** Duplicate the selected layer/frame (subtree ids remapped) with a 12,12 offset. */
      function duplicateSelected() {
        try {
          const current = docRef.current
          const layerId = selectedLayerIdRef.current
          if (!current || !layerId) return false
          const found = findLayerById(current, layerId)
          if (!found) return false
          const tree = treeRef.current
          const node = tree && tree.byId ? tree.byId.get(layerId) || null : null
          const autoParent = !!(node && node.autoParent)
          // Offset in parent space only for freely positioned layers; auto-layout children
          // derive their position from the layout anyway.
          const offset = autoParent ? 0 : 12
          const copy = cloneLayerSubtree(found.layer, offset, offset)
          if (!copy) return false
          const destination = found.parentId
            ? { parentId: found.parentId }
            : { artboardId: found.artboard.id }
          if (destination.parentId) {
            const parentFound = findLayerById(current, destination.parentId)
            if (!parentFound || !parentFound.layer) return false
            if (childrenOf(parentFound.layer).length >= FRAME_MAX_CHILDREN) {
              setInlineError(strings.childLimit)
              return false
            }
            if (parentFound.depth + subtreeHeight(copy) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return false
            }
          }
          const index = found.index + 1
          const ops = insertOpsForSubtree(copy, destination, index)
          if (ops.length === 0) return false
          // The Host caps ops per batch (default 200); a huge subtree cannot be copied at once.
          if (ops.length > 200) {
            setInlineError(strings.duplicateTooLarge)
            beacon('duplicate-rejected', { layerId: layerId, ops: ops.length })
            return false
          }
          applyDocLocal(docInsertLayer(current, destination, copy, index))
          setSelectedLayerId(copy.id)
          setSelectedArtboardId(found.artboard.id)
          commitWithHistory('duplicate', ops, [{ type: 'layer.delete', layerId: copy.id }])
          beacon('duplicate', { count: ops.length, layerId: copy.id, autoParent: autoParent })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-failed', { message: shortError(error) })
          return false
        }
      }

      function nudgeSelected(dx, dy) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        if (!current || !layerId) return
        const tree = treeRef.current
        const node = tree && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        if (node.autoParent) {
          setInlineError(strings.nudgeAutoLayout)
          beacon('nudge-blocked', { layerId: layerId, reason: 'auto-layout' })
          return
        }
        const pending = nudgeRef.current
        if (pending && pending.layerId !== layerId) {
          // Commit the pending delta for the previous layer before starting a new batch.
          flushNudge()
        } else if (pending) {
          pending.dx += dx
          pending.dy += dy
          return
        }
        nudgeRef.current = {
          layerId: layerId,
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
          const found = findLayerById(current, pending.layerId)
          if (!found) return
          const tree = treeRef.current
          const node = tree && tree.byId ? tree.byId.get(pending.layerId) || null : null
          if (node && node.autoParent) return
          const previousX = finiteNumber(found.layer.x, 0)
          const previousY = finiteNumber(found.layer.y, 0)
          const nextX = Math.round(previousX + pending.dx)
          const nextY = Math.round(previousY + pending.dy)
          if (nextX === previousX && nextY === previousY) return
          patchLocalLayer(pending.layerId, { x: nextX, y: nextY })
          commitWithHistory(
            'nudge',
            [{ type: 'layer.update', layerId: pending.layerId, patch: { x: nextX, y: nextY } }],
            [
              {
                type: 'layer.update',
                layerId: pending.layerId,
                patch: { x: previousX, y: previousY },
              },
            ],
          )
          beacon('nudge', { dx: pending.dx, dy: pending.dy, layerId: pending.layerId })
        } catch (error) {
          beacon('nudge-failed', { message: shortError(error) })
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

      function beginGesture(event, node, handle) {
        if (!node || !isObject(node.layer)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const found = docRef.current ? findLayerById(docRef.current, node.layer.id) : null
        if (!found) return
        // Commit any batched arrow-key nudge before a pointer gesture starts.
        flushNudge()
        const autoParent = !!node.autoParent
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
          layerId: node.layer.id,
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
        selectLayer(found.layer.id, found.artboard.id)
        beginGesture(event, node, null)
      }

      function handlePointerDown(event, handle) {
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const tree = treeRef.current
        const layerId = selectedLayerIdRef.current
        const node = tree && layerId && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        beginGesture(event, node, handle)
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

      function artboardPointerDown(event, artboardId) {
        if (!event || spaceHeldRef.current || isMiddlePointer(event)) return
        const target = event.target
        if (!target || !target.classList) return
        if (
          target.classList.contains('dc-board-frame') ||
          target.classList.contains('dc-board-inner')
        ) {
          selectArtboard(artboardId)
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
        const dx = screenDeltaToCanvas(gesture.clientX - gesture.startX, cameraRef.current.zoom)
        const dy = screenDeltaToCanvas(gesture.clientY - gesture.startY, cameraRef.current.zoom)
        const patch = gesturePatch(gesture, dx, dy)
        if (patch) patchLocalLayer(gesture.layerId, patch)
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
        setGestureActive(false)
        releaseCapture(event)
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
        const dx = screenDeltaToCanvas(
          finiteNumber(event.clientX, gesture.clientX) - gesture.startX,
          cameraRef.current.zoom,
        )
        const dy = screenDeltaToCanvas(
          finiteNumber(event.clientY, gesture.clientY) - gesture.startY,
          cameraRef.current.zoom,
        )
        const patch = gesturePatch(gesture, dx, dy)
        if (!patch) return
        let inversePatch
        if (gesture.kind === 'resize-auto') {
          inversePatch = { width: gesture.origin.width, height: gesture.origin.height }
        } else if (gesture.kind === 'drag') {
          inversePatch = { x: gesture.origin.x, y: gesture.origin.y }
        } else {
          inversePatch = {
            x: gesture.origin.x,
            y: gesture.origin.y,
            width: gesture.origin.width,
            height: gesture.origin.height,
          }
        }
        commitWithHistory(
          'gesture',
          [{ type: 'layer.update', layerId: gesture.layerId, patch: patch }],
          [{ type: 'layer.update', layerId: gesture.layerId, patch: inversePatch }],
        )
      }

      function gestureCancel(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        setGestureActive(false)
        releaseCapture(event)
        if (!gesture.moved) return
        // A cancelled reorder left the document untouched.
        if (gesture.kind === 'reorder') return
        const restore =
          gesture.kind === 'resize-auto'
            ? { width: gesture.origin.width, height: gesture.origin.height }
            : {
                x: gesture.origin.x,
                y: gesture.origin.y,
                width: gesture.origin.width,
                height: gesture.origin.height,
              }
        patchLocalLayer(gesture.layerId, restore)
        runOps([{ type: 'layer.update', layerId: gesture.layerId, patch: restore }])
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
          // Left drag pans only on the empty canvas background; hits on the artboard
          // still select, and hits on a layer still start a layer gesture.
          if (!blank) return
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
              setComposer(null)
              setSelectedLayerId(null)
              return
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              if (selectedLayerIdRef.current) {
                event.preventDefault()
                deleteSelectedLayer()
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
        const layer = placeImageInArtboard(targetArtboard, localPoint, naturalWidth, naturalHeight)
        layer.src = dataUrl
        applyDocLocal(docInsertLayer(current, { artboardId: targetArtboard.id }, layer))
        setSelectedLayerId(layer.id)
        setSelectedArtboardId(targetArtboard.id)
        commitWithHistory(
          'image-add',
          [{ type: 'layer.add', artboardId: targetArtboard.id, layer: layer }],
          [{ type: 'layer.delete', layerId: layer.id }],
        )
        beacon('image-add', {
          source: source,
          mode: 'add',
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

      /* ------------------------------- early states ------------------------------- */

      if (!doc) {
        return h(
          'div',
          { className: 'dc-app' },
          h(StyleTag, { key: 'style' }),
          h(
            'div',
            { className: 'dc-center' },
            loading && !loadError
              ? h('div', { className: 'dc-spinner' })
              : h(Glyph, { name: 'comment', size: 20 }),
            h(
              'div',
              { className: 'dc-center-text' },
              loading && !loadError ? strings.loading : strings.loadFailed,
            ),
            loadError
              ? h('div', { className: 'dc-center-hint' }, loadError)
              : null,
            h(
              'button',
              { type: 'button', className: 'dc-btn', onClick: retryNow },
              strings.retry,
            ),
          ),
        )
      }

      const artboards = artboardsOf(doc)
      const computedByArtboard = new Map()
      if (tree && Array.isArray(tree.artboards)) {
        tree.artboards.forEach(function (entry) {
          if (entry && entry.artboard) computedByArtboard.set(entry.artboard.id, entry)
        })
      }

      return h(
        'div',
        { className: 'dc-app', ref: appRef },
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
            h('span', { className: 'dc-board', title: boardPath }, doc.name || strings.untitled),
            h('span', { className: 'dc-version' }, 'v' + String(version)),
            h(
              'span',
              { className: 'dc-status', title: boardPath },
              h('span', { className: 'dc-dot dc-dot-' + status }),
              h('span', null, statusLabels[status] || strings.synced),
              status === 'offline'
                ? h(
                    'button',
                    { type: 'button', className: 'dc-retry', onClick: retryNow },
                    strings.retry,
                  )
                : null,
            ),
          ),
          h(
            'div',
            { className: 'dc-head-actions' },
            h(ToolButton, {
              icon: 'frame',
              label: strings.addArtboard,
              title: strings.addArtboard,
              onClick: addArtboard,
            }),
            h(
              'span',
              { className: 'dc-zoom-group' },
              h(IconButton, { icon: 'minus', title: strings.zoomOut, onClick: function () { zoomCameraBy(-ZOOM_STEP) } }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-zoom-label',
                  title: strings.zoomFit,
                  onClick: function () {
                    fitCamera()
                  },
                },
                Math.round(camera.zoom * 100) + '%',
              ),
              h(IconButton, { icon: 'plus', title: strings.zoomIn, onClick: function () { zoomCameraBy(ZOOM_STEP) } }),
            ),
            h(ToolButton, {
              icon: 'comment',
              label: strings.commentMode,
              title: strings.commentMode,
              active: commentMode,
              onClick: function () {
                const next = !commentMode
                setCommentMode(next)
                if (!next) setComposer(null)
              },
            }),
          ),
        ),
        inlineError
          ? h(
              'div',
              { className: 'dc-banner' },
              h('span', { className: 'dc-banner-text', title: inlineError }, inlineError),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-banner-close',
                  title: strings.dismiss,
                  onClick: function () {
                    setInlineError('')
                  },
                },
                h(Glyph, { name: 'close', size: 12 }),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dc-toolbar' },
          h(
            'div',
            { className: 'dc-tool-group' },
            h(ToolButton, {
              icon: 'rect',
              label: strings.rect,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('rect') },
            }),
            h(ToolButton, {
              icon: 'ellipse',
              label: strings.ellipse,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('ellipse') },
            }),
            h(ToolButton, {
              icon: 'text',
              label: strings.text,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('text') },
            }),
            h(ToolButton, {
              icon: 'frame',
              label: strings.frame,
              title: strings.addFrame,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('frame') },
            }),
            h(ToolButton, {
              icon: 'image',
              label: strings.image,
              title: strings.addImage,
              disabled: artboards.length === 0,
              onClick: function () { openImagePicker('toolbar') },
            }),
            h(ToolButton, {
              icon: 'comment',
              label: strings.comment,
              title: strings.comment,
              disabled: !selectedLayerId,
              onClick: function () {
                if (selectedLayerId) openComposerFor(selectedLayerId, null)
              },
            }),
            h(ToolButton, {
              icon: 'copy',
              label: strings.duplicate,
              title: strings.duplicate + ' (Ctrl/Cmd+D)',
              disabled: !selectedLayerId,
              onClick: function () {
                duplicateSelected()
              },
            }),
          ),
          h('span', { className: 'dc-spacer' }),
          h(
            'div',
            { className: 'dc-tool-group' },
            h(ToolButton, {
              icon: 'layers',
              label: strings.layers,
              active: treeOpen,
              onClick: function () {
                setTreeOpen(!treeOpen)
              },
            }),
            h(ToolButton, {
              icon: 'inspector',
              label: strings.inspector,
              active: inspectorOpen,
              onClick: function () {
                setInspectorOpen(!inspectorOpen)
              },
            }),
          ),
        ),
        h(
          'div',
          { className: 'dc-body' },
          treeOpen
            ? h(LayerTree, {
                key: 'tree',
                tree: tree,
                strings: strings,
                selectedLayerId: selectedLayerId,
                selectedArtboardId: selectedArtboardId,
                openCounts: commentIndex.openCounts,
                actions: {
                  selectLayer: selectLayer,
                  selectArtboard: selectArtboard,
                  toggleVisible: toggleVisible,
                  moveSelected: moveSelected,
                  deleteSelected: deleteSelectedLayer,
                  reparent: reparentLayer,
                  toggleTree: function () {
                    setTreeOpen(false)
                  },
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
                  h(Glyph, { name: 'frame', size: 20 }),
                  h('div', { className: 'dc-center-text' }, strings.noArtboards),
                  h(
                    'button',
                    { type: 'button', className: 'dc-btn dc-btn-primary', onClick: addArtboard },
                    strings.addArtboard,
                  ),
                )
              : h(
                  'div',
                  {
                    className: 'dc-stage',
                    style: {
                      width: Math.max(1, layout.width),
                      height: Math.max(1, layout.height),
                      transform:
                        'translate(' +
                        camera.x +
                        'px, ' +
                        camera.y +
                        'px) scale(' +
                        camera.zoom +
                        ')',
                    },
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
                      zoom: camera.zoom,
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
                  h('textarea', {
                    className: 'dc-textarea dc-composer-text',
                    rows: 3,
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
          inspectorOpen
            ? h(Inspector, {
                key: 'inspector',
                doc: doc,
                tree: tree,
                strings: strings,
                selectedLayerId: selectedLayerId,
                selectedArtboardId: selectedArtboardId,
                comments: selectedComments,
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
                  toggleInspector: function () {
                    setInspectorOpen(false)
                  },
                },
              })
            : null,
        ),
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
     * Plugin definition
     * ---------------------------------------------------------------------------------------- */

    return {
      inject: ['slots'],
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
