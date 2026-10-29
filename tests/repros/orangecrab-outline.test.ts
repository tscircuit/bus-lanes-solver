import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import { orangecrabByte0, orangecrabCircuit } from "../fixtures/orangecrab"

test("reproduces rejection of the unchanged real OrangeCrab outline", async () => {
  const input = orangecrabByte0()
  const before = JSON.stringify(input)
  const circuit = orangecrabCircuit(true)
  expect(circuit.filter((e) => e.type === "pcb_via")).toHaveLength(419)
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, {
    width: 1400,
    height: 700,
    showSolderMask: false,
    showCourtyards: false,
    showFabricationNotes: false,
  })
  const solver = new BusLanesSolver(input)
  solver.step()
  expect(solver.error).toBe("Custom board outlines are unsupported")
  expect(solver.failureCode).toBe("unsupported_outline")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.traces).toHaveLength(0)
  expect(JSON.stringify(input)).toBe(before)
})
