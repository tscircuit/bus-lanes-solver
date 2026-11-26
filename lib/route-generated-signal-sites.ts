import { signalLayers } from "./flexible-signal-state"
import { negotiateSurfaceRoutes } from "./negotiate-surface-routes"
import {
  finishGeneratedSurfaceCarriers,
  type CompletedGeneratedSurfaceCarriers,
} from "./finish-generated-surface-carriers"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { runBoundedRouting } from "./run-bounded-routing"
import type { SimpleRouteJson, SolverOptions } from "./types"

const EXPANDED_GRID_PROBE_STEPS = 3000

interface GeneratedSignalSitesRequest {
  input: SimpleRouteJson
  options: SolverOptions
  maxSteps: number
}

/** Keep new pad approaches and carrier layers negotiable when adjacent via
 * allocation falls back to the native surface. Supplied copper remains fixed. */
export function* routeGeneratedSignalSites(
  request: GeneratedSignalSitesRequest,
): Generator<void, CompletedGeneratedSurfaceCarriers | null> {
  // Try additional grid-centered sites together before freezing a local
  // assignment. Keep this probe bounded before the ordinary site search.
  if (request.maxSteps > 2 * EXPANDED_GRID_PROBE_STEPS) {
    const expandedGridRoute = yield* runBoundedRouting(
      completeGeneratedSignalSites(request, { expandAllGridSites: true }),
      EXPANDED_GRID_PROBE_STEPS,
    )
    if (expandedGridRoute) return expandedGridRoute
  }
  const completed = yield* routeGeneratedSurfaceCarriers(request)
  if (completed) return completed
  return yield* completeGeneratedSignalSites(request)
}

function* completeGeneratedSignalSites(
  { input, options, maxSteps }: GeneratedSignalSitesRequest,
  { expandAllGridSites = false } = {},
): Generator<void, CompletedGeneratedSurfaceCarriers | null> {
  const routed = yield* runBoundedRouting(
    negotiateGeneratedSignalSites(input, expandAllGridSites),
    maxSteps,
  )
  if (!routed) return null
  return yield* finishGeneratedSurfaceCarriers({
    input,
    carriers: routed.traces,
    escapes: routed.escapes,
    options,
    maxSteps,
  })
}

function* negotiateGeneratedSignalSites(
  input: SimpleRouteJson,
  expandAllGridSites: boolean,
): ReturnType<typeof negotiateSignalSites> {
  // Preserve the ordinary fallback when the grid-only probe cannot complete.
  for (const allowPadEdgeSites of [false, true]) {
    if (expandAllGridSites && allowPadEdgeSites) break
    const expandEmptyDomainsOnly = !expandAllGridSites && !allowPadEdgeSites
    const routed = yield* negotiateSignalSites(
      { native: input, pending: input, escapes: [], retained: [], traces: [] },
      new Set(input.connections.map((connection) => connection.name)),
      false,
      true,
      {
        checkEscapeCompatibility: true,
        allowExpandedSites: true,
        expandEmptyDomainsOnly,
        allowPadEdgeSites,
        maxCandidateSearchNodes: 12000,
      },
    )
    if (routed) return routed
  }
  return null
}

export function* routeGeneratedSurfaceCarriers(
  request: GeneratedSignalSitesRequest,
): Generator<void, CompletedGeneratedSurfaceCarriers | null> {
  // A declared minimum can require space that fixed via sites cannot provide.
  // Skew-only requests retain their existing generated-site search.
  if (!request.input.buses?.some((bus) => (bus.minLength ?? 0) > 0)) return null
  const commonInnerLayers = signalLayers(
    request.input,
    request.input.connections[0],
  ).filter(
    (layer) =>
      /^inner\d+$/.test(layer) &&
      request.input.connections.every((connection) =>
        signalLayers(request.input, connection).includes(layer),
      ),
  )
  const views: SimpleRouteJson[] = commonInnerLayers.map((layer) => ({
    ...request.input,
    allowedLayers: [layer],
  }))
  if (
    !request.input.allowedLayers &&
    request.input.connections.every((connection) =>
      ["top", "bottom"].every((layer) =>
        signalLayers(request.input, connection).includes(layer),
      ),
    )
  )
    views.push({ ...request.input, allowedLayers: ["top", "bottom"] })
  views.push(request.input)
  for (const native of views) {
    const surface = yield* runBoundedRouting(
      negotiateSurfaceRoutes(native, {
        native,
        pending: native,
        escapes: [],
        retained: [],
        traces: [],
      }),
      request.maxSteps,
    )
    if (surface) {
      const completed = yield* finishGeneratedSurfaceCarriers({
        input: request.input,
        carriers: surface.traces,
        escapes: surface.escapes,
        options: request.options,
        maxSteps: request.maxSteps,
      })
      if (completed) return completed
    }
  }
  return null
}
