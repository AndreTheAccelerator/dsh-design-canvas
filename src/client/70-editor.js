    /**
     * Canvas editor state machine: document sync with the Host, selection, camera, history,
     * gestures, mutations and comment flow. `CanvasRoot` (74-shell.js) renders it.
     *
     * Everything this hook returns is read by the shell; parts that only need one slice read
     * that slice. Adding state means adding it here and destructuring it in the shell.
     */
    function useEditor(sessionId) {
      const strings = React.useMemo(function () {
        return stringsFor(currentLocaleId())
      }, [])

      const [doc, setDoc] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      const [boardPath, setBoardPath] = React.useState('design-board.json')
      const [loading, setLoading] = React.useState(true)
      const [loadError, setLoadError] = React.useState('')
      const [status, setStatus] = React.useState('synced')
      const [inlineError, setInlineError] = React.useState('')
      const [selectedLayerId, setSelectedLayerId] = React.useState(null)
      const [selectedArtboardId, setSelectedArtboardId] = React.useState(null)
      const [camera, setCamera] = React.useState(defaultCamera)
      const [panning, setPanning] = React.useState(false)
      const [spaceHeld, setSpaceHeld] = React.useState(false)
      const [dragOver, setDragOver] = React.useState(false)
      const [commentMode, setCommentMode] = React.useState(false)
      const [composer, setComposer] = React.useState(null)
      const [commentBusy, setCommentBusy] = React.useState(false)
      const [commentError, setCommentError] = React.useState('')
      const [gestureActive, setGestureActive] = React.useState(false)
      const [treeOpen, setTreeOpen] = React.useState(true)
      const [inspectorOpen, setInspectorOpen] = React.useState(true)

      const docRef = React.useRef(null)
      const versionRef = React.useRef(0)
      const cameraRef = React.useRef(defaultCamera())
      const panRef = React.useRef(null)
      const spaceHeldRef = React.useRef(false)
      const imageInputRef = React.useRef(null)
      const imagePickSourceRef = React.useRef('toolbar')
      const selectedLayerIdRef = React.useRef(null)
      const selectedArtboardIdRef = React.useRef(null)
      const gestureRef = React.useRef(null)
      const treeRef = React.useRef(null)
      const inFlightRef = React.useRef(0)
      const lastLocalVersionRef = React.useRef(0)
      const statusTimerRef = React.useRef(null)
      const disposedRef = React.useRef(false)
      const mountReportedRef = React.useRef(false)
      const fitPendingRef = React.useRef(true)
      const canvasRef = React.useRef(null)
      const appRef = React.useRef(null)
      const canvasHoverRef = React.useRef(false)
      const historyRef = React.useRef({ undo: [], redo: [] })
      const applyingHistoryRef = React.useRef(false)
      const nudgeRef = React.useRef(null)

      React.useEffect(
        function () {
          selectedLayerIdRef.current = selectedLayerId
          selectedArtboardIdRef.current = selectedArtboardId
        },
        [selectedLayerId, selectedArtboardId],
      )

      /* ------------------------------- local doc application ------------------------------- */

      const applyDoc = React.useCallback(function (nextDoc, nextVersion) {
        docRef.current = nextDoc
        if (typeof nextVersion === 'number') versionRef.current = nextVersion
        if (disposedRef.current) return
        setDoc(nextDoc)
        if (typeof nextVersion === 'number') setVersion(nextVersion)
      }, [])

      const applyDocLocal = React.useCallback(
        function (nextDoc) {
          if (!nextDoc) return
          applyDoc(nextDoc, versionRef.current)
        },
        [applyDoc],
      )

      function patchLocalLayer(layerId, patch) {
        const current = docRef.current
        if (!current) return
        const next = docPatchLayer(current, layerId, patch)
        if (next !== current) applyDocLocal(next)
      }

      /* ------------------------------- sync effect ------------------------------- */

      React.useEffect(
        function () {
          if (!sessionId) return undefined
          disposedRef.current = false
          mountReportedRef.current = false
          fitPendingRef.current = true
          lastLocalVersionRef.current = 0
          applyDoc(null, 0)
          setLoading(true)
          setLoadError('')
          setInlineError('')
          setStatus('synced')
          setSelectedLayerId(null)
          setSelectedArtboardId(null)
          setComposer(null)
          setCommentError('')
          setTreeOpen(true)
          setInspectorOpen(true)
          panRef.current = null
          setPanning(false)
          spaceHeldRef.current = false
          setSpaceHeld(false)
          setDragOver(false)
          cameraRef.current = defaultCamera()
          setCamera(cameraRef.current)
          historyRef.current = { undo: [], redo: [] }
          applyingHistoryRef.current = false
          if (nudgeRef.current && nudgeRef.current.timer) {
            clearTimeout(nudgeRef.current.timer)
            nudgeRef.current = null
          }

          let cancelled = false
          let timer = null

          function failInitial(error) {
            if (cancelled) return
            const message = messageOf(error)
            setLoading(false)
            setLoadError(message)
            setStatus('offline')
            beacon('state-load-failed', { message: message.slice(0, 200) })
            report({
              sessionId: sessionId,
              kind: 'error',
              message: 'state load failed: ' + message.slice(0, 2000),
            })
          }

          function loadInitial() {
            beacon('state-loading', { sessionId: String(sessionId).slice(0, 40) })
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                if (!data || !data.doc) throw new Error('design-canvas state response has no document')
                lastLocalVersionRef.current = typeof data.version === 'number' ? data.version : 0
                if (data.path) setBoardPath(String(data.path))
                applyDoc(data.doc, lastLocalVersionRef.current)
                setLoading(false)
                setLoadError('')
                setStatus('synced')
                beacon('state-loaded', { version: data.version })
              })
              .catch(function (error) {
                failInitial(error)
              })
          }

          function poll() {
            if (cancelled) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            if (gestureRef.current) return
            if (inFlightRef.current > 0) return
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                setStatus(function (previous) {
                  return previous === 'offline' ? 'synced' : previous
                })
                if (!data || !data.doc) return
                if (data.path) setBoardPath(String(data.path))
                const remoteVersion = typeof data.version === 'number' ? data.version : 0
                if (remoteVersion <= versionRef.current) return
                const external = remoteVersion !== lastLocalVersionRef.current
                applyDoc(data.doc, remoteVersion)
                beacon('state-loaded', { version: remoteVersion, external: external })
                if (external) {
                  setStatus('revising')
                  if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
                  statusTimerRef.current = setTimeout(function () {
                    statusTimerRef.current = null
                    setStatus(function (previous) {
                      return previous === 'revising' ? 'synced' : previous
                    })
                  }, 2500)
                }
              })
              .catch(function (error) {
                if (cancelled) return
                setStatus('offline')
                beacon('poll-failed', { message: shortError(error) })
              })
          }

          loadInitial()
          timer = setInterval(poll, POLL_MS)
          function onVisibilityChange() {
            if (document.visibilityState === 'visible') poll()
          }
          document.addEventListener('visibilitychange', onVisibilityChange)

          return function () {
            cancelled = true
            disposedRef.current = true
            if (timer !== null) clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            if (statusTimerRef.current) {
              clearTimeout(statusTimerRef.current)
              statusTimerRef.current = null
            }
          }
        },
        [sessionId, applyDoc],
      )

      /* ------------------------------- camera: viewport, fit, zoom ------------------------------- */

      function canvasViewport() {
        const node = canvasRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') {
          return { left: 0, top: 0, width: 0, height: 0 }
        }
        try {
          const rect = node.getBoundingClientRect()
          return {
            left: finiteNumber(rect && rect.left, 0),
            top: finiteNumber(rect && rect.top, 0),
            width: Math.max(0, finiteNumber(rect && rect.width, 0)),
            height: Math.max(0, finiteNumber(rect && rect.height, 0)),
          }
        } catch (error) {
          return { left: 0, top: 0, width: 0, height: 0 }
        }
      }

      /** Viewport (client) coordinates -> canvas/document coordinates through the camera. */
      function screenToCanvas(clientX, clientY) {
        const viewport = canvasViewport()
        const cam = cameraRef.current
        const zoom = cam.zoom > 0 ? cam.zoom : 1
        return {
          x: (finiteNumber(clientX, 0) - viewport.left - cam.x) / zoom,
          y: (finiteNumber(clientY, 0) - viewport.top - cam.y) / zoom,
        }
      }

      /** Canvas/document coordinates -> viewport-local pixels (for unscaled overlays). */
      function projectToViewport(canvasX, canvasY) {
        const cam = cameraRef.current
        return {
          x: cam.x + finiteNumber(canvasX, 0) * cam.zoom,
          y: cam.y + finiteNumber(canvasY, 0) * cam.zoom,
        }
      }

      function setCameraValue(next) {
        const value = normalizeCamera(next, cameraRef.current)
        cameraRef.current = value
        setCamera(value)
        return value
      }

      /** Zoom while keeping the canvas point under (viewportX, viewportY) pinned. */
      function zoomAboutViewportPoint(viewportX, viewportY, nextZoom) {
        const cam = cameraRef.current
        const zoom = clamp(roundTo(nextZoom, 3), MIN_ZOOM, MAX_ZOOM)
        const anchorX = finiteNumber(viewportX, 0)
        const anchorY = finiteNumber(viewportY, 0)
        const canvasX = (anchorX - cam.x) / (cam.zoom || 1)
        const canvasY = (anchorY - cam.y) / (cam.zoom || 1)
        return setCameraValue({
          x: anchorX - canvasX * zoom,
          y: anchorY - canvasY * zoom,
          zoom: zoom,
        })
      }

      function zoomCameraBy(delta) {
        const viewport = canvasViewport()
        return zoomAboutViewportPoint(
          viewport.width / 2,
          viewport.height / 2,
          cameraRef.current.zoom + delta,
        )
      }

      /** Camera that frames every artboard inside the current viewport. */
      function computeFitCamera() {
        const viewport = canvasViewport()
        const current = docRef.current
        const layout = computeLayout(current)
        if (layout.width <= 0 || layout.height <= 0) return defaultCamera()
        const availableWidth = Math.max(120, viewport.width - FIT_PADDING)
        const availableHeight = Math.max(120, viewport.height - FIT_PADDING)
        const zoom = clamp(
          roundTo(Math.min(availableWidth / layout.width, availableHeight / layout.height), 2),
          MIN_ZOOM,
          MAX_ZOOM,
        )
        const x = Math.round((viewport.width - layout.width * zoom) / 2)
        const y = Math.round((viewport.height - layout.height * zoom) / 2)
        return {
          x: Number.isFinite(x) ? x : CAMERA_DEFAULT_X,
          y: Number.isFinite(y) ? y : CAMERA_DEFAULT_Y,
          zoom: zoom,
        }
      }

      function fitCamera() {
        const value = setCameraValue(computeFitCamera())
        beacon('camera-fit', { zoom: value.zoom, x: value.x, y: value.y })
        return value
      }

      React.useEffect(
        function () {
          beacon('body-mounted-start', { hasSession: true })
        },
        [],
      )

      React.useEffect(
        function () {
          if (!doc || !fitPendingRef.current) return
          const viewport = canvasViewport()
          // The tab can mount before the sidebar has a measurable size; keep the flag
          // so the first resize/measure still frames the artboards.
          if (viewport.width <= 0 || viewport.height <= 0) return
          fitPendingRef.current = false
          fitCamera()
        },
        [doc],
      )

      React.useEffect(
        function () {
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
            return undefined
          }
          function onWindowResize() {
            if (!fitPendingRef.current || !docRef.current) return
            const viewport = canvasViewport()
            if (viewport.width <= 0 || viewport.height <= 0) return
            fitPendingRef.current = false
            fitCamera()
          }
          window.addEventListener('resize', onWindowResize)
          return function () {
            try {
              window.removeEventListener('resize', onWindowResize)
            } catch (error) {
              /* window may already be gone */
            }
          }
        },
        [],
      )

      React.useEffect(
        function () {
          if (!doc || mountReportedRef.current) return
          mountReportedRef.current = true
          const node = canvasRef.current
          let width = 0
          let height = 0
          try {
            const rect = node ? node.getBoundingClientRect() : null
            width = rect ? Math.round(rect.width) : 0
            height = rect ? Math.round(rect.height) : 0
          } catch (error) {
            width = 0
            height = 0
          }
          const stats = {
            artboards: artboardsOf(doc).length,
            layers: countLayers(doc),
            comments: commentsOf(doc).length,
            width: width,
            height: height,
            zoom: roundTo(cameraRef.current.zoom, 2),
          }
          beacon('body-mounted', stats)
          report({ sessionId: sessionId, kind: 'mount', stats: stats, services: servicesSnapshot() })
        },
        [doc, sessionId],
      )

      /* ------------------------------- selection reconciliation ------------------------------- */

      React.useEffect(
        function () {
          if (!doc) return
          if (selectedLayerId && !findLayerById(doc, selectedLayerId)) setSelectedLayerId(null)
          if (selectedArtboardId && !findArtboardById(doc, selectedArtboardId)) setSelectedArtboardId(null)
          if (composer && !findLayerById(doc, composer.layerId)) setComposer(null)
        },
        [doc, selectedLayerId, selectedArtboardId, composer],
      )

      /* ------------------------------- ops bridge ------------------------------- */

      function runOps(ops) {
        if (!docRef.current) return Promise.resolve({ ok: false, errors: [], applied: [] })
        inFlightRef.current += 1
        setStatus('saving')
        return postOps(sessionId, ops)
          .then(function (data) {
            const errors = data && Array.isArray(data.errors) ? data.errors : []
            const remoteVersion =
              data && typeof data.version === 'number' ? data.version : versionRef.current
            // Never let an out-of-order response clobber a newer local document.
            if (data && data.doc && !gestureRef.current && remoteVersion >= versionRef.current) {
              applyDoc(data.doc, remoteVersion)
            }
            lastLocalVersionRef.current = remoteVersion
            if (data && data.path) setBoardPath(String(data.path))
            if (errors.length === 0) {
              beacon('ops-ok', { count: ops.length, version: data && data.version })
              setInlineError('')
            } else {
              const text = errors
                .map(function (entry) {
                  return (entry && (entry.message || entry.code)) || 'operation failed'
                })
                .join('; ')
              setInlineError(text)
              beacon('ops-errors', { count: errors.length })
            }
            return {
              ok: errors.length === 0,
              errors: errors,
              doc: data && data.doc ? data.doc : null,
              applied: data && Array.isArray(data.applied) ? data.applied : [],
              version: data && data.version,
            }
          })
          .catch(function (error) {
            const message = messageOf(error)
            setInlineError(message)
            setStatus('offline')
            beacon('ops-failed', { message: message.slice(0, 200) })
            getState(sessionId)
              .then(function (data) {
                if (gestureRef.current) return
                if (data && data.doc) {
                  lastLocalVersionRef.current =
                    typeof data.version === 'number' ? data.version : versionRef.current
                  applyDoc(data.doc, data.version)
                  setStatus('synced')
                  if (data.path) setBoardPath(String(data.path))
                }
              })
              .catch(function () {
                /* stays offline; the header offers Retry */
              })
            return { ok: false, errors: [{ message: message }], applied: [] }
          })
          .finally(function () {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1)
            if (inFlightRef.current === 0) {
              setStatus(function (previous) {
                return previous === 'saving' ? 'synced' : previous
              })
            }
          })
      }

      function retryNow() {
        if (!sessionId) return
        setStatus('saving')
        setInlineError('')
        getState(sessionId)
          .then(function (data) {
            if (!data || !data.doc) throw new Error('design-canvas state response has no document')
            lastLocalVersionRef.current =
              typeof data.version === 'number' ? data.version : 0
            if (data.path) setBoardPath(String(data.path))
            applyDoc(data.doc, data.version)
            setLoading(false)
            setLoadError('')
            setStatus('synced')
            beacon('state-loaded', { version: data.version, retry: true })
          })
          .catch(function (error) {
            setStatus('offline')
            setLoadError(messageOf(error))
            beacon('retry-failed', { message: shortError(error) })
          })
      }

      /* ------------------------------- history (undo/redo) ------------------------------- */

      function historyState() {
        return historyRef.current
      }

      function pushHistoryEntry(label, forwardOps, inverseOps) {
        if (!Array.isArray(forwardOps) || forwardOps.length === 0) return null
        if (!Array.isArray(inverseOps) || inverseOps.length === 0) return null
        const entry = { label: label, ops: forwardOps, inverse: inverseOps }
        const history = historyState()
        history.undo.push(entry)
        if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
        history.redo = []
        return entry
      }

      function dropHistoryEntry(entry) {
        const history = historyState()
        const index = history.undo.indexOf(entry)
        if (index >= 0) history.undo.splice(index, 1)
      }

      /** Run one forward batch and remember its inverse (no recording during undo/redo). */
      function commitWithHistory(label, forwardOps, inverseOps) {
        const entry = pushHistoryEntry(label, forwardOps, inverseOps)
        return runOps(forwardOps).then(function (result) {
          if (entry && result && result.ok === false) dropHistoryEntry(entry)
          return result
        })
      }

      /** Previous values for a layer.update patch so the change can be undone. */
      function inversePatchFor(layer, patch) {
        const inverse = {}
        if (!isObject(layer) || !isObject(patch)) return inverse
        Object.keys(patch).forEach(function (key) {
          const previous = layer[key]
          if (previous === undefined) {
            // Absent props: only nullable/boolean defaults can be restored exactly.
            if (key === 'shadow' || key === 'layout' || key === 'alignSelf') inverse[key] = null
            else if (key === 'visible') inverse[key] = true
            else if (key === 'grow' || key === 'clip') inverse[key] = false
            else if (key === 'opacity') inverse[key] = 1
            else if (key === 'letterSpacing') inverse[key] = 0
            else if (key === 'textTransform') inverse[key] = 'none'
            return
          }
          inverse[key] = previous
        })
        return inverse
      }

      /** layer.add ops re-creating a whole subtree (root first, children with parentId). */
      function insertOpsForSubtree(layer, destination, index) {
        const ops = []
        if (!isObject(layer) || !isObject(destination)) return ops
        const rootOp = { type: 'layer.add', layer: opLayerForAdd(layer) }
        if (destination.parentId) rootOp.parentId = destination.parentId
        else if (destination.artboardId) rootOp.artboardId = destination.artboardId
        else return ops
        if (typeof index === 'number') rootOp.index = index
        ops.push(rootOp)
        function addChildren(parentLayer) {
          const kids = childrenOf(parentLayer)
          for (let childIndex = 0; childIndex < kids.length; childIndex += 1) {
            const child = kids[childIndex]
            if (!isObject(child)) continue
            ops.push({
              type: 'layer.add',
              parentId: parentLayer.id,
              index: childIndex,
              layer: opLayerForAdd(child),
            })
            addChildren(child)
          }
        }
        addChildren(layer)
        return ops
      }

      function inverseMoveToOps(found) {
        if (!found || !found.layer) return []
        const op = { type: 'layer.move_to', layerId: found.layer.id, index: found.index }
        if (found.parentId) op.parentId = found.parentId
        else op.artboardId = found.artboard.id
        return [op]
      }

      function undoOnce() {
        try {
          if (applyingHistoryRef.current) return false
          if (gestureRef.current || panRef.current) return false
          flushNudge()
          const history = historyState()
          if (history.undo.length === 0) {
            beacon('undo-empty')
            return false
          }
          const entry = history.undo.pop()
          applyingHistoryRef.current = true
          runOps(entry.inverse).then(
            function (result) {
              applyingHistoryRef.current = false
              if (result && result.ok === false) {
                history.undo.push(entry)
                setInlineError(strings.undoFailed)
                beacon('undo-failed', { label: entry.label })
                return
              }
              history.redo.push(entry)
              if (history.redo.length > HISTORY_LIMIT) history.redo.shift()
              beacon('undo', { label: entry.label, count: entry.inverse.length })
            },
            function () {
              applyingHistoryRef.current = false
              history.undo.push(entry)
            },
          )
          return true
        } catch (error) {
          applyingHistoryRef.current = false
          beacon('undo-threw', { message: shortError(error) })
          return false
        }
      }

      function redoOnce() {
        try {
          if (applyingHistoryRef.current) return false
          if (gestureRef.current || panRef.current) return false
          flushNudge()
          const history = historyState()
          if (history.redo.length === 0) {
            beacon('redo-empty')
            return false
          }
          const entry = history.redo.pop()
          applyingHistoryRef.current = true
          runOps(entry.ops).then(
            function (result) {
              applyingHistoryRef.current = false
              if (result && result.ok === false) {
                history.redo.push(entry)
                setInlineError(strings.redoFailed)
                beacon('redo-failed', { label: entry.label })
                return
              }
              history.undo.push(entry)
              if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
              beacon('redo', { label: entry.label, count: entry.ops.length })
            },
            function () {
              applyingHistoryRef.current = false
              history.redo.push(entry)
            },
          )
          return true
        } catch (error) {
          applyingHistoryRef.current = false
          beacon('redo-threw', { message: shortError(error) })
          return false
        }
      }

      /* ------------------------------- mutations ------------------------------- */

      function selectLayer(layerId, artboardId) {
        setSelectedLayerId(layerId)
        if (artboardId) setSelectedArtboardId(artboardId)
        setComposer(function (previous) {
          return previous && previous.layerId !== layerId ? null : previous
        })
      }

      function selectArtboard(artboardId) {
        setSelectedArtboardId(artboardId)
        setSelectedLayerId(null)
        setComposer(null)
      }

      function clearSelection() {
        setSelectedLayerId(null)
        setComposer(null)
      }

      function openComposerFor(layerId, artboardId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const targetArtboard = artboardId || found.artboard.id
        setSelectedLayerId(layerId)
        setSelectedArtboardId(targetArtboard)
        setCommentError('')
        setComposer({ layerId: layerId, artboardId: targetArtboard, text: '' })
      }

      function commitLayer(patch) {
        const layerId = selectedLayerIdRef.current
        if (!layerId) return
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (found.layer[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        if (count === 0) return
        patchLocalLayer(layerId, changed)
        const ops = [{ type: 'layer.update', layerId: layerId, patch: changed }]
        const inversePatch = inversePatchFor(found.layer, changed)
        const inverse =
          Object.keys(inversePatch).length > 0
            ? [{ type: 'layer.update', layerId: layerId, patch: inversePatch }]
            : []
        commitWithHistory('update', ops, inverse)
      }

      function commitArtboard(patch) {
        const artboardId = selectedArtboardId
        const current = docRef.current
        if (!current || !artboardId) return
        const artboard = findArtboardById(current, artboardId)
        if (!artboard) return
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (artboard[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        if (count === 0) return
        applyDocLocal(docPatchArtboard(current, artboardId, changed))
        const ops = [{ type: 'artboard.update', artboardId: artboardId, patch: changed }]
        const inversePatch = inversePatchFor(artboard, changed)
        const inverse =
          Object.keys(inversePatch).length > 0
            ? [{ type: 'artboard.update', artboardId: artboardId, patch: inversePatch }]
            : []
        commitWithHistory('artboard', ops, inverse)
      }

      function toggleVisible(layerId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!found) return
        const visible = found.layer.visible === false
        patchLocalLayer(layerId, { visible: visible })
        commitWithHistory(
          'visibility',
          [{ type: 'layer.update', layerId: layerId, patch: { visible: visible } }],
          [
            {
              type: 'layer.update',
              layerId: layerId,
              patch: { visible: found.layer.visible !== false },
            },
          ],
        )
      }

      function deleteLayerById(layerId) {
        const current = docRef.current
        const found = current ? findLayerById(current, layerId) : null
        if (!current || !found) return
        const insertOps = insertOpsForSubtree(
          found.layer,
          found.parentId ? { parentId: found.parentId } : { artboardId: found.artboard.id },
          found.index,
        )
        applyDocLocal(docRemoveLayer(current, layerId))
        if (selectedLayerIdRef.current === layerId) setSelectedLayerId(null)
        setComposer(function (previous) {
          return previous && previous.layerId === layerId ? null : previous
        })
        commitWithHistory('delete', [{ type: 'layer.delete', layerId: layerId }], insertOps)
      }

      function deleteSelectedLayer() {
        if (selectedLayerIdRef.current) deleteLayerById(selectedLayerIdRef.current)
      }

      function moveSelected(direction) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        if (!current || !layerId) return
        const found = findLayerById(current, layerId)
        if (!found) return
        const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
        const last = siblings.length - 1
        const target = clamp(found.index + (direction === 'up' ? 1 : -1), 0, last)
        if (target === found.index) return
        applyDocLocal(docReorderLayer(current, layerId, target))
        commitWithHistory(
          'reorder',
          [{ type: 'layer.reorder', layerId: layerId, index: target }],
          [{ type: 'layer.reorder', layerId: layerId, index: found.index }],
        )
        beacon('layer-reorder', { layerId: layerId, index: target, source: 'buttons' })
      }

      /** layer.add must not carry `children` (the Host builds it with parentId adds). */
      function opLayerForAdd(layer) {
        if (!isObject(layer) || layer.type !== 'frame' || !Array.isArray(layer.children)) {
          return layer
        }
        const copy = Object.assign({}, layer)
        delete copy.children
        return copy
      }

      function addLayer(type) {
        const current = docRef.current
        if (!current) return
        const artboards = artboardsOf(current)
        const selectedId = selectedLayerIdRef.current
        let parentFound = null
        if (selectedId) {
          const found = findLayerById(current, selectedId)
          if (found && found.layer && found.layer.type === 'frame') parentFound = found
        }
        let artboard = null
        if (parentFound) {
          artboard = parentFound.artboard
          if (parentFound.depth >= FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            return
          }
          if (childrenOf(parentFound.layer).length >= FRAME_MAX_CHILDREN) {
            setInlineError(strings.childLimit)
            return
          }
        } else {
          artboard =
            (selectedArtboardIdRef.current
              ? findArtboardById(current, selectedArtboardIdRef.current)
              : null) ||
            artboards.find(function (item) {
              return isObject(item)
            }) ||
            null
          if (!artboard) {
            setInlineError(strings.noArtboards)
            return
          }
        }
        const box = parentFound ? parentFound.layer : artboard
        const layer = createLayer(type, box)
        const destination = parentFound
          ? { parentId: parentFound.layer.id }
          : { artboardId: artboard.id }
        applyDocLocal(docInsertLayer(current, destination, layer))
        setSelectedLayerId(layer.id)
        setSelectedArtboardId(artboard.id)
        const op = { type: 'layer.add', layer: opLayerForAdd(layer) }
        if (destination.parentId) op.parentId = destination.parentId
        else op.artboardId = destination.artboardId
        commitWithHistory(
          type === 'frame' ? 'add-frame' : 'add-layer',
          [op],
          [{ type: 'layer.delete', layerId: layer.id }],
        )
        beacon(type === 'frame' ? 'frame-add' : 'layer-add', {
          type: type,
          parentId: destination.parentId,
          artboardId: destination.artboardId,
        })
      }

      function cloneLayerSubtree(layer, offsetX, offsetY) {
        if (!isObject(layer)) return null
        const copy = Object.assign({}, layer, { id: makeId('l') })
        if (offsetX || offsetY) {
          copy.x = Math.round(finiteNumber(layer.x, 0) + offsetX)
          copy.y = Math.round(finiteNumber(layer.y, 0) + offsetY)
        }
        if (layer.type === 'frame') {
          copy.children = childrenOf(layer).map(function (child) {
            return cloneLayerSubtree(child, 0, 0)
          })
        }
        return copy
      }

      /** Duplicate the selected layer/frame (subtree ids remapped) with a 12,12 offset. */
      function duplicateSelected() {
        try {
          const current = docRef.current
          const layerId = selectedLayerIdRef.current
          if (!current || !layerId) return false
          const found = findLayerById(current, layerId)
          if (!found) return false
          const tree = treeRef.current
          const node = tree && tree.byId ? tree.byId.get(layerId) || null : null
          const autoParent = !!(node && node.autoParent)
          // Offset in parent space only for freely positioned layers; auto-layout children
          // derive their position from the layout anyway.
          const offset = autoParent ? 0 : 12
          const copy = cloneLayerSubtree(found.layer, offset, offset)
          if (!copy) return false
          const destination = found.parentId
            ? { parentId: found.parentId }
            : { artboardId: found.artboard.id }
          if (destination.parentId) {
            const parentFound = findLayerById(current, destination.parentId)
            if (!parentFound || !parentFound.layer) return false
            if (childrenOf(parentFound.layer).length >= FRAME_MAX_CHILDREN) {
              setInlineError(strings.childLimit)
              return false
            }
            if (parentFound.depth + subtreeHeight(copy) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return false
            }
          }
          const index = found.index + 1
          const ops = insertOpsForSubtree(copy, destination, index)
          if (ops.length === 0) return false
          // The Host caps ops per batch (default 200); a huge subtree cannot be copied at once.
          if (ops.length > 200) {
            setInlineError(strings.duplicateTooLarge)
            beacon('duplicate-rejected', { layerId: layerId, ops: ops.length })
            return false
          }
          applyDocLocal(docInsertLayer(current, destination, copy, index))
          setSelectedLayerId(copy.id)
          setSelectedArtboardId(found.artboard.id)
          commitWithHistory('duplicate', ops, [{ type: 'layer.delete', layerId: copy.id }])
          beacon('duplicate', { count: ops.length, layerId: copy.id, autoParent: autoParent })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-failed', { message: shortError(error) })
          return false
        }
      }

      function nudgeSelected(dx, dy) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        if (!current || !layerId) return
        const tree = treeRef.current
        const node = tree && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        if (node.autoParent) {
          setInlineError(strings.nudgeAutoLayout)
          beacon('nudge-blocked', { layerId: layerId, reason: 'auto-layout' })
          return
        }
        const pending = nudgeRef.current
        if (pending && pending.layerId !== layerId) {
          // Commit the pending delta for the previous layer before starting a new batch.
          flushNudge()
        } else if (pending) {
          pending.dx += dx
          pending.dy += dy
          return
        }
        nudgeRef.current = {
          layerId: layerId,
          dx: dx,
          dy: dy,
          timer: setTimeout(flushNudge, NUDGE_BATCH_MS),
        }
      }

      function flushNudge() {
        try {
          const pending = nudgeRef.current
          if (!pending) return
          nudgeRef.current = null
          if (pending.timer) clearTimeout(pending.timer)
          const current = docRef.current
          if (!current) return
          const found = findLayerById(current, pending.layerId)
          if (!found) return
          const tree = treeRef.current
          const node = tree && tree.byId ? tree.byId.get(pending.layerId) || null : null
          if (node && node.autoParent) return
          const previousX = finiteNumber(found.layer.x, 0)
          const previousY = finiteNumber(found.layer.y, 0)
          const nextX = Math.round(previousX + pending.dx)
          const nextY = Math.round(previousY + pending.dy)
          if (nextX === previousX && nextY === previousY) return
          patchLocalLayer(pending.layerId, { x: nextX, y: nextY })
          commitWithHistory(
            'nudge',
            [{ type: 'layer.update', layerId: pending.layerId, patch: { x: nextX, y: nextY } }],
            [
              {
                type: 'layer.update',
                layerId: pending.layerId,
                patch: { x: previousX, y: previousY },
              },
            ],
          )
          beacon('nudge', { dx: pending.dx, dy: pending.dy, layerId: pending.layerId })
        } catch (error) {
          beacon('nudge-failed', { message: shortError(error) })
        }
      }

      function commitShadow(value) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        if (!found) return
        const text = typeof value === 'string' ? value.trim() : ''
        if (!text) {
          commitLayer({ shadow: null })
          return
        }
        if (text.length > 200 || /[\n\r{};]/.test(text)) {
          setInlineError(strings.shadowInvalid)
          beacon('shadow-rejected', { length: text.length })
          return
        }
        commitLayer({ shadow: text })
      }

      function clearShadow() {
        commitLayer({ shadow: null })
      }

      /** Move an existing layer under another frame or back to an artboard root (append). */
      function reparentLayer(layerId, destination) {
        try {
          if (!isObject(destination)) return
          const current = docRef.current
          if (!current) return
          const found = findLayerById(current, layerId)
          if (!found) return
          const targetParentId =
            typeof destination.parentId === 'string' && destination.parentId
              ? destination.parentId
              : null
          const targetArtboardId =
            typeof destination.artboardId === 'string' && destination.artboardId
              ? destination.artboardId
              : null
          if (!targetParentId && !targetArtboardId) return
          const sameParent = targetParentId
            ? targetParentId === found.parentId
            : !found.parentId && targetArtboardId === found.artboard.id
          if (sameParent) return
          let destList = null
          let destArtboard = null
          if (targetParentId) {
            const parentFound = findLayerById(current, targetParentId)
            if (!parentFound || !parentFound.layer || parentFound.layer.type !== 'frame') {
              setInlineError(strings.reparentFailed)
              return
            }
            if (found.layer.type === 'frame' && subtreeContains(found.layer, targetParentId)) {
              setInlineError(strings.reparentFailed)
              return
            }
            if (parentFound.depth >= FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return
            }
            if (parentFound.depth + subtreeHeight(found.layer) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return
            }
            destList = childrenOf(parentFound.layer)
            destArtboard = parentFound.artboard
          } else {
            const board = findArtboardById(current, targetArtboardId)
            if (!board) {
              setInlineError(strings.reparentFailed)
              return
            }
            destList = layersOf(board)
            destArtboard = board
          }
          if (targetParentId && destList.length >= FRAME_MAX_CHILDREN) {
            setInlineError(strings.childLimit)
            return
          }
          const index = destList.length
          applyDocLocal(
            docMoveLayer(
              current,
              layerId,
              targetParentId ? { parentId: targetParentId } : { artboardId: targetArtboardId },
              index,
            ),
          )
          const op = { type: 'layer.move_to', layerId: layerId, index: index }
          if (targetParentId) op.parentId = targetParentId
          else op.artboardId = targetArtboardId
          commitWithHistory('reparent', [op], inverseMoveToOps(found))
          if (destArtboard) setSelectedArtboardId(destArtboard.id)
          beacon('reparent', {
            layerId: layerId,
            parentId: targetParentId || undefined,
            artboardId: targetArtboardId || undefined,
          })
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('reparent-failed', { message: shortError(error) })
        }
      }

      function currentFrameForLayout() {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        return found && found.layer && found.layer.type === 'frame' ? found : null
      }

      /** Toggle a frame between absolute mode (layout:null) and CSS auto layout. */
      function setFrameAutoLayout(enabled) {
        const found = currentFrameForLayout()
        if (!found) return
        if (!enabled) {
          if (!isObject(found.layer.layout)) return
          commitLayer({ layout: null })
          beacon('layout-change', { layerId: found.layer.id, mode: 'off' })
          return
        }
        if (isObject(found.layer.layout)) return
        commitLayer({ layout: defaultLayoutObject() })
        beacon('layout-change', { layerId: found.layer.id, mode: 'on' })
      }

      /** Patch one or more layout fields in a single layer.update (layout replaces wholesale). */
      function patchFrameLayout(patch) {
        const found = currentFrameForLayout()
        if (!found) return
        const base = normalizeLayoutObject(found.layer.layout) || defaultLayoutObject()
        const next = Object.assign({}, base, isObject(patch) ? patch : {})
        if (patch && isObject(patch.padding)) {
          next.padding = Object.assign({}, base.padding, patch.padding)
        }
        commitLayer({ layout: next })
        beacon('layout-change', {
          layerId: found.layer.id,
          mode: 'update',
          direction: next.direction,
        })
      }

      function addArtboard() {
        const current = docRef.current
        if (!current) return
        if (artboardsOf(current).length >= 50) {
          setInlineError(strings.noArtboards)
          return
        }
        const artboard = createArtboard(current)
        applyDocLocal(docInsertArtboard(current, artboard))
        setSelectedArtboardId(artboard.id)
        setSelectedLayerId(null)
        setComposer(null)
        fitPendingRef.current = true
        commitWithHistory(
          'add-artboard',
          [{ type: 'artboard.add', artboard: artboard }],
          [{ type: 'artboard.delete', artboardId: artboard.id }],
        )
      }

      function setCommentStatus(commentId, commentStatus) {
        const current = docRef.current
        if (!current) return
        applyDocLocal(docPatchComment(current, commentId, { status: commentStatus }))
        runOps([{ type: 'comment.update', commentId: commentId, status: commentStatus }])
      }

      function deleteCommentById(commentId) {
        const current = docRef.current
        if (!current) return
        applyDocLocal(docRemoveComment(current, commentId))
        runOps([{ type: 'comment.delete', commentId: commentId }])
      }

      /* ------------------------------- comment composer -> chat ------------------------------- */

      async function sendCommentChat(details) {
        const sessions = runtime.sessions
        if (!sessions || typeof sessions.using !== 'function') {
          throw new Error(strings.sessionUnavailable)
        }
        const text = buildCommentMessage(details, strings)
        const outcome = await sessions.using(
          sessionId,
          { source: 'controllerOperation' },
          async function (reference) {
            const session = reference && reference.binding ? reference.binding.session : null
            if (!session || typeof session.prompt !== 'function') {
              throw new Error(strings.sessionUnavailable)
            }
            const result = await session.prompt([{ type: 'text', text: text }], 'queue')
            if (result && result.ok === false) {
              const detail = result.error || {}
              throw new Error(detail.message || detail.code || 'prompt rejected')
            }
            return true
          },
        )
        beacon('chat-sent', { ok: true })
        return outcome
      }

      async function submitComment() {
        const active = composer
        if (!active) return
        const text = String(active.text || '').trim()
        if (!text) return
        setCommentBusy(true)
        setCommentError('')
        try {
          const result = await runOps([
            {
              type: 'comment.add',
              artboardId: active.artboardId,
              layerId: active.layerId,
              text: text,
            },
          ])
          if (!result.ok) {
            const first = result.errors && result.errors[0]
            setCommentError((first && (first.message || first.code)) || strings.postFailed)
            return
          }
          let commentId = null
          const applied = result.applied || []
          for (let index = 0; index < applied.length; index += 1) {
            if (applied[index] && applied[index].type === 'comment.add' && applied[index].id) {
              commentId = applied[index].id
              break
            }
          }
          const current = docRef.current
          const found = current ? findLayerById(current, active.layerId) : null
          const computed = treeRef.current && treeRef.current.byId
            ? treeRef.current.byId.get(active.layerId) || null
            : null
          setComposer(null)
          setCommentMode(false)
          try {
            await sendCommentChat({
              boardPath: boardPath,
              version: current && current.version,
              artboard: found ? found.artboard : null,
              layer: found ? found.layer : null,
              parentId: found ? found.parentId : null,
              renderedRect: computed ? computed.worldRect : null,
              commentId: commentId,
              text: text,
            })
          } catch (error) {
            const message = messageOf(error)
            setInlineError(strings.chatFailed + ': ' + message)
            beacon('chat-failed', { message: message.slice(0, 200) })
            report({
              sessionId: sessionId,
              kind: 'error',
              message: 'chat request failed: ' + message.slice(0, 2000),
            })
          }
        } catch (error) {
          const message = messageOf(error)
          setCommentError(message)
          beacon('comment-failed', { message: message.slice(0, 200) })
          beacon('error', { message: message.slice(0, 200) })
        } finally {
          setCommentBusy(false)
        }
      }

      /* ------------------------------- pointer gestures ------------------------------- */

      /** Patch for a layer gesture. `resize-auto` children only get width/height (never x/y). */
      function gesturePatch(gesture, dx, dy) {
        const origin = gesture.origin
        if (gesture.kind === 'drag') {
          return {
            x: Math.round(origin.x + dx),
            y: Math.round(origin.y + dy),
          }
        }
        let x = origin.x
        let y = origin.y
        let width = origin.width
        let height = origin.height
        const handle = String(gesture.handle || '')
        if (handle.indexOf('e') >= 0) width = origin.width + dx
        if (handle.indexOf('w') >= 0) {
          width = origin.width - dx
          x = origin.x + dx
        }
        if (handle.indexOf('s') >= 0) height = origin.height + dy
        if (handle.indexOf('n') >= 0) {
          height = origin.height - dy
          y = origin.y + dy
        }
        if (width < MIN_LAYER_SIZE) {
          if (handle.indexOf('w') >= 0) x = origin.x + origin.width - MIN_LAYER_SIZE
          width = MIN_LAYER_SIZE
        }
        if (height < MIN_LAYER_SIZE) {
          if (handle.indexOf('n') >= 0) y = origin.y + origin.height - MIN_LAYER_SIZE
          height = MIN_LAYER_SIZE
        }
        if (gesture.kind === 'resize-auto') {
          // Auto-layout children keep authored width/height only; their x/y are derived.
          return { width: Math.round(width), height: Math.round(height) }
        }
        return {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        }
      }

      function beginGesture(event, node, handle) {
        if (!node || !isObject(node.layer)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const found = docRef.current ? findLayerById(docRef.current, node.layer.id) : null
        if (!found) return
        // Commit any batched arrow-key nudge before a pointer gesture starts.
        flushNudge()
        const autoParent = !!node.autoParent
        event.preventDefault()
        event.stopPropagation()
        const target = event.currentTarget
        try {
          if (target && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(event.pointerId)
          }
        } catch (error) {
          /* pointer capture is best-effort */
        }
        gestureRef.current = {
          pointerId: event.pointerId,
          kind: handle
            ? autoParent
              ? 'resize-auto'
              : 'resize'
            : autoParent
              ? 'reorder'
              : 'drag',
          handle: handle || null,
          layerId: node.layer.id,
          artboardId: found.artboard.id,
          parentId: found.parentId,
          autoParent: autoParent,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          clientX: finiteNumber(event.clientX, 0),
          clientY: finiteNumber(event.clientY, 0),
          origin: {
            x: finiteNumber(found.layer.x, 0),
            y: finiteNumber(found.layer.y, 0),
            width: Math.max(1, finiteNumber(found.layer.width, 1)),
            height: Math.max(1, finiteNumber(found.layer.height, 1)),
          },
          moved: false,
        }
        setGestureActive(true)
      }

      function layerPointerDown(event, node) {
        if (!node || !isObject(node.layer)) return
        // Middle-drag and space+drag pan the canvas instead of manipulating the layer.
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const found = docRef.current ? findLayerById(docRef.current, node.layer.id) : null
        if (!found) return
        if (commentMode) {
          event.preventDefault()
          event.stopPropagation()
          openComposerFor(found.layer.id, found.artboard.id)
          return
        }
        selectLayer(found.layer.id, found.artboard.id)
        beginGesture(event, node, null)
      }

      function handlePointerDown(event, handle) {
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const tree = treeRef.current
        const layerId = selectedLayerIdRef.current
        const node = tree && layerId && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        beginGesture(event, node, handle)
      }

      /** Insertion index inside an auto-layout parent, from the pointer's main-axis position. */
      function computeReorderIndex(gesture, clientX, clientY) {
        const current = docRef.current
        if (!current) return null
        const found = findLayerById(current, gesture.layerId)
        if (!found || !found.parent) return null
        const tree = treeRef.current
        const parentNode = tree && tree.byId ? tree.byId.get(found.parent.id) || null : null
        if (!parentNode) return null
        const layoutValue = normalizeLayoutObject(found.parent.layout)
        if (!layoutValue) return null
        const layoutInfo = computeLayout(current)
        const entry = layoutInfo.entryById.get(found.artboard.id) || null
        const point = screenToCanvas(clientX, clientY)
        const originX = entry ? entry.frameX : 0
        const originY = entry ? entry.frameY : 0
        const relX = point.x - originX - parentNode.worldRect.x
        const relY = point.y - originY - parentNode.worldRect.y
        const mainPosition = layoutValue.direction === 'column' ? relY : relX
        const siblings = childrenOf(found.parent)
        let index = 0
        for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
          const sibling = siblings[siblingIndex]
          if (!isObject(sibling) || sibling.id === gesture.layerId) continue
          const siblingNode = tree && tree.byId ? tree.byId.get(sibling.id) || null : null
          if (!siblingNode) continue
          const center =
            layoutValue.direction === 'column'
              ? siblingNode.y + siblingNode.height / 2
              : siblingNode.x + siblingNode.width / 2
          if (center < mainPosition) index += 1
        }
        return clamp(index, 0, Math.max(0, siblings.length - 1))
      }

      function artboardPointerDown(event, artboardId) {
        if (!event || spaceHeldRef.current || isMiddlePointer(event)) return
        const target = event.target
        if (!target || !target.classList) return
        if (
          target.classList.contains('dc-board-frame') ||
          target.classList.contains('dc-board-inner')
        ) {
          selectArtboard(artboardId)
        }
      }

      function gestureMove(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gesture.clientX = finiteNumber(event.clientX, 0)
        gesture.clientY = finiteNumber(event.clientY, 0)
        const total =
          Math.abs(gesture.clientX - gesture.startX) + Math.abs(gesture.clientY - gesture.startY)
        if (!gesture.moved && total < PAN_START_THRESHOLD) return
        gesture.moved = true
        // Auto-layout children reorder on drop; nothing is patched while dragging.
        if (gesture.kind === 'reorder') return
        // Screen pixels -> canvas units: always divide by the camera zoom. Nested parents
        // have no extra scale, so this is also the parent-relative delta.
        const dx = screenDeltaToCanvas(gesture.clientX - gesture.startX, cameraRef.current.zoom)
        const dy = screenDeltaToCanvas(gesture.clientY - gesture.startY, cameraRef.current.zoom)
        const patch = gesturePatch(gesture, dx, dy)
        if (patch) patchLocalLayer(gesture.layerId, patch)
      }

      function releaseCapture(event) {
        try {
          const target = event.currentTarget
          if (target && typeof target.releasePointerCapture === 'function') {
            target.releasePointerCapture(event.pointerId)
          }
        } catch (error) {
          /* capture may already be released */
        }
      }

      function gestureUp(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        setGestureActive(false)
        releaseCapture(event)
        if (!gesture.moved) return
        if (gesture.kind === 'reorder') {
          const index = computeReorderIndex(
            gesture,
            finiteNumber(event.clientX, gesture.clientX),
            finiteNumber(event.clientY, gesture.clientY),
          )
          const current = docRef.current
          if (!current || index === null) return
          const found = findLayerById(current, gesture.layerId)
          if (!found) return
          const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
          const target = clamp(index, 0, Math.max(0, siblings.length - 1))
          if (target === found.index) return
          applyDocLocal(docReorderLayer(current, gesture.layerId, target))
          commitWithHistory(
            'reorder',
            [{ type: 'layer.reorder', layerId: gesture.layerId, index: target }],
            [{ type: 'layer.reorder', layerId: gesture.layerId, index: found.index }],
          )
          beacon('layer-reorder', { layerId: gesture.layerId, index: target, source: 'drag' })
          return
        }
        const dx = screenDeltaToCanvas(
          finiteNumber(event.clientX, gesture.clientX) - gesture.startX,
          cameraRef.current.zoom,
        )
        const dy = screenDeltaToCanvas(
          finiteNumber(event.clientY, gesture.clientY) - gesture.startY,
          cameraRef.current.zoom,
        )
        const patch = gesturePatch(gesture, dx, dy)
        if (!patch) return
        let inversePatch
        if (gesture.kind === 'resize-auto') {
          inversePatch = { width: gesture.origin.width, height: gesture.origin.height }
        } else if (gesture.kind === 'drag') {
          inversePatch = { x: gesture.origin.x, y: gesture.origin.y }
        } else {
          inversePatch = {
            x: gesture.origin.x,
            y: gesture.origin.y,
            width: gesture.origin.width,
            height: gesture.origin.height,
          }
        }
        commitWithHistory(
          'gesture',
          [{ type: 'layer.update', layerId: gesture.layerId, patch: patch }],
          [{ type: 'layer.update', layerId: gesture.layerId, patch: inversePatch }],
        )
      }

      function gestureCancel(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        setGestureActive(false)
        releaseCapture(event)
        if (!gesture.moved) return
        // A cancelled reorder left the document untouched.
        if (gesture.kind === 'reorder') return
        const restore =
          gesture.kind === 'resize-auto'
            ? { width: gesture.origin.width, height: gesture.origin.height }
            : {
                x: gesture.origin.x,
                y: gesture.origin.y,
                width: gesture.origin.width,
                height: gesture.origin.height,
              }
        patchLocalLayer(gesture.layerId, restore)
        runOps([{ type: 'layer.update', layerId: gesture.layerId, patch: restore }])
      }

      /* ------------------------------- pan: middle drag, space+drag, empty background ------------------------------- */

      function isMiddlePointer(event) {
        return !!event && event.pointerType === 'mouse' && event.button === 1
      }

      function beginPan(event, clickCandidate) {
        if (!event || panRef.current) return
        const cam = cameraRef.current
        panRef.current = {
          pointerId: event.pointerId,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          originX: cam.x,
          originY: cam.y,
          zoom: cam.zoom,
          moved: false,
          clickCandidate: !!clickCandidate,
        }
        setPanning(true)
        try {
          const target = event.currentTarget
          if (target && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(event.pointerId)
          }
        } catch (error) {
          /* pointer capture is best-effort */
        }
      }

      function releasePanCapture(event) {
        try {
          const target = event && event.currentTarget
          if (
            target &&
            typeof target.releasePointerCapture === 'function' &&
            event.pointerId !== undefined
          ) {
            target.releasePointerCapture(event.pointerId)
          }
        } catch (error) {
          /* capture may already be released */
        }
      }

      function canvasPointerDown(event) {
        if (!event) return
        const middle = isMiddlePointer(event)
        const spacePan = spaceHeldRef.current
        if (!middle && !spacePan) {
          if (event.button !== 0) return
          const target = event.target
          let blank = false
          try {
            if (target && typeof target.closest === 'function') {
              // Pan only from empty canvas: not from the artboards, pins, handles,
              // composer or interactive controls inside the canvas.
              blank = !target.closest(
                '.dc-board-wrap, .dc-composer, .dc-pin, .dc-sel-handle, button, input, textarea, select, a',
              )
            } else if (target && target.classList) {
              blank =
                target.classList.contains('dc-canvas') ||
                target.classList.contains('dc-stage') ||
                target.classList.contains('dc-center')
            }
          } catch (error) {
            blank = false
          }
          // Left drag pans only on the empty canvas background; hits on the artboard
          // still select, and hits on a layer still start a layer gesture.
          if (!blank) return
        }
        if (panRef.current) return
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
        } catch (error) {
          /* ignore */
        }
        beginPan(event, !spacePan && !middle)
      }

      function canvasPointerMove(event) {
        const pan = panRef.current
        if (!pan || !event || pan.pointerId !== event.pointerId) return
        const dx = finiteNumber(event.clientX, 0) - pan.startX
        const dy = finiteNumber(event.clientY, 0) - pan.startY
        if (!pan.moved && Math.abs(dx) + Math.abs(dy) < PAN_START_THRESHOLD) return
        pan.moved = true
        setCameraValue({
          x: roundTo(pan.originX + dx, 1),
          y: roundTo(pan.originY + dy, 1),
          zoom: pan.zoom,
        })
      }

      function endPan(event, cancelled) {
        const pan = panRef.current
        if (!pan || !event || pan.pointerId !== event.pointerId) return
        panRef.current = null
        setPanning(false)
        releasePanCapture(event)
        if (cancelled) {
          if (pan.moved) setCameraValue({ x: pan.originX, y: pan.originY, zoom: pan.zoom })
          return
        }
        // A click on empty background keeps its old meaning: clear the selection.
        if (!pan.moved && pan.clickCandidate) clearSelection()
      }

      function canvasPointerUp(event) {
        endPan(event, false)
      }

      function canvasPointerCancel(event) {
        endPan(event, true)
      }

      function cancelPan() {
        const pan = panRef.current
        if (!pan) return
        panRef.current = null
        setPanning(false)
        if (pan.moved) setCameraValue({ x: pan.originX, y: pan.originY, zoom: pan.zoom })
      }

      function holdSpace() {
        if (spaceHeldRef.current) return
        spaceHeldRef.current = true
        setSpaceHeld(true)
      }

      function releaseSpace() {
        if (!spaceHeldRef.current) return
        spaceHeldRef.current = false
        setSpaceHeld(false)
      }

      /* ------------------------------- wheel: zoom about cursor / pan ------------------------------- */

      React.useEffect(
        function () {
          const node = canvasRef.current
          if (!node || typeof node.addEventListener !== 'function') return undefined
          function handleWheel(event) {
            if (!event) return
            const target = event.target
            // Let the comment composer's textarea keep its native wheel scrolling.
            try {
              if (target && typeof target.closest === 'function' && target.closest('.dc-composer')) {
                return
              }
            } catch (error) {
              /* ignore */
            }
            try {
              if (typeof event.preventDefault === 'function') event.preventDefault()
            } catch (error) {
              /* ignore */
            }
            if (panRef.current) return
            const viewport = canvasViewport()
            const cam = cameraRef.current
            const unit =
              event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, viewport.height) : 1
            const deltaX = finiteNumber(event.deltaX, 0) * unit
            const deltaY = finiteNumber(event.deltaY, 0) * unit
            if (event.ctrlKey || event.metaKey) {
              // Chromium reports a trackpad pinch as ctrl+wheel, so this also covers pinch zoom.
              const cursorX =
                finiteNumber(event.clientX, viewport.left + viewport.width / 2) - viewport.left
              const cursorY =
                finiteNumber(event.clientY, viewport.top + viewport.height / 2) - viewport.top
              const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
              zoomAboutViewportPoint(cursorX, cursorY, cam.zoom * factor)
              return
            }
            let panX = deltaX
            let panY = deltaY
            if (event.shiftKey && panX === 0) {
              panX = panY
              panY = 0
            }
            if (panX === 0 && panY === 0) return
            setCameraValue({ x: cam.x - panX, y: cam.y - panY, zoom: cam.zoom })
          }
          node.addEventListener('wheel', handleWheel, { passive: false })
          return function () {
            try {
              node.removeEventListener('wheel', handleWheel)
            } catch (error) {
              /* node may already be gone */
            }
          }
        },
        [doc],
      )

      /* ------------------------------- keyboard + clipboard ------------------------------- */

      React.useEffect(
        function () {
          if (!sessionId) return undefined
          function editableTarget(target) {
            if (!target) return false
            const tag = String(target.tagName || '').toUpperCase()
            return (
              tag === 'INPUT' ||
              tag === 'TEXTAREA' ||
              tag === 'SELECT' ||
              !!target.isContentEditable
            )
          }
          function onKeyDown(event) {
            const target = event.target
            const tag = target ? String(target.tagName || '').toUpperCase() : ''
            if (editableTarget(target)) return
            // Feature parts register shortcuts here (see EXTENSIONS.keys in 00-core.js);
            // they run before the built-in bindings so a feature may claim an unused combo.
            if (EXTENSIONS.keys.length) {
              for (let index = 0; index < EXTENSIONS.keys.length; index += 1) {
                const entry = EXTENSIONS.keys[index]
                try {
                  if (!entry.match(event)) continue
                  if (entry.run(event, extensionApi) === false) continue
                  event.preventDefault()
                  return
                } catch (error) {
                  beacon('key-extension-failed', {
                    id: String(entry && entry.id),
                    message: shortError(error),
                  })
                }
              }
            }
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
              const shortcut = String(event.key || '').toLowerCase()
              if (shortcut === 'z') {
                event.preventDefault()
                if (event.shiftKey) redoOnce()
                else undoOnce()
                return
              }
              if (shortcut === 'y') {
                event.preventDefault()
                redoOnce()
                return
              }
              if (shortcut === 'd') {
                event.preventDefault()
                duplicateSelected()
                return
              }
            }
            if (
              event.key === 'ArrowLeft' ||
              event.key === 'ArrowRight' ||
              event.key === 'ArrowUp' ||
              event.key === 'ArrowDown'
            ) {
              if (!selectedLayerIdRef.current) return
              const step = event.shiftKey ? 10 : 1
              let dx = 0
              let dy = 0
              if (event.key === 'ArrowLeft') dx = -step
              else if (event.key === 'ArrowRight') dx = step
              else if (event.key === 'ArrowUp') dy = -step
              else dy = step
              event.preventDefault()
              nudgeSelected(dx, dy)
              return
            }
            if (event.code === 'Space' || event.key === ' ') {
              // Space-held turns the next left drag into a pan; only claim the key while
              // the pointer is over the canvas or focus is inside the canvas app, and
              // leave BUTTON/A activation alone.
              if (tag === 'BUTTON' || tag === 'A') return
              const appNode = appRef.current
              const active = typeof document !== 'undefined' ? document.activeElement : null
              const focusInApp =
                !!appNode && !!active && typeof appNode.contains === 'function' && appNode.contains(active)
              if (!canvasHoverRef.current && !focusInApp) return
              holdSpace()
              if (typeof event.preventDefault === 'function') event.preventDefault()
              return
            }
            if (event.key === 'Escape') {
              releaseSpace()
              cancelPan()
              setComposer(null)
              setSelectedLayerId(null)
              return
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              if (selectedLayerIdRef.current) {
                event.preventDefault()
                deleteSelectedLayer()
              }
              return
            }
            if (event.key === 'c' || event.key === 'C') {
              const layerId = selectedLayerIdRef.current
              if (layerId && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault()
                openComposerFor(layerId, null)
              }
            }
          }
          function onKeyUp(event) {
            if (event.code === 'Space' || event.key === ' ') releaseSpace()
          }
          function onWindowBlur() {
            releaseSpace()
            cancelPan()
          }
          function onPaste(event) {
            try {
              const node = canvasRef.current
              const target = event.target
              if (editableTarget(target)) return
              // Paste applies when focus is on the canvas app (canvas, toolbar, body); typing
              // into the chat composer or any input keeps its native paste.
              const appNode = appRef.current
              let targetOk = !target || target === document.body || target === document.documentElement
              if (!targetOk && appNode && target && typeof appNode.contains === 'function') {
                targetOk = appNode.contains(target)
              }
              if (!targetOk && node && target && typeof node.contains === 'function') {
                targetOk = node.contains(target)
              }
              if (!node || !targetOk) return
              const data = event.clipboardData
              if (!data) return
              const viewport = canvasViewport()
              const point = screenToCanvas(
                viewport.left + viewport.width / 2,
                viewport.top + viewport.height / 2,
              )
              const items = data.items || []
              for (let index = 0; index < items.length; index += 1) {
                const item = items[index]
                if (!item || item.kind !== 'file' || typeof item.getAsFile !== 'function') continue
                if (!imageFileType({ type: item.type, name: '' })) continue
                const file = item.getAsFile()
                if (!file) continue
                if (typeof event.preventDefault === 'function') event.preventDefault()
                handleImageFile(file, 'paste', point)
                return
              }
              const files = data.files || []
              for (let index = 0; index < files.length; index += 1) {
                if (!imageFileType(files[index])) continue
                if (typeof event.preventDefault === 'function') event.preventDefault()
                handleImageFile(files[index], 'paste', point)
                return
              }
            } catch (error) {
              beacon('image-paste-failed', { message: shortError(error) })
            }
          }
          document.addEventListener('keydown', onKeyDown)
          document.addEventListener('keyup', onKeyUp)
          document.addEventListener('paste', onPaste)
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('blur', onWindowBlur)
          }
          return function () {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
            document.removeEventListener('paste', onPaste)
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener('blur', onWindowBlur)
            }
            if (nudgeRef.current && nudgeRef.current.timer) {
              clearTimeout(nudgeRef.current.timer)
              nudgeRef.current = null
            }
          }
        },
        [sessionId],
      )

      /* ------------------------------- image input ------------------------------- */

      function openImagePicker(source) {
        try {
          imagePickSourceRef.current = source || 'toolbar'
          beacon('image-picker', { source: imagePickSourceRef.current })
          const input = imageInputRef.current
          if (!input) return
          try {
            input.value = ''
          } catch (error) {
            /* some browsers reject value writes; the click below still works */
          }
          if (typeof input.click === 'function') input.click()
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('image-picker-failed', { message: shortError(error) })
        }
      }

      function placeImageInArtboard(artboard, localPoint, naturalWidth, naturalHeight) {
        const boardWidth = Math.max(1, finiteNumber(artboard.width, 1))
        const boardHeight = Math.max(1, finiteNumber(artboard.height, 1))
        const naturalW = naturalWidth > 0 ? naturalWidth : 320
        const naturalH = naturalHeight > 0 ? naturalHeight : 200
        const maxWidth = Math.max(32, Math.round(boardWidth * IMAGE_MAX_WIDTH_RATIO))
        // Natural size capped to ~40% of the artboard width (and to the artboard height).
        const scale = Math.min(1, maxWidth / naturalW, boardHeight / naturalH)
        const width = Math.max(16, Math.round(naturalW * scale))
        const height = Math.max(16, Math.round(naturalH * scale))
        const layer = createLayer('image', artboard)
        layer.width = width
        layer.height = height
        layer.fit = 'cover'
        if (localPoint) {
          layer.x = Math.round(
            clamp(localPoint.x - width / 2, 0, Math.max(0, boardWidth - width)),
          )
          layer.y = Math.round(
            clamp(localPoint.y - height / 2, 0, Math.max(0, boardHeight - height)),
          )
        } else {
          layer.x = Math.round((boardWidth - width) / 2)
          layer.y = Math.round((boardHeight - height) / 2)
        }
        return layer
      }

      function replaceSelectedImage(dataUrl) {
        const layerId = selectedLayerIdRef.current
        const current = docRef.current
        const found = layerId && current ? findLayerById(current, layerId) : null
        if (!found || found.layer.type !== 'image') return false
        const previousSrc = typeof found.layer.src === 'string' ? found.layer.src : ''
        patchLocalLayer(layerId, { src: dataUrl })
        commitWithHistory(
          'image-replace',
          [{ type: 'layer.update', layerId: layerId, patch: { src: dataUrl } }],
          [{ type: 'layer.update', layerId: layerId, patch: { src: previousSrc } }],
        )
        return true
      }

      function applyImageFile(file, source, dataUrl, naturalWidth, naturalHeight, canvasPoint) {
        const current = docRef.current
        if (!current) return
        if (source === 'inspector' && replaceSelectedImage(dataUrl)) {
          beacon('image-add', {
            source: source,
            mode: 'replace',
            bytes: finiteNumber(file && file.size, 0),
            width: naturalWidth,
            height: naturalHeight,
          })
          return
        }
        const layout = computeLayout(current)
        let targetArtboard = null
        let localPoint = null
        if (canvasPoint) {
          const hit = layoutEntryAt(layout, canvasPoint.x, canvasPoint.y)
          if (hit) {
            targetArtboard = hit.artboard
            localPoint = {
              x: finiteNumber(canvasPoint.x, 0) - hit.frameX,
              y: finiteNumber(canvasPoint.y, 0) - hit.frameY,
            }
          }
        }
        if (!targetArtboard && selectedArtboardIdRef.current) {
          targetArtboard = findArtboardById(current, selectedArtboardIdRef.current)
        }
        if (!targetArtboard) {
          targetArtboard =
            artboardsOf(current).find(function (artboard) {
              return isObject(artboard)
            }) || null
        }
        if (!targetArtboard) {
          setInlineError(strings.imageNoArtboard)
          beacon('image-rejected', { source: source, reason: 'no-artboard' })
          return
        }
        const layer = placeImageInArtboard(targetArtboard, localPoint, naturalWidth, naturalHeight)
        layer.src = dataUrl
        applyDocLocal(docInsertLayer(current, { artboardId: targetArtboard.id }, layer))
        setSelectedLayerId(layer.id)
        setSelectedArtboardId(targetArtboard.id)
        commitWithHistory(
          'image-add',
          [{ type: 'layer.add', artboardId: targetArtboard.id, layer: layer }],
          [{ type: 'layer.delete', layerId: layer.id }],
        )
        beacon('image-add', {
          source: source,
          mode: 'add',
          bytes: finiteNumber(file && file.size, 0),
          width: layer.width,
          height: layer.height,
        })
      }

      function handleImageFile(file, source, canvasPoint) {
        try {
          if (!file) return
          const kind = String(source || 'toolbar')
          const type = imageFileType(file)
          if (!type) {
            setInlineError(strings.imageBadType)
            beacon('image-rejected', {
              source: kind,
              reason: 'unsupported-type',
              type: String(file.type || '').slice(0, 60),
              name: String(file.name || '').slice(0, 80),
            })
            return
          }
          const bytes = finiteNumber(file.size, 0)
          if (bytes > IMAGE_MAX_BYTES) {
            setInlineError(strings.imageTooLarge)
            beacon('image-rejected', {
              source: kind,
              reason: 'too-large',
              bytes: bytes,
              type: type,
            })
            return
          }
          if (!docRef.current || artboardsOf(docRef.current).length === 0) {
            setInlineError(strings.imageNoArtboard)
            beacon('image-rejected', { source: kind, reason: 'no-artboard' })
            return
          }
          readFileAsDataUrl(file)
            .then(function (dataUrl) {
              // Defense in depth: some clipboard files report no size, so also cap the
              // encoded payload (base64 inflates ~4/3) before it goes into the board.
              if (dataUrl.length > Math.ceil(IMAGE_MAX_BYTES * 1.4)) {
                setInlineError(strings.imageTooLarge)
                beacon('image-rejected', {
                  source: kind,
                  reason: 'too-large',
                  bytes: dataUrl.length,
                  type: type,
                })
                return null
              }
              return measureImageSize(dataUrl).then(function (size) {
                applyImageFile(file, kind, dataUrl, size.width, size.height, canvasPoint)
              })
            })
            .catch(function (error) {
              setInlineError(strings.imageReadFailed)
              beacon('image-rejected', {
                source: kind,
                reason: 'read-failed',
                message: shortError(error),
              })
            })
        } catch (error) {
          setInlineError(strings.imageReadFailed)
          beacon('image-rejected', {
            source: String(source || 'toolbar'),
            reason: 'threw',
            message: shortError(error),
          })
        }
      }

      function onImageInputChange(event) {
        try {
          const input = event && event.target
          const files = input && input.files
          const file = files && files[0]
          try {
            if (input) input.value = ''
          } catch (error) {
            /* ignore */
          }
          if (!file) return
          const source = imagePickSourceRef.current || 'toolbar'
          handleImageFile(file, source, null)
        } catch (error) {
          beacon('image-input-failed', { message: shortError(error) })
        }
      }

      function canvasDragOver(event) {
        if (!event) return
        try {
          const transfer = event.dataTransfer
          const types = transfer && transfer.types
          let hasFiles = false
          if (types) {
            for (let index = 0; index < types.length; index += 1) {
              if (String(types[index]) === 'Files') {
                hasFiles = true
                break
              }
            }
          }
          if (!hasFiles) return
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (transfer) transfer.dropEffect = 'copy'
          if (!dragOver) setDragOver(true)
        } catch (error) {
          /* drag signals are best-effort */
        }
      }

      function canvasDragLeave(event) {
        try {
          const node = event && event.currentTarget
          const related = event && event.relatedTarget
          if (node && related && typeof node.contains === 'function' && node.contains(related)) {
            return
          }
        } catch (error) {
          /* ignore */
        }
        setDragOver(false)
      }

      function canvasDrop(event) {
        if (!event) return
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
        } catch (error) {
          /* ignore */
        }
        setDragOver(false)
        try {
          const transfer = event.dataTransfer
          if (!transfer) return
          let file = null
          const files = transfer.files || []
          for (let index = 0; index < files.length; index += 1) {
            if (imageFileType(files[index])) {
              file = files[index]
              break
            }
          }
          if (!file && files.length > 0) file = files[0]
          if (!file) return
          const point = screenToCanvas(event.clientX, event.clientY)
          handleImageFile(file, 'drop', point)
        } catch (error) {
          beacon('image-drop-failed', { message: shortError(error) })
        }
      }

      /* ------------------------------- inline error auto-dismiss ------------------------------- */

      React.useEffect(
        function () {
          if (!inlineError) return undefined
          const timer = setTimeout(function () {
            setInlineError('')
          }, 12000)
          return function () {
            clearTimeout(timer)
          }
        },
        [inlineError],
      )

      /* ------------------------------- derived render data ------------------------------- */

      const tree = React.useMemo(
        function () {
          return buildComputedTree(doc)
        },
        [doc],
      )
      treeRef.current = tree
      const selectedNode =
        selectedLayerId && tree && tree.byId ? tree.byId.get(selectedLayerId) || null : null

      const commentIndex = React.useMemo(
        function () {
          const openCounts = new Map()
          const pinsByArtboard = new Map()
          const comments = commentsOf(doc)
          for (let index = 0; index < comments.length; index += 1) {
            const comment = comments[index]
            if (!isObject(comment) || comment.status === 'resolved') continue
            if (typeof comment.layerId !== 'string') continue
            openCounts.set(comment.layerId, (openCounts.get(comment.layerId) || 0) + 1)
          }
          const nodes = tree && Array.isArray(tree.allNodes) ? tree.allNodes : []
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            const count = node && node.layer ? openCounts.get(node.layer.id) : 0
            if (!count) continue
            const boardId = node.artboard && node.artboard.id ? node.artboard.id : ''
            if (!boardId) continue
            let pins = pinsByArtboard.get(boardId)
            if (!pins) {
              pins = []
              pinsByArtboard.set(boardId, pins)
            }
            pins.push({ node: node, count: count })
          }
          return { openCounts: openCounts, pinsByArtboard: pinsByArtboard }
        },
        [doc, tree],
      )

      const selectedComments = React.useMemo(
        function () {
          if (!doc || !selectedLayerId) return []
          return commentsOf(doc)
            .filter(function (comment) {
              return isObject(comment) && comment.layerId === selectedLayerId
            })
            .slice()
            .sort(function (first, second) {
              if ((first.status === 'resolved') !== (second.status === 'resolved')) {
                return first.status === 'resolved' ? 1 : -1
              }
              return 0
            })
        },
        [doc, selectedLayerId],
      )

      const layout = React.useMemo(
        function () {
          return computeLayout(doc)
        },
        [doc],
      )

      // The comment composer is positioned in viewport pixels (not canvas units) so it
      // stays readable at any zoom; the anchor is the targeted layer's bottom-right corner.
      let composerPlacement = null
      if (composer && doc && tree) {
        const node = tree.byId ? tree.byId.get(composer.layerId) || null : null
        const entry = node ? layout.entryById.get(node.artboard.id) || null : null
        if (node && entry) {
          const viewport = canvasViewport()
          const right = projectToViewport(
            entry.frameX + node.worldRect.x + node.worldRect.width,
            entry.frameY + node.worldRect.y + node.worldRect.height,
          )
          const maxLeft = Math.max(8, viewport.width - 268)
          const maxTop = Math.max(8, viewport.height - 52)
          composerPlacement = {
            left: Math.round(clamp(right.x + 8, 8, maxLeft)),
            top: Math.round(clamp(right.y + 8, 8, maxTop)),
            target: node.layer,
          }
        }
      }

      const handlers = {
        layerPointerDown: layerPointerDown,
        handlePointerDown: handlePointerDown,
        gestureMove: gestureMove,
        gestureUp: gestureUp,
        gestureCancel: gestureCancel,
        selectArtboard: selectArtboard,
        artboardPointerDown: artboardPointerDown,
        screenToCanvas: screenToCanvas,
        reparent: reparentLayer,
        panCameraBy: function (dx, dy) {
          const cam = cameraRef.current
          setCameraValue({ x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom })
        },
        pinClick: function (layerId, artboardId) {
          selectLayer(layerId, artboardId)
          setInspectorOpen(true)
          if (commentMode) openComposerFor(layerId, artboardId)
        },
        composerChange: function (text) {
          setComposer(function (previous) {
            return previous ? Object.assign({}, previous, { text: text }) : previous
          })
        },
        composerCancel: function () {
          setComposer(null)
        },
        composerSend: function () {
          submitComment()
        },
      }

      const statusLabels = {
        synced: strings.synced,
        saving: strings.saving,
        offline: strings.offline,
        revising: strings.revising,
      }

      /* ------------------------------- public API ------------------------------- */

      // Curated action surface handed to feature parts (key handlers, app panels, panels that
      // were registered through EXTENSIONS in 00-core.js). Everything here is stable API.
      const extensionApi = {
        doc: doc,
        tree: tree,
        camera: camera,
        strings: strings,
        selection: {
          layerIds: selectedLayerId ? [selectedLayerId] : [],
          primaryLayerId: selectedLayerId,
          artboardId: selectedArtboardId,
        },
        selectedLayerId: selectedLayerId,
        selectedArtboardId: selectedArtboardId,
        selectLayer: selectLayer,
        selectArtboard: selectArtboard,
        clearSelection: clearSelection,
        commitLayer: commitLayer,
        commitArtboard: commitArtboard,
        addLayer: addLayer,
        deleteSelected: deleteSelectedLayer,
        duplicateSelected: duplicateSelected,
        undo: undoOnce,
        redo: redoOnce,
        canUndo: function () {
          return historyRef.current.undo.length > 0
        },
        canRedo: function () {
          return historyRef.current.redo.length > 0
        },
        setInlineError: setInlineError,
        setInspectorOpen: setInspectorOpen,
        setTreeOpen: setTreeOpen,
        openComposerFor: openComposerFor,
        setCommentStatus: setCommentStatus,
        deleteComment: deleteCommentById,
        zoom: camera ? camera.zoom : 1,
        fitCamera: fitCamera,
        zoomCameraBy: zoomCameraBy,
        runOps: runOps,
        applyDocLocal: applyDocLocal,
      }

      return {
        strings: strings,
        doc: doc,
        setDoc: setDoc,
        version: version,
        setVersion: setVersion,
        boardPath: boardPath,
        setBoardPath: setBoardPath,
        loading: loading,
        setLoading: setLoading,
        loadError: loadError,
        setLoadError: setLoadError,
        status: status,
        setStatus: setStatus,
        inlineError: inlineError,
        setInlineError: setInlineError,
        selectedLayerId: selectedLayerId,
        setSelectedLayerId: setSelectedLayerId,
        selectedArtboardId: selectedArtboardId,
        setSelectedArtboardId: setSelectedArtboardId,
        camera: camera,
        setCamera: setCamera,
        panning: panning,
        setPanning: setPanning,
        spaceHeld: spaceHeld,
        setSpaceHeld: setSpaceHeld,
        dragOver: dragOver,
        setDragOver: setDragOver,
        commentMode: commentMode,
        setCommentMode: setCommentMode,
        composer: composer,
        setComposer: setComposer,
        commentBusy: commentBusy,
        setCommentBusy: setCommentBusy,
        commentError: commentError,
        setCommentError: setCommentError,
        gestureActive: gestureActive,
        setGestureActive: setGestureActive,
        treeOpen: treeOpen,
        setTreeOpen: setTreeOpen,
        inspectorOpen: inspectorOpen,
        setInspectorOpen: setInspectorOpen,
        docRef: docRef,
        versionRef: versionRef,
        cameraRef: cameraRef,
        panRef: panRef,
        spaceHeldRef: spaceHeldRef,
        imageInputRef: imageInputRef,
        imagePickSourceRef: imagePickSourceRef,
        selectedLayerIdRef: selectedLayerIdRef,
        selectedArtboardIdRef: selectedArtboardIdRef,
        gestureRef: gestureRef,
        treeRef: treeRef,
        inFlightRef: inFlightRef,
        lastLocalVersionRef: lastLocalVersionRef,
        statusTimerRef: statusTimerRef,
        disposedRef: disposedRef,
        mountReportedRef: mountReportedRef,
        fitPendingRef: fitPendingRef,
        canvasRef: canvasRef,
        appRef: appRef,
        canvasHoverRef: canvasHoverRef,
        historyRef: historyRef,
        applyingHistoryRef: applyingHistoryRef,
        nudgeRef: nudgeRef,
        applyDoc: applyDoc,
        applyDocLocal: applyDocLocal,
        patchLocalLayer: patchLocalLayer,
        canvasViewport: canvasViewport,
        screenToCanvas: screenToCanvas,
        projectToViewport: projectToViewport,
        setCameraValue: setCameraValue,
        zoomAboutViewportPoint: zoomAboutViewportPoint,
        zoomCameraBy: zoomCameraBy,
        computeFitCamera: computeFitCamera,
        fitCamera: fitCamera,
        runOps: runOps,
        retryNow: retryNow,
        historyState: historyState,
        pushHistoryEntry: pushHistoryEntry,
        dropHistoryEntry: dropHistoryEntry,
        commitWithHistory: commitWithHistory,
        inversePatchFor: inversePatchFor,
        insertOpsForSubtree: insertOpsForSubtree,
        inverseMoveToOps: inverseMoveToOps,
        undoOnce: undoOnce,
        redoOnce: redoOnce,
        selectLayer: selectLayer,
        selectArtboard: selectArtboard,
        clearSelection: clearSelection,
        openComposerFor: openComposerFor,
        commitLayer: commitLayer,
        commitArtboard: commitArtboard,
        toggleVisible: toggleVisible,
        deleteLayerById: deleteLayerById,
        deleteSelectedLayer: deleteSelectedLayer,
        moveSelected: moveSelected,
        opLayerForAdd: opLayerForAdd,
        addLayer: addLayer,
        cloneLayerSubtree: cloneLayerSubtree,
        duplicateSelected: duplicateSelected,
        nudgeSelected: nudgeSelected,
        flushNudge: flushNudge,
        commitShadow: commitShadow,
        clearShadow: clearShadow,
        reparentLayer: reparentLayer,
        currentFrameForLayout: currentFrameForLayout,
        setFrameAutoLayout: setFrameAutoLayout,
        patchFrameLayout: patchFrameLayout,
        addArtboard: addArtboard,
        setCommentStatus: setCommentStatus,
        deleteCommentById: deleteCommentById,
        sendCommentChat: sendCommentChat,
        submitComment: submitComment,
        gesturePatch: gesturePatch,
        beginGesture: beginGesture,
        layerPointerDown: layerPointerDown,
        handlePointerDown: handlePointerDown,
        computeReorderIndex: computeReorderIndex,
        artboardPointerDown: artboardPointerDown,
        gestureMove: gestureMove,
        releaseCapture: releaseCapture,
        gestureUp: gestureUp,
        gestureCancel: gestureCancel,
        isMiddlePointer: isMiddlePointer,
        beginPan: beginPan,
        releasePanCapture: releasePanCapture,
        canvasPointerDown: canvasPointerDown,
        canvasPointerMove: canvasPointerMove,
        endPan: endPan,
        canvasPointerUp: canvasPointerUp,
        canvasPointerCancel: canvasPointerCancel,
        cancelPan: cancelPan,
        holdSpace: holdSpace,
        releaseSpace: releaseSpace,
        openImagePicker: openImagePicker,
        placeImageInArtboard: placeImageInArtboard,
        replaceSelectedImage: replaceSelectedImage,
        applyImageFile: applyImageFile,
        handleImageFile: handleImageFile,
        onImageInputChange: onImageInputChange,
        canvasDragOver: canvasDragOver,
        canvasDragLeave: canvasDragLeave,
        canvasDrop: canvasDrop,
        tree: tree,
        selectedNode: selectedNode,
        commentIndex: commentIndex,
        selectedComments: selectedComments,
        layout: layout,
        composerPlacement: composerPlacement,
        handlers: handlers,
        statusLabels: statusLabels,
      }
    }
