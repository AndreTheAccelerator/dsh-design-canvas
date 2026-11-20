    function LayerTree(props) {
      const strings = props.strings
      const tree = props.tree
      const selectedLayerId = props.selectedLayerId
      const selectedArtboardId = props.selectedArtboardId
      const openCounts = props.openCounts
      const actions = props.actions
      const computedArtboards = tree && Array.isArray(tree.artboards) ? tree.artboards : []
      const collapsedState = React.useState({})
      const collapsed = collapsedState[0]
      const setCollapsed = collapsedState[1]
      const dropState = React.useState(null)
      const dropTarget = dropState[0]
      const setDropTarget = dropState[1]
      const dragRef = React.useRef(null)

      function toggleCollapsed(layerId) {
        setCollapsed(function (previous) {
          const next = Object.assign({}, previous)
          next[layerId] = previous[layerId] !== true
          return next
        })
      }

      function handleDragStart(layerId, event) {
        dragRef.current = layerId
        try {
          if (event && event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            if (typeof event.dataTransfer.setData === 'function') {
              event.dataTransfer.setData('text/plain', layerId)
            }
          }
        } catch (error) {
          /* drag payload is best-effort */
        }
      }

      function clearDrag() {
        dragRef.current = null
        setDropTarget(null)
      }

      function stopEvent(event) {
        try {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
      }

      function dragOverTarget(token, event) {
        stopEvent(event)
        try {
          if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        } catch (error) {
          /* ignore */
        }
        if (dragRef.current) {
          setDropTarget(function (previous) {
            return previous === token ? previous : token
          })
        }
      }

      function dropIntoFrame(frameId, event) {
        stopEvent(event)
        const dragged = dragRef.current
        clearDrag()
        if (dragged && dragged !== frameId) actions.reparent(dragged, { parentId: frameId })
      }

      function dropIntoArtboard(artboardId, event) {
        stopEvent(event)
        const dragged = dragRef.current
        clearDrag()
        if (dragged) actions.reparent(dragged, { artboardId: artboardId })
      }

      function renderLayerRows(nodes, depth) {
        if (!Array.isArray(nodes) || nodes.length === 0) return null
        return nodes
          .slice()
          .reverse()
          .map(function (node) {
            return renderLayerRow(node, depth)
          })
      }

      function renderLayerRow(node, depth) {
        if (!node || !isObject(node.layer)) return null
        const layer = node.layer
        const isFrame = layer.type === 'frame'
        const childNodes = Array.isArray(node.children) ? node.children : []
        const hasChildren = isFrame && childNodes.length > 0
        const open = collapsed[layer.id] !== true
        const count = openCounts.get(layer.id) || 0
        const isSelected = selectedLayerId === layer.id
        const isDropTarget = dropTarget === 'frame:' + layer.id
        const row = h(
          'div',
          {
            key: String(layer.id),
            className:
              'dc-tree-row' + (isSelected ? ' dc-sel' : '') + (isDropTarget ? ' dc-drop-into' : ''),
            style: { paddingLeft: 6 + depth * 12 },
            title: layer.name || layer.id,
            draggable: true,
            'data-layer-id': layer.id,
            onDragStart: function (event) {
              handleDragStart(layer.id, event)
            },
            onDragEnd: clearDrag,
            onDragOver: isFrame
              ? function (event) {
                  dragOverTarget('frame:' + layer.id, event)
                }
              : undefined,
            onDragLeave: isFrame
              ? function () {
                  setDropTarget(function (previous) {
                    return previous === 'frame:' + layer.id ? null : previous
                  })
                }
              : undefined,
            onDrop: isFrame
              ? function (event) {
                  dropIntoFrame(layer.id, event)
                }
              : undefined,
            onClick: function () {
              actions.selectLayer(layer.id, node.artboard.id)
            },
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dc-tree-caret',
              disabled: !hasChildren,
              title: hasChildren ? (open ? strings.collapse : strings.expand) : '',
              'aria-label': hasChildren ? (open ? strings.collapse : strings.expand) : layer.name || '',
              onClick: function (event) {
                event.stopPropagation()
                if (hasChildren) toggleCollapsed(layer.id)
              },
            },
            h(Glyph, { name: hasChildren && open ? 'chevronDown' : 'chevronRight', size: 10 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dc-eye' + (layer.visible === false ? ' dc-off' : ''),
              title: layer.visible === false ? strings.show : strings.hide,
              'aria-label': layer.name || layer.id,
              onClick: function (event) {
                event.stopPropagation()
                actions.toggleVisible(layer.id)
              },
            },
            h(Glyph, {
              name: layer.visible === false ? 'eyeOff' : 'eye',
              size: 11,
            }),
          ),
          h(
            'span',
            { className: 'dc-tree-type' },
            h(Glyph, { name: layerTypeLabel(layer.type), size: 10 }),
          ),
          h(
            'span',
            { className: 'dc-tree-name' },
            layer.name || layerFactoryName(layer.type),
          ),
          count > 0
            ? h('span', { className: 'dc-badge', title: strings.comments }, String(count))
            : null,
        )
        const rows = [row]
        if (hasChildren && open) rows.push(renderLayerRows(childNodes, depth + 1))
        return rows
      }

      return h(
        'aside',
        { className: 'dc-left', 'aria-label': strings.layers },
        h(
          'div',
          { className: 'dc-panel-head' },
          h('span', null, strings.layers),
          h(IconButton, {
            title: strings.hide,
            icon: 'chevronLeft',
            size: 12,
            onClick: actions.toggleTree,
          }),
        ),
        h(
          'div',
          { className: 'dc-tree' },
          computedArtboards.length === 0
            ? h('div', { className: 'dc-muted dc-pad' }, strings.noArtboards)
            : computedArtboards.map(function (entry) {
                const artboard = entry.artboard
                const artboardSelected = !selectedLayerId && selectedArtboardId === artboard.id
                const isDropTarget = dropTarget === 'artboard:' + artboard.id
                return h(
                  'div',
                  { className: 'dc-tree-group', key: String(artboard.id) },
                  h(
                    'button',
                    {
                      type: 'button',
                      className:
                        'dc-tree-ab' +
                        (artboardSelected ? ' dc-sel' : '') +
                        (isDropTarget ? ' dc-drop-into' : ''),
                      title: artboard.name || artboard.id,
                      'data-artboard-id': artboard.id,
                      onClick: function () {
                        actions.selectArtboard(artboard.id)
                      },
                      onDragOver: function (event) {
                        dragOverTarget('artboard:' + artboard.id, event)
                      },
                      onDragLeave: function () {
                        setDropTarget(function (previous) {
                          return previous === 'artboard:' + artboard.id ? null : previous
                        })
                      },
                      onDrop: function (event) {
                        dropIntoArtboard(artboard.id, event)
                      },
                    },
                    h(Glyph, { name: 'frame', size: 11 }),
                    h('span', { className: 'dc-tree-name' }, artboard.name || artboard.id),
                    h('span', { className: 'dc-tree-meta' }, String(layersOf(artboard).length)),
                  ),
                  renderLayerRows(entry.layers, 0),
                )
              }),
        ),
        h(
          'div',
          { className: 'dc-panel-foot' },
          h(IconButton, {
            title: strings.moveUp,
            icon: 'up',
            size: 13,
            disabled: !selectedLayerId,
            onClick: function () {
              actions.moveSelected('up')
            },
          }),
          h(IconButton, {
            title: strings.moveDown,
            icon: 'down',
            size: 13,
            disabled: !selectedLayerId,
            onClick: function () {
              actions.moveSelected('down')
            },
          }),
          h(IconButton, {
            title: strings.delete,
            icon: 'trash',
            size: 13,
            disabled: !selectedLayerId,
            onClick: actions.deleteSelected,
          }),
        ),
      )
    }

    function layerFactoryName(type) {
      if (type === 'rect') return 'Rectangle'
      if (type === 'ellipse') return 'Ellipse'
      if (type === 'text') return 'Text'
      if (type === 'image') return 'Image'
      if (type === 'frame') return 'Frame'
      return 'Layer'
    }

    /* ------------------------------------------------------------------------------------------
     * Inspector
     * ---------------------------------------------------------------------------------------- */

