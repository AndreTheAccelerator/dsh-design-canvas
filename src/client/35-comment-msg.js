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
