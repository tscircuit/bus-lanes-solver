import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { BusLanesPipelineSolver } from "../lib"
import { am3352Carrier } from "./am3352-carrier"
import {
  COUPLED_OFFSET_SAMPLE_NAME,
  createCoupledOffsetShorteningInput,
  validateCoupledOffsetShorteningSample,
} from "./coupled-offset-shortening-sample"
import sampleNames from "./pr-benchmark/samples.json"
import {
  am3352Hash,
  am3352SamplePlacements,
  loadAm3352Sample,
} from "./am3352-samples"
import {
  validateAm3352OutputShape,
  validateAm3352Sample,
} from "./validate-am3352-sample"

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw Error(`Missing value for ${name}`)
  return args[index + 1]
}
const workerName = option("--worker")
// PR comparisons share this trusted harness and fixture set across revisions.
const solverModulePath = option("--solver")
const outputPath = option("--output") ?? "benchmark-results.json"
const routeOption = option("--routes-directory")
const routesDirectory = routeOption ? resolve(routeOption) : undefined
const timeoutSeconds = Number(option("--timeout-seconds") ?? 3600)
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
  throw Error("--timeout-seconds must be a positive finite number")
for (let i = 0; i < args.length; i++) {
  if (
    [
      "--worker",
      "--solver",
      "--timeout-seconds",
      "--output",
      "--routes-directory",
    ].includes(args[i])
  )
    i++
  else if (args[i] !== "--require-all-solved")
    throw Error(`Unknown option: ${args[i]}`)
}

const samples = sampleNames.map((name) => {
  const placement = am3352SamplePlacements.find((p) => p.name === name)
  if (placement) return { name, placement, requestedSignals: 47 }
  if (name === COUPLED_OFFSET_SAMPLE_NAME)
    return { name, placement: null, requestedSignals: 2 }
  throw Error(`Unknown benchmark sample: ${name}`)
})
type ValidationReport =
  | Awaited<ReturnType<typeof validateAm3352Sample>>
  | Awaited<ReturnType<typeof validateCoupledOffsetShorteningSample>>
type BenchmarkStatus = "solved" | "failed" | "timed_out" | "validation_failed"
interface BenchmarkReport {
  sample: string
  cpu: { x: number; y: number } | null
  ram: { x: number; y: number } | null
  allowedLayers: string[] | null
  carrierLayerCounts: Record<string, number>
  status: BenchmarkStatus
  solved: boolean
  timeoutSeconds: number
  solveMilliseconds: number
  milliseconds: number
  iterations: number
  envelopeOptimization?: {
    beforeAreaMm2: number
    afterAreaMm2: number
    milliseconds: number
  }
  requestedSignals: number
  routedSignals: number
  fixedPowerDogbones: number
  inputUnchanged: boolean
  fixedPowerPreserved: boolean
  inputSha256: string | null
  failureCode: string | null
  error: string | null
  validation: ValidationReport | null
}

const sample = workerName
  ? samples.find((s) => s.name === workerName)
  : undefined
const placement = sample?.placement
const reducedPair = sample?.name === COUPLED_OFFSET_SAMPLE_NAME
if (workerName && !sample)
  throw Error(`Unknown benchmark sample: ${workerName}`)

if (!workerName) {
  const reports: BenchmarkReport[] = []
  let invalidRun = false
  // All declared cases, serially, in fresh processes. Keep failed routing in
  // the score and continue collecting the remaining cases.
  for (const sample of samples) {
    const placement = sample.placement
    const workerStart = performance.now()
    const child = Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        "--worker",
        sample.name,
        "--timeout-seconds",
        String(timeoutSeconds),
        ...(solverModulePath ? ["--solver", resolve(solverModulePath)] : []),
        ...(routesDirectory ? ["--routes-directory", routesDirectory] : []),
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    let killed = false
    const deadline = setTimeout(
      () => {
        killed = true
        child.kill()
      },
      (timeoutSeconds + 15) * 1000,
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(deadline)
    const serialized = stdout
      .split("\n")
      .find((line) => line.startsWith("REPORT "))
    const workerFailure = (
      error: string,
      status: BenchmarkStatus = "validation_failed",
    ): BenchmarkReport => ({
      sample: sample.name,
      cpu: placement ? { x: 0, y: 0 } : null,
      ram: placement?.ram ?? null,
      allowedLayers:
        placement && "allowedLayers" in placement
          ? [...placement.allowedLayers]
          : null,
      carrierLayerCounts: {},
      status,
      solved: false,
      timeoutSeconds,
      solveMilliseconds: 0,
      milliseconds: performance.now() - workerStart,
      iterations: 0,
      requestedSignals: sample.requestedSignals,
      routedSignals: 0,
      fixedPowerDogbones: 0,
      inputUnchanged: false,
      fixedPowerPreserved: false,
      inputSha256: null,
      failureCode: null,
      error,
      validation: null,
    })
    if (!serialized) {
      invalidRun = true
      reports.push(
        workerFailure(
          killed
            ? "Worker exceeded its process deadline"
            : stderr || stdout || `Worker exited ${exitCode}`,
          killed ? "timed_out" : "validation_failed",
        ),
      )
    } else {
      try {
        const report: BenchmarkReport = JSON.parse(serialized.slice(7))
        if (report.sample !== sample.name)
          throw Error("Worker reported wrong sample")
        invalidRun ||= exitCode !== 0 || report.status === "validation_failed"
        reports.push(report)
      } catch (error) {
        invalidRun = true
        reports.push(workerFailure(`Invalid worker report: ${String(error)}`))
      }
    }
    const report = reports.at(-1)!
    console.log(
      `${report.solved ? "PASS" : "FAIL"} ${report.sample} ${report.ram ? `RAM=(${report.ram.x},${report.ram.y})` : "reduced pair"} ${report.routedSignals}/${report.requestedSignals} signals ${(report.solveMilliseconds / 1000).toFixed(3)}s ${report.solved ? "DRC + matching passed" : (report.error ?? report.status)}`,
    )
    if (report.envelopeOptimization) {
      const { beforeAreaMm2, afterAreaMm2, milliseconds } =
        report.envelopeOptimization
      console.log(
        `  envelope=${beforeAreaMm2.toFixed(3)} -> ${afterAreaMm2.toFixed(3)}mm² reduction=${(100 * (1 - afterAreaMm2 / beforeAreaMm2)).toFixed(2)}% optimization=${(milliseconds / 1000).toFixed(3)}s`,
      )
    }
    const quality = report.validation?.quality
    if (quality)
      console.log(
        `  copper=${quality.totalPlanarLengthMm.toFixed(3)}mm max/mean detour=${quality.maxDetourRatio?.toFixed(3)}/${quality.meanDetourRatio?.toFixed(3)} turns=${quality.ordinaryTurns} short_jogs=${quality.shortJogs} acute=${quality.acuteCorners} signal_area=${quality.footprint.bounds?.areaMm2.toFixed(3)}mm² all_copper_area=${quality.footprint.allCopperBounds?.areaMm2.toFixed(3)}mm² middle_offset=${quality.footprint.middleRegionMaxCenterOffsetMm?.toFixed(3)}mm`,
      )
    if (quality?.footprint.middleRegionVacancy) {
      const vacancy = quality.footprint.middleRegionVacancy
      console.log(
        `  middle_envelope=${vacancy.envelopeAreaMm2.toFixed(3)}mm² free_inside=${vacancy.unoccupiedAreaMm2.toFixed(3)}mm² (clearance-aware grid)`,
      )
    }
  }
  await Bun.write(outputPath, JSON.stringify(reports, null, 2) + "\n")
  console.log(
    `Benchmark cases completed: ${reports.filter((report) => report.solved).length}/${samples.length}; results: ${outputPath}`,
  )
  // Exhausted searches are measured outcomes. Corrupt fixtures, crashes and
  // invalid completed copper fail the command. Optional strict mode requires
  // all declared cases to solve; failures are never counted as passes.
  process.exit(
    invalidRun ||
      (args.includes("--require-all-solved") &&
        reports.some((report) => !report.solved))
      ? 1
      : 0,
  )
}

const start = performance.now()
let report: BenchmarkReport = {
  sample: sample!.name,
  cpu: placement ? { x: 0, y: 0 } : null,
  ram: placement?.ram ?? null,
  allowedLayers:
    placement && "allowedLayers" in placement
      ? [...placement.allowedLayers]
      : null,
  carrierLayerCounts: {},
  status: "validation_failed",
  solved: false,
  timeoutSeconds,
  solveMilliseconds: 0,
  milliseconds: 0,
  iterations: 0,
  requestedSignals: sample!.requestedSignals,
  routedSignals: 0,
  fixedPowerDogbones: 0,
  inputUnchanged: false,
  fixedPowerPreserved: false,
  inputSha256: null,
  failureCode: null,
  error: null,
  validation: null,
}
try {
  const { input, metadata } = reducedPair
    ? { input: createCoupledOffsetShorteningInput(), metadata: null }
    : await loadAm3352Sample(placement!.name)
  const validate = (traces?: typeof input.traces) =>
    metadata
      ? validateAm3352Sample(input, metadata, traces)
      : validateCoupledOffsetShorteningSample(input, traces)
  report.requestedSignals = input.connections.length
  report.fixedPowerDogbones = input.traces?.length ?? 0
  report.validation = await validate()
  if (!report.validation.fixedDrc.valid)
    throw Error("Pre-dogboned power copper failed DRC")
  const before = JSON.stringify(input)
  report.inputSha256 = am3352Hash(input)
  const fixedBefore = JSON.stringify(input.traces ?? [])
  const solverModule = solverModulePath
    ? await import(resolve(solverModulePath))
    : { BusLanesPipelineSolver }
  const solver: BusLanesPipelineSolver =
    new solverModule.BusLanesPipelineSolver(
      input,
      reducedPair
        ? { fanout: "none" }
        : { singleCarrier: { fixedConnections: metadata!.powerConnections } },
    )
  const solveStart = performance.now()
  while (!solver.solved && !solver.failed) {
    if (performance.now() - solveStart >= timeoutSeconds * 1000) break
    solver.step()
  }
  report.solveMilliseconds = performance.now() - solveStart
  report.iterations = solver.iterations
  report.envelopeOptimization = solver.stats.envelopeOptimization
  report.routedSignals = solver.traces.length
  report.failureCode = solver.failureCode
  report.inputUnchanged = JSON.stringify(input) === before
  report.fixedPowerPreserved =
    JSON.stringify(solver.input.traces ?? []) === fixedBefore
  if (!report.inputUnchanged || !report.fixedPowerPreserved)
    throw Error("Routing changed immutable input or power dogbones")
  if (report.solveMilliseconds >= timeoutSeconds * 1000) {
    report.status = "timed_out"
    report.error = `Routing exceeded ${timeoutSeconds} seconds`
  } else if (!solver.solved || solver.failed) {
    report.status = "failed"
    report.error = solver.error ?? "Routing failed"
  } else {
    report.validation = await validate(solver.traces)
    const output = solver.getOutput()
    if (metadata)
      validateAm3352OutputShape(input, metadata, solver.traces, output)
    else if (
      output.traces?.length !== 2 ||
      am3352Hash(output.traces) !== am3352Hash(solver.traces) ||
      am3352Hash({ ...output, traces: undefined }) !==
        am3352Hash({ ...input, traces: undefined })
    )
      throw Error("Reduced pair output changed its input or routed traces")
    report.fixedPowerPreserved &&=
      JSON.stringify(output.traces.slice(0, input.traces?.length ?? 0)) ===
      fixedBefore
    if (!report.fixedPowerPreserved)
      throw Error("Output changed immutable power dogbones")
    if (reducedPair) report.carrierLayerCounts.top = solver.traces.length
    else
      for (const trace of solver.traces) {
        const carrier = am3352Carrier(trace)
        if (carrier)
          report.carrierLayerCounts[carrier.layer] =
            (report.carrierLayerCounts[carrier.layer] ?? 0) + 1
      }
    report.solved = report.validation.valid
    report.status = report.solved ? "solved" : "validation_failed"
    report.error = report.solved
      ? null
      : report.validation.issues.length
        ? report.validation.issues.join("; ")
        : "Completed routing failed connectivity, DRC, matching, or coupling validation"
    // Retain only audited, successfully completed native routes for snapshot
    // export. Diagnostic partial states never enter this directory.
    if (routesDirectory && report.solved) {
      await mkdir(routesDirectory, { recursive: true })
      await Bun.write(
        join(routesDirectory, `${sample!.name}.json`),
        JSON.stringify({
          sample: sample!.name,
          solved: solver.solved,
          failed: solver.failed,
          error: solver.error,
          input: solver.input,
          traces: solver.traces,
          output,
          validation: report.validation,
        }),
      )
    }
  }
} catch (error) {
  report.status = "validation_failed"
  report.solved = false
  report.error = error instanceof Error ? error.message : String(error)
}
report.milliseconds = performance.now() - start
console.log("REPORT " + JSON.stringify(report))
if (
  report.status === "validation_failed" ||
  (args.includes("--require-all-solved") && !report.solved)
)
  process.exitCode = 1
