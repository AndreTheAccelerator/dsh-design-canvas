    /**
     * Canvas shell: header, toolbar, panels (tree / inspector / comments), splitter-friendly
     * layout, the camera stage and the inline comment composer. All behaviour lives in
     * `useEditor` (70-editor.js); this component only composes and positions UI.
     */
    function CanvasRoot(props) {
      const editor = useEditor(props.sessionId)
      const {
        strings,
        doc,
        version,
        boardPath,
        loading,
        loadError,
        status,
        inlineError,
        setInlineError,
        selectedLayerId,
        selectedArtboardId,
        camera,
        panning,
        spaceHeld,
        dragOver,
        commentMode,
        setCommentMode,
        composer,
        setComposer,
        commentBusy,
        commentError,
        gestureActive,
        treeOpen,
        setTreeOpen,
        inspectorOpen,
        setInspectorOpen,
        imageInputRef,
        selectedLayerIdRef,
        canvasRef,
        appRef,
        canvasHoverRef,
        zoomCameraBy,
        fitCamera,
        retryNow,
        selectLayer,
        selectArtboard,
        clearSelection,
        openComposerFor,
        commitLayer,
        commitArtboard,
        toggleVisible,
        deleteSelectedLayer,
        moveSelected,
        addLayer,
        duplicateSelected,
        commitShadow,
        clearShadow,
        reparentLayer,
        setFrameAutoLayout,
        patchFrameLayout,
        addArtboard,
        setCommentStatus,
        deleteCommentById,
        canvasPointerDown,
        canvasPointerMove,
        canvasPointerUp,
        canvasPointerCancel,
        openImagePicker,
        onImageInputChange,
        canvasDragOver,
        canvasDragLeave,
        canvasDrop,
        tree,
        selectedNode,
        commentIndex,
        selectedComments,
        layout,
        composerPlacement,
        handlers,
        statusLabels,
      } = editor

      /* ------------------------------- early states ------------------------------- */

      // Context handed to every extension registry entry (toolbar buttons, app panels,
      // selection tools, inspector sections). Extensions live in their own parts.
      const editorApi = {
        editor: editor,
        strings: strings,
        doc: doc,
        tree: tree,
        layout: layout,
        version: version,
        boardPath: boardPath,
        camera: camera,
        zoom: camera.zoom,
        selection: {
          layerIds: selectedLayerId ? [selectedLayerId] : [],
          primaryLayerId: selectedLayerId,
          artboardId: selectedArtboardId,
        },
        selectedLayerId: selectedLayerId,
        selectedArtboardId: selectedArtboardId,
        selectedNode: selectedNode,
        comments: selectedComments,
        commentIndex: commentIndex,
        actions: {
          ...handlers,
          commitLayer: commitLayer,
          commitArtboard: commitArtboard,
          addLayer: addLayer,
          deleteSelected: deleteSelectedLayer,
          duplicateSelected: duplicateSelected,
          selectLayer: selectLayer,
          selectArtboard: selectArtboard,
          clearSelection: clearSelection,
          setInlineError: setInlineError,
          setCommentStatus: setCommentStatus,
          deleteComment: deleteCommentById,
          openComposerFor: openComposerFor,
        },
      }

      if (!doc) {
        return h(
          'div',
          { className: 'dc-app' },
          h(StyleTag, { key: 'style' }),
          h(
            'div',
            { className: 'dc-center' },
            loading && !loadError
              ? h('div', { className: 'dc-spinner' })
              : h(Glyph, { name: 'comment', size: 20 }),
            h(
              'div',
              { className: 'dc-center-text' },
              loading && !loadError ? strings.loading : strings.loadFailed,
            ),
            loadError
              ? h('div', { className: 'dc-center-hint' }, loadError)
              : null,
            h(
              'button',
              { type: 'button', className: 'dc-btn', onClick: retryNow },
              strings.retry,
            ),
          ),
        )
      }

      const artboards = artboardsOf(doc)
      const computedByArtboard = new Map()
      if (tree && Array.isArray(tree.artboards)) {
        tree.artboards.forEach(function (entry) {
          if (entry && entry.artboard) computedByArtboard.set(entry.artboard.id, entry)
        })
      }

      return h(
        'div',
        { className: 'dc-app', ref: appRef },
        h(StyleTag, { key: 'style' }),
        h('input', {
          key: 'image-input',
          ref: imageInputRef,
          type: 'file',
          accept: IMAGE_ACCEPT,
          className: 'dc-file-input',
          style: { display: 'none' },
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onImageInputChange,
        }),
        h(
          'header',
          { className: 'dc-header' },
          h(
            'div',
            { className: 'dc-head-main' },
            h('span', { className: 'dc-board', title: boardPath }, doc.name || strings.untitled),
            h('span', { className: 'dc-version' }, 'v' + String(version)),
            h(
              'span',
              { className: 'dc-status', title: boardPath },
              h('span', { className: 'dc-dot dc-dot-' + status }),
              h('span', null, statusLabels[status] || strings.synced),
              status === 'offline'
                ? h(
                    'button',
                    { type: 'button', className: 'dc-retry', onClick: retryNow },
                    strings.retry,
                  )
                : null,
            ),
          ),
          h(
            'div',
            { className: 'dc-head-actions' },
            h(ToolButton, {
              icon: 'frame',
              label: strings.addArtboard,
              title: strings.addArtboard,
              onClick: addArtboard,
            }),
            h(
              'span',
              { className: 'dc-zoom-group' },
              h(IconButton, { icon: 'minus', title: strings.zoomOut, onClick: function () { zoomCameraBy(-ZOOM_STEP) } }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-zoom-label',
                  title: strings.zoomFit,
                  onClick: function () {
                    fitCamera()
                  },
                },
                Math.round(camera.zoom * 100) + '%',
              ),
              h(IconButton, { icon: 'plus', title: strings.zoomIn, onClick: function () { zoomCameraBy(ZOOM_STEP) } }),
            ),
            h(ToolButton, {
              icon: 'comment',
              label: strings.commentMode,
              title: strings.commentMode,
              active: commentMode,
              onClick: function () {
                const next = !commentMode
                setCommentMode(next)
                if (!next) setComposer(null)
              },
            }),
          ),
        ),
        inlineError
          ? h(
              'div',
              { className: 'dc-banner' },
              h('span', { className: 'dc-banner-text', title: inlineError }, inlineError),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dc-banner-close',
                  title: strings.dismiss,
                  onClick: function () {
                    setInlineError('')
                  },
                },
                h(Glyph, { name: 'close', size: 12 }),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dc-toolbar' },
          h(
            'div',
            { className: 'dc-tool-group' },
            h(ToolButton, {
              icon: 'rect',
              label: strings.rect,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('rect') },
            }),
            h(ToolButton, {
              icon: 'ellipse',
              label: strings.ellipse,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('ellipse') },
            }),
            h(ToolButton, {
              icon: 'text',
              label: strings.text,
              title: strings.addLayerHint,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('text') },
            }),
            h(ToolButton, {
              icon: 'frame',
              label: strings.frame,
              title: strings.addFrame,
              disabled: artboards.length === 0,
              onClick: function () { addLayer('frame') },
            }),
            h(ToolButton, {
              icon: 'image',
              label: strings.image,
              title: strings.addImage,
              disabled: artboards.length === 0,
              onClick: function () { openImagePicker('toolbar') },
            }),
            h(ToolButton, {
              icon: 'comment',
              label: strings.comment,
              title: strings.comment,
              disabled: !selectedLayerId,
              onClick: function () {
                if (selectedLayerId) openComposerFor(selectedLayerId, null)
              },
            }),
            h(ToolButton, {
              icon: 'copy',
              label: strings.duplicate,
              title: strings.duplicate + ' (Ctrl/Cmd+D)',
              disabled: !selectedLayerId,
              onClick: function () {
                duplicateSelected()
              },
            }),
            // Feature parts add their own tool buttons here (line, button preset, export, …).
            renderExtensions(EXTENSIONS.toolbar, editorApi),
          ),
          h('span', { className: 'dc-spacer' }),
          h(
            'div',
            { className: 'dc-tool-group' },
            h(ToolButton, {
              icon: 'layers',
              label: strings.layers,
              active: treeOpen,
              onClick: function () {
                setTreeOpen(!treeOpen)
              },
            }),
            h(ToolButton, {
              icon: 'inspector',
              label: strings.inspector,
              active: inspectorOpen,
              onClick: function () {
                setInspectorOpen(!inspectorOpen)
              },
            }),
          ),
        ),
        // Selection tools (align/distribute/group/…) appear while something is selected.
        EXTENSIONS.selection.length && (selectedLayerId || selectedArtboardId)
          ? h(
              'div',
              { className: 'dc-selection-bar', key: 'selection-bar' },
              renderExtensions(EXTENSIONS.selection, editorApi),
            )
          : null,
        h(
          'div',
          { className: 'dc-body' },
          treeOpen
            ? h(LayerTree, {
                key: 'tree',
                tree: tree,
                strings: strings,
                selectedLayerId: selectedLayerId,
                selectedArtboardId: selectedArtboardId,
                openCounts: commentIndex.openCounts,
                actions: {
                  selectLayer: selectLayer,
                  selectArtboard: selectArtboard,
                  toggleVisible: toggleVisible,
                  moveSelected: moveSelected,
                  deleteSelected: deleteSelectedLayer,
                  reparent: reparentLayer,
                  toggleTree: function () {
                    setTreeOpen(false)
                  },
                },
              })
            : null,
          h(
            'div',
            {
              key: 'canvas',
              className:
                'dc-canvas' +
                (commentMode ? ' dc-comment-mode' : '') +
                (gestureActive ? ' dc-gesture-active' : '') +
                (panning ? ' dc-panning' : '') +
                (spaceHeld && !panning ? ' dc-space-pan' : '') +
                (dragOver ? ' dc-drag-over' : ''),
              ref: canvasRef,
              title: dragOver ? strings.imageHint : undefined,
              onPointerDown: canvasPointerDown,
              onPointerMove: canvasPointerMove,
              onPointerUp: canvasPointerUp,
              onPointerCancel: canvasPointerCancel,
              onPointerEnter: function () {
                canvasHoverRef.current = true
              },
              onPointerLeave: function () {
                canvasHoverRef.current = false
              },
              onDragOver: canvasDragOver,
              onDragLeave: canvasDragLeave,
              onDrop: canvasDrop,
            },
            artboards.length === 0
              ? h(
                  'div',
                  { className: 'dc-center' },
                  h(Glyph, { name: 'frame', size: 20 }),
                  h('div', { className: 'dc-center-text' }, strings.noArtboards),
                  h(
                    'button',
                    { type: 'button', className: 'dc-btn dc-btn-primary', onClick: addArtboard },
                    strings.addArtboard,
                  ),
                )
              : h(
                  'div',
                  {
                    className: 'dc-stage',
                    style: {
                      width: Math.max(1, layout.width),
                      height: Math.max(1, layout.height),
                      transform:
                        'translate(' +
                        camera.x +
                        'px, ' +
                        camera.y +
                        'px) scale(' +
                        camera.zoom +
                        ')',
                    },
                  },
                  artboards.map(function (artboard) {
                    if (!isObject(artboard)) return null
                    const computedEntry = computedByArtboard.get(artboard.id) || null
                    return h(ArtboardView, {
                      key: String(artboard.id),
                      artboard: artboard,
                      entry: layout.entryById.get(artboard.id) || null,
                      nodes: computedEntry ? computedEntry.layers : [],
                      selectedNode: selectedNode,
                      zoom: camera.zoom,
                      strings: strings,
                      handlers: handlers,
                      selectedLayerId: selectedLayerId,
                      selectedArtboardId: selectedArtboardId,
                      pins: commentIndex.pinsByArtboard.get(artboard.id) || [],
                    })
                  }),
                ),
            composerPlacement
              ? h(
                  'div',
                  {
                    className: 'dc-composer',
                    key: 'composer',
                    style: { left: composerPlacement.left, top: composerPlacement.top },
                    onPointerDown: function (event) {
                      event.stopPropagation()
                    },
                  },
                  h(
                    'div',
                    { className: 'dc-composer-title' },
                    strings.commentOn +
                      ': ' +
                      (composerPlacement.target.name || composerPlacement.target.id),
                  ),
                  h('textarea', {
                    className: 'dc-textarea dc-composer-text',
                    rows: 3,
                    autoFocus: true,
                    value: composer && composer.text,
                    placeholder: strings.commentPlaceholder,
                    onChange: function (event) {
                      handlers.composerChange(event.target.value)
                    },
                    onKeyDown: function (event) {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        handlers.composerCancel()
                      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        handlers.composerSend()
                      }
                    },
                  }),
                  commentError ? h('div', { className: 'dc-composer-error' }, commentError) : null,
                  h(
                    'div',
                    { className: 'dc-composer-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dc-btn',
                        disabled: commentBusy,
                        onClick: handlers.composerCancel,
                      },
                      strings.cancel,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dc-btn dc-btn-primary',
                        disabled: commentBusy || !String((composer && composer.text) || '').trim(),
                        onClick: handlers.composerSend,
                      },
                      commentBusy ? strings.sending : strings.send,
                    ),
                  ),
                )
              : null,
          ),
          inspectorOpen
            ? h(Inspector, {
                key: 'inspector',
                doc: doc,
                tree: tree,
                strings: strings,
                selectedLayerId: selectedLayerId,
                selectedArtboardId: selectedArtboardId,
                comments: selectedComments,
                extensionContext: editorApi,
                actions: {
                  commitLayer: commitLayer,
                  commitArtboard: commitArtboard,
                  enableLayout: function () {
                    setFrameAutoLayout(true)
                  },
                  disableLayout: function () {
                    setFrameAutoLayout(false)
                  },
                  patchLayout: patchFrameLayout,
                  reparent: reparentLayer,
                  commitShadow: commitShadow,
                  clearShadow: clearShadow,
                  resolveComment: function (commentId) {
                    setCommentStatus(commentId, 'resolved')
                  },
                  reopenComment: function (commentId) {
                    setCommentStatus(commentId, 'open')
                  },
                  deleteComment: deleteCommentById,
                  openComposer: function () {
                    const composedLayerId = selectedLayerIdRef.current
                    if (composedLayerId) openComposerFor(composedLayerId, null)
                  },
                  chooseImageFile: function () {
                    openImagePicker('inspector')
                  },
                  toggleInspector: function () {
                    setInspectorOpen(false)
                  },
                },
              })
            : null,
        ),
        // Full-app overlays registered by feature parts (export dialog, shortcuts sheet, …).
        renderExtensions(EXTENSIONS.appPanels, editorApi),
      )
    }

    /* ------------------------------------------------------------------------------------------
     * Body entry + conversation-row button
     * ---------------------------------------------------------------------------------------- */
