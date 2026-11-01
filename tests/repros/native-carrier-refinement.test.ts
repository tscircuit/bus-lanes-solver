import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../../lib"
import { matchNativeCarrierSignals } from "../../lib/match-native-carrier-signals"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { pairCouplingReports } from "../../lib/pair-coupling"
import { nativeSignalGeometryIsValid } from "../../lib/native-signal-geometry"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import {
  crossedCarrierSeed,
  fixedNativeEscapes,
  nativeCarrierRefinement,
} from "../fixtures/native-carrier-refinement"

test("fixed-via refinement repairs a crossed interconnect with the original native endpoints", () => {
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
  expect(result.value).not.toBeNull()
  const traces = result.value!
  expect(stages).toContain("native_fixed_via_repair")
  const native = {
    inputSrj: nativeInput,
    routedSrj: toNativeValidationSrj({ ...input, traces }),
  }
  const connectivity = validateOriginalEndpointConnectivity(native)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(input.connections.length)
  const drc = validateRoutedCopperDrc({
    ...native,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(drc.issues).toEqual([])
  for (const bus of busLengthReports(input, traces)) {
    expect(bus.aboveMinimumLength).toBe(true)
    expect(bus.withinLengthLimit).toBe(true)
    expect(bus.matched).toBe(true)
  }
  expect(pairLengthReports(input, traces).every((pair) => pair.matched)).toBe(
    true,
  )
  expect(pairCouplingReports(input, traces).every((pair) => pair.matched)).toBe(
    true,
  )
  expect(traces.every(nativeSignalGeometryIsValid)).toBe(true)
  for (const anchor of paired)
    expect(
      traces.find((trace) => trace.connection_name === anchor.connection_name),
    ).toEqual(anchor)
  for (const previous of ordinary)
    expect(
      fixedNativeEscapes(
        traces.find(
          (trace) => trace.connection_name === previous.connection_name,
        )!,
      ),
    ).toEqual(fixedNativeEscapes(previous))
  expect(seed).toEqual(seedBefore)
  expect(input).toEqual(before)
}, 60000)
