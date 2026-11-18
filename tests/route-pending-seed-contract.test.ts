import { expect, test } from "bun:test"
import { routePendingAccess } from "../lib/route-pending-access"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"
import type { Trace, Terminal } from "../lib/types"
function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) {
    step = steps.next()
  }
  return step.value
}
test("pending completion keeps a complete manufactured native seed as a planar carrier plus owned approaches", () => {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const tunnel: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "native_two_via_seed",
    connection_name: "TUNNEL",
    route: [
      { x: -4, y: -5, route_type: "wire", layer: "top", width: 0.1 },
      { x: -4, y: -4, route_type: "wire", layer: "top", width: 0.1 },
      {
        x: -4,
        y: -4,
        route_type: "via",
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { x: -4, y: -4, route_type: "wire", layer: "bottom", width: 0.1 },
      { x: 4, y: -4, route_type: "wire", layer: "bottom", width: 0.1 },
      {
        x: 4,
        y: -4,
        route_type: "via",
        from_layer: "bottom",
        to_layer: "top",
        layers: ["top", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { x: 4, y: -4, route_type: "wire", layer: "top", width: 0.1 },
      { x: 4, y: -5, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  const supplied: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "supplied",
    connection_name: "SUPPLIED",
    route: [
      { x: -5.5, y: -2, route_type: "wire", layer: "top", width: 0.16 },
      { x: -5.5, y: 2, route_type: "wire", layer: "top", width: 0.16 },
    ],
  }
  const traces = [upperLeft, lowerRight, tunnel]
  input.traces = [supplied]
  input.buses = [
    {
      busId: "CURRENT_BUS",
      connectionNames: traces.map((trace) => trace.connection_name!),
    },
  ]
  input.connections = traces.map((trace) => ({
    name: trace.connection_name!,
    width: 0.1,
    pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Terminal[],
  }))
  const original = structuredClone({ input, traces }),
    options = { smoothTuning: true, denseSearch: true },
    maxSteps = 500000
  expect(
    finish(new PendingPadAccess(input).getBlockedObligations(traces)),
  ).toHaveLength(1)
  const after = finish(
    routePendingAccess({
      input,
      traces,
      options,
      maxSteps,
      access: new PendingPadAccess(input),
    }),
  )
  expect(after).not.toBeNull()
  if (!after) return
  expect(
    finish(new PendingPadAccess(input).getBlockedObligations(after)),
  ).toEqual([])
  expect(
    after.find((trace) => trace.connection_name === "TUNNEL")!.route,
  ).toEqual(tunnel.route)
  const connections = [
    ...input.connections,
    {
      name: "SUPPLIED",
      pointsToConnect: [
        supplied.route[0],
        supplied.route.at(-1)!,
      ] as Terminal[],
    },
  ]
  expect(input.obstacles.every((obstacle) => obstacle.type === "rect")).toBe(
    true,
  )
  expectConnectedAndClear({
    request: input,
    connections,
    traces: [supplied, ...after],
  })
  expect({ input, traces }).toEqual(original)
})
test("pending completion refuses an unsupported same-layer mutable barrel before finishing can discard it", () => {
  const { input, upperLeft, lowerRight } = pendingPadAccessFixture()
  const unsupported: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "same_layer_mutable",
    connection_name: "LOCAL",
    route: [
      { x: -4, y: -4, route_type: "wire", layer: "top", width: 0.1 },
      { x: -3, y: -4, route_type: "wire", layer: "top", width: 0.1 },
      {
        x: -3,
        y: -4,
        route_type: "via",
        from_layer: "top",
        to_layer: "top",
        layers: ["top", "bottom"],
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { x: -3, y: -4, route_type: "wire", layer: "top", width: 0.1 },
      { x: -2, y: -4, route_type: "wire", layer: "top", width: 0.1 },
    ],
  }
  const traces = [upperLeft, lowerRight, unsupported]
  input.connections = traces.map((trace) => ({
    name: trace.connection_name!,
    width: 0.1,
    pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Terminal[],
  }))
  const original = structuredClone({ input, traces })
  expect(() =>
    finish(
      routePendingAccess({
        input,
        traces,
        options: { smoothTuning: true, denseSearch: true },
        maxSteps: 500000,
        access: new PendingPadAccess(input),
      }),
    ),
  ).toThrow("must change its logical routing layer")
  expect({ input, traces }).toEqual(original)
})
