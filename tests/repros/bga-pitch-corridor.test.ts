import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { bgaPitchCorridor } from "../fixtures/bga-pitch-corridor"

test("a phase-only search cannot cross successive BGA interstices", () => {
  const { input, options } = bgaPitchCorridor()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 30000)
