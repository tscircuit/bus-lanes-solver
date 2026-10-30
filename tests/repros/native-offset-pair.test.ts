import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { offsetNativePair } from "../fixtures/offset-native-pair"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

for (const explicitGap of [true, false]) {
  test(`offset packages require manual centerlines with ${explicitGap ? "explicit" : "default"} pair gap`, () => {
    const input = offsetNativePair()
    if (!explicitGap) delete input.differentialPairs![0].traceGap
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
    })
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toBe(
      "Error: Provide paired centerlines for diagonal native packages",
    )
    expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
    expect(solver.traces).toHaveLength(0)
    expect(input).toEqual(before)
  }, 30000)
}

test("the aligned-package positive control completes with unchanged copper", async () => {
  const input = offsetNativePair()
  for (const connection of input.connections) {
    const target = connection.pointsToConnect[1]
    const pad = input.obstacles.find(
      (obstacle) =>
        obstacle.center.x === target.x && obstacle.center.y === target.y,
    )!
    target.y -= 2
    pad.center.y -= 2
  }
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "aligned-control",
    svgOptions: {
      width: 1000,
      height: 650,
      showSolderMask: false,
      hiddenLayerOpacity: 1,
      xRayElementIds: circuit.flatMap((element) =>
        element.type === "pcb_trace"
          ? [element.pcb_trace_id]
          : element.type === "pcb_smtpad"
            ? [element.pcb_smtpad_id]
            : [],
      ),
    },
  })
}, 30000)
