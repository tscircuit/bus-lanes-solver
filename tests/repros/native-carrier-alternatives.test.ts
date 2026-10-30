import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { nativeCarrierAlternatives } from "../fixtures/native-carrier-alternatives"

test("a mixed native bus does not complete across permitted carrier alternatives", () => {
  const { input, options } = nativeCarrierAlternatives()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 20000)
