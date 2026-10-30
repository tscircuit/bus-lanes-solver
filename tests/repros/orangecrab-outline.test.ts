import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { orangecrabByte0 } from "../fixtures/orangecrab"

test("the unchanged real OrangeCrab outline reaches coupled-pair search", () => {
  const input = orangecrabByte0()
  const before = structuredClone(input)
  expect(input.connections).toHaveLength(11)
  expect(input.obstacles).toHaveLength(1430)
  expect(input.traces).toHaveLength(996)
  const solver = new BusLanesSolver(input)
  solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.phase).toBe("coupled_pairs")
  expect(input).toEqual(before)
})
