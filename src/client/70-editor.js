    /* ------------------------------------------------------------------------------------------
     * Interaction tuning + feature copy
     *
     * New feature copy lives here as a local constant (see CONTRACT §8.9) and is folded into the
     * strings table during the localization pass.
     * ---------------------------------------------------------------------------------------- */

    /** Snap distance in SCREEN pixels (divided by the camera zoom before comparing). */
    const SNAP_THRESHOLD_SCREEN = 6
    const TIDY_GAP = 16
    const PASTE_OFFSET = 16
    const DUPLICATE_OFFSET = 12
    const DOUBLE_CLICK_MS = 350
    const CLIPBOARD_KIND = 'dsh-design-canvas/layers'
    /** Host cap on ops per call (host/model.js MAX_OPS_PER_CALL). */
    const MAX_OPS_PER_BATCH = 200

    const INTERACTION_COPY = {
      locked: 'Locked — unlock it in the inspector to edit',
      groupNeedsTwo: 'Select at least two layers to group them',
      groupSameParent: 'Grouping needs layers that share the same parent',
      groupAutoLayout: 'Cannot group inside an auto-layout frame — turn its layout off first',
      ungroupNeedsGroup: 'Select a group to ungroup it',
      alignNeedsTwo: 'Select at least two layers to align them',
      alignSameParent: 'Aligning needs layers that share the same parent',
      distributeNeedsThree: 'Select at least three layers to distribute them',
      pasteEmpty: 'Nothing to paste — copy layers first',
      pasteLimit: 'This selection is too large to paste in one step',
      clipboardDenied: '',
    }

    /** Alignment kinds -> the axis and the edge/center they snap to on that axis. */
    const ALIGN_SPECS = {
      left: { axis: 'x', pos: 'start' },
      'center-h': { axis: 'x', pos: 'center' },
      hcenter: { axis: 'x', pos: 'center' },
      'center-x': { axis: 'x', pos: 'center' },
      right: { axis: 'x', pos: 'end' },
      top: { axis: 'y', pos: 'start' },
      'center-v': { axis: 'y', pos: 'center' },
      vcenter: { axis: 'y', pos: 'center' },
      'center-y': { axis: 'y', pos: 'center' },
      bottom: { axis: 'y', pos: 'end' },
    }

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
      // Multi-selection: ordered ids, the LAST one is the primary layer (`selectedLayerId`). The
      // array is the source of truth; `selectedLayerId` stays for single-layer affordances.
      const [selectedLayerIds, setSelectedLayerIds] = React.useState([])
      const [selectedArtboardId, setSelectedArtboardId] = React.useState(null)
      // Id of the group the user drilled into (double-click / Enter/ Esc steps back out).
      const [drillGroupId, setDrillGroupId] = React.useState(null)
      // Marquee rect in artboard-local canvas units, or null while not dragging.
      const [marquee, setMarquee] = React.useState(null)
      // Active snap guide lines for the renderer: [{ axis: 'x'|'y', at: number }].
      const [snapGuides, setSnapGuides] = React.useState([])
      const [snapGuidesArtboardId, setSnapGuidesArtboardId] = React.useState(null)
      const [snapEnabled, setSnapEnabled] = React.useState(true)
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

      const selectedLayerId = selectedLayerIds.length
        ? selectedLayerIds[selectedLayerIds.length - 1]
        : null

      const docRef = React.useRef(null)
      const versionRef = React.useRef(0)
      const cameraRef = React.useRef(defaultCamera())
      const panRef = React.useRef(null)
      const spaceHeldRef = React.useRef(false)
      const imageInputRef = React.useRef(null)
      const imagePickSourceRef = React.useRef('toolbar')
      const selectedLayerIdsRef = React.useRef([])
      const selectedLayerIdRef = React.useRef(null)
      const selectedArtboardIdRef = React.useRef(null)
      const drillGroupIdRef = React.useRef(null)
      const snapEnabledRef = React.useRef(true)
      const marqueeRef = React.useRef(null)
      const clipboardRef = React.useRef(null)
      const gestureFrameRef = React.useRef(null)
      const lastLayerPointerRef = React.useRef(null)
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
          selectedLayerIdsRef.current = selectedLayerIds
          selectedLayerIdRef.current = selectedLayerId
          selectedArtboardIdRef.current = selectedArtboardId
          drillGroupIdRef.current = drillGroupId
          snapEnabledRef.current = snapEnabled
        },
        [selectedLayerIds, selectedLayerId, selectedArtboardId, drillGroupId, snapEnabled],
      )

      /** Backwards-compatible single-selection setter (shell/inspector still know this name). */
      function setSelectedLayerId(layerId) {
        setSelectedLayerIds(layerId ? [layerId] : [])
        if (!layerId) setDrillGroupId(null)
      }

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
          setDrillGroupId(null)
          setMarquee(null)
          setSnapGuides([])
          setSnapGuidesArtboardId(null)
          marqueeRef.current = null
          clipboardRef.current = null
          lastLayerPointerRef.current = null
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
            if (gestureRef.current || marqueeRef.current) return
            if (inFlightRef.current > 0) return
            // A batched nudge holds a local-only preview; never let a poll clobber it.
            if (nudgeRef.current) return
            getState(sessionId)
              .then(function (data) {
                if (cancelled) return
                setStatus(function (previous) {
                  return previous === 'offline' ? 'synced' : previous
                })
                if (!data || !data.doc) return
                if (data.path) setBoardPath(String(data.path))
                const remoteVersion = typeof data.version === 'number' ? data.version : 0
                const heldVersion = versionRef.current
                const sameVersion = remoteVersion === heldVersion
                // The Host owns the board: a replaced/reset document can arrive with an equal or
                // LOWER version (Reset doc, adopting another workspace's board). Adopt it when the
                // version moved in either direction or when the board identity differs, so the
                // canvas never keeps showing a document the Host no longer holds.
                const replacedInPlace = sameVersion && !sameDocumentIdentity(docRef.current, data.doc)
                if (sameVersion && !replacedInPlace) return
                const regressed = remoteVersion < heldVersion
                const external = remoteVersion !== lastLocalVersionRef.current || replacedInPlace
                lastLocalVersionRef.current = remoteVersion
                applyDoc(data.doc, remoteVersion)
                if (regressed) {
                  beacon('state-version-regressed', {
                    from: heldVersion,
                    to: remoteVersion,
                    path: String(data.path || '').slice(0, 80),
                  })
                } else if (replacedInPlace) {
                  beacon('state-replaced-in-place', { version: remoteVersion })
                } else {
                  beacon('state-loaded', { version: remoteVersion, external: external })
                }
                if (external || regressed || replacedInPlace) {
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
          const stillThere = selectedLayerIds.filter(function (layerId) {
            return !!findLayerById(doc, layerId)
          })
          if (stillThere.length !== selectedLayerIds.length) setSelectedLayerIds(stillThere)
          if (selectedArtboardId && !findArtboardById(doc, selectedArtboardId)) setSelectedArtboardId(null)
          if (drillGroupId) {
            const drilled = findLayerById(doc, drillGroupId)
            if (!drilled || drilled.layer.type !== 'group') setDrillGroupId(null)
          }
          if (composer && !findLayerById(doc, composer.layerId)) setComposer(null)
        },
        [doc, selectedLayerIds, selectedArtboardId, drillGroupId, composer],
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
            // Absent props: restore the documented "absent" state. Boolean flags and size
            // bounds clear with false/null (CONTRACT: locked/hug/min-max are absent by default),
            // nullable props clear with null, enums get their documented default back.
            if (key === 'shadow' || key === 'layout' || key === 'alignSelf') inverse[key] = null
            else if (key === 'visible') inverse[key] = true
            else if (key === 'grow' || key === 'clip') inverse[key] = false
            else if (
              key === 'locked' ||
              key === 'hugWidth' ||
              key === 'hugHeight' ||
              key === 'dashed' ||
              key === 'arrowStart' ||
              key === 'arrowEnd'
            ) {
              inverse[key] = false
            } else if (
              key === 'minWidth' ||
              key === 'minHeight' ||
              key === 'maxWidth' ||
              key === 'maxHeight' ||
              key === 'rowGap' ||
              key === 'columnGap'
            ) {
              inverse[key] = null
            } else if (key === 'opacity') inverse[key] = 1
            else if (key === 'letterSpacing') inverse[key] = 0
            else if (key === 'textTransform') inverse[key] = 'none'
            else if (key === 'justify') inverse[key] = 'start'
            else if (key === 'align') inverse[key] = 'stretch'
            else if (key === 'alignContent') inverse[key] = 'stretch'
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

      /* ------------------------------- selection ------------------------------- */

      /** Computed node for a layer id (with artboard-local worldRect), or null. */
      function nodeForLayer(layerId) {
        const tree = treeRef.current
        if (!tree || !tree.byId || typeof layerId !== 'string' || !layerId) return null
        return tree.byId.get(layerId) || null
      }

      /**
       * Figma-like click target: a click on a child of a `group` selects the group first; once the
       * user drilled into that group (double-click / Enter) the child itself is the target.
       * Frames never trap clicks — their children stay directly selectable (v1 behaviour).
       */
      function selectionTargetForNode(node, drillId) {
        if (!node) return null
        const chain = []
        let current = node
        while (current) {
          chain.push(current)
          current = current.parent || null
        }
        let stop = chain.length - 1
        if (drillId) {
          for (let index = 0; index < chain.length; index += 1) {
            if (chain[index] && chain[index].id === drillId) {
              stop = index - 1
              break
            }
          }
        }
        for (let index = stop; index >= 0; index -= 1) {
          if (chain[index] && chain[index].type === 'group') return chain[index]
        }
        return node
      }

      function artboardIdForNode(node) {
        return node && node.artboard && typeof node.artboard.id === 'string' ? node.artboard.id : null
      }

      function artboardIdForLayer(layerId) {
        const node = nodeForLayer(layerId)
        if (node) return artboardIdForNode(node)
        const current = docRef.current
        const found = current && layerId ? findLayerById(current, layerId) : null
        return found ? found.artboard.id : null
      }

      /** Sibling nodes of a computed node (front-to-back array as authored). */
      function siblingNodesOf(node) {
        if (!node) return []
        if (node.parent) return Array.isArray(node.parent.children) ? node.parent.children : []
        const tree = treeRef.current
        if (!tree || !Array.isArray(tree.artboards)) return []
        for (let index = 0; index < tree.artboards.length; index += 1) {
          const entry = tree.artboards[index]
          if (entry && entry.artboard && node.artboard && entry.artboard.id === node.artboard.id) {
            return Array.isArray(entry.layers) ? entry.layers : []
          }
        }
        return []
      }

      /** Ids from `fromId` to `toId` (inclusive) when both are siblings, else null. */
      function siblingRangeIds(fromId, toId) {
        const fromNode = nodeForLayer(fromId)
        const toNode = nodeForLayer(toId)
        if (!fromNode || !toNode) return null
        if ((fromNode.parent ? fromNode.parent.id : null) !== (toNode.parent ? toNode.parent.id : null)) {
          return null
        }
        if (artboardIdForNode(fromNode) !== artboardIdForNode(toNode)) return null
        const siblings = siblingNodesOf(fromNode)
        let fromIndex = -1
        let toIndex = -1
        for (let index = 0; index < siblings.length; index += 1) {
          const sibling = siblings[index]
          if (!sibling) continue
          if (sibling.id === fromId) fromIndex = index
          if (sibling.id === toId) toIndex = index
        }
        if (fromIndex < 0 || toIndex < 0) return null
        const start = Math.min(fromIndex, toIndex)
        const end = Math.max(fromIndex, toIndex)
        const ids = []
        for (let index = start; index <= end; index += 1) {
          if (siblings[index] && siblings[index].id) ids.push(siblings[index].id)
        }
        return ids
      }

      /**
       * Outermost selected ids: when both a container and one of its descendants are selected, the
       * container is the unit every mutation works on (a group cannot be moved twice).
       */
      function rootSelectionIds(ids) {
        const current = docRef.current
        const list = Array.isArray(ids) ? ids : []
        const roots = []
        if (!current) return list.slice()
        const selected = new Set(list)
        for (let index = 0; index < list.length; index += 1) {
          const layerId = list[index]
          if (typeof layerId !== 'string' || !layerId) continue
          if (roots.indexOf(layerId) >= 0) continue
          let found = findLayerById(current, layerId)
          let nested = false
          const guard = new Set()
          while (found && found.parent) {
            if (guard.has(found.parent.id)) break
            guard.add(found.parent.id)
            if (selected.has(found.parent.id)) {
              nested = true
              break
            }
            found = findLayerById(current, found.parent.id)
          }
          if (!nested) roots.push(layerId)
        }
        return roots
      }

      function selectionNodes(ids) {
        const list = Array.isArray(ids) ? ids : []
        const nodes = []
        for (let index = 0; index < list.length; index += 1) {
          const node = nodeForLayer(list[index])
          if (node) nodes.push(node)
        }
        return nodes
      }

      /** Union box of a selection in artboard-local canvas units, or null. */
      function selectionBounds(ids) {
        const nodes = selectionNodes(ids)
        return unionRects(
          nodes.map(function (node) { return node.worldRect }),
        )
      }

      /**
       * Single funnel for every selection change: ordered ids, the owning artboard, the drilled
       * group and the composer. Refs are written synchronously so the pointer handler that just
       * changed the selection can start a gesture in the same tick.
       */
      function applySelection(ids, artboardId, drillId) {
        const next = []
        const seen = new Set()
        const raw = Array.isArray(ids) ? ids : []
        for (let index = 0; index < raw.length; index += 1) {
          const layerId = raw[index]
          if (typeof layerId !== 'string' || !layerId || seen.has(layerId)) continue
          seen.add(layerId)
          next.push(layerId)
        }
        const drill = typeof drillId === 'string' && drillId ? drillId : null
        const primary = next.length ? next[next.length - 1] : null
        selectedLayerIdsRef.current = next
        selectedLayerIdRef.current = primary
        if (artboardId) selectedArtboardIdRef.current = artboardId
        drillGroupIdRef.current = drill
        setSelectedLayerIds(next)
        setDrillGroupId(drill)
        if (artboardId) setSelectedArtboardId(artboardId)
        setComposer(function (previous) {
          if (!previous) return previous
          return primary && previous.layerId === primary ? previous : null
        })
      }

      /**
       * Select one layer. `options = { additive, range }`: additive (Shift / Ctrl / Cmd+click)
       * toggles the layer in the set; range extends from the primary to the target sibling.
       * Clicking inside a group selects the group unless the user drilled into it.
       */
      function selectLayer(layerId, artboardId, options) {
        const opts = isObject(options) ? options : {}
        if (!layerId) {
          clearSelection()
          return
        }
        const node = nodeForLayer(layerId)
        const drill = drillGroupIdRef.current
        const target = node ? selectionTargetForNode(node, drill) : null
        const targetId = target ? target.id : layerId
        const board =
          artboardId || artboardIdForNode(target) || artboardIdForLayer(layerId) || selectedArtboardIdRef.current || null
        const currentIds = selectedLayerIdsRef.current
        if (opts.additive === true || opts.toggle === true) {
          const at = currentIds.indexOf(targetId)
          const nextIds =
            at >= 0
              ? currentIds.filter(function (id) { return id !== targetId })
              : currentIds.concat([targetId])
          applySelection(nextIds, board, drill)
          beacon('select-layer', { count: nextIds.length, additive: true })
          return
        }
        if (opts.range === true && currentIds.length) {
          const range = siblingRangeIds(currentIds[currentIds.length - 1], targetId)
          if (range && range.length) {
            applySelection(range, board, drill)
            beacon('select-layer', { count: range.length, range: true })
            return
          }
        }
        applySelection([targetId], board, drill)
      }

      /** Replace the selection with a set of ids (tree multi-select, marquee, paste, …). */
      function selectLayers(ids, artboardId) {
        const current = docRef.current
        const clean = []
        const seen = new Set()
        const raw = Array.isArray(ids) ? ids : []
        for (let index = 0; index < raw.length; index += 1) {
          const layerId = raw[index]
          if (typeof layerId !== 'string' || !layerId || seen.has(layerId)) continue
          if (current && !findLayerById(current, layerId)) continue
          seen.add(layerId)
          clean.push(layerId)
        }
        const primary = clean.length ? clean[clean.length - 1] : null
        applySelection(
          clean,
          artboardId || (primary ? artboardIdForLayer(primary) : null),
          null,
        )
        return clean
      }

      /** Select every top-level layer of the selected (or first) artboard — Ctrl/Cmd+A. */
      function selectAllInArtboard() {
        const current = docRef.current
        if (!current) return []
        const boards = artboardsOf(current)
        let boardId = selectedArtboardIdRef.current
        if (!boardId && selectedLayerIdRef.current) boardId = artboardIdForLayer(selectedLayerIdRef.current)
        if (!boardId) {
          const first = boards.find(function (artboard) { return isObject(artboard) })
          boardId = first ? first.id : null
        }
        const artboard = boardId ? findArtboardById(current, boardId) : null
        if (!artboard) {
          clearSelection()
          return []
        }
        const ids = layersOf(artboard)
          .filter(function (layer) { return isObject(layer) && typeof layer.id === 'string' })
          .map(function (layer) { return layer.id })
        applySelection(ids, artboard.id, null)
        beacon('select-all', { count: ids.length })
        return ids
      }

      function selectArtboard(artboardId) {
        applySelection([], artboardId || null, null)
      }

      function clearSelection() {
        applySelection([], null, null)
      }

      /** Enter: step INTO the selected container, selecting its front-most child. */
      function drillIntoSelection() {
        const primaryId = selectedLayerIdRef.current
        if (!primaryId) return false
        const node = nodeForLayer(primaryId)
        if (!node || !isContainerLayer(node.layer)) return false
        const kids = Array.isArray(node.children) ? node.children : []
        const child = kids.length ? kids[kids.length - 1] : null
        applySelection(
          child ? [child.id] : [],
          artboardIdForNode(node),
          node.type === 'group' ? node.id : drillGroupIdRef.current,
        )
        beacon('drill-in', { layerId: node.id, type: node.type })
        return true
      }

      /**
       * Descend from `node` to the deepest visible descendant whose box contains the pointer
       * (artboard-local coordinates). This is what makes double-click "click through" a stack of
       * frames/groups in one gesture, the way Figma's deep select behaves.
       */
      function deepestNodeAtClientPoint(node, clientX, clientY) {
        if (!node) return node
        const current = docRef.current
        const boardId = artboardIdForNode(node)
        if (!current || !boardId) return node
        const entry = computeLayout(current).entryById.get(boardId) || null
        if (!entry) return node
        const point = screenToCanvas(clientX, clientY)
        const local = { x: point.x - entry.frameX, y: point.y - entry.frameY }
        let deepest = node
        let guard = 0
        while (guard < 12) {
          guard += 1
          const children = Array.isArray(deepest.children) ? deepest.children : []
          let next = null
          // Front-to-back: the last painted child owns the pixel when boxes overlap.
          for (let index = children.length - 1; index >= 0; index -= 1) {
            const child = children[index]
            if (!child || !child.layer || child.layer.visible === false) continue
            if (rectContainsPoint(child.worldRect, local)) {
              next = child
              break
            }
          }
          if (!next) break
          deepest = next
        }
        return deepest
      }

      /** Closest containing frame/group of a node (used as the drill scope after a deep select). */
      function containerIdForNode(node) {
        let current = node ? node.parent : null
        while (current) {
          if (isContainerLayer(current.layer)) return current.id
          current = current.parent
        }
        return null
      }

      /**
       * Double-click (Figma deep-select): descend to the layer under the pointer and select it, so
       * repeated double-clicks walk a deeply nested object down to the layer itself. Falls back to
       * stepping one container level (for a double-click on a container's own background).
       */
      function drillIntoNode(node, event) {
        if (!node) return false
        const board = artboardIdForNode(node)
        // A leaf under the pointer IS the deepest object: one double-click selects it (and sets
        // the scope to its parent container so the following single clicks stay inside it).
        if (!isContainerLayer(node.layer)) {
          applySelection([node.id], board, containerIdForNode(node))
          beacon('deep-select', { layerId: node.id, container: containerIdForNode(node) })
          return true
        }
        // A container: descend to the deepest descendant under the pointer.
        const clientX = event && Number.isFinite(event.clientX) ? event.clientX : null
        const clientY = event && Number.isFinite(event.clientY) ? event.clientY : null
        const deepest =
          clientX !== null && clientY !== null
            ? deepestNodeAtClientPoint(node, clientX, clientY)
            : node
        if (deepest && deepest.id !== node.id) {
          applySelection([deepest.id], artboardIdForNode(deepest) || board, containerIdForNode(deepest))
          beacon('deep-select', { layerId: deepest.id, from: node.id })
          return true
        }
        const drill = drillGroupIdRef.current
        // Containers from the outermost ancestor down to the node itself.
        const containers = []
        let current = node.parent || null
        while (current) {
          if (isContainerLayer(current.layer)) containers.unshift(current)
          current = current.parent || null
        }
        if (isContainerLayer(node.layer)) containers.push(node)
        let nextIndex = 0
        if (drill) {
          const at = containers.findIndex(function (container) {
            return container.id === drill
          })
          nextIndex = at >= 0 ? at + 1 : 0
        }
        const next = containers[nextIndex] || null
        if (next) {
          // The child of `next` that leads toward the double-clicked node (or the node itself).
          let child = node
          while (child && child.parent && child.parent.id !== next.id) child = child.parent
          const childId = child && child.parent && child.parent.id === next.id ? child.id : node.id
          applySelection([childId], board, next.id)
          beacon('drill-step', {
            container: next.id,
            type: next.type,
            into: childId,
            depth: nextIndex,
          })
          return true
        }
        applySelection([node.id], board, drill)
        beacon('drill-step', { container: null, into: node.id, depth: containers.length })
        return true
      }

      /** Esc: step out of the drilled group to the group itself, else clear the selection. */
      function stepSelectionOut() {
        const drillId = drillGroupIdRef.current
        if (drillId) {
          const node = nodeForLayer(drillId)
          applySelection([drillId], node ? artboardIdForNode(node) : null, null)
          return true
        }
        if (selectedLayerIdsRef.current.length) {
          clearSelection()
          return true
        }
        return false
      }

      /** Toggle snapping on/off (Alt temporarily disables it for one drag regardless). */
      function toggleSnap() {
        const next = !snapEnabledRef.current
        snapEnabledRef.current = next
        setSnapEnabled(next)
        beacon('snap-toggle', { enabled: next })
        return next
      }

      /* ------------------------------- mutations ------------------------------- */

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

      /** Changed subset of `patch` for one layer (null when nothing actually changes). */
      function patchDiff(layer, patch) {
        if (!isObject(patch)) return null
        const changed = {}
        let count = 0
        Object.keys(patch).forEach(function (key) {
          if (!isObject(layer) || layer[key] !== patch[key]) {
            changed[key] = patch[key]
            count += 1
          }
        })
        return count > 0 ? changed : null
      }

      /**
       * Apply a property patch to EVERY selected layer as one op batch and one undo entry.
       * Single-layer edits (inspector, tree) keep working unchanged; multi-edit comes for free.
       */
      function commitLayer(patch) {
        const ids = selectedLayerIdsRef.current
        const current = docRef.current
        if (!current || !ids.length || !isObject(patch)) return false
        const entries = []
        const ops = []
        const inverse = []
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          const changed = patchDiff(found.layer, patch)
          if (!changed) continue
          entries.push({ layerId: found.layer.id, patch: changed })
          ops.push({ type: 'layer.update', layerId: found.layer.id, patch: changed })
          const inversePatch = inversePatchFor(found.layer, changed)
          if (Object.keys(inversePatch).length > 0) {
            inverse.push({ type: 'layer.update', layerId: found.layer.id, patch: inversePatch })
          }
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('update', ops, inverse)
        return true
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

      /* ------------------------------- id-based mutations (tree / inspector) ------------------------------- */

      /**
       * Patch ONE layer by id, independent of the current selection, as a single undo entry.
       * The tree and the inspector call this for inline rename, drag-reorder and per-row edits.
       */
      function updateLayer(layerId, patch) {
        const current = docRef.current
        if (!current || typeof layerId !== 'string' || !layerId || !isObject(patch)) return false
        const found = findLayerById(current, layerId)
        if (!found) return false
        const changed = patchDiff(found.layer, patch)
        if (!changed) return false
        applyDocLocal(docPatchLayers(current, [{ layerId: layerId, patch: changed }]))
        const inversePatch = inversePatchFor(found.layer, changed)
        commitWithHistory(
          'update',
          [{ type: 'layer.update', layerId: layerId, patch: changed }],
          Object.keys(inversePatch).length > 0
            ? [{ type: 'layer.update', layerId: layerId, patch: inversePatch }]
            : [],
        )
        return true
      }

      /** Inline rename of one layer (trimmed, empty names are ignored). */
      function renameLayer(layerId, name) {
        const trimmed = typeof name === 'string' ? name.trim().slice(0, 200) : ''
        if (!trimmed) return false
        return updateLayer(layerId, { name: trimmed })
      }

      /** Inline rename of an artboard (single artboard.update + one undo entry). */
      function renameArtboard(artboardId, name) {
        const current = docRef.current
        if (!current || typeof artboardId !== 'string' || !artboardId) return false
        const trimmed = typeof name === 'string' ? name.trim().slice(0, 200) : ''
        if (!trimmed) return false
        const artboard = findArtboardById(current, artboardId)
        if (!artboard || artboard.name === trimmed) return false
        const previousName =
          typeof artboard.name === 'string' && artboard.name ? artboard.name : 'Artboard'
        applyDocLocal(docPatchArtboard(current, artboardId, { name: trimmed }))
        commitWithHistory(
          'rename-artboard',
          [{ type: 'artboard.update', artboardId: artboardId, patch: { name: trimmed } }],
          [{ type: 'artboard.update', artboardId: artboardId, patch: { name: previousName } }],
        )
        beacon('artboard-rename', { artboardId: artboardId })
        return true
      }

      /** Reorder one layer within its current parent (tree drag/drop), single undo entry. */
      function reorderLayer(layerId, index) {
        const current = docRef.current
        if (!current || typeof layerId !== 'string' || !layerId) return false
        const found = findLayerById(current, layerId)
        if (!found) return false
        const siblings = found.parent ? childrenOf(found.parent) : layersOf(found.artboard)
        if (siblings.length < 2) return false
        const target = clamp(Math.round(finiteNumber(index, found.index)), 0, siblings.length - 1)
        if (target === found.index) return false
        applyDocLocal(docReorderLayer(current, layerId, target))
        commitWithHistory(
          'reorder',
          [{ type: 'layer.reorder', layerId: layerId, index: target }],
          [{ type: 'layer.reorder', layerId: layerId, index: found.index }],
        )
        beacon('layer-reorder', { layerId: layerId, index: target, source: 'tree' })
        return true
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

      /**
       * Delete every given layer (roots only) in ONE document update + one undo entry.
       * Locked layers are protected from direct manipulation; the rest of the selection still goes.
       */
      function deleteLayersByIds(ids) {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(ids)
        if (!roots.length) return false
        const buckets = []
        const removed = []
        let blockedLocked = false
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          if (found.layer.locked === true) {
            blockedLocked = true
            continue
          }
          buckets.push({
            key: (found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id) + '#' + found.index,
            parentId: found.parentId,
            artboardId: found.artboard.id,
            index: found.index,
            ops: insertOpsForSubtree(
              found.layer,
              found.parentId ? { parentId: found.parentId } : { artboardId: found.artboard.id },
              found.index,
            ),
          })
          removed.push(found.layer.id)
        }
        if (removed.length === 0) {
          if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
          return false
        }
        applyDocLocal(docRemoveLayers(current, removed))
        const nextDoc = docRef.current
        const remaining = selectedLayerIdsRef.current.filter(function (layerId) {
          return removed.indexOf(layerId) < 0 && !!findLayerById(nextDoc, layerId)
        })
        applySelection(remaining, selectedArtboardIdRef.current, null)
        // Restore in ascending sibling order so the original indexes line up again.
        buckets.sort(function (first, second) {
          if (first.parentId !== second.parentId) return first.parentId ? -1 : 1
          return first.index - second.index
        })
        const inverse = []
        for (let index = 0; index < buckets.length; index += 1) {
          inverse.push.apply(inverse, buckets[index].ops)
        }
        commitWithHistory(
          'delete',
          removed.map(function (layerId) {
            return { type: 'layer.delete', layerId: layerId }
          }),
          inverse,
        )
        if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
        beacon('layer-delete', { count: removed.length })
        return true
      }

      function deleteLayerById(layerId) {
        return deleteLayersByIds([layerId])
      }

      function deleteSelectedLayer() {
        const ids = selectedLayerIdsRef.current
        if (!ids.length) return false
        return deleteLayersByIds(ids)
      }

      /**
       * Reorder ops that turn `list` into `target` (same members). Works for both the local
       * simulation and the Host batch because `layer.reorder` is applied sequentially.
       */
      function reorderOpsToReach(list, target) {
        const order = Array.isArray(list) ? list.slice() : []
        const goal = Array.isArray(target) ? target : []
        const ops = []
        for (let index = 0; index < goal.length; index += 1) {
          const wanted = goal[index]
          if (!wanted || !wanted.id) continue
          if (order[index] && order[index].id === wanted.id) continue
          let from = -1
          for (let scan = index; scan < order.length; scan += 1) {
            if (order[scan] && order[scan].id === wanted.id) {
              from = scan
              break
            }
          }
          if (from < 0) continue
          const moved = order.splice(from, 1)[0]
          order.splice(index, 0, moved)
          ops.push({ type: 'layer.reorder', layerId: wanted.id, index: index })
        }
        return ops
      }

      /**
       * Z-order moves for the whole selection: `front`, `forward`, `backward`, `back` (the tree's
       * up/down buttons map to forward/backward). One op batch, one undo entry.
       */
      function reorderSelection(direction) {
        const current = docRef.current
        if (!current) return false
        const mode =
          direction === 'up' || direction === 'forward'
            ? 'forward'
            : direction === 'down' || direction === 'backward'
              ? 'backward'
              : direction === 'front' || direction === 'back'
                ? direction
                : null
        if (!mode) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (!roots.length) return false
        const selectedSet = new Set(roots)
        const groups = new Map()
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          let group = groups.get(key)
          if (!group) {
            group = {
              key: key,
              list: (found.parentId ? childrenOf(found.parent) : layersOf(found.artboard)).slice(),
            }
            groups.set(key, group)
          }
        }
        let forwardOps = []
        let inverseOps = []
        groups.forEach(function (group) {
          const list = group.list
          if (list.length < 2) return
          const isSelected = function (layer) {
            return !!(layer && selectedSet.has(layer.id))
          }
          const target = list.slice()
          if (mode === 'front' || mode === 'back') {
            const picked = target.filter(isSelected)
            if (!picked.length) return
            const rest = target.filter(function (layer) { return !isSelected(layer) })
            const next = mode === 'front' ? rest.concat(picked) : picked.concat(rest)
            target.length = 0
            for (let index = 0; index < next.length; index += 1) target.push(next[index])
          } else if (mode === 'forward') {
            for (let index = target.length - 2; index >= 0; index -= 1) {
              if (!isSelected(target[index]) || isSelected(target[index + 1])) continue
              const swap = target[index]
              target[index] = target[index + 1]
              target[index + 1] = swap
            }
          } else {
            for (let index = 1; index < target.length; index += 1) {
              if (!isSelected(target[index]) || isSelected(target[index - 1])) continue
              const swap = target[index]
              target[index] = target[index - 1]
              target[index - 1] = swap
            }
          }
          forwardOps = forwardOps.concat(reorderOpsToReach(list, target))
          inverseOps = inverseOps.concat(reorderOpsToReach(target, list))
        })
        if (forwardOps.length === 0) return false
        let next = current
        for (let index = 0; index < forwardOps.length; index += 1) {
          next = docReorderLayer(next, forwardOps[index].layerId, forwardOps[index].index)
        }
        applyDocLocal(next)
        commitWithHistory(
          mode === 'front' || mode === 'back' ? 'arrange' : 'reorder',
          forwardOps,
          inverseOps,
        )
        beacon('layer-reorder', { source: 'selection', mode: mode, count: forwardOps.length })
        return true
      }

      function moveSelected(direction) {
        return reorderSelection(direction)
      }

      function arrangeSelection(mode) {
        return reorderSelection(mode)
      }

      /** layer.add must not carry `children` (the Host builds it with parentId adds). */
      function opLayerForAdd(layer) {
        if (!isObject(layer) || !isContainerLayer(layer) || !Array.isArray(layer.children)) {
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
        if (isContainerLayer(layer)) {
          copy.children = childrenOf(layer).map(function (child) {
            return cloneLayerSubtree(child, 0, 0)
          })
        }
        return copy
      }

      /**
       * Duplicate the whole selection. Each selected root is copied with remapped subtree ids and
       * a 12,12 offset (0 inside an auto-layout parent, where x/y are derived); everything lands in
       * ONE `runOps` batch and ONE undo entry, and the copies become the new selection.
       */
      function duplicateSelected() {
        try {
          const current = docRef.current
          if (!current) return false
          const roots = rootSelectionIds(selectedLayerIdsRef.current)
          if (!roots.length) return false
          const copies = []
          const ops = []
          let boardId = null
          for (let index = 0; index < roots.length; index += 1) {
            const found = findLayerById(current, roots[index])
            if (!found) continue
            const node = nodeForLayer(found.layer.id)
            const autoParent = !!(node && node.autoParent)
            const offset = autoParent ? 0 : DUPLICATE_OFFSET
            const copy = cloneLayerSubtree(found.layer, offset, offset)
            if (!copy) continue
            const destination = found.parentId
              ? { parentId: found.parentId }
              : { artboardId: found.artboard.id }
            if (destination.parentId) {
              const parentFound = findLayerById(current, destination.parentId)
              if (!parentFound || !parentFound.layer) continue
              if (childrenOf(parentFound.layer).length + copies.length >= FRAME_MAX_CHILDREN) {
                setInlineError(strings.childLimit)
                continue
              }
              if (parentFound.depth + subtreeHeight(copy) > FRAME_MAX_DEPTH) {
                setInlineError(strings.depthLimit)
                continue
              }
            }
            // A single duplicate keeps v1 behaviour (directly above the original); several
            // duplicates from one gesture are appended so their indexes cannot fight each other.
            const insertIndex = roots.length === 1 ? found.index + 1 : null
            const subOps = insertOpsForSubtree(copy, destination, insertIndex)
            if (subOps.length === 0) continue
            if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
              setInlineError(strings.duplicateTooLarge)
              beacon('duplicate-rejected', { layerId: found.layer.id, ops: subOps.length })
              return false
            }
            ops.push.apply(ops, subOps)
            copies.push({ copy: copy, destination: destination, index: insertIndex })
            boardId = found.artboard.id
          }
          if (copies.length === 0) return false
          let next = current
          for (let index = 0; index < copies.length; index += 1) {
            next = docInsertLayers(next, copies[index].destination, [copies[index].copy], copies[index].index)
          }
          applyDocLocal(next)
          applySelection(
            copies.map(function (item) { return item.copy.id }),
            boardId,
            null,
          )
          commitWithHistory(
            'duplicate',
            ops,
            copies.map(function (item) {
              return { type: 'layer.delete', layerId: item.copy.id }
            }),
          )
          beacon('duplicate', { count: copies.length, ops: ops.length })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-failed', { message: shortError(error) })
          return false
        }
      }

      function sameIdSet(first, second) {
        if (!Array.isArray(first) || !Array.isArray(second)) return false
        if (first.length !== second.length) return false
        for (let index = 0; index < first.length; index += 1) {
          if (first[index] !== second[index]) return false
        }
        return true
      }

      /** Batched arrow-key nudge for the whole selection (one history entry per pause). */
      function nudgeSelected(dx, dy) {
        const current = docRef.current
        const ids = selectedLayerIdsRef.current
        if (!current || !ids.length) return
        const pending = nudgeRef.current
        if (pending) {
          if (sameIdSet(pending.layerIds, ids)) {
            pending.dx += dx
            pending.dy += dy
            return
          }
          flushNudge()
        }
        nudgeRef.current = {
          layerIds: ids.slice(),
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
          const entries = []
          const ops = []
          const inverse = []
          let blockedAuto = false
          let blockedLocked = false
          for (let index = 0; index < pending.layerIds.length; index += 1) {
            const layerId = pending.layerIds[index]
            const found = findLayerById(current, layerId)
            if (!found) continue
            const node = nodeForLayer(layerId)
            if (node && node.autoParent) {
              blockedAuto = true
              continue
            }
            if (found.layer.locked === true) {
              blockedLocked = true
              continue
            }
            const previousX = finiteNumber(found.layer.x, 0)
            const previousY = finiteNumber(found.layer.y, 0)
            const nextX = Math.round(previousX + pending.dx)
            const nextY = Math.round(previousY + pending.dy)
            if (nextX === previousX && nextY === previousY) continue
            entries.push({ layerId: layerId, patch: { x: nextX, y: nextY } })
            ops.push({ type: 'layer.update', layerId: layerId, patch: { x: nextX, y: nextY } })
            inverse.push({
              type: 'layer.update',
              layerId: layerId,
              patch: { x: previousX, y: previousY },
            })
          }
          if (blockedAuto) setInlineError(strings.nudgeAutoLayout)
          if (blockedLocked) setInlineError(INTERACTION_COPY.locked)
          if (ops.length === 0) return
          applyDocLocal(docPatchLayers(current, entries))
          commitWithHistory('nudge', ops, inverse)
          beacon('nudge', { dx: pending.dx, dy: pending.dy, count: ops.length })
        } catch (error) {
          beacon('nudge-failed', { message: shortError(error) })
        }
      }

      /* ------------------------------- selection groups, align, tidy ------------------------------- */

      /**
       * Selection roots grouped by parent container. Alignment/distribution/tidy work per parent so
       * a layer is positioned relative to the artboard (direct child) or to its parent frame.
       */
      function selectionGroups() {
        const current = docRef.current
        const groups = []
        if (!current) return groups
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        const byKey = new Map()
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const node = nodeForLayer(found.layer.id)
          if (!node) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          let group = byKey.get(key)
          if (!group) {
            const parentNode = node.parent || null
            group = {
              key: key,
              parentId: found.parentId,
              artboard: found.artboard,
              parentNode: parentNode,
              auto: !!node.autoParent,
              nodes: [],
              list: (parentNode ? childrenOf(parentNode.layer) : layersOf(found.artboard)).slice(),
              box: parentNode
                ? rectOf(0, 0, parentNode.width, parentNode.height)
                : rectOf(0, 0, found.artboard.width, found.artboard.height),
            }
            byKey.set(key, group)
            groups.push(group)
          }
          group.nodes.push(node)
        }
        return groups
      }

      /**
       * An auto-layout parent owns its children's positions, so the only sane "move" there is the
       * child order: normalize the stored order of the selected children to their visual order.
       */
      function visualOrderReorderOps(group, axis) {
        if (!group || !group.auto || !group.parentNode) return null
        const layout = normalizeLayoutObject(group.parentNode.layer.layout)
        if (!layout) return null
        const mainAxis = layout.direction === 'column' ? 'y' : 'x'
        if (axis && axis !== mainAxis) return null
        const list = group.list
        const selectedSet = new Set(group.nodes.map(function (node) { return node.id }))
        const sorted = group.nodes.slice().sort(function (first, second) {
          return mainAxis === 'y' ? first.y - second.y : first.x - second.x
        })
        const slots = []
        for (let index = 0; index < list.length; index += 1) {
          if (list[index] && selectedSet.has(list[index].id)) slots.push(index)
        }
        if (slots.length < 2) return { forward: [], inverse: [] }
        const target = list.slice()
        for (let index = 0; index < slots.length; index += 1) {
          if (sorted[index]) target[slots[index]] = sorted[index].layer
        }
        return {
          forward: reorderOpsToReach(list, target),
          inverse: reorderOpsToReach(target, list),
        }
      }

      /**
       * Align the selection's layers. `kind` is one of left, center-h, right, top, center-v,
       * bottom. Absolute parents get real x/y math (relative to the artboard or parent frame);
       * inside an auto-layout frame the main axis becomes an order change and the cross axis
       * becomes `alignSelf`, because authored x/y are ignored there.
       */
      function alignSelection(kind) {
        const spec = ALIGN_SPECS[kind]
        const current = docRef.current
        if (!current || !spec) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 2) {
          setInlineError(INTERACTION_COPY.alignNeedsTwo)
          return false
        }
        const groups = selectionGroups()
        if (!groups.length) return false
        const entries = []
        const ops = []
        const inverse = []
        let reorderForward = []
        let reorderInverse = []
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]
          const layout = group.auto ? normalizeLayoutObject(group.parentNode.layer.layout) : null
          if (layout) {
            const mainAxis = layout.direction === 'column' ? 'y' : 'x'
            if (spec.axis === mainAxis) {
              const selectedSet = new Set(group.nodes.map(function (node) { return node.id }))
              const picked = group.list.filter(function (layer) {
                return isObject(layer) && selectedSet.has(layer.id)
              })
              const rest = group.list.filter(function (layer) {
                return isObject(layer) && !selectedSet.has(layer.id)
              })
              let insertAt = 0
              if (spec.pos === 'end') insertAt = rest.length
              else if (spec.pos === 'center') insertAt = Math.floor(rest.length / 2)
              const target = rest.slice(0, insertAt).concat(picked).concat(rest.slice(insertAt))
              reorderForward = reorderForward.concat(reorderOpsToReach(group.list, target))
              reorderInverse = reorderInverse.concat(reorderOpsToReach(target, group.list))
            } else {
              const alignSelf = spec.pos === 'start' ? 'start' : spec.pos === 'end' ? 'end' : 'center'
              for (let nodeIndex = 0; nodeIndex < group.nodes.length; nodeIndex += 1) {
                const node = group.nodes[nodeIndex]
                if (node.layer.alignSelf === alignSelf) continue
                const patch = { alignSelf: alignSelf }
                entries.push({ layerId: node.id, patch: patch })
                ops.push({ type: 'layer.update', layerId: node.id, patch: patch })
                inverse.push({
                  type: 'layer.update',
                  layerId: node.id,
                  patch: inversePatchFor(node.layer, patch),
                })
              }
            }
            continue
          }
          for (let nodeIndex = 0; nodeIndex < group.nodes.length; nodeIndex += 1) {
            const node = group.nodes[nodeIndex]
            const patch = {}
            if (spec.axis === 'x') {
              const width = Math.max(1, finiteNumber(node.width, 1))
              patch.x = Math.round(
                spec.pos === 'start'
                  ? 0
                  : spec.pos === 'end'
                    ? group.box.width - width
                    : (group.box.width - width) / 2,
              )
            } else {
              const height = Math.max(1, finiteNumber(node.height, 1))
              patch.y = Math.round(
                spec.pos === 'start'
                  ? 0
                  : spec.pos === 'end'
                    ? group.box.height - height
                    : (group.box.height - height) / 2,
              )
            }
            const changed = patchDiff(node.layer, patch)
            if (!changed) continue
            entries.push({ layerId: node.id, patch: changed })
            ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
            inverse.push({
              type: 'layer.update',
              layerId: node.id,
              patch: inversePatchFor(node.layer, changed),
            })
          }
        }
        const forwardOps = ops.concat(reorderForward)
        if (forwardOps.length === 0) return false
        let next = docPatchLayers(current, entries)
        for (let index = 0; index < reorderForward.length; index += 1) {
          next = docReorderLayer(next, reorderForward[index].layerId, reorderForward[index].index)
        }
        applyDocLocal(next)
        commitWithHistory('align', forwardOps, reorderInverse.concat(inverse))
        beacon('selection-align', { kind: kind, count: forwardOps.length })
        return true
      }

      /**
       * Distribute equal gaps along `axis` ('x' horizontal / 'y' vertical), 3+ layers with the
       * same parent. Inside an auto-layout parent the gaps belong to the frame, so this normalizes
       * the child order along that frame's main axis instead (and is a no-op on the cross axis).
       */
      function distributeSelection(axis) {
        const current = docRef.current
        if (!current) return false
        const direction = axis === 'y' || axis === 'vertical' ? 'y' : 'x'
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 3) {
          setInlineError(INTERACTION_COPY.distributeNeedsThree)
          return false
        }
        const groups = selectionGroups()
        if (groups.length !== 1) {
          setInlineError(INTERACTION_COPY.alignSameParent)
          return false
        }
        const group = groups[0]
        if (group.nodes.length < 3) {
          setInlineError(INTERACTION_COPY.distributeNeedsThree)
          return false
        }
        if (group.auto) {
          const reorder = visualOrderReorderOps(group, direction)
          if (!reorder || reorder.forward.length === 0) return false
          let next = current
          for (let index = 0; index < reorder.forward.length; index += 1) {
            next = docReorderLayer(next, reorder.forward[index].layerId, reorder.forward[index].index)
          }
          applyDocLocal(next)
          commitWithHistory('distribute', reorder.forward, reorder.inverse)
          beacon('selection-distribute', { axis: direction, mode: 'order' })
          return true
        }
        const nodes = group.nodes.slice().sort(function (first, second) {
          return direction === 'x' ? first.x - second.x : first.y - second.y
        })
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        let total = 0
        for (let index = 0; index < nodes.length; index += 1) {
          total += Math.max(1, direction === 'x' ? nodes[index].width : nodes[index].height)
        }
        const span =
          (direction === 'x' ? last.x + last.width : last.y + last.height) -
          (direction === 'x' ? first.x : first.y)
        const gap = (span - total) / (nodes.length - 1)
        if (!Number.isFinite(gap)) return false
        const entries = []
        const ops = []
        const inverse = []
        let cursor = direction === 'x' ? first.x : first.y
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]
          if (index > 0) {
            const patch = {}
            patch[direction] = Math.round(cursor)
            const changed = patchDiff(node.layer, patch)
            if (changed) {
              entries.push({ layerId: node.id, patch: changed })
              ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
              inverse.push({
                type: 'layer.update',
                layerId: node.id,
                patch: inversePatchFor(node.layer, changed),
              })
            }
          }
          cursor += Math.max(1, direction === 'x' ? node.width : node.height) + gap
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('distribute', ops, inverse)
        beacon('selection-distribute', { axis: direction, mode: 'positions', gap: Math.round(gap) })
        return true
      }

      /**
       * Tidy up: arrange the selection into a single row or column with even spacing (TIDY_GAP),
       * sharing one edge. Auto-layout parents get the equivalent: their child order is normalized.
       */
      function tidySelection(direction) {
        const current = docRef.current
        if (!current) return false
        const mode = direction === 'column' ? 'column' : 'row'
        const groups = selectionGroups()
        if (!groups.length) return false
        const entries = []
        const ops = []
        const inverse = []
        let reorderForward = []
        let reorderInverse = []
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]
          if (group.auto) {
            const reorder = visualOrderReorderOps(group, mode === 'column' ? 'y' : 'x')
            if (!reorder) continue
            reorderForward = reorderForward.concat(reorder.forward)
            reorderInverse = reorderInverse.concat(reorder.inverse)
            continue
          }
          if (group.nodes.length < 2) continue
          const nodes = group.nodes.slice().sort(function (first, second) {
            return mode === 'row' ? first.x - second.x : first.y - second.y
          })
          const box = unionRects(
            group.nodes.map(function (node) {
              return rectOf(node.x, node.y, node.width, node.height)
            }),
          )
          if (!box) continue
          let cursor = mode === 'row' ? box.x : box.y
          for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index]
            const patch =
              mode === 'row'
                ? { x: Math.round(cursor), y: Math.round(box.y) }
                : { x: Math.round(box.x), y: Math.round(cursor) }
            cursor += Math.max(1, mode === 'row' ? node.width : node.height) + TIDY_GAP
            const changed = patchDiff(node.layer, patch)
            if (!changed) continue
            entries.push({ layerId: node.id, patch: changed })
            ops.push({ type: 'layer.update', layerId: node.id, patch: changed })
            inverse.push({
              type: 'layer.update',
              layerId: node.id,
              patch: inversePatchFor(node.layer, changed),
            })
          }
        }
        const forwardOps = ops.concat(reorderForward)
        if (forwardOps.length === 0) return false
        let next = docPatchLayers(current, entries)
        for (let index = 0; index < reorderForward.length; index += 1) {
          next = docReorderLayer(next, reorderForward[index].layerId, reorderForward[index].index)
        }
        applyDocLocal(next)
        commitWithHistory('tidy', forwardOps, reorderInverse.concat(inverse))
        beacon('selection-tidy', { direction: mode })
        return true
      }

      /* ------------------------------- group / ungroup ------------------------------- */

      /**
       * Group the selection with one `layer.group` op. The Host builds the group (union box, ids,
       * relative child coordinates), so the local document is not patched optimistically; the id
       * the Host assigned comes back in `applied[]` and becomes the selection.
       */
      async function groupSelection() {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (roots.length < 2) {
          setInlineError(INTERACTION_COPY.groupNeedsTwo)
          return false
        }
        const first = findLayerById(current, roots[0])
        if (!first) return false
        const parentKey = first.parentId ? 'p:' + first.parentId : 'a:' + first.artboard.id
        for (let index = 1; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found) continue
          const key = found.parentId ? 'p:' + found.parentId : 'a:' + found.artboard.id
          if (key !== parentKey) {
            // layer.group has no parentId: grouping across containers would be ambiguous.
            setInlineError(INTERACTION_COPY.groupSameParent)
            return false
          }
        }
        const op = { type: 'layer.group', layerIds: roots }
        if (!first.parentId) op.artboardId = first.artboard.id
        // The Host refuses to group auto-layout children (their x/y are derived); say it up front.
        if (first.parentId) {
          const parentFound = findLayerById(current, first.parentId)
          if (parentFound && parentFound.layer.type === 'frame' && isObject(parentFound.layer.layout)) {
            setInlineError(INTERACTION_COPY.groupAutoLayout)
            return false
          }
        }
        const result = await runOps([op])
        if (!result || result.ok === false) return false
        let groupId = null
        const applied = Array.isArray(result.applied) ? result.applied : []
        for (let index = 0; index < applied.length; index += 1) {
          if (applied[index] && applied[index].type === 'layer.group' && applied[index].id) {
            groupId = applied[index].id
            break
          }
        }
        if (!groupId) return false
        pushHistoryEntry('group', [op], [{ type: 'layer.ungroup', layerId: groupId }])
        applySelection([groupId], first.artboard.id, null)
        beacon('selection-group', { groupId: groupId, members: roots.length })
        return groupId
      }

      /**
       * Ungroup every selected group. The inverse re-creates a group from the promoted children
       * (which keep their ids), so undo restores the selection unit even though the Host assigns a
       * fresh group id and box.
       */
      function ungroupSelection() {
        const current = docRef.current
        if (!current) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        const targets = []
        const promoted = []
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(current, roots[index])
          if (!found || found.layer.type !== 'group') continue
          targets.push(found)
          const kids = childrenOf(found.layer)
          for (let childIndex = 0; childIndex < kids.length; childIndex += 1) {
            if (kids[childIndex] && kids[childIndex].id) promoted.push(kids[childIndex].id)
          }
        }
        if (targets.length === 0) {
          setInlineError(INTERACTION_COPY.ungroupNeedsGroup)
          return false
        }
        const ops = targets.map(function (found) {
          return { type: 'layer.ungroup', layerId: found.layer.id }
        })
        const inverse = targets.map(function (found) {
          const op = {
            type: 'layer.group',
            layerIds: childrenOf(found.layer).map(function (child) { return child.id }),
          }
          if (found.layer.name) op.name = found.layer.name
          if (!found.parentId) op.artboardId = found.artboard.id
          return op
        })
        commitWithHistory('ungroup', ops, inverse)
        applySelection(promoted, targets[0].artboard.id, null)
        beacon('selection-ungroup', { groups: targets.length, promoted: promoted.length })
        return true
      }

      /** Lock / unlock the whole selection (locked layers stay selectable; gestures are blocked). */
      function toggleLock() {
        const current = docRef.current
        const ids = selectedLayerIdsRef.current
        if (!current || !ids.length) return false
        let allLocked = true
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          if (found.layer.locked !== true) allLocked = false
        }
        const nextLocked = !allLocked
        const entries = []
        const ops = []
        const inverse = []
        for (let index = 0; index < ids.length; index += 1) {
          const found = findLayerById(current, ids[index])
          if (!found) continue
          if ((found.layer.locked === true) === nextLocked) continue
          entries.push({ layerId: found.layer.id, patch: { locked: nextLocked } })
          ops.push({ type: 'layer.update', layerId: found.layer.id, patch: { locked: nextLocked } })
          inverse.push({
            type: 'layer.update',
            layerId: found.layer.id,
            patch: { locked: found.layer.locked === true },
          })
        }
        if (ops.length === 0) return false
        applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory(nextLocked ? 'lock' : 'unlock', ops, inverse)
        beacon('selection-lock', { locked: nextLocked, count: ops.length })
        return true
      }

      /** Move every selected root into another frame/group or back to an artboard root. */
      function reparentSelection(destination) {
        const current = docRef.current
        if (!current || !isObject(destination)) return false
        const targetParentId =
          typeof destination.parentId === 'string' && destination.parentId
            ? destination.parentId
            : null
        const targetArtboardId =
          typeof destination.artboardId === 'string' && destination.artboardId
            ? destination.artboardId
            : null
        if (!targetParentId && !targetArtboardId) return false
        const roots = rootSelectionIds(selectedLayerIdsRef.current)
        if (!roots.length) return false
        const ops = []
        const inverse = []
        let next = current
        for (let index = 0; index < roots.length; index += 1) {
          const found = findLayerById(next, roots[index])
          if (!found) continue
          const sameParent = targetParentId
            ? targetParentId === found.parentId
            : !found.parentId && targetArtboardId === found.artboard.id
          if (sameParent) continue
          let insertIndex = 0
          if (targetParentId) {
            const parentFound = findLayerById(next, targetParentId)
            if (!parentFound || !isContainerLayer(parentFound.layer)) {
              setInlineError(strings.reparentFailed)
              continue
            }
            if (isContainerLayer(found.layer) && subtreeContains(found.layer, targetParentId)) {
              setInlineError(strings.reparentFailed)
              continue
            }
            if (parentFound.depth + subtreeHeight(found.layer) > FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              continue
            }
            insertIndex = childrenOf(parentFound.layer).length
          } else {
            const board = findArtboardById(next, targetArtboardId)
            if (!board) {
              setInlineError(strings.reparentFailed)
              continue
            }
            insertIndex = layersOf(board).length
          }
          const moveDestination = targetParentId
            ? { parentId: targetParentId }
            : { artboardId: targetArtboardId }
          const moved = docMoveLayer(next, found.layer.id, moveDestination, insertIndex)
          if (moved === next) continue
          next = moved
          const op = { type: 'layer.move_to', layerId: found.layer.id, index: insertIndex }
          if (targetParentId) op.parentId = targetParentId
          else op.artboardId = targetArtboardId
          ops.push(op)
          inverse.push.apply(inverse, inverseMoveToOps(found))
        }
        if (ops.length === 0) return false
        applyDocLocal(next)
        inverse.reverse()
        commitWithHistory('reparent', ops, inverse)
        if (targetArtboardId) setSelectedArtboardId(targetArtboardId)
        beacon('selection-reparent', { count: ops.length })
        return true
      }

      /* ------------------------------- clipboard ------------------------------- */

      function writeClipboardText(text) {
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') return
          const pending = nav.clipboard.writeText(text)
          if (pending && typeof pending.catch === 'function') {
            pending.catch(function () {
              /* OS clipboard writes are best-effort; the in-memory tree still works */
            })
          }
        } catch (error) {
          /* ignore */
        }
      }

      function readClipboardText() {
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (!nav || !nav.clipboard || typeof nav.clipboard.readText !== 'function') {
            return Promise.resolve('')
          }
          const pending = nav.clipboard.readText()
          if (pending && typeof pending.then === 'function') {
            return pending.catch(function () { return '' })
          }
          return Promise.resolve('')
        } catch (error) {
          return Promise.resolve('')
        }
      }

      function parseClipboardPayload(text) {
        if (typeof text !== 'string' || !text.trim()) return null
        try {
          const parsed = JSON.parse(text)
          if (!isObject(parsed)) return null
          if (parsed.kind !== CLIPBOARD_KIND) return null
          if (!Array.isArray(parsed.layers) || parsed.layers.length === 0) return null
          return parsed
        } catch (error) {
          return null
        }
      }

      /** Copy the selection into the internal clipboard ref + the OS clipboard as JSON. */
      function copySelection() {
        try {
          const current = docRef.current
          if (!current) return false
          const roots = rootSelectionIds(selectedLayerIdsRef.current)
          if (!roots.length) return false
          const layers = []
          for (let index = 0; index < roots.length; index += 1) {
            const found = findLayerById(current, roots[index])
            if (found) layers.push(cloneLayerSubtree(found.layer, 0, 0))
          }
          if (!layers.length) return false
          const payload = { kind: CLIPBOARD_KIND, version: 1, layers: layers }
          clipboardRef.current = payload
          let text = ''
          try {
            text = JSON.stringify(payload)
          } catch (error) {
            text = ''
          }
          if (text) writeClipboardText(text)
          beacon('clipboard-copy', { count: layers.length })
          return true
        } catch (error) {
          beacon('clipboard-copy-failed', { message: shortError(error) })
          return false
        }
      }

      function cutSelection() {
        if (!copySelection()) return false
        deleteSelectedLayer()
        return true
      }

      /** Destination for a paste: the selected container, else the primary layer's parent/board. */
      function pasteDestination() {
        const current = docRef.current
        if (!current) return null
        const primaryId = selectedLayerIdRef.current
        const primaryNode = primaryId ? nodeForLayer(primaryId) : null
        const primaryFound = primaryId ? findLayerById(current, primaryId) : null
        if (primaryNode && isContainerLayer(primaryNode.layer)) {
          return { parentId: primaryNode.layer.id, parentNode: primaryNode }
        }
        if (primaryFound && primaryFound.parentId) {
          return { parentId: primaryFound.parentId, parentNode: nodeForLayer(primaryFound.parentId) }
        }
        if (primaryFound) return { artboardId: primaryFound.artboard.id, parentNode: null }
        let board = selectedArtboardIdRef.current
          ? findArtboardById(current, selectedArtboardIdRef.current)
          : null
        if (!board) board = artboardsOf(current).find(function (artboard) { return isObject(artboard) }) || null
        if (!board) return null
        return { artboardId: board.id, parentNode: null }
      }

      /** Insert cloned clipboard layers into the paste destination (one history entry). */
      function insertPastedLayers(layers) {
        const current = docRef.current
        if (!current || !Array.isArray(layers) || !layers.length) return false
        const destination = pasteDestination()
        if (!destination) {
          setInlineError(strings.noArtboards)
          return false
        }
        const destinationNode = destination.parentNode || null
        const destinationLayer = destinationNode
          ? destinationNode.layer
          : destination.artboardId
            ? findArtboardById(current, destination.artboardId)
            : null
        if (!destinationLayer) return false
        if (destinationNode) {
          if (destinationNode.depth >= FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            return false
          }
          if (
            childrenOf(destinationLayer).length + layers.length >
            FRAME_MAX_CHILDREN
          ) {
            setInlineError(strings.childLimit)
            return false
          }
        }
        const autoDestination =
          destinationNode &&
          destinationNode.layer.type === 'frame' &&
          !!normalizeLayoutObject(destinationNode.layer.layout)
        const offset = autoDestination ? 0 : PASTE_OFFSET
        const copies = []
        const ops = []
        for (let index = 0; index < layers.length; index += 1) {
          const clone = cloneLayerSubtree(layers[index], offset, offset)
          if (!clone) continue
          if (destinationNode && destinationNode.depth + subtreeHeight(clone) > FRAME_MAX_DEPTH) {
            setInlineError(strings.depthLimit)
            continue
          }
          const subOps = insertOpsForSubtree(
            clone,
            destination.parentId ? { parentId: destination.parentId } : { artboardId: destination.artboardId },
            null,
          )
          if (subOps.length === 0) continue
          if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
            setInlineError(INTERACTION_COPY.pasteLimit)
            return false
          }
          ops.push.apply(ops, subOps)
          copies.push(clone)
        }
        if (copies.length === 0) return false
        const next = docInsertLayers(
          current,
          destination.parentId ? { parentId: destination.parentId } : { artboardId: destination.artboardId },
          copies,
        )
        applyDocLocal(next)
        const boardId =
          destination.artboardId ||
          (destinationNode ? artboardIdForNode(destinationNode) : null) ||
          selectedArtboardIdRef.current
        applySelection(
          copies.map(function (clone) { return clone.id }),
          boardId,
          null,
        )
        commitWithHistory(
          'paste',
          ops,
          copies.map(function (clone) {
            return { type: 'layer.delete', layerId: clone.id }
          }),
        )
        beacon('clipboard-paste', { count: copies.length, ops: ops.length })
        return true
      }

      /**
       * Paste layers from the internal clipboard (survives in-tab), falling back to the JSON we
       * wrote to the OS clipboard so a reload or another tab can still paste.
       */
      function pasteSelection() {
        let payload = clipboardRef.current
        if (!isObject(payload) || !Array.isArray(payload.layers) || payload.layers.length === 0) {
          return readClipboardText().then(function (text) {
            const parsed = parseClipboardPayload(text)
            if (!parsed) {
              setInlineError(INTERACTION_COPY.pasteEmpty)
              return false
            }
            clipboardRef.current = parsed
            return insertPastedLayers(parsed.layers)
          })
        }
        return Promise.resolve(insertPastedLayers(payload.layers))
      }

      /* ------------------------------- presets ------------------------------- */

      /**
       * Toolbar action for the chrome agent: a ready-made button (auto-layout frame + label) in
       * the selected container/artboard, one history entry.
       */
      function addButtonPreset() {
        try {
          const current = docRef.current
          if (!current) return false
          const boards = artboardsOf(current)
          const primaryId = selectedLayerIdRef.current
          const primaryNode = primaryId ? nodeForLayer(primaryId) : null
          const primaryFound = primaryId ? findLayerById(current, primaryId) : null
          let artboard = primaryFound ? primaryFound.artboard : null
          if (!artboard && selectedArtboardIdRef.current) {
            artboard = findArtboardById(current, selectedArtboardIdRef.current)
          }
          if (!artboard) artboard = boards.find(function (board) { return isObject(board) }) || null
          if (!artboard) {
            setInlineError(strings.noArtboards)
            return false
          }
          const containerNode =
            primaryNode && isContainerLayer(primaryNode.layer) ? primaryNode : null
          const destination = containerNode
            ? { parentId: containerNode.layer.id }
            : { artboardId: artboard.id }
          if (containerNode) {
            if (containerNode.depth >= FRAME_MAX_DEPTH) {
              setInlineError(strings.depthLimit)
              return false
            }
            if (childrenOf(containerNode.layer).length + 1 > FRAME_MAX_CHILDREN) {
              setInlineError(strings.childLimit)
              return false
            }
          }
          const preset = createButtonPresetLayers(containerNode ? containerNode.layer : artboard)
          const frameOp = { type: 'layer.add', layer: opLayerForAdd(preset.frame) }
          if (destination.parentId) frameOp.parentId = destination.parentId
          else frameOp.artboardId = destination.artboardId
          const textOp = {
            type: 'layer.add',
            parentId: preset.frame.id,
            layer: preset.text,
          }
          let next = docInsertLayer(current, destination, preset.frame)
          next = docInsertLayer(next, { parentId: preset.frame.id }, preset.text)
          applyDocLocal(next)
          applySelection([preset.frame.id], artboard.id, null)
          commitWithHistory('add-button', [frameOp, textOp], [
            { type: 'layer.delete', layerId: preset.frame.id },
          ])
          beacon('button-preset-add', { artboardId: artboard.id })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('button-preset-failed', { message: shortError(error) })
          return false
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

      /**
       * Delete an artboard (and its subtree, plus the comments anchored to it). Undo re-creates
       * the board and re-inserts every layer with its original id and props.
       */
      function deleteArtboard(artboardId) {
        const current = docRef.current
        if (!current) return false
        const targetId = typeof artboardId === 'string' && artboardId ? artboardId : selectedArtboardIdRef.current
        if (!targetId) return false
        const board = findArtboardById(current, targetId)
        if (!board) return false
        const boards = artboardsOf(current)
        const index = boards.findIndex(function (item) {
          return item && item.id === targetId
        })
        // Undo: re-add the artboard, then re-insert its layers (subtrees included) in order.
        const inverse = [
          {
            type: 'artboard.add',
            artboard: {
              name: board.name,
              width: board.width,
              height: board.height,
              background: board.background,
              x: board.x,
              y: board.y,
            },
            index: index >= 0 ? index : undefined,
          },
        ]
        const topLayers = layersOf(board)
        for (let layerIndex = 0; layerIndex < topLayers.length; layerIndex += 1) {
          const layer = topLayers[layerIndex]
          if (!isObject(layer)) continue
          inverse.push.apply(inverse, insertOpsForSubtree(layer, { artboardId: targetId }, layerIndex))
        }
        if (
          selectedArtboardIdRef.current === targetId ||
          (selectedLayerIdRef.current && artboardIdForLayer(selectedLayerIdRef.current) === targetId)
        ) {
          applySelection([], null, null)
        }
        commitWithHistory(
          'delete-artboard',
          [{ type: 'artboard.delete', artboardId: targetId }],
          inverse,
        )
        beacon('delete-artboard', { artboardId: targetId, layers: topLayers.length })
        return true
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

      /**
       * v2 batch API (CONTRACT §6): send ONE chat message for many comments. The builder lives in
       * 53-batch.js and is hoisted; the editor contributes the live document/context.
       */
      function submitCommentsFor(commentIds) {
        return submitComments(commentIds, {
          doc: docRef.current,
          tree: treeRef.current,
          version: versionRef.current,
          boardPath: boardPath,
          strings: strings,
          editor: { sendCommentChat: sendCommentChat, runOps: runOps },
          actions: { selectLayer: selectLayer, selectArtboard: selectArtboard },
        })
      }

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

      /**
       * Layers that take part in one drag: the whole selection when the grabbed layer is part of
       * it, otherwise just the grabbed layer. Auto-layout children (their x/y are derived) and
       * locked layers are left out; `blocked*` flags let the caller surface why.
       */
      function gestureMembersFor(grabbedId, multi) {
        const current = docRef.current
        const result = { members: [], blockedLocked: false, blockedAuto: false }
        if (!current) return result
        let ids = multi ? rootSelectionIds(selectedLayerIdsRef.current) : [grabbedId]
        if (ids.indexOf(grabbedId) < 0) ids = [grabbedId]
        for (let index = 0; index < ids.length; index += 1) {
          const layerId = ids[index]
          const found = findLayerById(current, layerId)
          if (!found) continue
          const node = nodeForLayer(layerId)
          if (node && node.autoParent) {
            result.blockedAuto = true
            continue
          }
          if (found.layer.locked === true) {
            result.blockedLocked = true
            continue
          }
          result.members.push({
            layerId: layerId,
            parentId: found.parentId,
            artboardId: found.artboard.id,
            origin: {
              x: finiteNumber(found.layer.x, 0),
              y: finiteNumber(found.layer.y, 0),
              width: Math.max(1, finiteNumber(found.layer.width, 1)),
              height: Math.max(1, finiteNumber(found.layer.height, 1)),
            },
          })
        }
        return result
      }

      /** Layer update entries for the current gesture delta (absolute, so preview is idempotent). */
      function gesturePatchEntries(gesture) {
        if (!gesture || !Array.isArray(gesture.members)) return []
        const dx = finiteNumber(gesture.dx, 0)
        const dy = finiteNumber(gesture.dy, 0)
        const entries = []
        if (gesture.kind === 'drag') {
          for (let index = 0; index < gesture.members.length; index += 1) {
            const member = gesture.members[index]
            entries.push({
              layerId: member.layerId,
              patch: {
                x: Math.round(member.origin.x + dx),
                y: Math.round(member.origin.y + dy),
              },
            })
          }
          return entries
        }
        // Resize handles sit on the union box of the selection: scale every member about it.
        const patch = gesturePatch(gesture, dx, dy)
        if (patch && gesture.members.length <= 1) {
          entries.push({ layerId: gesture.layerId, patch: patch })
          return entries
        }
        return resizeEntries(gesture, dx, dy)
      }

      /**
       * Scale every member about the union box the handles are drawn on.
       *
       * Everything here comes from geometry captured when the gesture started (`resizeMembers`
       * plus `selectionBox`), never from the live document: the preview runs on every
       * pointermove, so reading live rects would re-scale already-scaled layers and the
       * selection would explode. Members can have different parents, so the scale happens in
       * artboard space and each parent's offset is subtracted back out for its patch.
       */
      function resizeEntries(gesture, dx, dy) {
        const box = isObject(gesture.selectionBox) ? gesture.selectionBox : null
        const members = Array.isArray(gesture.resizeMembers) ? gesture.resizeMembers : []
        if (!box || !members.length || !(box.width > 0) || !(box.height > 0)) return []
        const handle = String(gesture.handle || '')
        let left = box.x
        let top = box.y
        let width = box.width
        let height = box.height
        if (handle.indexOf('e') >= 0) width = box.width + dx
        if (handle.indexOf('w') >= 0) width = box.width - dx
        if (handle.indexOf('s') >= 0) height = box.height + dy
        if (handle.indexOf('n') >= 0) height = box.height - dy
        width = Math.max(MIN_LAYER_SIZE, width)
        height = Math.max(MIN_LAYER_SIZE, height)
        if (handle.indexOf('w') >= 0) left = box.x + box.width - width
        if (handle.indexOf('n') >= 0) top = box.y + box.height - height
        const scaleX = width / box.width
        const scaleY = height / box.height
        const out = []
        for (let index = 0; index < members.length; index += 1) {
          const member = members[index]
          out.push({
            layerId: member.layerId,
            patch: {
              x: Math.round(left + (member.x - box.x) * scaleX - member.baseX),
              y: Math.round(top + (member.y - box.y) * scaleY - member.baseY),
              width: Math.round(Math.max(MIN_LAYER_SIZE, member.width * scaleX)),
              height: Math.round(Math.max(MIN_LAYER_SIZE, member.height * scaleY)),
            },
          })
        }
        return out
      }

      function cancelGestureFrame() {
        const frame = gestureFrameRef.current
        if (frame !== null && typeof cancelAnimationFrame === 'function') {
          try {
            cancelAnimationFrame(frame)
          } catch (error) {
            /* ignore */
          }
        }
        gestureFrameRef.current = null
      }

      /** Coalesce pointer previews to one document update per animation frame (N=50 stays smooth). */
      function scheduleGesturePreview() {
        if (gestureFrameRef.current !== null) return
        if (typeof requestAnimationFrame !== 'function') {
          flushGesturePreview()
          return
        }
        gestureFrameRef.current = requestAnimationFrame(function () {
          gestureFrameRef.current = null
          flushGesturePreview()
        })
      }

      function flushGesturePreview() {
        const gesture = gestureRef.current
        const current = docRef.current
        if (!gesture || !current) return
        const entries = gesturePatchEntries(gesture)
        if (!entries.length) return
        applyDocLocal(docPatchLayers(current, entries))
      }

      function beginGesture(event, node, handle, unionBox) {
        if (!node || !isObject(node.layer)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const current = docRef.current
        const found = current ? findLayerById(current, node.layer.id) : null
        if (!found) return
        // Commit any batched arrow-key nudge before a pointer gesture starts.
        flushNudge()
        const autoParent = !!node.autoParent
        // Locked layers stay selectable, but direct manipulation is refused (CONTRACT §1).
        if (!autoParent && found.layer.locked === true) {
          setInlineError(INTERACTION_COPY.locked)
          beacon('gesture-blocked', { layerId: found.layer.id, reason: 'locked' })
          return
        }
        const selectedIds = selectedLayerIdsRef.current
        // A handle sits on the union box of the WHOLE selection, so a handle drag must carry
        // every member, not only the primary layer.
        const multi = !autoParent && selectedIds.length > 1 && selectedIds.indexOf(found.layer.id) >= 0
        const collected = gestureMembersFor(found.layer.id, multi)
        const members = collected.members
        if (members.length === 0) {
          if (collected.blockedLocked) setInlineError(INTERACTION_COPY.locked)
          else if (collected.blockedAuto) setInlineError(strings.nudgeAutoLayout)
          return
        }
        if (collected.blockedLocked) setInlineError(INTERACTION_COPY.locked)
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
        // Snapping targets are captured once: siblings of the grabbed layer plus the parent box
        // and the artboard box. They do not move while the gesture runs.
        const snapStatic = []
        const memberIds = new Set(
          members.map(function (member) { return member.layerId }),
        )
        const primaryNode = nodeForLayer(found.layer.id)
        const siblingNodes = siblingNodesOf(primaryNode)
        for (let index = 0; index < siblingNodes.length; index += 1) {
          const sibling = siblingNodes[index]
          if (!sibling || memberIds.has(sibling.id)) continue
          if (sibling.layer && sibling.layer.visible === false) continue
          snapStatic.push(sibling.worldRect)
        }
        const parentNode = primaryNode ? primaryNode.parent || null : null
        let frameRect = rectOf(0, 0, found.artboard.width, found.artboard.height)
        if (parentNode && parentNode.worldRect) frameRect = parentNode.worldRect
        const movingNodes = members
          .map(function (member) { return nodeForLayer(member.layerId) })
          .filter(function (item) { return !!item })
        const selectionBox =
          unionRects(
            movingNodes.map(function (item) {
              return item.worldRect
            }),
          ) || rectOf(0, 0, 1, 1)
        // Resize sessions scale from a snapshot: artboard-space rects of every member plus the
        // parent offset each patch has to convert back into (see resizeEntries). Same reason the
        // drag branch reads `member.origin` instead of the live layer.
        const resizeMembers = movingNodes.map(function (item) {
          const itemParent = item.parent || null
          return {
            layerId: item.id,
            x: finiteNumber(item.worldRect.x, 0),
            y: finiteNumber(item.worldRect.y, 0),
            width: Math.max(0, finiteNumber(item.worldRect.width, 0)),
            height: Math.max(0, finiteNumber(item.worldRect.height, 0)),
            baseX: itemParent && itemParent.worldRect ? finiteNumber(itemParent.worldRect.x, 0) : 0,
            baseY: itemParent && itemParent.worldRect ? finiteNumber(itemParent.worldRect.y, 0) : 0,
          }
        })
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
          layerId: found.layer.id,
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
          members: members,
          multi: members.length > 1,
          // The exact model union of the members wins; the box the renderer drew (unionBox, read
          // from `data-selection-bounds`) is device-pixel snapped and is only a fallback.
          selectionBox: selectionBox || unionBox,
          resizeMembers: resizeMembers,
          snapStatic: snapStatic,
          frameRect: frameRect,
          dx: null,
          dy: null,
          guidesActive: false,
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
        // Double-click (two pointerdowns on the same layer inside DOUBLE_CLICK_MS) drills into
        // the containing group and selects the child — no drag starts on the second press.
        const now = Date.now()
        const previous = lastLayerPointerRef.current
        const isDouble = !!(
          previous &&
          previous.layerId === found.layer.id &&
          now - previous.time < DOUBLE_CLICK_MS
        )
        lastLayerPointerRef.current = { layerId: found.layer.id, time: now }
        if (isDouble) {
          lastLayerPointerRef.current = null
          event.preventDefault()
          event.stopPropagation()
          drillIntoNode(node, event)
          return
        }
        const additive = !!(event.shiftKey || event.ctrlKey || event.metaKey)
        if (additive) {
          // Shift / Ctrl / Cmd+click toggles membership; it never starts a drag.
          selectLayer(found.layer.id, found.artboard.id, { additive: true })
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const targetNode = selectionTargetForNode(node, drillGroupIdRef.current) || node
        const targetId = targetNode.id || found.layer.id
        const currentIds = selectedLayerIdsRef.current
        if (currentIds.indexOf(targetId) >= 0) {
          // Pressing on a layer that is already selected keeps the whole selection (Figma-like) so
          // the press can drag every selected layer; the pressed one becomes the primary.
          if (currentIds.length > 1) {
            const nextIds = currentIds
              .filter(function (layerId) { return layerId !== targetId })
              .concat([targetId])
            applySelection(nextIds, artboardIdForNode(targetNode) || found.artboard.id, drillGroupIdRef.current)
          }
        } else {
          // Plain click replaces the selection with the Figma-like target (group or child).
          selectLayer(found.layer.id, found.artboard.id)
        }
        const gestureNode = nodeForLayer(targetId) || targetNode || node
        beginGesture(event, gestureNode, null)
      }

      function handlePointerDown(event, handle) {
        if (spaceHeldRef.current || isMiddlePointer(event)) return
        const tree = treeRef.current
        const layerId = selectedLayerIdRef.current
        const node = tree && layerId && tree.byId ? tree.byId.get(layerId) || null : null
        if (!node) return
        // The renderer draws ONE union box for the whole selection (60-render.js SelectionBox) and
        // publishes its rect in artboard canvas units on the box element.
        let unionBox = null
        const target = event && event.currentTarget
        const boxEl =
          target && typeof target.closest === 'function' ? target.closest('.dc-sel-box') : null
        if (boxEl) {
          try {
            unionBox = JSON.parse(boxEl.getAttribute('data-selection-bounds') || 'null')
          } catch (error) {
            unionBox = null
          }
        }
        beginGesture(event, node, handle, unionBox)
      }

      /**
       * Alt+drag (Figma): leave the originals where they were and drop duplicates at the pointer.
       * One document update + one history entry; the copies become the selection.
       */
      function applyAltDragDuplicate(gesture, dx, dy) {
        try {
          const current = docRef.current
          if (!current) return false
          const members = Array.isArray(gesture.members) ? gesture.members : []
          if (!members.length) return false
          // The drag preview moved the originals locally; put them back before copying.
          const restore = members.map(function (member) {
            return { layerId: member.layerId, patch: { x: member.origin.x, y: member.origin.y } }
          })
          let next = docPatchLayers(current, restore)
          const copies = []
          const ops = []
          for (let index = 0; index < members.length; index += 1) {
            const member = members[index]
            const found = findLayerById(next, member.layerId)
            if (!found) continue
            const copy = cloneLayerSubtree(found.layer, 0, 0)
            if (!copy) continue
            copy.x = Math.round(member.origin.x + dx)
            copy.y = Math.round(member.origin.y + dy)
            const destination = found.parentId
              ? { parentId: found.parentId }
              : { artboardId: found.artboard.id }
            const subOps = insertOpsForSubtree(copy, destination, null)
            if (subOps.length === 0) continue
            if (ops.length + subOps.length > MAX_OPS_PER_BATCH) {
              setInlineError(strings.duplicateTooLarge)
              return false
            }
            ops.push.apply(ops, subOps)
            copies.push({ copy: copy, destination: destination })
          }
          if (copies.length === 0) return false
          for (let index = 0; index < copies.length; index += 1) {
            next = docInsertLayers(next, copies[index].destination, [copies[index].copy])
          }
          applyDocLocal(next)
          applySelection(
            copies.map(function (item) { return item.copy.id }),
            gesture.artboardId,
            null,
          )
          commitWithHistory(
            'duplicate-drag',
            ops,
            copies.map(function (item) {
              return { type: 'layer.delete', layerId: item.copy.id }
            }),
          )
          beacon('duplicate-drag', { count: copies.length, ops: ops.length })
          return true
        } catch (error) {
          setInlineError(messageOf(error))
          beacon('duplicate-drag-failed', { message: shortError(error) })
          return false
        }
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

      /* ------------------------------- marquee selection ------------------------------- */

      /** Ids a marquee rect selects in an artboard (container-aware, group-collapsed). */
      function marqueeSelectionIds(artboardId, rect) {
        const tree = treeRef.current
        if (!tree || !Array.isArray(tree.artboards) || !isObject(rect)) return []
        const entry = tree.artboards.find(function (item) {
          return item && item.artboard && item.artboard.id === artboardId
        })
        if (!entry) return []
        const ids = []
        const seen = new Set()
        const drill = drillGroupIdRef.current
        function addTarget(node) {
          const target = selectionTargetForNode(node, drill) || node
          if (!target || !target.id || seen.has(target.id)) return
          seen.add(target.id)
          ids.push(target.id)
        }
        function visit(nodes) {
          const list = Array.isArray(nodes) ? nodes : []
          for (let index = 0; index < list.length; index += 1) {
            const node = list[index]
            if (!node || !node.layer || node.layer.visible === false) continue
            if (!rectsIntersect(rect, node.worldRect)) continue
            const container = isContainerLayer(node.layer)
            // A fully covered container is selected as a unit (a whole frame/group, Figma-like).
            if (!container || rectContainsRect(rect, node.worldRect)) {
              addTarget(node)
              continue
            }
            const before = ids.length
            visit(node.children)
            if (ids.length === before) addTarget(node)
          }
        }
        visit(entry.layers)
        return ids
      }

      function removeMarqueeListeners(active) {
        if (!active || typeof window === 'undefined' || typeof window.removeEventListener !== 'function') {
          return
        }
        try {
          window.removeEventListener('pointermove', active.onMove)
          window.removeEventListener('pointerup', active.onUp)
          window.removeEventListener('pointercancel', active.onCancel)
        } catch (error) {
          /* ignore */
        }
      }

      function marqueeMove(active, event) {
        if (!event || !active || event.pointerId !== active.pointerId) return
        const total =
          Math.abs(finiteNumber(event.clientX, active.startX) - active.startX) +
          Math.abs(finiteNumber(event.clientY, active.startY) - active.startY)
        if (!active.moved && total < PAN_START_THRESHOLD) return
        active.moved = true
        setGestureActive(true)
        const point = screenToCanvas(event.clientX, event.clientY)
        const rect = rectFromPoints(active.start, {
          x: point.x - active.originX,
          y: point.y - active.originY,
        })
        setMarquee({
          artboardId: active.artboardId,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
      }

      function endMarquee(active, cancelled) {
        removeMarqueeListeners(active)
        if (marqueeRef.current === active) marqueeRef.current = null
        setMarquee(null)
        setGestureActive(false)
      }

      /**
       * Ids a marquee rect selects across EVERY artboard. `rect` is expressed in the reference
       * artboard's local coordinates (so a drag that starts on the empty canvas still has a
       * stable origin); each board's own local rect is derived from the layout offsets.
       */
      function marqueeSelectionIdsAcross(referenceArtboardId, rect) {
        const tree = treeRef.current
        const current = docRef.current
        if (!tree || !current || !isObject(rect)) return []
        const layoutInfo = computeLayout(current)
        const reference = layoutInfo.entryById.get(referenceArtboardId) || null
        if (!reference) return []
        const boards = Array.isArray(tree.artboards) ? tree.artboards : []
        const ids = []
        const seen = new Set()
        for (let index = 0; index < boards.length; index += 1) {
          const entry = boards[index]
          if (!entry || !entry.artboard) continue
          const boardEntry = layoutInfo.entryById.get(entry.artboard.id) || null
          if (!boardEntry) continue
          const localRect = {
            x: rect.x - (boardEntry.frameX - reference.frameX),
            y: rect.y - (boardEntry.frameY - reference.frameY),
            width: rect.width,
            height: rect.height,
          }
          const boardIds = marqueeSelectionIds(entry.artboard.id, localRect)
          for (let boardIndex = 0; boardIndex < boardIds.length; boardIndex += 1) {
            const layerId = boardIds[boardIndex]
            if (seen.has(layerId)) continue
            seen.add(layerId)
            ids.push(layerId)
          }
        }
        return ids
      }

      function marqueeUp(active, event) {
        if (!active || !event || event.pointerId !== active.pointerId) return
        endMarquee(active, false)
        if (!active.moved) {
          // A plain click on the background: inside an artboard it selects the artboard, on the
          // empty canvas it clears the selection (same as v1).
          if (active.crossArtboards) clearSelection()
          else selectArtboard(active.artboardId)
          return
        }
        const point = screenToCanvas(event.clientX, event.clientY)
        const rect = rectFromPoints(active.start, {
          x: point.x - active.originX,
          y: point.y - active.originY,
        })
        const ids = active.crossArtboards
          ? marqueeSelectionIdsAcross(active.artboardId, rect)
          : marqueeSelectionIds(active.artboardId, rect)
        const existing = selectedLayerIdsRef.current
        const nextIds = active.additive
          ? existing.concat(
              ids.filter(function (layerId) { return existing.indexOf(layerId) < 0 }),
            )
          : ids
        // The selected artboard follows the first hit so `Move`/align actions have a parent.
        const boardId = active.crossArtboards
          ? artboardIdForLayer(nextIds[0]) || active.artboardId
          : active.artboardId
        applySelection(nextIds, boardId, drillGroupIdRef.current)
        beacon('marquee-select', {
          count: ids.length,
          additive: active.additive,
          crossArtboards: !!active.crossArtboards,
        })
      }

      function marqueeCancel(active, event) {
        if (!active || !event || event.pointerId !== active.pointerId) return
        endMarquee(active, true)
      }

      function beginMarquee(event, artboardId, options) {
        if (!event || event.button !== 0 || marqueeRef.current) return false
        const current = docRef.current
        if (!current) return false
        const opts = isObject(options) ? options : {}
        const layoutInfo = computeLayout(current)
        const boards = artboardsOf(current)
        // Reference frame: the artboard the drag started in, or the first board when the drag
        // starts on the empty canvas (the rect may then extend over any number of boards).
        let referenceId = artboardId || ''
        if (!referenceId || !layoutInfo.entryById.get(referenceId)) {
          const first = boards.find(function (board) {
            return isObject(board) && layoutInfo.entryById.get(board.id)
          })
          referenceId = first ? first.id : ''
        }
        const entry = referenceId ? layoutInfo.entryById.get(referenceId) || null : null
        if (!entry) return false
        const point = screenToCanvas(event.clientX, event.clientY)
        const active = {
          pointerId: event.pointerId,
          artboardId: referenceId,
          crossArtboards: opts.crossArtboards === true || !artboardId,
          additive: !!event.shiftKey,
          startX: finiteNumber(event.clientX, 0),
          startY: finiteNumber(event.clientY, 0),
          originX: entry.frameX,
          originY: entry.frameY,
          start: { x: point.x - entry.frameX, y: point.y - entry.frameY },
          moved: false,
          onMove: null,
          onUp: null,
          onCancel: null,
        }
        active.onMove = function (moveEvent) { marqueeMove(active, moveEvent) }
        active.onUp = function (upEvent) { marqueeUp(active, upEvent) }
        active.onCancel = function (cancelEvent) { marqueeCancel(active, cancelEvent) }
        marqueeRef.current = active
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('pointermove', active.onMove)
          window.addEventListener('pointerup', active.onUp)
          window.addEventListener('pointercancel', active.onCancel)
        }
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
        return true
      }

      function cancelMarquee() {
        const active = marqueeRef.current
        if (!active) return false
        endMarquee(active, true)
        return true
      }

      function artboardPointerDown(event, artboardId) {
        if (!event || spaceHeldRef.current || isMiddlePointer(event)) return
        if (commentMode) return
        const target = event.target
        if (!target || !target.classList) return
        if (
          target.classList.contains('dc-board-frame') ||
          target.classList.contains('dc-board-inner')
        ) {
          beginMarquee(event, artboardId)
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
        const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1
        const rawDx = screenDeltaToCanvas(gesture.clientX - gesture.startX, zoom)
        const rawDy = screenDeltaToCanvas(gesture.clientY - gesture.startY, zoom)
        let dx = rawDx
        let dy = rawDy
        // Snap guides: edges/centers of siblings and of the parent/artboard box, Alt disables.
        const canSnap =
          gesture.kind === 'drag' && snapEnabledRef.current && !event.altKey && !spaceHeldRef.current
        if (canSnap) {
          const snapped = snapMovingBox(
            gesture.selectionBox,
            gesture.snapStatic,
            gesture.frameRect,
            rawDx,
            rawDy,
            SNAP_THRESHOLD_SCREEN / zoom,
          )
          dx = snapped.dx
          dy = snapped.dy
          const active = snapped.guides.length > 0
          if (active !== gesture.guidesActive) {
            gesture.guidesActive = active
            setSnapGuides(active ? snapped.guides : [])
            setSnapGuidesArtboardId(active ? gesture.artboardId : null)
          } else if (active) {
            setSnapGuides(snapped.guides)
          }
        } else if (gesture.guidesActive) {
          gesture.guidesActive = false
          setSnapGuides([])
          setSnapGuidesArtboardId(null)
        }
        gesture.dx = dx
        gesture.dy = dy
        scheduleGesturePreview()
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
        cancelGestureFrame()
        setGestureActive(false)
        releaseCapture(event)
        setSnapGuides([])
        setSnapGuidesArtboardId(null)
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
        const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1
        // Prefer the previewed (snapped) delta; fall back to the release coordinates.
        let dx = typeof gesture.dx === 'number' ? gesture.dx : NaN
        let dy = typeof gesture.dy === 'number' ? gesture.dy : NaN
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          dx = screenDeltaToCanvas(
            finiteNumber(event.clientX, gesture.clientX) - gesture.startX,
            zoom,
          )
          dy = screenDeltaToCanvas(
            finiteNumber(event.clientY, gesture.clientY) - gesture.startY,
            zoom,
          )
          gesture.dx = dx
          gesture.dy = dy
        }
        // Alt+drag duplicates the selection on drop and leaves the originals in place.
        if (gesture.kind === 'drag' && event.altKey) {
          applyAltDragDuplicate(gesture, dx, dy)
          return
        }
        const entries = gesturePatchEntries(gesture)
        if (!entries.length) return
        const ops = []
        const inverse = []
        for (let index = 0; index < entries.length; index += 1) {
          ops.push({ type: 'layer.update', layerId: entries[index].layerId, patch: entries[index].patch })
        }
        for (let index = 0; index < gesture.members.length; index += 1) {
          const member = gesture.members[index]
          const inversePatch =
            gesture.kind === 'resize-auto'
              ? { width: member.origin.width, height: member.origin.height }
              : gesture.kind === 'drag'
                ? { x: member.origin.x, y: member.origin.y }
                : {
                    x: member.origin.x,
                    y: member.origin.y,
                    width: member.origin.width,
                    height: member.origin.height,
                  }
          inverse.push({ type: 'layer.update', layerId: member.layerId, patch: inversePatch })
        }
        // A pending animation frame may not have run yet; make the final state visible now.
        const current = docRef.current
        if (current) applyDocLocal(docPatchLayers(current, entries))
        commitWithHistory('gesture', ops, inverse)
        beacon('gesture', { kind: gesture.kind, count: ops.length })
      }

      function gestureCancel(event) {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        gestureRef.current = null
        cancelGestureFrame()
        setGestureActive(false)
        setSnapGuides([])
        setSnapGuidesArtboardId(null)
        releaseCapture(event)
        if (!gesture.moved) return
        // A cancelled reorder left the document untouched.
        if (gesture.kind === 'reorder') return
        const current = docRef.current
        if (!current) return
        // The Host never saw the preview (it only existed locally), so restoring locally is
        // enough: no runOps, no history entry.
        const restore = gesture.members.map(function (member) {
          return {
            layerId: member.layerId,
            patch:
              gesture.kind === 'resize-auto'
                ? { width: member.origin.width, height: member.origin.height }
                : gesture.kind === 'drag'
                  ? { x: member.origin.x, y: member.origin.y }
                  : {
                      x: member.origin.x,
                      y: member.origin.y,
                      width: member.origin.width,
                      height: member.origin.height,
                    },
          }
        })
        if (restore.length) applyDocLocal(docPatchLayers(current, restore))
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
          // Figma: a left drag on the empty canvas draws a selection marquee (it may start
          // outside every artboard and still catch layers inside them). Panning stays on
          // space+drag and middle-drag. Hits on an artboard or a layer are handled by their own
          // pointer handlers, so nothing else starts here.
          if (!blank) return
          if (beginMarquee(event, null, { crossArtboards: true })) return
          return
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
              if (shortcut === 'a') {
                event.preventDefault()
                selectAllInArtboard()
                return
              }
              if (shortcut === 'c') {
                event.preventDefault()
                copySelection()
                return
              }
              if (shortcut === 'x') {
                event.preventDefault()
                cutSelection()
                return
              }
              if (shortcut === 'v') {
                event.preventDefault()
                const pending = pasteSelection()
                if (pending && typeof pending.catch === 'function') {
                  pending.catch(function () {
                    /* paste is best-effort; errors surface through inlineError */
                  })
                }
                return
              }
              if (shortcut === 'g') {
                event.preventDefault()
                if (event.shiftKey) {
                  ungroupSelection()
                } else {
                  const pending = groupSelection()
                  if (pending && typeof pending.catch === 'function') {
                    pending.catch(function () {
                      /* group errors surface through inlineError */
                    })
                  }
                }
                return
              }
              if (event.key === ']' || event.key === '}') {
                event.preventDefault()
                arrangeSelection(event.shiftKey ? 'front' : 'forward')
                return
              }
              if (event.key === '[' || event.key === '{') {
                event.preventDefault()
                arrangeSelection(event.shiftKey ? 'back' : 'backward')
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
              if (cancelMarquee()) {
                if (typeof event.preventDefault === 'function') event.preventDefault()
                return
              }
              // The composer textarea handles its own Escape (and stops propagation).
              if (composer) {
                setComposer(null)
                return
              }
              // Esc steps out of a drilled group to the group, else clears the selection.
              stepSelectionOut()
              return
            }
            if (event.key === 'Enter') {
              // Never steal Enter from a focused control (buttons, links, inputs are filtered).
              if (tag === 'BUTTON' || tag === 'A') return
              if (drillIntoSelection()) {
                if (typeof event.preventDefault === 'function') event.preventDefault()
              }
              return
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              if (selectedLayerIdsRef.current.length) {
                event.preventDefault()
                deleteSelectedLayer()
                return
              }
              // Nothing selected but an artboard is: Delete removes the artboard (item 3).
              if (selectedArtboardIdRef.current) {
                event.preventDefault()
                deleteArtboard(selectedArtboardIdRef.current)
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
        // Images dropped/pasted onto a group or frame land INSIDE that container; with no
        // pointer position, a selected container is the target as well.
        let dropContainer = null
        if (localPoint) {
          const drop = imageDropContainerAt(treeRef.current, targetArtboard.id, localPoint)
          if (drop && drop.node && drop.node.depth < FRAME_MAX_DEPTH) {
            if (childrenOf(drop.node.layer).length < FRAME_MAX_CHILDREN) dropContainer = drop
          }
        }
        if (!dropContainer) {
          const primaryId = selectedLayerIdRef.current
          const primaryNode = primaryId ? nodeForLayer(primaryId) : null
          if (
            primaryNode &&
            isContainerLayer(primaryNode.layer) &&
            primaryNode.depth < FRAME_MAX_DEPTH &&
            childrenOf(primaryNode.layer).length < FRAME_MAX_CHILDREN
          ) {
            dropContainer = {
              node: primaryNode,
              localPoint: { x: primaryNode.width / 2, y: primaryNode.height / 2 },
            }
          }
        }
        const containerBox = dropContainer ? dropContainer.node.layer : targetArtboard
        const boxWidth = Math.max(1, finiteNumber(containerBox.width, targetArtboard.width))
        const boxHeight = Math.max(1, finiteNumber(containerBox.height, targetArtboard.height))
        const layer = placeImageInArtboard(
          Object.assign({}, containerBox, { width: boxWidth, height: boxHeight }),
          dropContainer ? dropContainer.localPoint : localPoint,
          naturalWidth,
          naturalHeight,
        )
        layer.src = dataUrl
        const destination = dropContainer
          ? { parentId: dropContainer.node.layer.id }
          : { artboardId: targetArtboard.id }
        applyDocLocal(docInsertLayer(current, destination, layer))
        applySelection([layer.id], targetArtboard.id, null)
        const addOp = { type: 'layer.add', layer: layer }
        if (destination.parentId) addOp.parentId = destination.parentId
        else addOp.artboardId = destination.artboardId
        commitWithHistory('image-add', [addOp], [{ type: 'layer.delete', layerId: layer.id }])
        beacon('image-add', {
          source: source,
          mode: 'add',
          parentId: destination.parentId,
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

      // Computed nodes for every selected layer (ordered, primary last). The renderer draws one
      // outline per node; the shell/inspector use it for multi-selection affordances.
      const selectedNodes = React.useMemo(
        function () {
          if (!tree || !tree.byId || !selectedLayerIds.length) return []
          const nodes = []
          for (let index = 0; index < selectedLayerIds.length; index += 1) {
            const node = tree.byId.get(selectedLayerIds[index])
            if (node) nodes.push(node)
          }
          return nodes
        },
        [tree, selectedLayerIds],
      )

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
          layerIds: selectedLayerIds.slice(),
          primaryLayerId: selectedLayerId,
          artboardId: selectedArtboardId,
          drillGroupId: drillGroupId,
        },
        selectedLayerId: selectedLayerId,
        selectedLayerIds: selectedLayerIds.slice(),
        selectedArtboardId: selectedArtboardId,
        selectedNode: selectedNode,
        selectedNodes: selectedNodes,
        drillGroupId: drillGroupId,
        marquee: marquee,
        snapGuides: snapGuides,
        snapGuidesArtboardId: snapGuidesArtboardId,
        snapEnabled: snapEnabled,
        setSnapEnabled: setSnapEnabled,
        toggleSnap: toggleSnap,
        selectLayer: selectLayer,
        selectLayers: selectLayers,
        selectAll: selectAllInArtboard,
        selectArtboard: selectArtboard,
        clearSelection: clearSelection,
        stepSelectionOut: stepSelectionOut,
        drillIntoSelection: drillIntoSelection,
        drillIntoNode: drillIntoNode,
        commitLayer: commitLayer,
        commitArtboard: commitArtboard,
        updateLayer: updateLayer,
        renameLayer: renameLayer,
        renameArtboard: renameArtboard,
        reorderLayer: reorderLayer,
        addLayer: addLayer,
        deleteArtboard: deleteArtboard,
        addButtonPreset: addButtonPreset,
        deleteSelected: deleteSelectedLayer,
        duplicateSelected: duplicateSelected,
        groupSelection: groupSelection,
        ungroupSelection: ungroupSelection,
        alignSelection: alignSelection,
        distributeSelection: distributeSelection,
        tidySelection: tidySelection,
        arrangeSelection: arrangeSelection,
        reorderSelection: reorderSelection,
        moveSelected: moveSelected,
        reparentSelection: reparentSelection,
        toggleLock: toggleLock,
        copySelection: copySelection,
        cutSelection: cutSelection,
        pasteSelection: pasteSelection,
        nudgeSelection: nudgeSelected,
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
        submitComment: submitComment,
        sendCommentChat: sendCommentChat,
        submitComments: submitCommentsFor,
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
        selectedLayerIds: selectedLayerIds,
        setSelectedLayerIds: setSelectedLayerIds,
        selectedArtboardId: selectedArtboardId,
        setSelectedArtboardId: setSelectedArtboardId,
        drillGroupId: drillGroupId,
        setDrillGroupId: setDrillGroupId,
        marquee: marquee,
        snapGuides: snapGuides,
        snapGuidesArtboardId: snapGuidesArtboardId,
        snapEnabled: snapEnabled,
        setSnapEnabled: setSnapEnabled,
        toggleSnap: toggleSnap,
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
        updateLayer: updateLayer,
        renameLayer: renameLayer,
        renameArtboard: renameArtboard,
        reorderLayer: reorderLayer,
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
        deleteArtboard: deleteArtboard,
        setCommentStatus: setCommentStatus,
        deleteCommentById: deleteCommentById,
        sendCommentChat: sendCommentChat,
        submitComment: submitComment,
        // v2 batch API: one chat message for many comments (helper lives in 53-batch.js).
        submitComments: submitCommentsFor,
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
        selectedNodes: selectedNodes,
        // v2 selection / interaction surface (consumed by the shell, selection bar, renderer).
        selectLayers: selectLayers,
        selectAllInArtboard: selectAllInArtboard,
        drillIntoSelection: drillIntoSelection,
        drillIntoNode: drillIntoNode,
        stepSelectionOut: stepSelectionOut,
        toggleSnap: toggleSnap,
        groupSelection: groupSelection,
        ungroupSelection: ungroupSelection,
        alignSelection: alignSelection,
        distributeSelection: distributeSelection,
        tidySelection: tidySelection,
        arrangeSelection: arrangeSelection,
        reorderSelection: reorderSelection,
        reparentSelection: reparentSelection,
        toggleLock: toggleLock,
        copySelection: copySelection,
        cutSelection: cutSelection,
        pasteSelection: pasteSelection,
        addButtonPreset: addButtonPreset,
        rootSelectionIds: rootSelectionIds,
        selectionBounds: selectionBounds,
        selectionGroups: selectionGroups,
        reorderOpsToReach: reorderOpsToReach,
        marqueeSelectionIds: marqueeSelectionIds,
        beginMarquee: beginMarquee,
        cancelMarquee: cancelMarquee,
        applySelection: applySelection,
        nodeForLayer: nodeForLayer,
        selectionTargetForNode: selectionTargetForNode,
        gesturePatchEntries: gesturePatchEntries,
        scheduleGesturePreview: scheduleGesturePreview,
        flushGesturePreview: flushGesturePreview,
        cancelGestureFrame: cancelGestureFrame,
        gestureMembersFor: gestureMembersFor,
        applyAltDragDuplicate: applyAltDragDuplicate,
        writeClipboardText: writeClipboardText,
        readClipboardText: readClipboardText,
        parseClipboardPayload: parseClipboardPayload,
        insertPastedLayers: insertPastedLayers,
        pasteDestination: pasteDestination,
        patchDiff: patchDiff,
        siblingRangeIds: siblingRangeIds,
        siblingNodesOf: siblingNodesOf,
        selectionNodes: selectionNodes,
        artboardIdForLayer: artboardIdForLayer,
        clipboardRef: clipboardRef,
        marqueeRef: marqueeRef,
        gestureFrameRef: gestureFrameRef,
        selectedLayerIdsRef: selectedLayerIdsRef,
        drillGroupIdRef: drillGroupIdRef,
        snapEnabledRef: snapEnabledRef,
        lastLayerPointerRef: lastLayerPointerRef,
        snapGuidesArtboardId: snapGuidesArtboardId,
        commentIndex: commentIndex,
        selectedComments: selectedComments,
        layout: layout,
        composerPlacement: composerPlacement,
        handlers: handlers,
        statusLabels: statusLabels,
      }
    }
