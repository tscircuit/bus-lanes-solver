import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { pairOnlyInput } from "../fixtures/pair-only-length-target"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("pair-only bus reproduces exhausted plans from automatic tuning headroom", () => {
  const input = pairOnlyInput()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe(
    "Error: Native carrier matching exhausted its routing plans",
  )
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.traces).toHaveLength(0)
  expect(input).toEqual(before)
}, 30000)

test("the same pair without the bus target remains a completed positive control", async () => {
  const input = pairOnlyInput()
  input.buses = []
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "bus-free-control",
    svgOptions: {
      width: 1000,
      height: 450,
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
