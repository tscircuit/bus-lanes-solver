import {
  populatedInput,
  solvePopulated,
} from "../../tests/fixtures/pixel-dash-am3354-populated"

const input = populatedInput()
const solver = solvePopulated(input)

if (!solver.solved) {
  console.error(solver.error)
  process.exitCode = 1
} else {
  const traces = solver.getOutput().traces
  const routed = new Set(traces.map((trace) => trace.connection_name))
  const missing = input.connections.filter((net) => !routed.has(net.name))
  console.log(
    `${input.connections.length - missing.length}/${input.connections.length} requested nets returned`,
  )
  if (missing.length || traces.length !== input.connections.length) {
    throw new Error(
      `Incomplete channel. Missing nets: ${missing.map((net) => net.name).join(", ")}`,
    )
  }
}
