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
