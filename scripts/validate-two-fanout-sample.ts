import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson, Trace } from "../lib"
type Bounds = SimpleRouteJson["bounds"]
export interface FanoutMetadata {
  allowViaInPad?: boolean
  kind: string
  marginMm: number
  socRegion: Bounds
  ramRegion: Bounds
  fixedFanoutTraces: Array<Trace & { side: "soc" | "ram" }>
  corePhase: {
    autorouter: string
    connections: number
    fanoutTraces: number
    carrierInputTraces: number
    carrierOutputTraces: number
    circuitErrors: number
  }
}
export function validateTwoFanoutSample(
  input: SimpleRouteJson,
  meta: FanoutMetadata,
  carrierTraces: Trace[] = [],
) {
  const fail = (message: string): never => {
    throw Error(`Invalid two-fanout sample: ${message}`)
  }
  if (
    meta.kind !== "captured-bus-lanes-phase" ||
    meta.corePhase.autorouter !== "bus_lanes"
  )
    fail("missing actual bus_lanes phase capture")
  if (input.connections.length !== 33 || meta.fixedFanoutTraces.length !== 66)
    fail("expected all 33 signals and both complete fanouts")
  if (
    (input.traces ?? []).some(
      (t) =>
        !meta.fixedFanoutTraces.some((f) => f.pcb_trace_id === t.pcb_trace_id),
    ) ||
    meta.corePhase.carrierInputTraces !== 0
  )
    fail("pre-routed carrier copper")
  if (
    (input.traces ?? []).length !== 66 ||
    meta.corePhase.connections !== 33 ||
    meta.corePhase.fanoutTraces !== 66 ||
    ![0, 33].includes(meta.corePhase.carrierOutputTraces)
  )
    fail("incomplete or failing phase capture")
  const geometry = (trace: Trace) => {
    const points = trace.route.map((p) =>
      p.route_type === "wire"
        ? [p.route_type, p.x, p.y, p.width, p.layer]
        : [
            p.route_type,
            p.x,
            p.y,
            p.via_diameter,
            (p as typeof p & { via_hole_diameter?: number }).via_hole_diameter,
            ...[p.from_layer, p.to_layer].sort(),
          ],
    )
    return [
      JSON.stringify(points),
      JSON.stringify([...points].reverse()),
    ].sort()[0]
  }
  for (const fixed of meta.fixedFanoutTraces) {
    const captured = input.traces!.filter(
      (t) => t.pcb_trace_id === fixed.pcb_trace_id,
    )
    if (captured.length !== 1 || geometry(captured[0]) !== geometry(fixed))
      fail("fixed fanout geometry differs from phase input")
  }
  const a = meta.socRegion,
    b = meta.ramRegion
  const separation = Math.max(
    b.minX - a.maxX,
    a.minX - b.maxX,
    b.minY - a.maxY,
    a.minY - b.maxY,
  )
  if (meta.marginMm < 6 || separation < meta.marginMm - 1e-8)
    fail("overlapping fanout regions or insufficient margin")
  const originalConnections = input.connections.map((c) => {
    const paths = (["soc", "ram"] as const).map((side) => {
      const candidates = meta.fixedFanoutTraces.filter(
        (t) => t.side === side && t.source_trace_id === c.name,
      )
      if (candidates.length !== 1)
        fail(`${c.name}: missing/duplicate ${side} fanout`)
      const t = candidates[0],
        region = meta[`${side}Region`]
      for (const p of t.route) {
        const radius =
          p.route_type === "via" ? (p.via_diameter ?? 0.3) / 2 : p.width / 2
        if (
          p.x - radius < region.minX - 1e-7 ||
          p.x + radius > region.maxX + 1e-7 ||
          p.y - radius < region.minY - 1e-7 ||
          p.y + radius > region.maxY + 1e-7
        )
          fail(`${side} copper outside its region`)
      }
      const endpoints = [t.route[0], t.route.at(-1)!]
      if (
        !endpoints.some(
          (exit) =>
            exit.route_type === "wire" &&
            c.pointsToConnect.some(
              (p) =>
                p.layer === exit.layer &&
                Math.hypot(p.x - exit.x, p.y - exit.y) < 1e-7,
            ),
        )
      )
        fail(`${c.name}: endpoint is not a fanout exit`)
      return t
    })

    return {
      ...c,
      pointsToConnect: paths.map((t, index) => {
        const exit = c.pointsToConnect[index]
        const first = t.route[0]
        return Math.hypot(first.x - exit.x, first.y - exit.y) < 1e-7
          ? t.route.at(-1)!
          : first
      }),
    }
  })
  // Fixed fanouts are independently checked against real component pads and
  // each other, excluding core's conservative rasterization of the same copper.
  const fixedInput = {
    ...input,
    connections: originalConnections,
    allowViaInPad: meta.allowViaInPad === true,
    obstacles: input.obstacles.filter(
      (o) => (o as { componentId?: string }).componentId,
    ),
    traces: [],
  }
  const traces = meta.fixedFanoutTraces.map((t) => ({
    ...t,
    connection_name: t.source_trace_id,
    route: t.route.map((p, i) => {
      if (p.route_type !== "via") return p
      const before = t.route[i - 1],
        after = t.route[i + 1]
      if (
        before?.route_type !== "wire" ||
        after?.route_type !== "wire" ||
        ![p.from_layer, p.to_layer].includes(before.layer) ||
        ![p.from_layer, p.to_layer].includes(after.layer)
      )
        fail("discontinuous fixed via")
      // Core can reverse a saved trace without reversing its via annotation;
      // normalize traversal direction, preserving the physical layer span.
      return {
        ...p,
        from_layer: (before as import("../lib/types").Wire).layer,
        to_layer: (after as import("../lib/types").Wire).layer,
      }
    }),
  }))
  const drc = validateRoutedCopperDrc({
    inputSrj: fixedInput,
    routedSrj: { ...fixedInput, traces: [...traces, ...carrierTraces] },
    clearance: 0.075,
    allowBlindAndBuriedVias: true,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  if (!drc.valid) fail(`copper DRC: ${drc.issues[0]?.message}`)
  return {
    marginMm: separation,
    fanoutTraces: 66,
    signals: 33,
    mismatchedExitLayers: input.connections.filter(
      (c) => c.pointsToConnect[0].layer !== c.pointsToConnect[1].layer,
    ).length,
    fixedCopperDrcErrors: drc.issues.length,
  }
}
