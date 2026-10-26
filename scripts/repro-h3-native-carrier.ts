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
  return { solver, inputUnchanged: JSON.stringify(input) === original, validation, svg }
}
