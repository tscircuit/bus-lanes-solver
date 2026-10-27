import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import type { SimpleRouteJson, Trace } from "../lib/types"

/** Independent acceptance of all requested DDR signals, not whole-SBC routing.
 * Geometry is right-handed board-world XY in mm (+X right, +Y up).
 */
export async function validateNativeGroups(
  input: SimpleRouteJson,
  originalNative: any[],
  traces: Trace[],
) {
  const native = structuredClone(originalNative)
  const complete =
    traces.length === input.connections.length &&
    input.connections.every(
      (c) => traces.filter((t) => t.connection_name === c.name).length === 1,
    )
  const endpoints = traces.every((t) => {
    const c = input.connections.find((c) => c.name === t.connection_name)
    return (
      !!c &&
      c.pointsToConnect.every((p, i) => {
        const q = i ? t.route.at(-1) : t.route[0]
        return (
          q?.route_type === "wire" &&
          q.layer === p.layer &&
          Math.hypot(q.x - p.x, q.y - p.y) < 1e-7
        )
      })
    )
  })
  const drc = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces },
    clearance: input.minTraceToPadEdgeClearance ?? 0.075,
    allowBlindAndBuriedVias: false,
  } as never)
  const buses = busLengthReports(input, traces),
    pairs = pairLengthReports(input, traces),
    coupling = exteriorPairSpacingReports(input, traces)
  const board = native.find((e) => e.type === "pcb_board")
  for (const original of traces) {
    const t = structuredClone(original),
      c = input.connections.find((c) => c.name === t.connection_name)
    if (!c) continue
    native.push({
      ...t,
      source_trace_id: c.source_trace_id,
      subcircuit_id: board.subcircuit_id,
      pcb_group_id: "pcb_group_0",
    })
    let index = 0
    for (const p of t.route)
      if (p.route_type === "via")
        native.push({
          type: "pcb_via",
          pcb_via_id: `native_group_${t.pcb_trace_id}_${index++}`,
          pcb_trace_id: t.pcb_trace_id,
          source_trace_id: c.source_trace_id,
          subcircuit_id: board.subcircuit_id,
          x: p.x,
          y: p.y,
          outer_diameter: p.via_diameter ?? input.minViaPadDiameter,
          hole_diameter: p.via_hole_diameter ?? input.minViaHoleDiameter,
          layers: p.layers ?? [p.from_layer, p.to_layer],
        })
  }
  const connMap = getFullConnectivityMapFromCircuitJson(native)
  const checks = await import(
    process.env.NATIVE_CHECKS_MODULE ?? "@tscircuit/checks"
  )
  const nativeFindings: Record<string, unknown[]> = {}
  for (const name of [
    "checkEachPcbTraceNonOverlapping",
    "checkPadTraceClearance",
    "checkViaPadClearance",
    "checkViaTraceClearance",
    "checkDifferentNetViaSpacing",
    "checkHoleTraceClearance",
    "checkViasInPads",
    "checkTracesAreContiguous",
    "checkPcbTraceStyle",
    "checkPcbBusLengthSkew",
    "checkPcbRoutingConstraints",
  ])
    nativeFindings[name] = await checks[name](native, { connMap })
  const valid =
    complete &&
    endpoints &&
    drc.valid &&
    buses.every(
      (b) =>
        b.aboveMinimumLength &&
        b.withinLengthLimit &&
        (b.toleranceMm === null || b.matched),
    ) &&
    pairs.every((p) => p.matched) &&
    coupling.every((p) => p.applicable && p.matched) &&
    Object.values(nativeFindings).every((f) => f.length === 0)
  return {
    valid,
    scope: "all_requested_ddr_signals" as const,
    wholeBoardComplete: false,
    complete,
    endpoints,
    connections: traces.length,
    drc,
    buses,
    pairs,
    coupling,
    nativeFindings,
  }
}
