import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { nativeOvalObstacle } from "../fixtures/native-oval-obstacle"

test("a rotated oval's bounding box blocks physically clear terminals", () => {
  const input = nativeOvalObstacle()
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(input).toEqual(before)
})
