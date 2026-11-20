/**
 * Load the generated browser bundle in Node with a minimal React stub.
 *
 * The client half is a browser artifact: `window.__ModuleLoader__.load({ id, factory })`.
 * Evaluating it in Node (a) proves the factory runs end to end — every part is concatenated
 * into one scope, so a typo, a duplicated declaration or a temporal-dead-zone mistake in one
 * part breaks the whole bundle at load time and `node --check` cannot see it — and (b) gives
 * the tests access to the internal helpers the plugin exposes for exactly this purpose.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST, PARTS_DIR } from '../../scripts/build-client.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Assemble the bundle the same way `npm run build` does, straight from the parts, so the tests
 * always exercise the current sources (and fail early when a part cannot be concatenated).
 */
export async function assembleBundle() {
  const chunks = []
  for (const name of MANIFEST) {
    chunks.push(await readFile(path.join(PARTS_DIR, name), 'utf8'))
  }
  return chunks.join('')
}

/** Minimal React surface: enough for load-time code, no rendering. */
export function createReactStub() {
  class Component {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }
    setState() {}
  }

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    Fragment: 'Fragment',
    Component,
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useRef(value) {
      return { current: value }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useEffect() {},
    useLayoutEffect() {},
  }
  return React
}

/** Browser-ish globals the bundle touches at load time. */
function installGlobals(beacons) {
  const g = globalThis
  const previous = {
    window: g.window,
    document: g.document,
    fetch: g.fetch,
    Image: g.Image,
    sessionStorage: g.sessionStorage,
    localStorage: g.localStorage,
  }

  class FakeImage {
    constructor() {
      this.width = 1
      this.height = 1
    }
    set src(value) {
      this._src = value
      beacons.push(String(value))
      if (typeof this.onload === 'function') this.onload()
    }
    get src() {
      return this._src
    }
  }

  g.Image = FakeImage
  g.window = {
    __ModuleLoader__: {
      load(definition) {
        g.window.__dcDefinition = definition
      },
    },
    // The bundle beacons through `new window.Image()`; the fake records the URLs.
    Image: FakeImage,
    devicePixelRatio: 2,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} }
    },
  }
  g.document = {
    baseURI: 'http://127.0.0.1:5599/',
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null
    },
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }
    },
  }
  g.sessionStorage = {
    getItem() {
      return null
    },
    setItem() {},
    removeItem() {},
  }
  g.localStorage = {
    getItem() {
      return null
    },
    setItem() {},
    removeItem() {},
  }
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  return previous
}

function restoreGlobals(previous) {
  const g = globalThis
  for (const key of Object.keys(previous)) {
    if (previous[key] === undefined) delete g[key]
    else g[key] = previous[key]
  }
}

/**
 * Assemble + evaluate the bundle and return the plugin definition's factory result plus the
 * internal handles the bundle exposes (see `__test` in src/client/80-boot.js).
 */
export async function loadClientBundle(options = {}) {
  const source = options.source ? options.source : await assembleBundle()
  const beacons = []
  const previous = installGlobals(beacons)

  try {
    // eslint-disable-next-line no-new-func
    const run = new Function('window', 'document', 'fetch', 'Image', 'sessionStorage', 'localStorage', source)
    run(globalThis.window, globalThis.document, globalThis.fetch, globalThis.Image, globalThis.sessionStorage, globalThis.localStorage)

    const definition = globalThis.window.__dcDefinition
    if (!definition) throw new Error('the bundle did not call window.__ModuleLoader__.load')
    if (typeof definition.factory !== 'function') throw new Error('the module definition has no factory')

    const react = createReactStub()
    const needed = []
    const plugin = definition.factory((id) => {
      needed.push(id)
      if (id === 'react') return react
      throw new Error(`unexpected require(${JSON.stringify(id)})`)
    })

    return { plugin, definition, beacons, required: needed, react }
  } finally {
    restoreGlobals(previous)
  }
}
