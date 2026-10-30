import { expect } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import {
  BusLanesPipelineSolver,
  type BusLanesSolver,
  type SimpleRouteJson,
} from "../../lib"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"
import { sharedPairSpacingReports } from "../../lib/shared-pair-spacing"
import { toNativeValidationSrj } from "../../lib/native-validation-input"

/** All acceptance checks run before a completed routing snapshot can be written. */
export function expectCompletedRouting(
  solver: BusLanesSolver | BusLanesPipelineSolver,
  original: SimpleRouteJson,
) {
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const input = solver.input
  const output = solver.getOutput()
  const fixedConnections =
    solver instanceof BusLanesPipelineSolver
      ? (solver.options.singleCarrier?.fixedConnections ?? [])
      : []
  const native = {
    inputSrj: toNativeValidationSrj({
      ...input,
      connections: [...input.connections, ...fixedConnections],
    }),
    routedSrj: toNativeValidationSrj({
      ...output,
      connections: [...output.connections, ...fixedConnections],
    }),
  }
  const connectivity = validateOriginalEndpointConnectivity(native)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(
    native.inputSrj.connections.length,
  )
  expect(
    validateRoutedCopperDrc({
      ...native,
      clearance:
        input.minTraceToPadEdgeClearance ??
        input.defaultObstacleMargin ??
        0.075,
    }).valid,
  ).toBe(true)
  for (const report of busLengthReports(input, solver.traces)) {
    expect(report.aboveMinimumLength).toBe(true)
    expect(report.withinLengthLimit).toBe(true)
    if (report.toleranceMm !== null) expect(report.matched).toBe(true)
  }
  expect(
    pairLengthReports(input, solver.traces).every((report) => report.matched),
  ).toBe(true)
  expect(
    sharedPairSpacingReports(input, solver.traces).every(
      (report) => report.matched,
    ),
  ).toBe(true)
  expect(
    exteriorPairSpacingReports(input, solver.traces).every(
      (report) => report.matched,
    ),
  ).toBe(true)
  expect(input).toEqual(original)
  expect(output.traces?.slice(0, input.traces?.length ?? 0)).toEqual(
    input.traces ?? [],
  )
}
