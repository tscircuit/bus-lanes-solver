import { length } from "../geometry"
import { fixedRouteLength } from "../route-lengths"
import {
  IncompleteLengthTuningError,
  tuneSmoothLengths,
} from "../smooth-length-tuning"
import type { SimpleRouteJson, Trace, Wire } from "../types"
import type { RoutedLengthWindow } from "./get-routed-length-windows"

/** Add length on a single layer while keeping the other spans as obstacles. */
export function tuneRoutedWireSpan({
  input,
  window,
  trace,
  obstacles,
}: {
  input: SimpleRouteJson
  window: RoutedLengthWindow
  trace: Trace
  obstacles: Trace[]
}): Trace | undefined {
  const deficit = window.targetMm - length(trace.route)
  if (Math.abs(deficit) < 1e-7) return trace
  if (deficit < 0) return
  const spans: { start: number; points: Wire[] }[] = []
  for (const [index, point] of trace.route.entries()) {
    if (point.route_type !== "wire") continue
    const current = spans.at(-1)
    if (
      current &&
      current.start + current.points.length === index &&
      current.points[0].layer === point.layer
    )
      current.points.push(point)
    else spans.push({ start: index, points: [point] })
  }
  for (const span of spans
    .filter((s) => s.points.length > 1)
    .sort((a, b) => length(b.points) - length(a.points))) {
    const held = spans
      .filter((other) => other !== span && other.points.length > 1)
      .map((other) => ({
        ...trace,
        pcb_trace_id: `${trace.pcb_trace_id}:span:${other.start}`,
        connection_name: undefined,
        source_trace_id: undefined,
        route: other.points,
      }))
    const piece = { ...trace, route: span.points }
    const request = {
      ...input,
      connections: [
        {
          ...window.connection,
          pointsToConnect: [span.points[0], span.points.at(-1)!],
        },
      ],
      traces: [...obstacles, ...held],
      buses: [],
      differentialPairs: [],
    }
    try {
      const target =
        length(span.points) +
        deficit +
        fixedRouteLength(request, window.connection.name)
      const [tuned] = tuneSmoothLengths(
        request,
        [piece],
        new Map([[window.connection.name, target]]),
        { packMeanders: true, maxCandidates: 4200 },
      )
      return {
        ...trace,
        route: [
          ...trace.route.slice(0, span.start),
          ...tuned.route,
          ...trace.route.slice(span.start + span.points.length),
        ],
      }
    } catch (error) {
      if (!(error instanceof IncompleteLengthTuningError)) throw error
    }
  }
}
