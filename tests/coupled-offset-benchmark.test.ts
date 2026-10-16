import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  COUPLED_OFFSET_SAMPLE_NAME,
  createCoupledOffsetShorteningInput,
  validateCoupledOffsetShorteningSample,
} from "../scripts/coupled-offset-shortening-sample"
import { runBenchmarkProcess } from "../scripts/pr-benchmark/run-pair"
import { validateCoupledOffsetSnapshot } from "../scripts/snapshot-coupled-offset-shortening"

const repository = resolve(import.meta.dir, "..")
const worker = join(repository, "scripts/benchmark.ts")
const sample = COUPLED_OFFSET_SAMPLE_NAME

test("the production reduced benchmark requires complete, audited native copper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coupled-offset-benchmark-"))
  try {
    const result = await runBenchmarkProcess(
      [
        worker,
        "--worker",
        sample,
        "--timeout-seconds",
        "5",
        "--require-all-solved",
        "--routes-directory",
        directory,
      ],
      repository,
      20_000,
    )
    expect(result.exitCode).toBe(0)
    expect(result.error).toBeNull()
    expect(result.report).toMatchObject({
      sample,
      status: "solved",
      solved: true,
      cpu: null,
      ram: null,
      requestedSignals: 2,
      routedSignals: 2,
      fixedPowerDogbones: 0,
      inputUnchanged: true,
      fixedPowerPreserved: true,
      validation: {
        valid: true,
        complete: true,
        matched: true,
        fixedPowerTraces: 0,
        fixedPowerVias: 0,
        fixedPowerPadJoins: 0,
        fixedDrc: { valid: true },
        combinedDrc: { valid: true },
        busLengths: [],
      },
    })
    const native = await Bun.file(join(directory, `${sample}.json`)).json()
    expect(native.input).toEqual(createCoupledOffsetShorteningInput())
    const audit = validateCoupledOffsetSnapshot(native)
    expect(audit.pairLengths).toHaveLength(1)
    expect(audit.pairLengths[0]).toMatchObject({
      busId: "pair_0",
      toleranceMm: 0.127,
      matched: true,
    })
    expect(audit.sharedSpacing[0].matched).toBe(true)
    expect(audit.coupling[0].matched).toBe(true)
    expect(validateCoupledOffsetShorteningSample(native.input, []).valid).toBe(
      false,
    )
    expect(() =>
      validateCoupledOffsetSnapshot({ ...native, failed: true }),
    ).toThrow()
    expect(() =>
      validateCoupledOffsetSnapshot({ ...native, solved: false }),
    ).toThrow()
    expect(() =>
      validateCoupledOffsetSnapshot({ ...native, traces: [] }),
    ).toThrow()
    for (const flags of [
      { solved: "false" },
      { failed: undefined },
      { error: undefined },
      { error: "" },
    ])
      expect(() =>
        validateCoupledOffsetSnapshot({ ...native, ...flags }),
      ).toThrow()
    const wrongEndpoint = structuredClone(native.traces)
    wrongEndpoint[0].route[0].x += 0.01
    expect(
      validateCoupledOffsetShorteningSample(native.input, wrongEndpoint).valid,
    ).toBe(false)
    const wrongWidth = structuredClone(native.traces)
    wrongWidth[0].route[0].width = 0.09
    expect(() =>
      validateCoupledOffsetShorteningSample(native.input, wrongWidth),
    ).toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 25_000)

test("the reduced worker uses the selected revision and never saves failed copper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coupled-offset-revision-"))
  try {
    const selected = join(directory, "selected.ts")
    for (const solved of [false, true]) {
      writeFileSync(
        selected,
        `export class BusLanesPipelineSolver {
      input; traces=[]; solved=${solved}; failed=true; iterations=0; stats={};
      failureCode="selected_revision_failure"; error="selected revision executed";
      constructor(input, options) {
        if (options.fanout !== "none") throw Error("wrong reduced fixture pipeline");
        this.input=input;
      }
    }`,
      )
      for (const strict of [false, true]) {
        const routes = join(directory, `routes-${solved}-${strict}`)
        const result = await runBenchmarkProcess(
          [
            worker,
            "--worker",
            sample,
            "--timeout-seconds",
            "5",
            "--solver",
            selected,
            "--routes-directory",
            routes,
            ...(strict ? ["--require-all-solved"] : []),
          ],
          repository,
          20_000,
        )
        expect(result.exitCode).toBe(strict ? 1 : 0)
        expect(result.report).toMatchObject({
          sample,
          status: "failed",
          solved: false,
          routedSignals: 0,
          failureCode: "selected_revision_failure",
          error: "selected revision executed",
          inputUnchanged: true,
          fixedPowerPreserved: true,
        })
        expect(existsSync(routes)).toBe(false)
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 45_000)
