import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { nativePairDetour } from "../fixtures/native-pair-detour"
import { offsetNativePair } from "../fixtures/offset-native-pair"

test("automatic pair planning misses a clear detour around a fixed wall", () => {
  const { input } = nativePairDetour()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    maxRoutingTimeMs: 20000,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 30000)

for (const control of ["direct", "explicit-detour"] as const)
  test(`the completed ${control} positive control passes every routing gate`, async () => {
    const fixture = nativePairDetour()
    const input = control === "direct" ? offsetNativePair() : fixture.input
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, {
      maxRoutingTimeMs: 20000,
      singleCarrier:
        control === "explicit-detour"
          ? { centerlines: fixture.centerlines }
          : undefined,
    })
    solver.solve()
    expectCompletedRouting(solver, before)
    expect(
      pairCouplingReports(input, solver.traces).every((pair) => pair.matched),
    ).toBe(true)
    const circuit = nativePairCircuit({ input, traces: solver.traces })
    await expect(circuit).toMatchPcbSnapshot({
      testPath: import.meta.path,
      snapshotName: control,
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
