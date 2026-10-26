import { mkdirSync, writeFileSync } from "node:fs"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { loadH3NativeCarrierInput } from "./load-h3-native-carrier"
import { snapshotH3NativeCarrier } from "./snapshot-h3-native-carrier"
import { validateH3NativeCarrier } from "./validate-h3-native-carrier"

export function runH3NativeCarrierRepro(): {
  solver: BusLanesPipelineSolver
  inputUnchanged: boolean
  validation: ReturnType<typeof validateH3NativeCarrier> | null
  svg: string
} {
  const input = loadH3NativeCarrierInput()
  const original = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input, { goal: "matched", smoothTuning: true, denseSearch: true, maxSearchIterations: 2_000_000 })
  solver.solve()
  const validation = solver.solved ? validateH3NativeCarrier({ input, output: solver.getOutput() }) : null
  const svg = snapshotH3NativeCarrier({ input, solver, validation })
  const directory = new URL("../docs/h3-native-carrier/", import.meta.url)
  mkdirSync(directory, { recursive: true })
  writeFileSync(new URL(solver.solved ? "completed.svg" : "source-failure.svg", directory), svg)
  return { solver, inputUnchanged: JSON.stringify(input) === original, validation, svg }
}

if (import.meta.main) {
  const report = runH3NativeCarrierRepro()
  console.log(JSON.stringify({ solved: report.solver.solved, failed: report.solver.failed, error: report.solver.error, validation: report.validation, inputUnchanged: report.inputUnchanged }, null, 2))
}
