import { GridVisibilitySearch } from "./grid-visibility"
import { VectorScene, type Copper } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"
import { packageApproachRegions } from "./package-approach-regions"

const certificates = new WeakMap<SimpleRouteJson, Map<string, Trace[]>>()

/** Preserve local access to connected package pads that belong to a later
 * routing request. These soft guides stop at the pad field, never become
 * routed connections, and retain the native connectivity aliases. */
export function* pendingPackageExits(
  input: SimpleRouteJson,
  fixed: Copper[],
): Generator<void, Copper[]> {
  const pads = input.obstacles.filter((pad) => pad.componentId)
  const regions = packageApproachRegions(input, 0)
  const fields = new Map(
    [...new Set(pads.map((pad) => pad.componentId!))].map((id, index) => [
      id,
      regions[index].pads,
    ]),
  )
  const groups = new Map<string, Set<(typeof pads)[number]>>()
  for (const pad of pads) {
    const touching = pad.connectedTo.flatMap((alias) =>
      groups.has(alias) ? [groups.get(alias)!] : [],
    )
    const group = new Set([pad, ...touching.flatMap((set) => [...set])])
    for (const member of group)
      for (const alias of member.connectedTo) groups.set(alias, group)
  }
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
  const width = input.minTraceWidth
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const extension = (input.minViaPadDiameter ?? 0.6) / 2 + width / 2 + clearance
  const result: Copper[] = []
  for (const group of new Set(groups.values())) {
    if (group.size < 2) continue
    const owners = [...new Set([...group].flatMap((pad) => pad.connectedTo))]
    if (owners.some((owner) => assigned.has(owner))) continue
    const ports = new Set(
      [...group].flatMap((pad) => {
        const port = (
          pad as typeof pad & { circuitJsonMetadata?: { pcb_port_id?: string } }
        ).circuitJsonMetadata?.pcb_port_id
        return port ? [port] : []
      }),
    )
    if (ports.size < 2) continue
    for (const pad of group) {
      const port = (
        pad as typeof pad & { circuitJsonMetadata?: { pcb_port_id?: string } }
      ).circuitJsonMetadata?.pcb_port_id
      if (!port) continue
      const field = fields.get(pad.componentId!)!
      for (const layer of pad.layers) {
        const start = { ...pad.center, layer, pcb_port_id: port }
        const end = [
          { x: field.minX - extension, y: start.y, layer },
          { x: field.maxX + extension, y: start.y, layer },
          { x: start.x, y: field.minY - extension, layer },
          { x: start.x, y: field.maxY + extension, layer },
        ].sort(
          (a, b) =>
            Math.hypot(a.x - start.x, a.y - start.y) -
            Math.hypot(b.x - start.x, b.y - start.y),
        )[0]
        const connection: Connection = {
          name: port,
          pointsToConnect: [start, end],
        }
        const scene = new VectorScene(
          input,
          connection,
          width,
          fixed.filter(
            (copper) => !copper.owners.some((owner) => owners.includes(owner)),
          ),
        )
        const search = new GridVisibilitySearch(scene, start, end, [], 0)
        try {
          while (!search.solved && !search.failed) {
            search.step()
            yield
          }
          if (search.solved)
            for (let index = 1; index < search.result.length; index++)
              result.push({
                a: search.result[index - 1],
                b: search.result[index],
                radius: width / 2,
                layer,
                owners,
              })
        } finally {
          if (!search.solved && !search.failed) search.cancel()
        }
      }
    }
  }
  return result
}

/** Compute provisional paths for pending terminals. These are soft search
 * preferences, never output copper or saved route guides. A later route can
 * otherwise close a narrow package exit before its neighbor is considered. */
export function* pendingLaneCertificates(
  input: SimpleRouteJson,
  connections: Connection[],
  fixed: Copper[],
  widths: ReadonlyMap<string, number>,
): Generator<void, Trace[]> {
  const key = JSON.stringify([
    input.bounds,
    input.layerCount,
    input.minTraceWidth,
    input.obstacles,
    input.traces,
    input.connections.map((c) => c.pointsToConnect),
    input.minBoardEdgeClearance,
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075,
    fixed,
    connections.map((c) => [
      c.name,
      c.source_trace_id,
      c.pointsToConnect,
      widths.get(c.name),
    ]),
  ])
  const cache = certificates.get(input) ?? new Map<string, Trace[]>()
  certificates.set(input, cache)
  const cached = cache.get(key)
  if (cached) return structuredClone(cached)
  const result: Trace[] = []
  for (const connection of connections) {
    const width = widths.get(connection.name)!
    const search = new GridVisibilitySearch(
      new VectorScene(input, connection, width, fixed),
      connection.pointsToConnect[0],
      connection.pointsToConnect[1],
    )
    try {
      while (!search.solved && !search.failed) {
        search.step()
        yield
      }
      if (search.solved)
        result.push({
          type: "pcb_trace",
          pcb_trace_id: `certificate_${connection.name}`,
          connection_name: connection.name,
          route: search.result.map((point) => ({
            ...point,
            route_type: "wire",
            layer: connection.pointsToConnect[0].layer,
            width,
          })),
        })
    } finally {
      if (!search.solved && !search.failed) search.cancel()
    }
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, structuredClone(result))
  return result
}
