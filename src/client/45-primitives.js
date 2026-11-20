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

