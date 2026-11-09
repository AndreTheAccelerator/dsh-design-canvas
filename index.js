/**
 * Host half of the design-canvas bundle.
 *
 * Owns the design document (a JSON file in the Session workspace), applies operations,
 * registers the agent-facing tools and prompt section, and serves the small JSON API the
 * right-sidebar canvas talks to over the Host web server.
 */
import { createDesignStore } from './host/store.js'
import { registerDesignPrompt, registerDesignTools } from './host/tools.js'
import { registerDesignRoutes } from './host/routes.js'

export const name = 'design-canvas'

/** Host services this half needs; a profile without them leaves the plugin inactive. */
export const inject = ['tools', 'webServer', 'agents', 'workingDirectory', 'systemPrompt']

const DEFAULTS = {
  /** Board file, relative to the Session workspace root. */
  boardPath: 'design-board.json',
  /** Upper bound on one ops call. */
  maxOpsPerCall: 200,
  /** Upper bound on layers per artboard. */
  maxLayersPerArtboard: 300,
  /** Ask the Host to add a short prompt section describing the canvas. */
  promptSection: true,
}

export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  const store = createDesignStore(ctx, options)

  ctx.effect(() => registerDesignRoutes(ctx, store), 'design-canvas routes')
  ctx.effect(() => registerDesignTools(ctx, store, options), 'design-canvas tools')
  if (options.promptSection) {
    ctx.effect(() => registerDesignPrompt(ctx, options), 'design-canvas prompt section')
  }
}
