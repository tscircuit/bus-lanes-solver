import { BusLanesSolver } from "../lib"
import { Glob } from "bun"
const reports = []
for await (const file of new Glob("tests/fixtures/*.json").scan(".")) {
  const input = await Bun.file(file).json(),
    solver = new BusLanesSolver(input, {
      gridStep: 0.1,
      maxSearchIterations: 10000,
    })
  const start = performance.now()
  solver.solve()
  const report = {
    file,
    solved: solver.solved,
    error: solver.error,
    failureCode: solver.failureCode,
    iterations: solver.iterations,
    routedLanes: solver.traces.length,
    milliseconds: performance.now() - start,
  }
  reports.push(report)
  console.log(JSON.stringify(report))
  if (
    file.endsWith("-raw.json") &&
    solver.failureCode !== "layer_change_required"
  )
    throw Error("Raw mixed-layer fixture must fail explicitly")
  if (
    solver.solved &&
    solver.traces.flatMap((t) => t.route).some((p) => p.route_type !== "wire")
  )
    throw Error("Via invariant broken")
}
await Bun.write("fixture-results.json", JSON.stringify(reports, null, 2))
