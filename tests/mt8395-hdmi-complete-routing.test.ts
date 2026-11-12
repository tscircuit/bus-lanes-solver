import "bun-match-svg"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import {
  loadMt8395HdmiInput,
  hashMt8395Input,
} from "./fixtures/mt8395-hdmi-input"
import { mt8395HdmiRoutingSnapshot } from "./fixtures/mt8395-hdmi-routing-snapshot"

test("MT8395 HDMI completes with a local package reconnection search", async () => {
  const input = loadMt8395HdmiInput()
  const before = hashMt8395Input(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(input.connections).toHaveLength(2)
  expect(input.traces).toHaveLength(138)
  expect(hashMt8395Input(input)).toBe(before)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.traces).toHaveLength(2)
  const output = solver.getOutput()
  expect(output.traces.slice(0, input.traces!.length)).toEqual(input.traces!)
  // The original phase omits earlier DDR requests. Restore their owners only
  // for independent DRC; the solver receives the exact core input unchanged.
  const connections = [
    ...input.connections,
    ...input.traces!.map((t) => ({
      name: t.connection_name!,
      pointsToConnect: [t.route[0], t.route.at(-1)!],
    })),
  ]
  type CheckerInput = Parameters<typeof validateRoutedCopperDrc>[0]["inputSrj"]
  const context = {
    inputSrj: { ...input, connections } as unknown as CheckerInput,
    routedSrj: { ...output, connections } as unknown as CheckerInput,
  }
  expect(
    validateRoutedCopperDrc({
      ...context,
      clearance: 0.06,
      allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
    }).issues,
  ).toEqual([])
  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj: input as unknown as CheckerInput,
    routedSrj: output as unknown as CheckerInput,
  })
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(2)
  for (const report of [
    ...busLengthReports(input, solver.traces),
    ...pairLengthReports(input, solver.traces),
  ]) {
    expect(report.matched).toBe(true)
    expect(report.aboveMinimumLength).toBe(true)
    expect(report.withinLengthLimit).toBe(true)
  }
  expect(
    exteriorPairSpacingReports(input, solver.traces).every((r) => r.matched),
  ).toBe(true)
  expect(
    sharedPairSpacingReports(input, solver.traces).every((r) => r.matched),
  ).toBe(true)
  await expect(
    mt8395HdmiRoutingSnapshot(input, solver.traces),
  ).toMatchSvgSnapshot(import.meta.path)
}, 300_000)
