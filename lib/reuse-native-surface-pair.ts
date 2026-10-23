import { VectorScene, fixedCopper } from "./vector-scene"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { pairLengthReports, maximumCarrierLength } from "./route-lengths"
import { pairCouplingReports } from "./pair-coupling"
import { exteriorPairSpacingReports } from "./exterior-pair-spacing"
import { distance, length } from "./geometry"
import { signalLayers, type FlexibleSignalState } from "./flexible-signal-state"
import type { SimpleRouteJson } from "./types"
/** Reuse only an independently accepted, fully native wire pair. Supplied
 * copper stays fixed; the whole new reservation is physically revalidated. */
export function reuseNativeSurfacePair(
  input: SimpleRouteJson,
  pair: NonNullable<SimpleRouteJson["differentialPairs"]>[number],
  candidate: FlexibleSignalState,
): boolean {
  const names = new Set(pair.connectionNames),
    traces = candidate.retained.filter((t) => names.has(t.connection_name!)),
    connections = input.connections.filter((c) => names.has(c.name))
  if (traces.length !== 2 || connections.length !== 2) return false
  for (const c of connections) {
    const t = traces.find((t) => t.connection_name === c.name)!
    if (
      !t ||
      t.route.length < 2 ||
      t.route.some(
        (p) =>
          p.route_type !== "wire" || !signalLayers(input, c).includes(p.layer),
      )
    )
      return false
    for (const i of [0, 1]) {
      const p = i ? t.route.at(-1)! : t.route[0],
        q = c.pointsToConnect[i]
      if (
        p.route_type !== "wire" ||
        p.layer !== q.layer ||
        distance(p, q) > 1e-8
      )
        return false
    }
    if (
      length(t.route) >
      maximumCarrierLength(
        { ...input, traces: [...(input.traces ?? []), ...candidate.escapes] },
        c.name,
      ) +
        1e-7
    )
      return false
  }
  const scoped = { ...input, differentialPairs: [pair] }
  if (
    pairLengthReports(scoped, traces).some((p) => !p.matched) ||
    pairCouplingReports(scoped, traces).some((p) => !p.matched) ||
    exteriorPairSpacingReports(scoped, traces).some((p) => !p.matched)
  )
    return false
  const manufacturing = input as SimpleRouteJson & {
    minTraceToHoleEdgeClearance?: number
  }
  const padClearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const holeClearance =
    manufacturing.minTraceToHoleEdgeClearance ?? padClearance
  // Fixed via lands must conservatively cover the declared drill clearance.
  // Other manufacturing regimes retain the original pair-search fallback.
  const supplied = [
    ...(input.traces ?? []),
    ...candidate.escapes,
    ...candidate.traces,
    ...candidate.retained.filter((t) => !names.has(t.connection_name!)),
  ]
  for (const trace of supplied)
    for (const point of trace.route)
      if (point.route_type === "via") {
        const diameter = point.via_diameter
        const drill = point.via_hole_diameter
        if (
          !diameter ||
          !drill ||
          !Number.isFinite(diameter) ||
          !Number.isFinite(drill) ||
          diameter <= 0 ||
          drill <= 0 ||
          drill > diameter ||
          holeClearance > padClearance + (diameter - drill) / 2 + 1e-8
        )
          return false
      }
  const hard = fixedCopper({ ...input, traces: supplied })
  for (const c of connections) {
    const t = traces.find((t) => t.connection_name === c.name)!
    const width = (t.route[0] as import("./types").Wire).width
    if (
      t.route.some(
        (p) => p.route_type !== "wire" || Math.abs(p.width - width) > 1e-8,
      )
    )
      return false
    if (!new VectorScene(input, c, width, hard).pathVisible(t.route))
      return false
  }
  // Validate current-phase copper here; supplied prior-phase copper was checked
  // above as immutable obstacles, without inventing input connections for it.
  return validateRoutedCopperDrc({
    inputSrj: input as never,
    routedSrj: {
      ...input,
      traces: [
        ...candidate.escapes,
        ...candidate.retained,
        ...candidate.traces,
      ],
    } as never,
    clearance: padClearance,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
  }).valid
}
