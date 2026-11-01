import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../../lib"
import { matchNativeCarrierSignals } from "../../lib/match-native-carrier-signals"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import {
  crossedCarrierSeed,
  nativeCarrierRefinement,
} from "../fixtures/native-carrier-refinement"

test("native matching exhausts a crossed interconnect seed despite a legal fixed-via control", () => {
  const { input, options } = nativeCarrierRefinement()
  const before = structuredClone(input)
  const control = new BusLanesPipelineSolver(input, options)
  control.solve()
  expect(control.error).toBeNull()
  expectCompletedRouting(control, before)
  const seed = crossedCarrierSeed({ input, traces: control.traces })
  const seedBefore = structuredClone(seed)
  const paired = seed.filter((trace) =>
    input.differentialPairs![0].connectionNames.includes(
      trace.connection_name!,
    ),
  )
  const ordinary = seed.filter((trace) => !paired.includes(trace))
  const nativeInput = toNativeValidationSrj(input)
  const failed = validateRoutedCopperDrc({
    inputSrj: nativeInput,
    routedSrj: toNativeValidationSrj({ ...input, traces: seed }),
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(failed.valid).toBe(false)
  const stages: string[] = []
  const work = matchNativeCarrierSignals(
    input,
    paired,
    {
      carrierLayer: "inner1",
      ordinaryCarrierLayers: ["bottom"],
      maxPasses: 1,
      maxLocalPasses: 0,
      maxExpansionsPerRoute: 1,
    },
    (progress) => stages.push(progress.stage),
    ordinary,
  )
  let result = work.next()
  while (!result.done) result = work.next()
  expect(result.value).toBeNull()
  expect(stages).not.toContain("native_fixed_via_repair")
  expect(seed).toEqual(seedBefore)
  expect(input).toEqual(before)
}, 60000)
