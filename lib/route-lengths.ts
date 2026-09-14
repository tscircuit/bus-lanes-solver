import { length } from "./geometry"
import type { SimpleRouteJson, Trace } from "./types"

/** Planar copper length already routed for a connection. Via depth and package
 * delay require stackup/package data and are not inferred from XY coordinates. */
export function fixedRouteLength(input: SimpleRouteJson, name: string) {
  const connection = input.connections.find((c) => c.name === name)
  return (input.traces ?? [])
    .filter(
      (t) =>
        t.connection_name === name ||
        t.source_trace_id === (connection?.source_trace_id ?? name),
    )
    .reduce((sum, t) => sum + length(t.route), 0)
}
export function busLengthReports(input: SimpleRouteJson, traces: Trace[]) {
  return (input.buses ?? []).map((bus) => {
    const lengths = bus.connectionNames.map((name) => {
      const route = traces.find((t) => t.connection_name === name)
      return {
        name,
        carrierLengthMm: route ? length(route.route) : null,
        fixedLengthMm: fixedRouteLength(input, name),
        totalLengthMm: route
          ? length(route.route) + fixedRouteLength(input, name)
          : null,
      }
    })
    const complete = lengths.every((l) => l.totalLengthMm !== null)
    const values = lengths.map((l) => l.totalLengthMm ?? 0)
    const skewMm =
      complete && values.length
        ? Math.max(...values) - Math.min(...values)
        : null
    return {
      busId: bus.busId,
      toleranceMm: bus.maxLengthSkew ?? null,
      skewMm,
      matched:
        bus.maxLengthSkew !== undefined &&
        skewMm !== null &&
        skewMm <= bus.maxLengthSkew + 1e-7,
      lengths,
    }
  })
}
