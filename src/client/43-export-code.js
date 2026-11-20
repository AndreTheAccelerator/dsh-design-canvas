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
