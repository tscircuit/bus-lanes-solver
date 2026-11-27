import { applyToPoint } from "transformation-matrix"
import { GridVisibilitySearch } from "./grid-visibility"
import { VectorScene, type Copper } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"
import { packageApproachRegions } from "./package-approach-regions"
import { getPackagePadFrame } from "./package-pad-frame"
import { getPendingPads } from "./pending-via-sites"

const certificates = new WeakMap<SimpleRouteJson, Map<string, Trace[]>>()

/** Preserve access for the pads of nets that a later request still has to
 * route. A request needs no completed trunk to receive them: a first bus
 * between two packages can close the last exit of a neighboring pad as easily
 * as a branch added to an existing trunk. The ordered lane search asks for
 * them for every input with buses; dense negotiation does not use them. Each
 * guide runs from its pad to the nearest side of the package's pad field,
 * measured in the package's own frame so that a rotated package is not given
 * guides across the open board beside it. These soft guides retain native
 * connectivity aliases; they never become routed connections. */
export function* pendingPackageExits(
  input: SimpleRouteJson,
  fixed: Copper[],
): Generator<void, Copper[]> {
  const pads = input.obstacles.filter((pad) => pad.componentId)
  const regions = packageApproachRegions(input, 0)
  const frames = new Map(
    [...new Set(pads.map((pad) => pad.componentId!))].map((id, index) => [
      id,
      getPackagePadFrame(
        pads.filter((pad) => pad.componentId === id),
        regions[index].pads,
      ),
    ]),
  )
  const width = input.minTraceWidth
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const extension = (input.minViaPadDiameter ?? 0.6) / 2 + width / 2 + clearance
  const result: Copper[] = []
  // Pending pads arrive group by group; each group shares one owner list.
  const groups = Map.groupBy(getPendingPads(input), (pending) => pending.owners)
  for (const [owners, group] of groups) {
    const ownerSet = new Set(owners)
    const foreignCopper = fixed.filter(
      (copper) => !copper.owners.some((owner) => ownerSet.has(owner)),
    )
    for (const { pad, port } of group) {
      const { field, boardToPackage, packageToBoard } = frames.get(
        pad.componentId!,
      )!
      // Exits leave along the package frame's axes.
      const padCenterInPackage = applyToPoint(boardToPackage, pad.center)
      for (const layer of pad.layers) {
        const start = { ...pad.center, layer, pcb_port_id: port }
        const end = [
          { x: field.minX - extension, y: padCenterInPackage.y },
          { x: field.maxX + extension, y: padCenterInPackage.y },
          { x: padCenterInPackage.x, y: field.minY - extension },
          { x: padCenterInPackage.x, y: field.maxY + extension },
        ]
          .map((exitInPackage) => ({
            ...applyToPoint(packageToBoard, exitInPackage),
            layer,
          }))
          .sort(
            (a, b) =>
              Math.hypot(a.x - start.x, a.y - start.y) -
              Math.hypot(b.x - start.x, b.y - start.y),
          )[0]
        const connection: Connection = {
          name: port,
          pointsToConnect: [start, end],
        }
        const scene = new VectorScene(input, connection, width, foreignCopper)
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
