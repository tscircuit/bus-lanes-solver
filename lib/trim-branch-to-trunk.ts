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
    traces: [...(input.traces ?? []), ...trunk].filter(
      (trace) =>
        trace.connection_name === branch.connection_name ||
        (branch.source_trace_id !== undefined &&
          trace.source_trace_id === branch.source_trace_id),
    ),
  })
  for (let index = branch.route.length - 2; index >= 0; index--) {
    const a = branch.route[index]
    const b = branch.route[index + 1]
    let wire: Wire | undefined
    if (a.route_type === "wire") wire = a
    else if (b.route_type === "wire") wire = b
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
    return {
      ...branch,
      route: [start, ...branch.route.slice(index + 1)],
      curvedSegments: branch.curvedSegments
        ?.filter((ending) => ending > index)
        .map((ending) => ending - index),
    }
  }
  return branch
}
