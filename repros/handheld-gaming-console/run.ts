import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import {
  BusLanesPipelineSolver,
  busLengthReports,
  pairLengthReports,
  type SimpleRouteJson,
} from "../../lib"

const mode = process.argv[2] ?? "matched"
if (!["matched", "connectivity"].includes(mode))
  throw Error("Usage: bun run.ts [matched|connectivity]")
const dir = new URL("./", import.meta.url)
const raw = readFileSync(new URL("input.srj.json", dir))
const provenance = JSON.parse(
  readFileSync(new URL("provenance.json", dir), "utf8"),
)
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex")
if (sha(raw) !== provenance.input_sha256)
  throw Error("Immutable fixture hash mismatch")
const input: SimpleRouteJson = JSON.parse(raw.toString())
if (mode === "connectivity") input.allowedLayers = ["inner2"]
const original = JSON.stringify(input)
const options = {
  goal: mode as "matched" | "connectivity",
  maxRoutingTimeMs: 120_000,
  connectivity: {
    gridStep: 0.1,
    maxPasses: 300,
    maxExpansionsPerRoute: 300_000,
  },
}
rmSync(new URL(`results/${mode}.output.json`, dir), { force: true })
const start = performance.now()
let solver: BusLanesPipelineSolver | undefined
let exception: string | null = null
try {
  solver = new BusLanesPipelineSolver(input, options)
  while (
    !solver.solved &&
    !solver.failed &&
    performance.now() - start < options.maxRoutingTimeMs
  )
    solver.step()
} catch (e) {
  exception = String(e)
}
if (JSON.stringify(input) !== original)
  throw Error("Solver mutated supplied input")
const traces = solver?.traces ?? []
const names = new Set(traces.map((t) => t.connection_name))
const allRequestedReturned = input.connections.every((c) => names.has(c.name))
const report = {
  mode,
  status: exception
    ? "exception"
    : solver?.solved
      ? "solver_solved"
      : solver?.failed
        ? "solver_failed"
        : "budget_exhausted",
  error: exception ?? solver?.error ?? null,
  options,
  solverCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../../", dir),
    encoding: "utf8",
  }).trim(),
  solverVersion: JSON.parse(
    readFileSync(new URL("../../package.json", dir), "utf8"),
  ).version,
  runtime: process.versions,
  runtimeMs: performance.now() - start,
  fixtureSha256: sha(raw),
  effectiveInputSha256: sha(original),
  inputUnchanged: true,
  phase: solver?.phase,
  stats: solver?.stats,
  requestedSignals: input.connections.length,
  returnedTraces: traces.length,
  allRequestedReturned,
  busReports: busLengthReports(input, traces),
  pairReports: pairLengthReports(input, traces),
  nativeBoardDrcVerified: false,
  electricalTimingVerified: false,
  impedanceVerified: false,
  manufacturingRelease: false,
}
mkdirSync(new URL("results/", dir), { recursive: true })
writeFileSync(
  new URL(`results/${mode}.json`, dir),
  JSON.stringify(report, null, 2) + "\n",
)
writeFileSync(
  new URL(`results/${mode}.input.json`, dir),
  JSON.stringify(input, null, 2) + "\n",
)
// Only expose accepted solver output; never relabel internal candidates as completed copper.
if (solver?.solved && allRequestedReturned)
  writeFileSync(
    new URL(`results/${mode}.output.json`, dir),
    JSON.stringify({ ...input, traces }, null, 2) + "\n",
  )
console.log(
  JSON.stringify(
    {
      mode,
      status: report.status,
      error: report.error,
      stats: report.stats,
      returnedTraces: traces.length,
      runtimeMs: report.runtimeMs,
    },
    null,
    2,
  ),
)
process.exitCode = solver?.solved && allRequestedReturned ? 0 : 2
