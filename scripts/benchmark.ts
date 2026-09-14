import { validateFanoutProvenance } from "./validate-fanout-provenance"
import { validateTwoFanoutSample } from "./validate-two-fanout-sample"
import { Glob } from "bun"
import { BusLanesSolver, type SimpleRouteJson } from "../lib"
const workerFile = process.argv.includes("--worker")
  ? process.argv[process.argv.indexOf("--worker") + 1]
  : undefined
const timeoutSeconds = Number(
  process.argv.includes("--timeout-seconds")
    ? process.argv[process.argv.indexOf("--timeout-seconds") + 1]
    : 1,
)
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
  throw Error("Invalid timeout")
const legacy = process.argv.includes("--legacy")
const files = workerFile
  ? [workerFile]
  : legacy
    ? Array.from(new Glob("tests/fixtures/ddr_*.json").scanSync(".")).sort()
    : [
        ...Array.from(
          new Glob("tests/fixtures/two-fanouts/ddr_*.json").scanSync("."),
        ).filter((f) => !f.endsWith(".meta.json")),
        ...Array.from(new Glob("tests/fixtures/ddr_*-raw.json").scanSync(".")),
      ].sort()
if (!files.length) throw Error("No DDR samples found")
if (!legacy && !workerFile) {
  for (const profile of [
    "ddr_left_io_right",
    "ddr_right_io_left",
    "ddr_top_io_bottom",
    "ddr_bottom_io_top",
  ]) {
    if (!files.includes(`tests/fixtures/two-fanouts/${profile}.json`))
      throw Error(`Missing full DDR phase: ${profile}`)
  }
}
if (!workerFile) {
  const reports = await Promise.all(
    files.map(async (file) => {
      const child = Bun.spawn(
        [
          process.execPath,
          import.meta.path,
          "--worker",
          file,
          "--timeout-seconds",
          String(timeoutSeconds),
          ...(legacy ? ["--legacy"] : []),
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      await child.exited
      const serialized = stdout
        .split("\n")
        .find((line) => line.startsWith("REPORT "))
      if (!serialized) throw Error(`${file}: ${stderr || stdout}`)
      const report = JSON.parse(serialized.slice(7))
      console.log(
        `${report.expectedRejection ? (report.failureCode === "layer_change_required" ? "REJECT OK" : "REJECT FAIL") : report.solved ? "PASS" : "FAIL"} ${file.split("/").at(-1)} ${report.routedLanes}/33 ${report.timedOut ? "timeout" : (report.failureCode ?? "")}`,
      )
      return report
    }),
  )
  await Bun.write(
    legacy ? "legacy-benchmark-results.json" : "benchmark-results.json",
    JSON.stringify(reports, null, 2) + "\n",
  )
  const positives = reports.filter((r) => !r.expectedRejection),
    negatives = reports.filter((r) => r.expectedRejection)
  console.log(
    `Full DDR phases solved: ${positives.filter((r) => r.solved).length}/${positives.length}; expected layer-change rejections: ${negatives.filter((r) => r.failureCode === "layer_change_required").length}/${negatives.length}`,
  )
  process.exit(
    positives.some((r) => !r.solved) ||
      negatives.some((r) => r.failureCode !== "layer_change_required")
      ? 1
      : 0,
  )
}
const reports = []
for (const file of files) {
  const input: SimpleRouteJson = await Bun.file(file).json()
  const dataset =
    !legacy && !file.endsWith("-raw.json")
      ? validateTwoFanoutSample(
          input,
          await Bun.file(file.replace(".json", ".meta.json")).json(),
        )
      : undefined
  const provenance = dataset
    ? await validateFanoutProvenance(
        await Bun.file(file.replace(".json", ".meta.json")).json(),
      )
    : undefined
  const before = JSON.stringify(input)
  const solver = new BusLanesSolver(input)
  const start = performance.now()
  let timedOut = false
  while (!solver.solved && !solver.failed) {
    if (performance.now() - start >= timeoutSeconds * 1000) {
      timedOut = true
      break
    }
    solver.step()
  }
  const solveMilliseconds = performance.now() - start
  timedOut ||= solveMilliseconds > timeoutSeconds * 1000
  if (JSON.stringify(input) !== before) throw Error("Benchmark input mutated")
  const negative = file.endsWith("-raw.json")
  const valid =
    !timedOut &&
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
  if (valid && !legacy && !negative) {
    validateTwoFanoutSample(
      input,
      await Bun.file(file.replace(".json", ".meta.json")).json(),
      solver.traces,
    )
  }
  const report = {
    file,
    timedOut,
    timeoutSeconds,
    dataset,
    provenance,
    expectedRejection: negative,
    solved: valid,
    failureCode: solver.failureCode,
    error: solver.error,
    iterations: solver.iterations,
    attempts: Number(solver.stats.attempt ?? 0) + 1,
    routedLanes: solver.traces.length,
    solveMilliseconds: Math.round(solveMilliseconds),
    milliseconds: Math.round(performance.now() - start),
  }
  reports.push(report)
  console.log("REPORT " + JSON.stringify(report))
  console.log(
    `${negative ? (solver.failureCode === "layer_change_required" ? "REJECT OK" : "REJECT FAIL") : valid ? "PASS" : "FAIL"} ${file.split("/").at(-1)} ${report.routedLanes}/${input.connections.length} lanes ${report.milliseconds}ms ${report.failureCode ?? ""}`,
  )
}
