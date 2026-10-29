import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { boardOutlineInput } from "../fixtures/board-outline"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("a routed trace stays inside a concave board outline", async () => {
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
  expect(solver.solved).toBe(true)
  expect(solver.traces[0].route.some((p) => p.y < -1.2)).toBe(true)
})
