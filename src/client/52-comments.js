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

