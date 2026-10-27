import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { BusLanesPipelineSolver } from "../lib"
import {
  am3352OneGbOuterLayersInputSha256,
  am3352OneGbOuterLayersMetadata,
  am3352OneGbOuterLayersRecordedBundleSha256,
  loadAm3352OneGbOuterLayersInput,
} from "./load-am3352-1gb-outer-layers"

interface Options {
  steps: number
  seconds: number
  recordedBundle?: string
  outputDirectory: string
  worker: boolean
}

function parseOptions(): Options {
  const options: Options = {
    steps: 10_000,
    seconds: 30,
    outputDirectory: resolve(
      ".cache/repros/am3352-1gb-outer-layers",
      new Date().toISOString().replaceAll(":", "-"),
    ),
    worker: false,
  }
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === "--worker") {
      options.worker = true
      continue
    }
    if (
      ![
        "--steps",
        "--seconds",
        "--recorded-bundle",
        "--output-directory",
      ].includes(flag)
    )
      throw Error(`Unknown option: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith("--")) throw Error(`Missing ${flag}`)
    if (flag === "--steps") {
      options.steps = Number(value)
      if (!Number.isSafeInteger(options.steps) || options.steps <= 0)
        throw Error("--steps must be a positive integer")
    } else if (flag === "--seconds") {
      options.seconds = Number(value)
      if (!Number.isFinite(options.seconds) || options.seconds <= 0)
        throw Error("--seconds must be positive and finite")
    } else if (flag === "--recorded-bundle")
      options.recordedBundle = resolve(value)
    else options.outputDirectory = resolve(value)
  }
  return options
}

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
const signalNames = new Map<string, string>(
  Object.entries(am3352OneGbOuterLayersMetadata.signalNames),
)
const readable = (message: string | null | undefined) =>
  message?.replace(
    /\bsource_trace_\d+\b/g,
    (id) => signalNames.get(id) ?? "unnamed DDR connection",
  ) ?? null

async function runWorker(options: Options) {
  let Solver: typeof BusLanesPipelineSolver
  let implementation: {
    kind: string
    version: string
    bundleSha256?: string
    gitRevision?: string
    solverSourceDirty?: boolean | null
  }
  if (options.recordedBundle) {
    const bundleSha256 = hash(await readFile(options.recordedBundle))
    if (bundleSha256 !== am3352OneGbOuterLayersRecordedBundleSha256)
      throw Error(
        "Recorded bundle hash mismatch; use the original bus-lanes-solver 0.0.35 dist/index.js",
      )
    const module = await import(pathToFileURL(options.recordedBundle).href)
    if (typeof module.BusLanesPipelineSolver !== "function")
      throw Error("The recorded bundle does not export BusLanesPipelineSolver")
    Solver = module.BusLanesPipelineSolver
    implementation = {
      kind: "recorded_package",
      version: "0.0.35",
      bundleSha256,
    }
  } else {
    Solver = (await import("../lib")).BusLanesPipelineSolver
    const pkg = await import("../package.json")
    let gitRevision = "unavailable"
    let solverSourceDirty: boolean | null = null
    try {
      gitRevision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      solverSourceDirty = Boolean(
        execFileSync(
          "git",
          ["status", "--porcelain", "--untracked-files=normal", "--", "lib"],
          {
            cwd: new URL("../", import.meta.url),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).trim(),
      )
    } catch {}
    implementation = {
      kind: "local_source",
      version: pkg.version,
      gitRevision,
      solverSourceDirty,
    }
  }
  const input = loadAm3352OneGbOuterLayersInput()
  const before = hash(JSON.stringify(input))
  const solver = new Solver(input, { goal: "matched" })
  const started = performance.now()
  let lastReport = started
  const report = () => ({
    case: "am3352-1gb-outer-layers",
    nativeInputSha256: am3352OneGbOuterLayersInputSha256,
    implementation,
    solverOptions: { goal: "matched" },
    stepBudget: options.steps,
    secondsBudget: options.seconds,
    runtimeMs: performance.now() - started,
    iterations: solver.iterations,
    phase: solver.phase,
    solved: solver.solved,
    failed: solver.failed,
    failureCode: solver.failureCode,
    error: readable(solver.error),
    requestedSignals: input.connections.length,
    acceptedSignalRoutes: solver.solved ? solver.traces.length : 0,
    provisionalTraceCount: solver.traces.length,
    stats: solver.stats,
  })
  while (
    !solver.solved &&
    !solver.failed &&
    solver.iterations < options.steps &&
    performance.now() - started < options.seconds * 1000
  ) {
    solver.step()
    if (performance.now() - lastReport >= 1000) {
      console.log(`PROGRESS ${JSON.stringify(report())}`)
      lastReport = performance.now()
    }
    await new Promise<void>((complete) => setImmediate(complete))
  }
  const inputUnchanged = hash(JSON.stringify(input)) === before
  return {
    ...report(),
    status: !inputUnchanged
      ? "input_mutated"
      : solver.solved
        ? "solver_completed"
        : solver.failed
          ? "solver_failed"
          : solver.iterations >= options.steps
            ? "step_budget_exhausted"
            : "wall_time_budget_reached",
    inputUnchanged,
    electricalAcceptanceVerified: false,
    note: "Signal-only repro. Native completion is not independent DDR electrical or manufacturing acceptance.",
  }
}

async function main() {
  const options = parseOptions()
  if (options.worker) {
    console.log(`REPORT ${JSON.stringify(await runWorker(options))}`)
    return
  }
  await mkdir(options.outputDirectory, { recursive: true })
  const child = Bun.spawn(
    [
      process.execPath,
      import.meta.path,
      "--worker",
      "--steps",
      String(options.steps),
      "--seconds",
      String(options.seconds),
      ...(options.recordedBundle
        ? ["--recorded-bundle", options.recordedBundle]
        : []),
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  let killed = false
  const timer = setTimeout(
    () => {
      killed = true
      child.kill("SIGKILL")
    },
    (options.seconds + 5) * 1000,
  )
  const stdout: string[] = []
  const consumeStdout = async () => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) {
      const text = decoder.decode(chunk, { stream: true })
      stdout.push(text)
      process.stdout.write(text)
    }
    stdout.push(decoder.decode())
  }
  const [, stderr, exitCode] = await Promise.all([
    consumeStdout(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  const lines = stdout.join("").split("\n")
  const completed = lines.find((line) => line.startsWith("REPORT "))
  const lastProgress = lines
    .filter((line) => line.startsWith("PROGRESS "))
    .at(-1)
  const result =
    exitCode === 0 && completed
      ? JSON.parse(completed.slice(7))
      : {
          ...(lastProgress ? JSON.parse(lastProgress.slice(9)) : {}),
          case: "am3352-1gb-outer-layers",
          nativeInputSha256: am3352OneGbOuterLayersInputSha256,
          stepBudget: options.steps,
          secondsBudget: options.seconds,
          status: killed ? "worker_wall_time_limit" : "worker_error",
          acceptedSignalRoutes: 0,
          error: stderr.trim() || "Worker exited without a result",
        }
  await writeFile(
    resolve(options.outputDirectory, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  await writeFile(
    resolve(options.outputDirectory, "stdout.log"),
    stdout.join(""),
  )
  await writeFile(resolve(options.outputDirectory, "stderr.log"), stderr)
  console.log(`RESULT ${JSON.stringify(result)}`)
  console.log(`Diagnostics: ${options.outputDirectory}`)
  process.exitCode =
    result.status === "solver_completed" && result.inputUnchanged
      ? 0
      : [
            "step_budget_exhausted",
            "wall_time_budget_reached",
            "worker_wall_time_limit",
          ].includes(result.status)
        ? 2
        : 1
}

if (import.meta.main) await main()
