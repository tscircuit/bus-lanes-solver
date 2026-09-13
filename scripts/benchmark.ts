import { Glob } from "bun"
import { BusLanesSolver, type SimpleRouteJson } from "../lib"
const files = Array.from(
  new Glob("tests/fixtures/ddr_*.json").scanSync("."),
).sort()
if (!files.length) throw Error("No DDR samples found")
const reports = []
for (const file of files) {
  const input: SimpleRouteJson = await Bun.file(file).json()
  const before = JSON.stringify(input)
  const solver = new BusLanesSolver(input)
  const start = performance.now()
  solver.solve()
  if (JSON.stringify(input) !== before) throw Error("Benchmark input mutated")
  const negative = file.endsWith("-raw.json")
  const valid =
    solver.solved &&
    solver.traces.length === input.connections.length &&
    input.connections.every((c) => {
      const routes = solver.traces.filter((t) => t.connection_name === c.name)
      if (routes.length !== 1 || routes[0].route.length < 2) return false
      const first = routes[0].route[0],
        last = routes[0].route.at(-1)!
      const [a, b] = c.pointsToConnect
      const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
        Math.hypot(p.x - q.x, p.y - q.y) < 1e-8
      return (
        (same(first, a) && same(last, b)) || (same(first, b) && same(last, a))
      )
    }) &&
    solver.traces.every((t) =>
      t.route.every(
        (p) =>
          p.route_type === "wire" &&
          p.layer ===
            input.connections.find((c) => c.name === t.connection_name)!
              .pointsToConnect[0].layer,
      ),
    )
  const report = {
    file,
    expectedRejection: negative,
    solved: valid,
    failureCode: solver.failureCode,
    error: solver.error,
    iterations: solver.iterations,
    attempts: Number(solver.stats.attempt ?? 0) + 1,
    routedLanes: solver.traces.length,
    milliseconds: Math.round(performance.now() - start),
  }
  reports.push(report)
  console.log(
    `${negative ? (solver.failureCode === "layer_change_required" ? "REJECT OK" : "REJECT FAIL") : valid ? "PASS" : "FAIL"} ${file.split("/").at(-1)} ${report.routedLanes}/${input.connections.length} lanes ${report.milliseconds}ms ${report.failureCode ?? ""}`,
  )
}
const positives = reports.filter((r) => !r.expectedRejection),
  negatives = reports.filter((r) => r.expectedRejection)
console.log(
  `Legacy carrier-prefix samples solved: ${positives.filter((r) => r.solved).length}/${positives.length}; expected layer-change rejections: ${negatives.filter((r) => r.failureCode === "layer_change_required").length}/${negatives.length}`,
)
await Bun.write(
  "benchmark-results.json",
  `${JSON.stringify(reports, null, 2)}\n`,
)
if (
  positives.some((r) => !r.solved) ||
  negatives.some((r) => r.failureCode !== "layer_change_required")
)
  process.exitCode = 1
