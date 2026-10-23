import { expect, test } from "bun:test"
import {
  loadFirstPhaseNativeByte,
  auditFirstPhasePair,
} from "../scripts/native-first-phase"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { busLengthReports } from "../lib/route-lengths"
test("bounded native alternative completes rotated BYTE1 with all hard constraints", () => {
  const input = loadFirstPhaseNativeByte(),
    before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  while (!solver.solved && !solver.failed && solver.iterations < 170000)
    solver.step()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput(),
    traces = solver.traces
  expect(traces).toHaveLength(input.connections.length)
  for (const c of input.connections) {
    const t = traces.find((t) => t.connection_name === c.name)!
    expect(t).toBeDefined()
    for (const i of [0, 1]) {
      const p = i ? t.route.at(-1)! : t.route[0],
        q = c.pointsToConnect[i]
      expect(p.route_type).toBe("wire")
      expect((p as any).layer).toBe(q.layer)
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-8)
    }
  }
  expect(
    validateRoutedCopperDrc({
      inputSrj: input as never,
      routedSrj: output as never,
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    }).valid,
  ).toBe(true)
  expect(
    busLengthReports(input, traces).every(
      (b) => b.matched && b.withinLengthLimit,
    ),
  ).toBe(true)
  const names = new Set(input.differentialPairs![0].connectionNames)
  expect(
    auditFirstPhasePair(
      input,
      traces.filter((t) => names.has(t.connection_name!)),
    ).valid,
  ).toBe(true)
  expect(input).toEqual(before)
}, 300000)
