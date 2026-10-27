import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  loadNativeGroupFixture,
  type NativeGroupSample,
} from "./native-group-fixtures"
import { validateNativeGroups } from "./validate-native-groups"
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}
const sample = option("--sample", "ram-minus29") as NativeGroupSample
if (!["ram-minus29", "ram-minus25"].includes(sample))
  throw Error("Unknown native DDR sample")
const solverPath = resolve(
  option("--solver", new URL("../lib/index.ts", import.meta.url).pathname),
)
const output = resolve(option("--output", `.cache/native-groups/${sample}`))
const budget = Number(option("--timeout-seconds", "300")) * 1000
if (!Number.isFinite(budget) || budget <= 0)
  throw Error("Invalid routing budget")
await mkdir(output, { recursive: true })
if (!args.includes("--worker")) {
  // A failed rerun must never reuse an earlier successful report or route.
  await Promise.all(
    ["report.json", "routes.json.gz"].map((name) =>
      rm(join(output, name), { force: true }),
    ),
  )
  let timedOut = false,
    phase = "routing"
  const started = performance.now()
  const kill = () => {
    timedOut = true
    child.kill("SIGKILL")
  }
  let timer: ReturnType<typeof setTimeout>
  const child = Bun.spawn(
    [process.execPath, import.meta.path, ...args, "--worker"],
    {
      stdout: Bun.file(join(output, "stdout.log")),
      stderr: Bun.file(join(output, "stderr.log")),
      ipc(message: any) {
        if (message?.phase === "validation") {
          phase = "validation"
          clearTimeout(timer)
          timer = setTimeout(kill, 120000)
        }
      },
    },
  )
  timer = setTimeout(kill, budget + 5000)
  const exitCode = await child.exited
  clearTimeout(timer)
  if (timedOut)
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(
        {
          sample,
          status: "timed_out",
          phase,
          solverPath,
          budgetSeconds: budget / 1000,
          milliseconds: performance.now() - started,
          wholeBoardComplete: false,
        },
        null,
        2,
      ),
    )
  let reportText: string
  try {
    reportText = await readFile(join(output, "report.json"), "utf8")
  } catch {
    reportText = JSON.stringify(
      {
        sample,
        status: "worker_failed",
        exitCode,
        phase,
        solverPath,
        budgetSeconds: budget / 1000,
        wholeBoardComplete: false,
      },
      null,
      2,
    )
    await writeFile(join(output, "report.json"), reportText)
  }
  console.log(reportText)
  process.exit(exitCode === 0 && !timedOut ? 0 : 1)
}
const { input, native } = loadNativeGroupFixture(sample)
const before = JSON.stringify(input),
  inputSha256 = createHash("sha256").update(before).digest("hex")
const { BusLanesPipelineSolver } = await import(pathToFileURL(solverPath).href)
const solver = new BusLanesPipelineSolver(input, { maxRoutingTimeMs: budget })
const started = performance.now()
let last = started
while (
  !solver.solved &&
  !solver.failed &&
  performance.now() - started < budget
) {
  solver.step()
  if (performance.now() - last > 10000) {
    console.log(
      JSON.stringify({
        seconds: (performance.now() - started) / 1000,
        phase: solver.phase,
        iterations: solver.iterations,
      }),
    )
    last = performance.now()
  }
}
const solveMilliseconds = performance.now() - started
let validation = null
if (solver.solved) {
  process.send?.({ phase: "validation" })
  validation = await validateNativeGroups(input, native, solver.traces)
}
const status = solver.solved
  ? validation?.valid
    ? "solved"
    : "validation_failed"
  : solver.failureCode === "routing_timeout" || !solver.failed
    ? "timed_out"
    : "failed"
const solverDirectory = resolve(solverPath, "../..")
const report = {
  sample,
  status,
  scope: "all_47_ddr_connections",
  wholeBoardComplete: false,
  solverPath,
  solverRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: solverDirectory,
  })
    .toString()
    .trim(),
  solverDiffSha256: createHash("sha256")
    .update(
      execFileSync("git", ["diff", "HEAD", "--", "lib"], {
        cwd: solverDirectory,
      }),
    )
    .digest("hex"),
  runtime: Bun.version,
  budgetSeconds: budget / 1000,
  inputSha256,
  inputUnchanged: before === JSON.stringify(input),
  solveMilliseconds,
  totalMilliseconds: performance.now() - started,
  iterations: solver.iterations,
  routedConnections: solver.solved ? solver.traces.length : 0,
  error: solver.error,
  failureCode: solver.failureCode,
  stats: solver.stats,
  validation,
}
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2))
if (status === "solved" && report.inputUnchanged)
  await writeFile(
    join(output, "routes.json.gz"),
    gzipSync(JSON.stringify(solver.traces)),
  )
process.exit(status === "solved" && report.inputUnchanged ? 0 : 1)
