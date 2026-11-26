import { getSegmentIntersection } from "@tscircuit/math-utils"
import { distance, pointSegmentDistanceToPoints } from "./geometry"
import { fixedCopper } from "./vector-scene"
import type { Point, SimpleRouteJson, Trace, Wire } from "./types"

/** Connect a new terminal at its first contact with existing same-net copper.
 * Continuing beyond that junction creates a loop that can bypass tuned copper.
 * Coordinates and intersections remain in board-world millimetres. */
export function trimBranchToTrunk({
  input,
  branch,
  trunk,
}: {
  input: SimpleRouteJson
  branch: Trace
  trunk: Trace[]
}): Trace {
  const copper = fixedCopper({
    ...input,
    obstacles: [],
    traces: trunk.filter(
      (trace) => trace.connection_name === branch.connection_name,
    ),
  })
  for (let index = branch.route.length - 2; index >= 0; index--) {
    const a = branch.route[index]
    const b = branch.route[index + 1]
    const wire =
      a.route_type === "wire" ? a : b.route_type === "wire" ? b : undefined
    if (!wire || distance(a, b) < 1e-8) continue
    let junction: Point | undefined
    for (const segment of copper) {
      if (segment.layer !== wire.layer) continue
      const candidates = [
        getSegmentIntersection(a, b, segment.a, segment.b),
        ...[segment.a, segment.b].filter(
          (point) => pointSegmentDistanceToPoints(point, a, b) < 1e-8,
        ),
      ]
      for (const point of candidates) {
        if (!point || (junction && distance(point, b) >= distance(junction, b)))
          continue
        junction = point
      }
    }
    if (!junction) continue
    const start: Wire = { ...wire, x: junction.x, y: junction.y }
    return { ...branch, route: [start, ...branch.route.slice(index + 1)] }
  }
  return branch
}
