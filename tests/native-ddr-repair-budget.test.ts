import { reuseNativeSurfacePair } from "../lib/reuse-native-surface-pair"
import { nativePrefixLengthReports } from "../scripts/audit-native-counterfactual"
import { length } from "../lib/geometry"
import { ordinaryRepairBlocksPeer } from "../lib/plan-ordinary-repair-candidates"
import { surfaceRepairKey } from "../lib/surface-repair-key"
import { expect, test } from "bun:test"
import {
  loadSequentialNativeDdr,
  nativeDqs0Control,
  auditSequentialNativePair,
} from "../scripts/native-sequential-pair"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { repairSurfacePairEscape } from "../lib/repair-surface-pair-escape"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
function drive<T>(work: Generator<unknown, T>) {
  let next = work.next(),
    steps = 0
  while (!next.done) {
    steps++
    next = work.next()
  }
  return { value: next.value, steps }
}

test("native pair repair recovers validated progress around a computed ordinary candidate", () => {
  const sample = loadSequentialNativeDdr(),
    before = structuredClone(sample)
  const paired = drive(nativeDqs0Control(sample.secondInput, 60000)).value
  expect(paired).not.toBeNull()
  const pairNames = new Set(
    sample.secondInput.differentialPairs![0].connectionNames,
  )
  const ordinary = sample.secondInput.connections.filter(
      (c) => !pairNames.has(c.name),
    ),
    names = new Set(ordinary.map((c) => c.name))
  const state: FlexibleSignalState = {
    native: sample.secondInput,
    pending: {
      ...sample.secondInput,
      connections: ordinary,
      traces: [...sample.secondInput.traces!, ...paired!],
    },
    escapes: [],
    retained: paired!,
    traces: [],
  }
  const stateBefore = structuredClone(state),
    blocked: string[] = []
  const rejected = drive(
    negotiateSignalSites(state, names, false, false, {
      checkEscapeCompatibility: true,
      allowExpandedSites: true,
      expandEmptyDomainsOnly: true,
      maxCandidateSearchNodes: 12000,
      onBlockedConnection: (name) => blocked.push(name),
    }),
  )
  expect(rejected.value).toBeNull()
  expect(blocked).toHaveLength(1)
  const repair = drive(
    repairSurfacePairEscape(
      state,
      blocked[0],
      new Set([surfaceRepairKey(state)]),
    ),
  )
  expect(repair.value).not.toBeNull()
  expect(surfaceRepairKey(repair.value!)).not.toEqual(surfaceRepairKey(state))
  // A compatible ordinary reservation is progress even with the same pair.
  expect(repair.value!.traces[0].route[0]).toMatchObject({ layer: "bottom" })
  expect(repair.steps).toBeLessThan(10000)
  const recovered = repair.value!
  expect(
    surfaceRepairKey({
      ...recovered,
      retained: [...recovered.retained].reverse(),
      traces: [...recovered.traces].reverse(),
      escapes: [...recovered.escapes].reverse(),
    }),
  ).toBe(surfaceRepairKey(recovered))
  const reservation = { ...state, retained: [], traces: [], escapes: [] }
  expect(
    drive(ordinaryRepairBlocksPeer(reservation, recovered, blocked[0])).value,
  ).toBe(false)
  expect(recovered.retained).toHaveLength(2)
  expect(recovered.traces).toHaveLength(1)
  expect(auditSequentialNativePair(sample, recovered.retained).valid).toBe(true)
  const combined = {
    ...sample.secondInput,
    connections: [
      ...sample.firstInput.connections,
      ...sample.secondInput.connections,
    ],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: {
      ...combined,
      traces: [
        ...sample.secondInput.traces!,
        ...recovered.escapes,
        ...recovered.retained,
        ...recovered.traces,
      ],
    } as never,
    clearance: sample.secondInput.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(drc.valid).toBe(true)
  const lengths = nativePrefixLengthReports(
    sample.secondInput,
    recovered.escapes,
    recovered.traces,
  )[0].lengths[0]
  expect(lengths.carrierLengthMm).toBeGreaterThan(20)
  expect(lengths.fixedLengthMm).toBeGreaterThan(1)
  expect(lengths.totalLengthMm).toBeCloseTo(
    length(recovered.traces[0].route) +
      recovered.escapes
        .filter(
          (t) => t.connection_name === recovered.traces[0].connection_name,
        )
        .reduce((sum, t) => sum + length(t.route), 0),
    8,
  )
  const next = drive(
    repairSurfacePairEscape(
      recovered,
      blocked[0],
      new Set([surfaceRepairKey(state), surfaceRepairKey(recovered)]),
    ),
  )
  expect(next.value).not.toBeNull()
  expect(next.steps).toBeLessThan(10000)
  expect(surfaceRepairKey(next.value!)).not.toBe(surfaceRepairKey(recovered))
  const nextDrc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: {
      ...combined,
      traces: [
        ...sample.secondInput.traces!,
        ...next.value!.escapes,
        ...next.value!.retained,
        ...next.value!.traces,
      ],
    } as never,
    clearance: sample.secondInput.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(nextDrc.valid).toBe(true)
  expect(auditSequentialNativePair(sample, next.value!.retained).valid).toBe(
    true,
  )
  const invalid = structuredClone(recovered)
  invalid.retained[0].route[0].x += 0.1
  expect(
    reuseNativeSurfacePair(
      sample.secondInput,
      sample.secondInput.differentialPairs![0],
      invalid,
    ),
  ).toBe(false)
  const stricter = structuredClone(
    sample.secondInput,
  ) as typeof sample.secondInput & { minTraceToHoleEdgeClearance: number }
  stricter.minTraceToHoleEdgeClearance = 0.25
  expect(
    reuseNativeSurfacePair(stricter, stricter.differentialPairs![0], recovered),
  ).toBe(false)

  expect(state).toEqual(stateBefore)
  expect(sample).toEqual(before)
}, 900000)
