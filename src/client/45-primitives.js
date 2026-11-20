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
