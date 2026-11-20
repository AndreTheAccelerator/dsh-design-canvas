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
