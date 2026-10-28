import { expect, test } from "bun:test"
import { BusLanesPipelineSolver, busLengthReports } from "../lib"
import { meanderReturnGapInput } from "./fixtures/meander-return-gap"
import { measureReturnGap } from "./fixtures/measure-return-gap"

const solved = (async () => {
  const input = await meanderReturnGapInput()
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  return { input, solver }
})()

test("real TSX pads and bus produce a complete matched pipeline output", async () => {
  const { input, solver } = await solved
  expect(input.connections).toHaveLength(2)
  expect(input.obstacles).toHaveLength(4)
  expect(input.buses).toHaveLength(1)
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutput().traces!
  expect(busLengthReports(input, traces).every((r) => r.matched)).toBe(true)
  expect(measureReturnGap(traces).edgeGap).toBeGreaterThanOrEqual(0.1 - 1e-8)
})

test("TSX pipeline retains the documented three-width return-leg spacing", async () => {
  const { solver } = await solved
  expect(
    measureReturnGap(solver.getOutput().traces!).edgeGap,
  ).toBeGreaterThanOrEqual(0.2 - 1e-8)
})
