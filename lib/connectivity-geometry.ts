import { pointSegmentDistanceToPoints } from "./geometry"
import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace, Via, Wire } from "./types"

/** Hole spacing is independent of copper clearance, including same-net holes. */
export function connectivityDrillConflicts(
  input: SimpleRouteJson,
  traces: Trace[],
) {
  const gap = input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0
  const vias = traces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "via"
        ? [{ name: trace.connection_name!, point }]
        : [],
    ),
  )
  const hits: Array<{ names: [string, string]; points: [Via, Via] }> = []
  for (let i = 0; i < vias.length; i++)
    for (let j = 0; j < i; j++) {
      const a = vias[i],
        b = vias[j]
      const required =
        gap +
        ((a.point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) +
          (b.point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15)) /
          2
      if (
        Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) <
        required - 1e-8
      )
        hits.push({ names: [a.name, b.name], points: [a.point, b.point] })
    }
  return hits
}

/** Remove zero-length layer excursions and paths bypassed by an owned pad/via
 * overlap. This does not move terminals, vias, or any supplied fixed copper. */
export function canonicalConnectivityTrace(
  input: SimpleRouteJson,
  connection: Connection,
  trace: Trace,
): Trace {
  let route = structuredClone(trace.route)
  const indices = route.flatMap((p, i) => (p.route_type === "via" ? [i] : []))
  if (indices.length === 2) {
    const a = route[indices[0]],
      b = route[indices[1]]
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-8)
      route = [...route.slice(0, indices[0]), ...route.slice(indices[1] + 1)]
  }
  for (const side of [0, 1]) {
    if (side) route.reverse()
    const i = route.findIndex((p) => p.route_type === "via")
    const terminal = connection.pointsToConnect[side]
    const pad = input.obstacles.find(
      (o) =>
        o.shape === "circle" &&
        !!terminal.pcb_port_id &&
        o.connectedTo.includes(terminal.pcb_port_id) &&
        Math.hypot(o.center.x - terminal.x, o.center.y - terminal.y) < 1e-8,
    )
    if (i >= 0 && pad) {
      const via = route[i] as Via,
        first = route[0] as Wire
      if (
        Math.hypot(via.x - first.x, via.y - first.y) <=
        ((via.via_diameter ?? input.minViaPadDiameter ?? 0.3) + pad.width) / 2 +
          1e-8
      )
        route = [first, { ...first, x: via.x, y: via.y }, ...route.slice(i)]
    }
    if (side) route.reverse()
  }
  route = route.filter(
    (p, i) =>
      !i ||
      p.route_type !== "wire" ||
      route[i - 1].route_type !== "wire" ||
      p.layer !== (route[i - 1] as Wire).layer ||
      Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) > 1e-9,
  )
  return { ...trace, route }
}

/** Clearance-aware simplification of native escapes; unlike tuning this only
 * shortens copper and never changes fixed neighbor geometry. */
export function simplifyConnectivityTrace(
  input: SimpleRouteJson,
  connection: Connection,
  trace: Trace,
  others: Trace[],
): Trace {
  const fixed = fixedCopper({
    ...input,
    traces: [...(input.traces ?? []), ...others],
  })
  const route: Trace["route"] = []
  let run: Wire[] = []
  const flush = () => {
    if (!run.length) return
    const layer = run[0].layer
    const scene = new VectorScene(
      input,
      {
        ...connection,
        pointsToConnect: connection.pointsToConnect.map((p) => ({
          ...p,
          layer,
        })),
      },
      input.minTraceWidth,
      fixed,
    )
    route.push(
      ...reduceOrdinaryTurns(run, scene).map((p) => ({
        ...p,
        route_type: "wire" as const,
        layer,
        width: input.minTraceWidth,
      })),
    )
    run = []
  }
  for (const point of trace.route) {
    if (point.route_type === "via") {
      flush()
      route.push(point)
    } else {
      if (run.length && run[0].layer !== point.layer) flush()
      run.push(point)
    }
  }
  flush()
  return { ...trace, route }
}

/** Detect nonlocal same-net via contacts which would invalidate path length. */
export function connectivityViaShortcuts(input: SimpleRouteJson, trace: Trace) {
  const route = trace.route
  const arc = [0]
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i]
    arc.push(
      arc[i - 1] +
        (a.route_type === "wire" &&
        b.route_type === "wire" &&
        a.layer === b.layer
          ? Math.hypot(a.x - b.x, a.y - b.y)
          : 0),
    )
  }
  for (let i = 0; i < route.length; i++) {
    const via = route[i]
    if (via.route_type !== "via") continue
    const radius = (via.via_diameter ?? input.minViaPadDiameter ?? 0.3) / 2
    for (let j = 1; j < route.length; j++) {
      const a = route[j - 1],
        b = route[j]
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== b.layer
      )
        continue
      // Local handoff copper is intentionally connected to the via.
      const separation = Math.max(arc[j - 1] - arc[i], arc[i] - arc[j], 0)
      if (separation <= Math.PI * (radius + a.width / 2) + 1e-8) continue
      if (pointSegmentDistanceToPoints(via, a, b) < radius + a.width / 2 - 1e-8)
        return true
    }
  }
  return false
}
