import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { orangecrabByte0 } from "../fixtures/orangecrab"

test("the original OrangeCrab outline reproduces unsupported_outline", () => {
  const input = orangecrabByte0()
  const before = structuredClone(input)
  expect(input.connections).toHaveLength(11)
  expect(input.obstacles).toHaveLength(1430)
  expect(input.traces).toHaveLength(996)
  const solver = new BusLanesSolver(input)
  solver.step()
  expect(solver.error).toBe("Custom board outlines are unsupported")
  expect(solver.failureCode).toBe("unsupported_outline")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.traces).toHaveLength(0)
  expect(input).toEqual(before)
})
