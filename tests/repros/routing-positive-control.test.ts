import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { boardOutlineInput } from "../fixtures/board-outline"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("the rectangular positive control supplies completed-only repro visuals", async () => {
  const input = boardOutlineInput()
  delete input.outline
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 900, height: 800, showSolderMask: false },
  })
})
