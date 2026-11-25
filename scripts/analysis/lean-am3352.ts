import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const [baseRoot, solverPath, sample, budget] = process.argv.slice(2)
const { loadAm3352Sample } = await import(join(baseRoot, "scripts/am3352-samples.ts"))
const { input, metadata } = await loadAm3352Sample(sample)
const before = JSON.stringify(input)
const { BusLanesPipelineSolver } = await import(solverPath)
const solver = new BusLanesPipelineSolver(input, {
  singleCarrier: { fixedConnections: metadata.powerConnections },
})
const started = performance.now()
while (!solver.solved && !solver.failed) {
  if (performance.now() - started >= Number(budget) * 1000) break
  solver.step()
}
const solveMilliseconds = performance.now() - started
// Trusted validation loads after the measured solve; it cannot warm or retain
// a second solver tree before either distribution package runs.
const { validateAm3352Sample, validateAm3352OutputShape } = await import(
  join(baseRoot, "scripts/validate-am3352-sample.ts")
)
if (JSON.stringify(input) !== before) throw Error("Solver changed input")
const validation = await validateAm3352Sample(input, metadata, solver.traces)
validateAm3352OutputShape(input, metadata, solver.traces, solver.getOutput())
if (!solver.solved || !validation.valid) throw Error("Fresh solve was not accepted")
console.log("REPORT " + JSON.stringify({
  sample,
  solved: true,
  solveMilliseconds,
  iterations: solver.iterations,
  inputSha256: createHash("sha256").update(before).digest("hex"),
  bundleSha256: createHash("sha256").update(readFileSync(solverPath)).digest("hex"),
  validation,
}))
