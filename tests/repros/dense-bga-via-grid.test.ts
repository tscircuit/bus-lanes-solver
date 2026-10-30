import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { denseBgaViaGrid } from "../fixtures/dense-bga-via-grid"

test("a coarse native grid misses legal via pockets in a dense BGA", () => {
  const { input, options } = denseBgaViaGrid()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 30000)
