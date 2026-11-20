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

