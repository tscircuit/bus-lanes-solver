import { spyOn } from "bun:test"
import { BusLanesSolver } from "../../lib/bus-lanes-solver"
import { joinSignalEscapes } from "../../lib/join-signal-escapes"
import {
  NativeCarrierRouter,
  type NativeCarrierSearchOptions,
} from "../../lib/native-carrier-router"
import {
  planNativePairedCarriers,
  type NativePairedCarrierOptions,
} from "../../lib/plan-native-paired-carriers"
import type { Connection, Point, SimpleRouteJson, Trace } from "../../lib/types"

/** Observe real native copper at the stage boundary, before residual meanders. */
export function captureNativePairProposal(
  input: SimpleRouteJson,
  options: NativePairedCarrierOptions,
) {
  const stopped = new Error(
    "Captured complete native pair before residual matching",
  )
  let traces: Trace[] | undefined
  let capturedCarriers: Trace[] = []
  const originalRoute = NativeCarrierRouter.prototype.route
  const candidates: Array<{
    router: NativeCarrierRouter
    connection: Connection
    options: NativeCarrierSearchOptions
    point: Point
    trace: Trace | null
  }> = []
  const routing = spyOn(
    NativeCarrierRouter.prototype,
    "route",
  ).mockImplementation(function* (
    this: NativeCarrierRouter,
    connection,
    routeOptions = {},
  ) {
    const result = yield* originalRoute.call(this, connection, routeOptions)
    if (routeOptions.forcedVia)
      candidates.push({
        router: this,
        connection,
        options: routeOptions,
        point: routeOptions.forcedVia,
        trace: result?.trace ?? null,
      })
    return result
  })
  const matching = spyOn(BusLanesSolver, "forRefinement").mockImplementation(
    (prepared, carriers) => {
      capturedCarriers = carriers
      traces = carriers.map((trace) =>
        joinSignalEscapes(
          trace,
          prepared.traces!.filter(
            (escape) => escape.connection_name === trace.connection_name,
          ),
        ),
      )
      throw stopped
    },
  )
  try {
    const search = planNativePairedCarriers(input, options)
    let result = search.next()
    while (!result.done) result = search.next()
    throw new Error("Native planner did not reach the matching stage")
  } catch (error) {
    if (error !== stopped) throw error
  } finally {
    matching.mockRestore()
    routing.mockRestore()
  }
  // This is a control route, never inserted into the planner output. It proves
  // that a failed off-grid candidate had a physically legal grid alternative.
  let projectedAlternative: Trace | null = null
  let projectedCandidate: Point | null = null
  for (const candidate of candidates) {
    const step = options.gridStep ?? 0.1
    const forcedVia = {
      x:
        input.bounds.minX +
        Math.round((candidate.point.x - input.bounds.minX) / step) * step,
      y:
        input.bounds.minY +
        Math.round((candidate.point.y - input.bounds.minY) / step) * step,
    }
    const search = originalRoute.call(candidate.router, candidate.connection, {
      ...candidate.options,
      forcedVia,
    })
    let result = search.next()
    while (!result.done) result = search.next()
    if (result.value) {
      projectedAlternative = result.value.trace
      projectedCandidate = candidate.point
      break
    }
  }
  return {
    traces: traces!,
    carriers: capturedCarriers,
    attempts: candidates.map(({ point, trace, connection }) => ({
      point,
      accepted: trace !== null,
      trace,
      connectionName: connection.name,
    })),
    projectedAlternative,
    projectedCandidate,
  }
}
