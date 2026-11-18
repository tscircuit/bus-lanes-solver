import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("the actual pipeline publishes access evidence only for accepted final copper", () => {
  const { input } = pendingPadAccessFixture()
  input.connections = [
    {
      name: "CONTROL",
      width: 0.1,
      pointsToConnect: [
        { x: -5, y: -5, layer: "top" },
        { x: -4, y: -5, layer: "top" },
      ],
    },
  ]
  input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "supplied_control",
      connection_name: "SUPPLIED_CONTROL",
      route: [
        { route_type: "wire", x: -5, y: 4, layer: "top", width: 0.1 },
        { route_type: "wire", x: -4, y: 4, layer: "top", width: 0.1 },
      ],
    },
  ]
  const original = structuredClone(input)
  const options = { fanout: "none", smoothTuning: false } as const
  const solver = new BusLanesPipelineSolver(input, options)
  expect(solver.getPendingRoutingAccessReport()).toBeUndefined()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  const report = solver.getPendingRoutingAccessReport()
  expect(report).toMatchObject({
    outcome: "preserved",
    declaredConnectionCount: 1,
    declaredTerminalCount: 2,
    framedTerminalCount: 2,
    baselineAccessibleFramedTerminalCount: 2,
    validatedTraceCount: 2,
    newlyBlockedConnectionNames: [],
  })
  Object.assign(report!, {
    validatedTraceCount: 999,
    newlyBlockedConnectionNames: ["not actual evidence"],
  })
  expect(solver.getPendingRoutingAccessReport()?.validatedTraceCount).toBe(2)
  expect(
    solver.getPendingRoutingAccessReport()?.newlyBlockedConnectionNames,
  ).toEqual([])
  expect(solver.getOutput().traces).toHaveLength(2)
  expect(solver.getOutput().traces[0]).toEqual(input.traces[0])

  const legacyInput = structuredClone(input)
  delete legacyInput.pendingRoutingAccess
  const legacy = new BusLanesPipelineSolver(legacyInput, options)
  legacy.solve()
  expect(legacy.solved).toBe(true)
  expect(legacy.getPendingRoutingAccessReport()).toBeUndefined()
  expect(legacy.getOutput()).not.toHaveProperty("pendingRoutingAccess")
  expect(legacy.getOutput().traces).toEqual(solver.getOutput().traces)

  const stopped = new BusLanesPipelineSolver(input, {
    ...options,
    maxRoutingTimeMs: Number.MIN_VALUE,
  })
  stopped.solve()
  expect(stopped.failed).toBe(true)
  expect(stopped.failureCode).toBe("routing_timeout")
  expect(stopped.getPendingRoutingAccessReport()).toBeUndefined()
  expect(input).toEqual(original)
})
