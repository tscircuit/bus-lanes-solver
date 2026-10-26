import { expect, spyOn, test } from "bun:test"
import { BusLanesPipelineSolver, BusLanesSolver } from "../lib"
import {
  busLengthReports,
  fixedRouteLength,
  pairLengthReports,
} from "../lib/route-lengths"
import { loadAm3352Sample } from "../scripts/am3352-samples"

test("a dense bus can converge beyond the old per-layer cutoff while retaining work for controls", async () => {
  const { input } = await loadAm3352Sample("control")
  const original = structuredClone(input)
  const stages: number[] = []
  const step = spyOn(BusLanesSolver.prototype, "_step").mockImplementation(
    function (this: BusLanesSolver) {
      // Model completion timing just after the old 200k cutoff. These
      // nonphysical triangles isolate scheduling, while respecting the real
      // full-copper bus/pair lengths, including generated fixed escapes.
      // The unconstrained control stage needs only one step.
      if (this.input.buses?.length && this.iterations < 200100) return
      stages.push(this.input.connections.length)
      this.traces = this.input.connections.map((connection) => {
        const [start, end] = connection.pointsToConnect
        const dx = end.x - start.x,
          dy = end.y - start.y,
          chord = Math.hypot(dx, dy)
        const carrierLength =
          100 - fixedRouteLength(this.input, connection.name)
        expect(carrierLength).toBeGreaterThan(chord)
        const height = Math.sqrt((carrierLength / 2) ** 2 - (chord / 2) ** 2)
        return {
          type: "pcb_trace",
          pcb_trace_id: `budget_test_${connection.name}`,
          connection_name: connection.name,
          route: [
            { ...start, route_type: "wire", width: this.input.minTraceWidth },
            {
              route_type: "wire",
              x: (start.x + end.x) / 2 - (dy / chord) * height,
              y: (start.y + end.y) / 2 + (dx / chord) * height,
              layer: start.layer,
              width: this.input.minTraceWidth,
            },
            { ...end, route_type: "wire", width: this.input.minTraceWidth },
          ],
        }
      })
      this.solved = true
    },
  )
  try {
    // Isolate the shared search budget from geometric post-processing.
    const solver = new BusLanesPipelineSolver(input, { smoothTuning: false })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(stages).toEqual([24, 23])
    expect(solver.iterations).toBeLessThan(solver.MAX_ITERATIONS)
    expect(
      busLengthReports(input, solver.traces).every((bus) => bus.matched),
    ).toBe(true)
    expect(
      pairLengthReports(input, solver.traces).every((pair) => pair.matched),
    ).toBe(true)
    expect(solver.getOutput().traces!.slice(0, 161)).toEqual(input.traces!)
    expect(input).toEqual(original)
  } finally {
    step.mockRestore()
  }
})

test("an explicit child search budget is retained across layer retries", async () => {
  const { input } = await loadAm3352Sample("control")
  const budgets: number[] = []
  const step = spyOn(BusLanesSolver.prototype, "_step").mockImplementation(
    function (this: BusLanesSolver) {
      budgets.push(this.MAX_ITERATIONS)
      this.failed = true
      this.error = "Unsatisfiable test scene"
    },
  )
  try {
    const solver = new BusLanesPipelineSolver(input, {
      maxSearchIterations: 73,
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(budgets).toEqual([73, 73, 73, 73])
    expect(solver.MAX_ITERATIONS).toBe(73 * input.layerCount)
  } finally {
    step.mockRestore()
  }
})
