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

