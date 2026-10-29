import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { boardOutlineInput } from "../fixtures/board-outline"

test("a concave board reproduces unsupported_outline without mutating the input", () => {
  const input = boardOutlineInput()
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.error).toBe("Custom board outlines are unsupported")
  expect(solver.failureCode).toBe("unsupported_outline")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.traces).toHaveLength(0)
  expect(input).toEqual(before)
})
