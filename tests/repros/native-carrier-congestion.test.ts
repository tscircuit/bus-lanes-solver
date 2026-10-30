import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { nativeCarrierCongestion } from "../fixtures/native-carrier-congestion"

test("the native mixed-carrier request cannot complete its congested byte", () => {
  const { input, options } = nativeCarrierCongestion()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 20000)
