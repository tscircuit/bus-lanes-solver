import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { nativeOvalObstacle } from "../fixtures/native-oval-obstacle"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"

test("a rotated oval retains physically clear terminals outside its copper", async () => {
  const input = nativeOvalObstacle()
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 800,
      height: 800,
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
})

test("native validation still rejects copper crossing the oval body", () => {
  const input = nativeOvalObstacle()
  const native = toNativeValidationSrj(input)
  const report = validateRoutedCopperDrc({
    inputSrj: native,
    routedSrj: {
      ...native,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "illegal_crossing",
          connection_name: "signal",
          route: [
            { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "inner2" },
            { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner2" },
          ],
        },
      ],
    },
    clearance: 0.1,
  })
  expect(report.valid).toBe(false)
  expect(
    report.issues.some((issue) => issue.code === "trace-obstacle-clearance"),
  ).toBe(true)
})
