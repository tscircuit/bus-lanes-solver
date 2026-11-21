import { expect } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import type { Connection, SimpleRouteJson, Trace } from "../../lib"

/** Every listed connection reaches both native pads and all copper passes
 * DRC. `connections` names the owners of supplied and new traces alike. */
export function expectConnectedAndClear(params: {
  request: SimpleRouteJson
  connections: Connection[]
  traces: Trace[]
}): void {
  const { request, connections, traces } = params
  const ownedTraces = [request.traces ?? [], traces].map((list) =>
    list.map((trace) => {
      if (!trace.connection_name) throw Error("Trace has no net owner")
      return { ...trace, connection_name: trace.connection_name }
    }),
  )
  const inputSrj = {
    ...request,
    connections,
    obstacles: request.obstacles.map((obstacle) => ({
      ...obstacle,
      type: "rect" as const,
    })),
    traces: ownedTraces[0],
  }
  const context = { inputSrj, routedSrj: { ...inputSrj, traces: ownedTraces[1] } }
  const connectivity = validateOriginalEndpointConnectivity(context)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(connections.length)
  expect(
    validateRoutedCopperDrc({
      ...context,
      clearance: request.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: request.allowBlindAndBuriedVias ?? false,
    }).valid,
  ).toBe(true)
}
