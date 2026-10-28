import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  busLengthReports,
  pairLengthReports,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import { joinedSignalGeometryIsValid } from "../lib/joined-signal-geometry"
import { tuneLengths, tuningPathIsSelfClear } from "../lib/length-tuning"
import { minimumLengthTargets } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import { tuneCoupledLengths } from "../lib/tune-coupled-lengths"
import { meanderReturnGapInput } from "./fixtures/meander-return-gap"
import { measureReturnGap } from "./fixtures/measure-return-gap"

const inputs = [
  meanderReturnGapInput(),
  meanderReturnGapInput({ paired: true }),
]
function validate(input: SimpleRouteJson, traces: Trace[], gap: number) {
  expect(measureReturnGap(traces).edgeGap).toBeGreaterThanOrEqual(gap - 1e-8)
  expect(busLengthReports(input, traces).every((r) => r.matched)).toBe(true)
  expect(pairLengthReports(input, traces).every((r) => r.matched)).toBe(true)
  expect(sharedPairSpacingReports(input, traces).every((r) => r.matched)).toBe(
    true,
  )
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
}

for (const paired of [false, true])
  for (const smoothTuning of paired ? [true] : [false, true])
    test(`TSX pipeline honors 0.5 mm gap (paired=${paired}, smooth=${smoothTuning})`, async () => {
      const input = { ...(await inputs[Number(paired)]), minMeanderGap: 0.5 }
      const before = structuredClone(input)
      const solver = new BusLanesPipelineSolver(input, {
        fanout: "none",
        smoothTuning,
      })
      solver.solve()
      expect(solver.error).toBeNull()
      expect(solver.solved).toBe(true)
      validate(input, solver.getOutput().traces!, 0.5)
      expect(input).toEqual(before)
    })

for (const kind of [
  "octilinear",
  "smooth",
  "packed",
  "coupled",
  "coupled-packed",
] as const)
  test(`${kind} tuner honors requested spacing on routes generated from TSX`, async () => {
    const paired = kind.startsWith("coupled")
    const input = { ...(await inputs[Number(paired)]), minMeanderGap: 0.5 }
    const seed = new BusLanesPipelineSolver(
      { ...input, buses: [] },
      { fanout: "none" },
    )
    seed.solve()
    expect(seed.solved).toBe(true)
    const traces = seed.getOutput().traces!
    const targets = minimumLengthTargets(input, traces)
    const result = paired
      ? tuneCoupledLengths(input, traces, {
          packMeanders: kind === "coupled-packed",
        })
      : kind === "octilinear"
        ? tuneLengths(input, traces, targets)
        : tuneSmoothLengths(input, traces, targets, {
            packMeanders: kind === "packed",
          })
    validate(input, result, 0.5)
  })

test("an explicit smaller gap retains the existing electrical clearance", async () => {
  const input = { ...(await inputs[0]), minMeanderGap: 0 }
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(true)
  validate(input, solver.getOutput().traces!, 0.1)
})

test("final carrier and joined-signal validators reject a matched but too-narrow meander", async () => {
  const input = await inputs[0]
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutput().traces!
  const stricter = { ...input, minMeanderGap: 0.5 }
  const validator = BusLanesSolver.forValidation(stricter, traces, {
    smoothTuning: true,
  })
  validator.solve()
  expect(validator.failed).toBe(true)
  expect(validator.error).toContain("self-clearance")
  expect(() => validator.getOutput()).toThrow()
  expect(
    traces.every((trace) =>
      joinedSignalGeometryIsValid({ input: stricter, trace }),
    ),
  ).toBe(false)
})

test("an infeasible gap fails without returning unmatched copper", async () => {
  const input = { ...(await inputs[0]), minMeanderGap: 50 }
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("tuning clearance")
  expect(() => solver.getOutput()).toThrow()
})

test.each([-1, NaN, Infinity, -Infinity])(
  "invalid gap %s is rejected before routing",
  async (minMeanderGap) => {
    const input = { ...(await inputs[0]), minMeanderGap }
    expect(() => new BusLanesSolver(input)).toThrow("minMeanderGap")
    expect(() => new BusLanesPipelineSolver(input)).toThrow("minMeanderGap")
  },
)

// The existing octilinear tuner cannot maintain this shared pair while adding
// ten millimetres. The new gap must never turn that into an accepted near miss.
test("unsmoothed paired tuning fails honestly when it cannot preserve the corridor", async () => {
  const input = { ...(await inputs[1]), minMeanderGap: 0.5 }
  const solver = new BusLanesPipelineSolver(input, {
    fanout: "none",
    smoothTuning: false,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow()
})

test("edge gap uses actual copper width under a 45-degree TSX placement", async () => {
  const input = {
    ...(await meanderReturnGapInput({ width: 0.15, rotation: 45 })),
    minMeanderGap: 0.3,
  }
  const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  validate(input, solver.getOutput().traces!, 0.3)
})

test.each([false, true])(
  "small TSX corrections retain a wide gap without full returning legs (paired=%s)",
  async (paired) => {
    const input = {
      ...(await meanderReturnGapInput({ paired, extraLength: 0.3 })),
      minMeanderGap: 0.5,
    }
    const solver = new BusLanesPipelineSolver(input, { fanout: "none" })
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutput().traces!
    expect(traces.some((t) => t.curvedSegments?.length)).toBe(true)
    expect(traces.every((t) => tuningPathIsSelfClear(t.route, 0.6))).toBe(true)
    expect(busLengthReports(input, traces).every((r) => r.matched)).toBe(true)
    expect(pairLengthReports(input, traces).every((r) => r.matched)).toBe(true)
    expect(
      sharedPairSpacingReports(input, traces).every((r) => r.matched),
    ).toBe(true)
    expect(
      validateRoutedCopperDrc({
        inputSrj: input,
        routedSrj: solver.getOutput(),
        clearance: 0.1,
      } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
    ).toBe(true)
  },
)
