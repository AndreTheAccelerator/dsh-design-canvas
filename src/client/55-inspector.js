    function Inspector(props) {
      const strings = props.strings
      const doc = props.doc
      const tree = props.tree
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const comments = props.comments
      const actions = props.actions
      const found = selectedLayerId ? findLayerById(doc, selectedLayerId) : null
      const layer = found ? found.layer : null
      const selectedNode =
        selectedLayerId && tree && tree.byId ? tree.byId.get(selectedLayerId) || null : null
      const artboard = found
        ? found.artboard
        : selectedArtboardId
          ? findArtboardById(doc, selectedArtboardId)
          : null

      const alignOptions = [
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
      ]
      const justifyOptions = [
        { value: 'start', label: strings.justifyStart },
        { value: 'center', label: strings.justifyCenter },
        { value: 'end', label: strings.justifyEnd },
        { value: 'space-between', label: strings.justifySpaceBetween },
      ]
      const onOffOptions = [
        { value: false, label: strings.off },
        { value: true, label: strings.on },
      ]
      const alignSelfOptions = [
        { value: 'inherit', label: strings.inherit },
        { value: 'start', label: strings.alignStart },
        { value: 'center', label: strings.alignCenter },
        { value: 'end', label: strings.alignEnd },
        { value: 'stretch', label: strings.alignStretch },
      ]

      function buildParentOptions() {
        const options = []
        if (!tree || !Array.isArray(tree.artboards)) return options
        function pushFrames(nodes, depth) {
          if (!Array.isArray(nodes)) return
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            if (!node || !node.layer || node.layer.type !== 'frame') continue
            if (layer) {
              if (node.id === layer.id) continue
              if (layer.type === 'frame' && subtreeContains(layer, node.id)) continue
            }
            options.push({
              value: 'frame:' + node.id,
              label:
                (depth > 0 ? '· '.repeat(depth) : '') +
                (node.layer.name || node.layer.id),
            })
            pushFrames(node.children, depth + 1)
          }
        }
        tree.artboards.forEach(function (entry) {
          options.push({
            value: 'artboard:' + entry.artboard.id,
            label: entry.artboard.name || entry.artboard.id,
          })
          pushFrames(entry.layers, 1)
        })
        return options
      }

      function handleMoveInto(value) {
        const token = String(value || '')
        if (token.indexOf('frame:') === 0) {
          actions.reparent(layer.id, { parentId: token.slice(6) })
        } else if (token.indexOf('artboard:') === 0) {
          actions.reparent(layer.id, { artboardId: token.slice(9) })
        }
      }

      const parentToken = found
        ? found.parentId
          ? 'frame:' + found.parentId
          : 'artboard:' + found.artboard.id
        : ''

      const header = h(
        'div',
        { className: 'dc-panel-head' },
        h('span', null, layer ? strings.layer : artboard ? strings.artboard : strings.inspector),
        h(IconButton, {
          title: strings.hide,
          icon: 'chevronRight',
          size: 12,
          onClick: actions.toggleInspector,
        }),
      )

      if (!layer && !artboard) {
        return h(
          'aside',
          { className: 'dc-right', 'aria-label': strings.inspector },
          header,
          h(
            'div',
            { className: 'dc-section' },
            h('div', { className: 'dc-muted' }, strings.selectHint),
          ),
        )
      }

      if (!layer) {
        return h(
          'aside',
          { className: 'dc-right', 'aria-label': strings.inspector },
          header,
          h(
            'div',
            { className: 'dc-section' },
            h('div', { className: 'dc-section-title' }, strings.artboard),
            h(TextField, {
              label: strings.name,
              value: artboard.name || '',
              onCommit: function (value) {
                actions.commitArtboard({ name: value })
              },
            }),
            h(
              'div',
              { className: 'dc-row' },
              h('span', { className: 'dc-field-label' }, artboard.id || ''),
            ),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.width,
                value: finiteNumber(artboard.width, 1),
                min: 1,
                onCommit: function (value) {
                  actions.commitArtboard({ width: value })
                },
              }),
              h(NumField, {
                label: strings.height,
                value: finiteNumber(artboard.height, 1),
                min: 1,
                onCommit: function (value) {
                  actions.commitArtboard({ height: value })
                },
              }),
            ),
            h(SwatchField, {
              label: strings.background,
              value: artboard.background || '#ffffff',
              onCommit: function (value) {
                actions.commitArtboard({ background: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
          ),
        )
      }

      const sections = []
      sections.push(
        h(
          'div',
          { className: 'dc-section', key: 'element' },
          h('div', { className: 'dc-section-title' }, strings.element),
          h(
            'div',
            { className: 'dc-row', title: layer.id },
            h(Glyph, { name: layerTypeLabel(layer.type), size: 12 }),
            h(
              'span',
              { className: 'dc-muted' },
              layerFactoryName(layer.type) + ' · ' + String(layer.id),
            ),
          ),
          h(TextField, {
            label: strings.name,
            value: layer.name || '',
            onCommit: function (value) {
              actions.commitLayer({ name: value })
            },
          }),
          selectedNode && selectedNode.autoParent
            ? h(
                'div',
                { className: 'dc-geo-note' },
                strings.derivedGeometry +
                  ': x=' +
                  Math.round(selectedNode.x) +
                  ' y=' +
                  Math.round(selectedNode.y) +
                  ' w=' +
                  Math.round(selectedNode.width) +
                  ' h=' +
                  Math.round(selectedNode.height),
              )
            : null,
          selectedNode && selectedNode.autoParent
            ? h(
                'div',
                { className: 'dc-grid2' },
                h(NumField, {
                  label: strings.width,
                  value: finiteNumber(layer.width, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ width: value })
                  },
                }),
                h(NumField, {
                  label: strings.height,
                  value: finiteNumber(layer.height, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ height: value })
                  },
                }),
              )
            : h(
                'div',
                { className: 'dc-grid2' },
                h(NumField, {
                  label: strings.x,
                  value: finiteNumber(layer.x, 0),
                  onCommit: function (value) {
                    actions.commitLayer({ x: value })
                  },
                }),
                h(NumField, {
                  label: strings.y,
                  value: finiteNumber(layer.y, 0),
                  onCommit: function (value) {
                    actions.commitLayer({ y: value })
                  },
                }),
                h(NumField, {
                  label: strings.width,
                  value: finiteNumber(layer.width, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ width: value })
                  },
                }),
                h(NumField, {
                  label: strings.height,
                  value: finiteNumber(layer.height, 1),
                  min: 1,
                  onCommit: function (value) {
                    actions.commitLayer({ height: value })
                  },
                }),
              ),
          h(NumField, {
            label: strings.opacity,
            value: finiteNumber(layer.opacity, 1),
            min: 0,
            max: 1,
            step: 0.05,
            decimals: 2,
            integer: false,
            onCommit: function (value) {
              actions.commitLayer({ opacity: value })
            },
          }),
        ),
      )

      if (layer.type === 'rect' || layer.type === 'ellipse' || layer.type === 'frame') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'appearance' },
            h('div', { className: 'dc-section-title' }, strings.appearance),
            h(SwatchField, {
              label: strings.fill,
              value: layer.fill || '#e5e7eb',
              onCommit: function (value) {
                actions.commitLayer({ fill: value })
              },
            }),
            h('div', { className: 'dc-geo-note' }, strings.gradientHint),
            layer.type === 'rect' || layer.type === 'frame'
              ? h(NumField, {
                  label: strings.radius,
                  value: finiteNumber(layer.radius, 0),
                  min: 0,
                  onCommit: function (value) {
                    actions.commitLayer({ radius: value })
                  },
                })
              : null,
            h(NumField, {
              label: strings.borderWidth,
              value: finiteNumber(layer.borderWidth, 0),
              min: 0,
              onCommit: function (value) {
                actions.commitLayer({ borderWidth: value })
              },
            }),
            h(SwatchField, {
              label: strings.borderColor,
              value: layer.borderColor || '#9ca3af',
              onCommit: function (value) {
                actions.commitLayer({ borderColor: value })
              },
            }),
            layer.type === 'frame'
              ? h(Segmented, {
                  label: strings.clip,
                  value: layer.clip === true,
                  options: onOffOptions,
                  onCommit: function (value) {
                    actions.commitLayer({ clip: !!value })
                  },
                })
              : null,
          ),
        )
      } else if (layer.type === 'text') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'text' },
            h('div', { className: 'dc-section-title' }, strings.textSection),
            h(TextAreaField, {
              label: strings.content,
              value: layer.text || '',
              rows: 3,
              onCommit: function (value) {
                actions.commitLayer({ text: value })
              },
            }),
            h(SwatchField, {
              label: strings.color,
              value: layer.color || '#111827',
              onCommit: function (value) {
                actions.commitLayer({ color: value })
              },
            }),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.fontSize,
                value: finiteNumber(layer.fontSize, 16),
                min: 1,
                onCommit: function (value) {
                  actions.commitLayer({ fontSize: value })
                },
              }),
              h(NumField, {
                label: strings.lineHeight,
                value: finiteNumber(layer.lineHeight, finiteNumber(layer.fontSize, 16) * 1.4),
                min: 1,
                onCommit: function (value) {
                  actions.commitLayer({ lineHeight: value })
                },
              }),
            ),
            h(
              'div',
              { className: 'dc-grid2' },
              h(NumField, {
                label: strings.letterSpacing,
                title: strings.letterSpacing,
                value: finiteNumber(layer.letterSpacing, 0),
                min: -20,
                max: 40,
                step: 0.5,
                decimals: 1,
                integer: false,
                onCommit: function (value) {
                  actions.commitLayer({ letterSpacing: value })
                },
              }),
              h(SelectField, {
                label: strings.textTransform,
                title: strings.textTransform,
                value:
                  layer.textTransform === 'uppercase' || layer.textTransform === 'lowercase'
                    ? layer.textTransform
                    : 'none',
                options: [
                  { value: 'none', label: strings.none },
                  { value: 'uppercase', label: strings.uppercase },
                  { value: 'lowercase', label: strings.lowercase },
                ],
                onCommit: function (value) {
                  actions.commitLayer({ textTransform: value })
                },
              }),
            ),
            h(SelectField, {
              label: strings.fontWeight,
              value: finiteNumber(layer.fontWeight, 400),
              numeric: true,
              options: [
                { value: 400, label: '400' },
                { value: 500, label: '500' },
                { value: 600, label: '600' },
                { value: 700, label: '700' },
              ],
              onCommit: function (value) {
                actions.commitLayer({ fontWeight: value })
              },
            }),
            h(Segmented, {
              label: strings.align,
              value: layer.align || 'left',
              options: [
                { value: 'left', label: strings.left },
                { value: 'center', label: strings.center },
                { value: 'right', label: strings.right },
              ],
              onCommit: function (value) {
                actions.commitLayer({ align: value })
              },
            }),
            h(TextField, {
              label: strings.fontFamily,
              value: layer.fontFamily || DEFAULT_FONT,
              onCommit: function (value) {
                actions.commitLayer({ fontFamily: value })
              },
            }),
          ),
        )
      } else if (layer.type === 'image') {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'image' },
            h('div', { className: 'dc-section-title' }, strings.imageSection),
            h(TextField, {
              label: strings.src,
              value: layer.src || '',
              placeholder: 'https://…',
              onCommit: function (value) {
                actions.commitLayer({ src: value })
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                title: strings.chooseFile,
                onClick: function () {
                  actions.chooseImageFile()
                },
              },
              strings.chooseFile,
            ),
            h(SelectField, {
              label: strings.fit,
              value: layer.fit || 'cover',
              options: [
                { value: 'cover', label: strings.cover },
                { value: 'contain', label: strings.contain },
                { value: 'fill', label: strings.fillFit },
              ],
              onCommit: function (value) {
                actions.commitLayer({ fit: value })
              },
            }),
            h(NumField, {
              label: strings.radius,
              value: finiteNumber(layer.radius, 0),
              min: 0,
              onCommit: function (value) {
                actions.commitLayer({ radius: value })
              },
            }),
          ),
        )
      }

      sections.push(
        h(
          'div',
          { className: 'dc-section', key: 'effects' },
          h('div', { className: 'dc-section-title' }, strings.effects),
          h(
            'div',
            { className: 'dc-row' },
            h(TextField, {
              label: strings.shadow,
              value: typeof layer.shadow === 'string' ? layer.shadow : '',
              placeholder: strings.shadowPlaceholder,
              onCommit: function (value) {
                actions.commitShadow(value)
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dc-btn',
                title: strings.clear,
                disabled: typeof layer.shadow !== 'string',
                onClick: actions.clearShadow,
              },
              strings.clear,
            ),
          ),
        ),
      )

      if (layer.type === 'frame') {
        const layoutValue = isObject(layer.layout) ? normalizeLayoutObject(layer.layout) : null
        const layoutChildren = [
          h(
            'div',
            { key: 'layout-state', className: 'dc-geo-note' },
            layoutSummaryText(layer.layout),
          ),
        ]
        if (layoutValue) {
          layoutChildren.push(
            h(Segmented, {
              key: 'direction',
              label: strings.direction,
              value: layoutValue.direction,
              options: [
                { value: 'row', label: strings.row },
                { value: 'column', label: strings.column },
              ],
              onCommit: function (value) {
                actions.patchLayout({ direction: value })
              },
            }),
            h(NumField, {
              key: 'gap',
              label: strings.gap,
              value: layoutValue.gap,
              min: 0,
              onCommit: function (value) {
                actions.patchLayout({ gap: value })
              },
            }),
            h('div', { key: 'pad-title', className: 'dc-section-title' }, strings.padding),
            h(
              'div',
              { key: 'pad-row-1', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-top',
                label: strings.paddingTop,
                title: strings.padding + ' top',
                value: layoutValue.padding.top,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { top: value } })
                },
              }),
              h(NumField, {
                key: 'pad-right',
                label: strings.paddingRight,
                title: strings.padding + ' right',
                value: layoutValue.padding.right,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { right: value } })
                },
              }),
            ),
            h(
              'div',
              { key: 'pad-row-2', className: 'dc-grid2' },
              h(NumField, {
                key: 'pad-bottom',
                label: strings.paddingBottom,
                title: strings.padding + ' bottom',
                value: layoutValue.padding.bottom,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { bottom: value } })
                },
              }),
              h(NumField, {
                key: 'pad-left',
                label: strings.paddingLeft,
                title: strings.padding + ' left',
                value: layoutValue.padding.left,
                min: 0,
                onCommit: function (value) {
                  actions.patchLayout({ padding: { left: value } })
                },
              }),
            ),
            h(SelectField, {
              key: 'align',
              label: strings.align,
              value: layoutValue.align,
              options: alignOptions,
              onCommit: function (value) {
                actions.patchLayout({ align: value })
              },
            }),
            h(SelectField, {
              key: 'justify',
              label: strings.justify,
              value: layoutValue.justify,
              options: justifyOptions,
              onCommit: function (value) {
                actions.patchLayout({ justify: value })
              },
            }),
            h(Segmented, {
              key: 'wrap',
              label: strings.wrap,
              value: layoutValue.wrap === true,
              options: onOffOptions,
              onCommit: function (value) {
                actions.patchLayout({ wrap: !!value })
              },
            }),
            h(
              'button',
              {
                key: 'disable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                onClick: actions.disableLayout,
              },
              strings.disableAutoLayout,
            ),
          )
        } else {
          layoutChildren.push(
            h(
              'button',
              {
                key: 'enable',
                type: 'button',
                className: 'dc-btn dc-btn-wide',
                onClick: actions.enableLayout,
              },
              strings.enableAutoLayout,
            ),
          )
        }
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'layout' },
            h('div', { className: 'dc-section-title' }, strings.layout),
            layoutChildren,
          ),
        )
      }

      if (selectedNode && selectedNode.autoParent) {
        const alignSelfValue = typeof layer.alignSelf === 'string' ? layer.alignSelf : 'inherit'
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'autolayout' },
            h('div', { className: 'dc-section-title' }, strings.inAutoLayout),
            h(Segmented, {
              label: strings.grow,
              value: layer.grow === true,
              options: onOffOptions,
              onCommit: function (value) {
                actions.commitLayer({ grow: !!value })
              },
            }),
            h(SelectField, {
              label: strings.alignSelf,
              value: alignSelfValue,
              options: alignSelfOptions,
              onCommit: function (value) {
                actions.commitLayer({ alignSelf: value === 'inherit' ? null : value })
              },
            }),
          ),
        )
      }

      const parentOptions = buildParentOptions()
      if (parentOptions.length > 0) {
        sections.push(
          h(
            'div',
            { className: 'dc-section', key: 'structure' },
            h('div', { className: 'dc-section-title' }, strings.structure),
            h(
              'div',
              { className: 'dc-geo-note' },
              strings.parent +
                ': ' +
                (found && found.parentId
                  ? found.parentId
                  : found
                    ? found.artboard.name || found.artboard.id
                    : ''),
            ),
            h(SelectField, {
              label: strings.moveInto,
              value: parentToken,
              options: parentOptions,
              onCommit: handleMoveInto,
            }),
          ),
        )
      }

      sections.push(
        h(CommentThread, {
          key: 'comments',
          strings: strings,
          comments: comments,
          canAdd: true,
          actions: {
            resolveComment: actions.resolveComment,
            reopenComment: actions.reopenComment,
            deleteComment: actions.deleteComment,
            openComposer: actions.openComposer,
          },
        }),
      )

      // Feature parts contribute inspector sections through EXTENSIONS.inspector
      // (see 00-core.js): new layer props, export settings, layout helpers, …
      if (EXTENSIONS.inspector.length) {
        const extensionSections = renderExtensions(EXTENSIONS.inspector, props.extensionContext || {
          doc: doc,
          tree: tree,
          strings: strings,
          selection: {
            layerIds: selectedLayerId ? [selectedLayerId] : [],
            primaryLayerId: selectedLayerId,
            artboardId: selectedArtboardId,
          },
          selectedLayerId: selectedLayerId,
          selectedArtboardId: selectedArtboardId,
          actions: actions,
        })
        if (extensionSections) {
          for (let index = 0; index < extensionSections.length; index += 1) {
            sections.push(extensionSections[index])
          }
        }
      }

      return h(
        'aside',
        { className: 'dc-right', 'aria-label': strings.inspector },
        header,
        sections,
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Canvas: artboards, layers, selection overlay, pins, inline composer
     * ---------------------------------------------------------------------------------------- */

