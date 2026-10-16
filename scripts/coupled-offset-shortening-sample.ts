import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { segmentDistance } from "../lib/geometry"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { pairCouplingReports } from "../lib/pair-coupling"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import type { SimpleRouteJson, Trace } from "../lib/types"

export const COUPLED_OFFSET_SAMPLE_NAME = "coupled-offset-shortening" as const
const width = 0.1
const gap = 0.18
const clearance = 0.1

/** Exact original PR58 fixture. Decimal endpoints and arithmetic are intentional;
 * rounding them can change connector selection. Every call returns fresh data. */
export function createCoupledOffsetShorteningInput(): SimpleRouteJson {
  const ends = [
    { x: 39.03105969999999, y: -15.000126000000002 },
    { x: 39.4650233, y: -14.99924 },
  ]
  const offset = (width + gap) / 2
  const approach = 2 * width + gap + clearance
  return {
    layerCount: 2,
    minTraceWidth: width,
    minTraceToPadEdgeClearance: clearance,
    bounds: { minX: 38, maxX: 41, minY: -17, maxY: -13 },
    obstacles: [],
    connections: ["P", "N"].map((name, side) => ({
      name,
      pointsToConnect: ends.map((point, end) => ({
        x: point.x + (end === 0 ? -approach : approach),
        y: point.y + (side === 0 ? offset : -offset),
        layer: "top",
      })),
    })),
    differentialPairs: [
      {
        connectionNames: ["P", "N"],
        traceGap: gap,
        lengthTolerance: 0.127,
        maxUncoupledLength: 1,
      },
    ],
  }
}

/** Audit this non-AM benchmark with the original regression's full criteria.
 * Missing routes never count as a completed/valid result; fixedDrc separately
 * permits the benchmark worker's initial input-only audit. No routing occurs. */
export function validateCoupledOffsetShorteningSample(
  input: SimpleRouteJson,
  signalTraces?: Trace[],
) {
  const inputBefore = JSON.stringify(input)
  if (inputBefore !== JSON.stringify(createCoupledOffsetShorteningInput()))
    throw Error("Invalid coupled-offset sample: original fixture changed")
  const traces = signalTraces ?? []
  if (
    !Array.isArray(traces) ||
    traces.some(
      (trace) =>
        trace.type !== "pcb_trace" ||
        typeof trace.pcb_trace_id !== "string" ||
        !trace.pcb_trace_id ||
        !Array.isArray(trace.route) ||
        trace.route.some(
          (point) =>
            point.route_type !== "wire" ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            point.layer !== "top" ||
            point.width !== width,
        ),
    )
  )
    throw Error("Invalid coupled-offset sample: malformed signal copper")
  const tracesBefore = JSON.stringify(traces)
  const issues: string[] = []
  const names = new Set(input.connections.map((connection) => connection.name))
  const complete =
    traces.length === 2 &&
    new Set(traces.map((trace) => trace.pcb_trace_id)).size === 2 &&
    traces.every((trace) => names.has(trace.connection_name ?? "")) &&
    input.connections.every((connection) => {
      const routes = traces.filter(
        (trace) => trace.connection_name === connection.name,
      )
      if (routes.length !== 1 || routes[0].route.length < 2) return false
      const route = routes[0].route
      return [route[0], route.at(-1)!].every((point, end) => {
        const terminal = connection.pointsToConnect[end]
        return (
          point.x === terminal.x &&
          point.y === terminal.y &&
          point.route_type === "wire" &&
          point.layer === terminal.layer
        )
      })
    })
  if (!complete)
    issues.push(
      "signals must connect exactly once between all four original terminals",
    )
  if (!routeAnglesAreConventional(traces))
    issues.push("signal copper contains a nonconventional turn")
  if (
    traces.some(
      (trace) => !tuningPathIsSelfClear(trace.route, width + clearance),
    )
  )
    issues.push("signal copper fails self-clearance")

  let minPairEdgeClearanceMm: number | null = null
  if (complete) {
    let minimum = Infinity
    for (let i = 1; i < traces[0].route.length; i++)
      for (let j = 1; j < traces[1].route.length; j++)
        minimum = Math.min(
          minimum,
          segmentDistance(
            [traces[0].route[i - 1], traces[0].route[i]],
            [traces[1].route[j - 1], traces[1].route[j]],
          ) - width,
        )
    minPairEdgeClearanceMm = minimum
    if (!Number.isFinite(minimum) || minimum < clearance - 1e-8)
      issues.push(
        "different-net conductors violate continuous copper clearance",
      )
  }
  const audit = (routed: Trace[]) =>
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: routed },
      clearance,
      allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  const fixedDrc = audit([])
  const combinedDrc = signalTraces === undefined ? null : audit(traces)
  const pairLengths = pairLengthReports(input, traces)
  const sharedSpacing = sharedPairSpacingReports(input, traces)
  const coupling = pairCouplingReports(input, traces)
  const matched =
    complete &&
    pairLengths.length === 1 &&
    pairLengths.every((report) => report.matched) &&
    sharedSpacing.length === 1 &&
    sharedSpacing.every((report) => report.matched) &&
    coupling.length === 1 &&
    coupling.every((report) => report.matched)
  if (!matched)
    issues.push(
      "pair length matching, shared spacing, or coupling is incomplete",
    )
  if (!fixedDrc.valid || (combinedDrc && !combinedDrc.valid))
    issues.push("native full copper DRC failed")
  if (
    JSON.stringify(input) !== inputBefore ||
    JSON.stringify(traces) !== tracesBefore
  )
    throw Error(
      "Coupled-offset validation mutated original input or routed copper",
    )
  return {
    valid:
      complete &&
      matched &&
      fixedDrc.valid &&
      combinedDrc?.valid === true &&
      !issues.length,
    complete,
    matched,
    fixedPowerTraces: 0,
    fixedPowerVias: 0,
    fixedPowerPadJoins: 0,
    fixedDrc,
    combinedDrc,
    busLengths: [],
    pairLengths,
    quality: null,
    issues,
    sharedSpacing,
    coupling,
    minPairEdgeClearanceMm,
  }
}
