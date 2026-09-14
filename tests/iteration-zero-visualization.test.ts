import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib"

test("AM62L fixed copper is visible at iteration zero and unchanged after a routing attempt", async () => {
  const input = await Bun.file(
    new URL("./fixtures/two-fanouts/ddr_left_io_right.json", import.meta.url),
  ).json()
  const solver = new BusLanesSolver(input)
  const initial = solver.visualize()
  const fixedLines = (graphics: ReturnType<typeof solver.visualize>) =>
    graphics.lines?.filter((line) => line.label?.startsWith("Fixed fanout"))
  expect(fixedLines(initial)!.length).toBeGreaterThan(100)
  expect(
    new Set(fixedLines(initial)!.map((line) => line.layer)).size,
  ).toBeGreaterThan(1)
  expect(
    new Set(fixedLines(initial)!.map((line) => line.strokeColor)).size,
  ).toBeGreaterThan(1)
  expect(initial.circles!.length).toBeGreaterThan(0)
  expect(solver.iterations).toBe(0)
  expect(solver.phase).toBe("validate")
  expect(solver.traces).toEqual([])
  expect(solver.visualize()).toEqual(initial)
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(fixedLines(solver.visualize())).toEqual(fixedLines(initial))
  expect(solver.visualize().rects).toEqual(initial.rects)
})
