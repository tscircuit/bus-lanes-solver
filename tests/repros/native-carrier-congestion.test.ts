import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { nativeCarrierCongestion } from "../fixtures/native-carrier-congestion"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("a matched primary cannot hide a clear permitted alternative", async () => {
  const { input, options } = nativeCarrierCongestion()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expectCompletedRouting(solver, before)
  expect(solver.stats.nativeSingleCarrier).toMatchObject({
    stage: "native_global_matching",
    pass: 0,
    collisions: 0,
  })
  for (const [name, layer] of [
    ["DQ", "inner1"],
    ["DQ2", "bottom"],
  ])
    expect(
      solver.traces
        .find((trace) => trace.connection_name === name)!
        .route.some(
          (point) => point.route_type === "wire" && point.layer === layer,
        ),
    ).toBe(true)
  expect(
    pairCouplingReports(input, solver.traces).every((report) => report.matched),
  ).toBe(true)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1100,
      height: 750,
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
}, 20000)

test("matched but colliding primary copper remains unacceptable without an alternative", () => {
  const { input, options } = nativeCarrierCongestion()
  options.singleCarrier.ordinaryCarrierLayers = ["inner1"]
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(input).toEqual(before)
}, 20000)
