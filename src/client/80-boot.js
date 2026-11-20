
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
      // Wait for the client services read below; otherwise apply() can run before
      // the sidebar/session/locale providers mount and every ctx.get() is undefined.
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'locale'],
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
