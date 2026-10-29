import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { boardOutlineInput } from "../fixtures/board-outline"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("reproduces rejection of a valid concave board outline", async () => {
  const input = boardOutlineInput()
  const solver = new BusLanesSolver(input)
  solver.solve()
  const circuit = nativePairCircuit(
    input,
    solver.solved ? solver.traces : [],
    solver.solved
      ? "Board cutout: 1/1 connected"
      : "Board cutout: FAILED - no accepted copper",
  )
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, {
    width: 900,
    height: 800,
    showSolderMask: false,
  })
  expect(solver.error).toBe("Custom board outlines are unsupported")
  expect(solver.failureCode).toBe("unsupported_outline")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.traces).toHaveLength(0)
})
