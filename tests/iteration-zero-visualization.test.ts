import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib"

test("AM62L fixed copper is visible at iteration zero and unchanged after solving", async () => {
  const input = await Bun.file(
    new URL("./fixtures/ddr_left_io_right-byte0.json", import.meta.url),
  ).json()
  const solver = new BusLanesSolver(input)
  const initial = solver.visualize()
  const grayLines = (graphics: ReturnType<typeof solver.visualize>) =>
    graphics.lines?.filter((line) => line.strokeColor === "#94a3b8")
  expect(grayLines(initial)!.length).toBeGreaterThan(100)
  expect(solver.iterations).toBe(0)
  expect(solver.phase).toBe("validate")
  expect(solver.traces).toEqual([])
  expect(solver.visualize()).toEqual(initial)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(grayLines(solver.visualize())).toEqual(grayLines(initial))
  expect(solver.visualize().rects).toEqual(initial.rects)
})
