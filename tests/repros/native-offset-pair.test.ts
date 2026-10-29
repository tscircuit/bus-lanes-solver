import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { offsetNativePair } from "../fixtures/offset-native-pair"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"
import { pairLengthReports } from "../../lib/route-lengths"

test("reproduces missing automatic centerlines for offset native packages", async () => {
  const input = offsetNativePair(),
    before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: 20000 })
  solver.solve()
  if (solver.solved) {
    const native = {
      inputSrj: input,
      routedSrj: solver.getOutput(),
    } as Parameters<typeof validateRoutedCopperDrc>[0]
    expect(validateOriginalEndpointConnectivity(native).valid).toBe(true)
    expect(validateRoutedCopperDrc({ ...native, clearance: 0.1 }).valid).toBe(
      true,
    )
    expect(
      pairLengthReports(input, solver.traces).every((r) => r.matched),
    ).toBe(true)
    expect(
      exteriorPairSpacingReports(input, solver.traces).every((r) => r.matched),
    ).toBe(true)
  }
  const circuit = nativePairCircuit(
    input,
    solver.solved ? solver.traces : [],
    solver.solved
      ? "Offset pair: 2/2 connected"
      : "Offset pair: FAILED - no accepted copper",
  )
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, {
    width: 1000,
    height: 650,
    showSolderMask: false,
    hiddenLayerOpacity: 1,
    xRayElementIds: circuit
      .filter((e) => e.type === "pcb_trace" || e.type === "pcb_smtpad")
      .map((e: any) => e.pcb_trace_id ?? e.pcb_smtpad_id),
  })
  expect(solver.error).toBe(
    "Error: Provide paired centerlines for diagonal native packages",
  )
  expect(solver.failureCode).toBe("native_single_carrier_matching_failed")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.traces).toHaveLength(0)
  expect(input).toEqual(before)
}, 30000)
