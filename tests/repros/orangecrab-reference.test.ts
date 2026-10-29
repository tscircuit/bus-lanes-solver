import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { orangecrabCircuit } from "../fixtures/orangecrab"

test("the real OrangeCrab r0.2.1 PCB retains its original components and copper", async () => {
  const circuit = orangecrabCircuit()
  expect(circuit.filter((e) => e.type === "pcb_component")).toHaveLength(163)
  expect(circuit.filter((e) => e.type === "pcb_via")).toHaveLength(441)
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, {
    width: 1400,
    height: 700,
    showSolderMask: false,
    showCourtyards: false,
    showFabricationNotes: false,
  })
})
