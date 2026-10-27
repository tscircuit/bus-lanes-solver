import { expect, spyOn, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { loadNativeGroupFixture } from "../scripts/native-group-fixtures"

test("a native DDR request stops at its elapsed budget without accepting partial copper", () => {
  const { input } = loadNativeGroupFixture("ram-minus29")
  const clock = spyOn(performance, "now").mockReturnValue(100)
  try {
    const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 5 })
    clock.mockReturnValue(106)
    solver.step()
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.failureCode).toBe("routing_timeout")
    expect(solver.traces).toHaveLength(0)
  } finally {
    clock.mockRestore()
  }
})
