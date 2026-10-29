import { pairOnlyInput } from "./fixtures/pair-only-length-target"
import { expectRoutingFixSnapshot } from "./fixtures/routing-fix-svg"
import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"

test("a pair-only bus routes without artificial tuning headroom", () => {
  const input = pairOnlyInput(),
    before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(2)
  expect(busLengthReports(input, solver.traces).every((r) => r.matched)).toBe(
    true,
  )
  expect(pairLengthReports(input, solver.traces).every((r) => r.matched)).toBe(
    true,
  )
  expect(
    exteriorPairSpacingReports(input, solver.traces).every((r) => r.matched),
  ).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: solver.getOutput(),
      clearance: 0.1,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expectRoutingFixSnapshot(
    "pair-target",
    input,
    solver,
    "Pair-only bus: match without artificial length headroom",
  )
  expect(input).toEqual(before)
}, 30000)
