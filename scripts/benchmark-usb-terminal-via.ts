import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import { pairLengthReports } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"
const { BusLanesPipelineSolver } = await import(
  pathToFileURL(resolve(process.argv[2] ?? "lib/index.ts")).href
)
const raw = gunzipSync(
  readFileSync(
    new URL(
      "../tests/fixtures/usb-terminal-via/input.json.gz",
      import.meta.url,
    ),
  ),
)
const input = JSON.parse(raw.toString()),
  before = JSON.stringify(input),
  solver = new BusLanesPipelineSolver(input, {
    maxSearchIterations: 2_000_000,
  }),
  started = performance.now()
while (
  !solver.solved &&
  !solver.failed &&
  performance.now() - started < 3_600_000
) {
  solver.step()
  if (solver.iterations % 200 === 0)
    await new Promise((resolve) => setTimeout(resolve, 0))
}
const report = {
  solverRevision: Bun.spawnSync([
    "git",
    "-C",
    resolve(process.argv[2] ?? "lib/index.ts", "../.."),
    "rev-parse",
    "HEAD",
  ])
    .stdout.toString()
    .trim(),
  runtime: Bun.version,
  searchBudget: 2_000_000,
  wallBudgetSeconds: 3600,
  fixtureSha256: createHash("sha256").update(raw).digest("hex"),
  entry: process.argv[2] ?? "lib/index.ts",
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  seconds: (performance.now() - started) / 1000,
  iterations: solver.iterations,
  inputUnchanged: JSON.stringify(input) === before,
  carriers: solver.traces.length,
  terminalViaShortcuts: solver.traces
    .filter(
      (t: any) =>
        !createTerminalViaClearanceChecker(input, t, {
          preserveExistingApproach: false,
        })(t.route),
    )
    .map((t: any) => t.connection_name),
  pairs: pairLengthReports(input, solver.traces),
  coupling: pairCouplingReports(input, solver.traces),
}
const accepted =
  report.solved &&
  report.inputUnchanged &&
  report.carriers === 4 &&
  !report.terminalViaShortcuts.length &&
  report.pairs.every((p: any) => p.matched) &&
  report.coupling.every((p: any) => p.matched)
console.log(JSON.stringify({ ...report, accepted }, null, 2))
if (process.argv[3]) {
  mkdirSync(resolve(process.argv[3], ".."), { recursive: true })
  writeFileSync(
    process.argv[3],
    JSON.stringify({ ...report, accepted }, null, 2) + "\n",
  )
}
if (!accepted) process.exitCode = 1
