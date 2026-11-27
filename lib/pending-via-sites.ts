import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { getConnectedPadGroups } from "./connected-pad-groups"
import {
  expandedSignalSites,
  MAX_SITE_SURFACE_LENGTH,
} from "./expanded-signal-sites"
import type { Obstacle, Point, SimpleRouteJson, Terminal, Trace } from "./types"
import {
  type Copper,
  clearanceToCopper,
  fixedCopper,
  routeCopper,
} from "./vector-scene"

type PortPad = Obstacle & { circuitJsonMetadata?: { pcb_port_id?: string } }

/** A pad of a net that no connection or supplied trace in this request owns:
 * a later request still has to escape from it. */
export type PendingPad = { pad: Obstacle; port: string; owners: string[] }

/** Pads of nets that join at least two native ports but that this request
 * neither routes nor receives as supplied copper. */
export function getPendingPads(input: SimpleRouteJson): PendingPad[] {
  const assigned = new Set([
    ...input.connections.flatMap((connection) => [
      connection.name,
      connection.source_trace_id,
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ]),
    ...(input.traces ?? []).flatMap((trace) => [
      trace.connection_name,
      trace.source_trace_id,
    ]),
  ])
  const result: PendingPad[] = []
  for (const group of getConnectedPadGroups(
    input.obstacles.filter((pad) => pad.componentId),
  )) {
    if (group.size < 2) continue
    const owners = [...new Set([...group].flatMap((pad) => pad.connectedTo))]
    if (owners.some((owner) => assigned.has(owner))) continue
    const pads = [...group].flatMap((pad) => {
      const port = (pad as PortPad).circuitJsonMetadata?.pcb_port_id
      return port ? [{ pad, port, owners }] : []
    })
    if (new Set(pads.map((p) => p.port)).size >= 2) result.push(...pads)
  }
  return result
}

/** One expanded site as copper: its surface escape and its via. */
type Site = Copper[]

// Sites beside the native pads alone depend only on the pads and the design
// rules, so one board computes each pad once however its requests are spread.
const siteCache = new WeakMap<object, Map<string, Site[]>>()
const requestCollections = new Set([
  "obstacles",
  "traces",
  "connections",
  "buses",
  "differentialPairs",
])

/** Via sites of one pending pad beside the native pads, from the solver's own
 * expanded signal site generator. Copper is checked against them separately. */
function pendingViaSites(
  input: SimpleRouteJson,
  rules: string,
  pending: PendingPad,
): Site[] {
  const cache = siteCache.get(input.obstacles) ?? new Map<string, Site[]>()
  siteCache.set(input.obstacles, cache)
  const key = `${rules}|${pending.port}`
  const cached = cache.get(key)
  if (cached) return cached
  const { pad, port } = pending
  const point: Terminal = {
    x: pad.center.x,
    y: pad.center.y,
    layer: pad.layers[0],
    layers: pad.layers,
    pcb_port_id: port,
  }
  const connection = { name: port, pointsToConnect: [point, point] }
  const search = expandedSignalSites({
    input: { ...input, connections: [connection], traces: [] },
    connection,
    targetLayer: getCopperLayerNames(input.layerCount).at(-1)!,
  })
  let step = search.next()
  while (!step.done) step = search.next()
  const result = step.value[0].map((site) =>
    fixedCopper({ ...input, obstacles: [], traces: [site.escape] }),
  )
  cache.set(key, result)
  return result
}

/** Tuning is optional copper: it may use a pending pad's via sites only while
 * that pad keeps at least one. A site counts while neither the supplied copper
 * nor `traces` blocks it. Board coordinates in mm, +X right, +Y up. */
export function createPendingViaSiteGuard(
  input: SimpleRouteJson,
  traces: Trace[],
): (path: Point[], layer: string, width: number) => boolean {
  const targetLayer = getCopperLayerNames(input.layerCount).at(-1)!
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const blocks = (site: Site, copper: Copper[]): boolean =>
    site.some((part) =>
      copper.some(
        (c) =>
          c.layer === part.layer &&
          clearanceToCopper(part.a, part.b, c) - part.radius < clearance,
      ),
    )
  // Most banks are rejected by cheaper checks first: prepare on first use.
  let prepared:
    | { pending: PendingPad[]; rules: string; placed: Copper[] }
    | undefined
  const openSites = new Map<PendingPad, Site[]>()
  return (path, layer, width) => {
    prepared ??= {
      pending: getPendingPads(input).filter(
        (p) => !p.pad.layers.includes(targetLayer),
      ),
      rules: JSON.stringify(
        Object.entries(input).filter(([name]) => !requestCollections.has(name)),
      ),
      placed: fixedCopper({
        ...input,
        obstacles: [],
        traces: [...(input.traces ?? []), ...traces],
      }),
    }
    const { pending, rules, placed } = prepared
    const bank = routeCopper({
      type: "pcb_trace",
      pcb_trace_id: "pending_via_site_bank",
      route: path.map((p) => ({
        ...p,
        route_type: "wire" as const,
        layer,
        width,
      })),
    })
    // A site's via and escape stay within MAX_SITE_SURFACE_LENGTH of its pad,
    // so copper farther than that plus a via and clearance cannot block it.
    const reach =
      MAX_SITE_SURFACE_LENGTH + (input.minViaPadDiameter ?? 0.3) / 2 + clearance
    const near = (p: PendingPad, c: Copper): boolean =>
      clearanceToCopper(p.pad.center, p.pad.center, c) < reach
    return pending.every((p) => {
      if (!bank.some((c) => near(p, c))) return true
      let open = openSites.get(p)
      if (!open) {
        const nearby = placed.filter((c) => near(p, c))
        open = pendingViaSites(input, rules, p).filter(
          (site) => !blocks(site, nearby),
        )
        openSites.set(p, open)
      }
      return !open.length || open.some((site) => !blocks(site, bank))
    })
  }
}
