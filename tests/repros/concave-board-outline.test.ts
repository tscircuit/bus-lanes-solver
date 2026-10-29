import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { boardOutlineInput } from "../fixtures/board-outline"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"

test("a complete route stays inside the concave board cutout", async () => {
  const input = boardOutlineInput()
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expectCompletedRouting(solver, before)
  expect(solver.traces[0].route.some((point) => point.y < -1.2)).toBe(true)
  const circuit = nativePairCircuit({
    input,
    traces: solver.traces,
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 900, height: 800, showSolderMask: false },
  })
})
