import {
  loadSequentialNativeDdr,
  nativeDqs0Control,
  auditSequentialNativePair,
} from "./native-sequential-pair"
import { drive, siteOptions } from "./native-counterfactual"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { repairSurfacePairEscape } from "../lib/repair-surface-pair-escape"
import { surfaceRepairKey } from "../lib/surface-repair-key"
import { ordinaryRepairBlocksPeer } from "../lib/plan-ordinary-repair-candidates"
import { nativeSignalsConnected } from "./audit-native-counterfactual"
import { busLengthReports } from "../lib/route-lengths"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"

export function completedNativeCounterfactualRepair() {
  const sample = loadSequentialNativeDdr(),
    input = sample.secondInput,
    before = JSON.stringify(sample)
  const paired = drive(nativeDqs0Control(input, 60000), 60000).value
  if (!paired) throw Error("Initial native pair did not complete")
  const pairNames = new Set(
      input.differentialPairs!.flatMap((p) => p.connectionNames),
    ),
    ordinaryNames = new Set(
      input.connections
        .filter((c) => !pairNames.has(c.name))
        .map((c) => c.name),
    )
  const state: FlexibleSignalState = {
    native: input,
    pending: input,
    escapes: [],
    retained: paired,
    traces: [],
  }
  let blocked: string | undefined
  drive(
    negotiateSignalSites(state, ordinaryNames, false, false, {
      ...siteOptions,
      checkEscapeCompatibility: true,
      onBlockedConnection: (name) => {
        blocked = name
      },
    }),
  )
  if (!blocked) throw Error("Missing native blocked control")
  const started = performance.now(),
    work = drive(
      repairSurfacePairEscape(
        state,
        blocked,
        new Set([surfaceRepairKey(state)]),
      ),
      100000,
    )
  if (!work.value || !work.completed) throw Error("No completed bounded repair")
  const repaired = work.value,
    all = [
      ...input.traces!,
      ...repaired.escapes,
      ...repaired.retained,
      ...repaired.traces,
    ]
  const combined = {
    ...input,
    connections: [...sample.firstInput.connections, ...input.connections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: { ...combined, traces: all } as never,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  const scoped = {
    ...input,
    connections: input.connections.filter((c) => c.name === blocked),
    differentialPairs: [],
    buses: input.buses!.map((b) => ({
      ...b,
      connectionNames: b.connectionNames.filter((n) => n === blocked),
    })),
  }
  const ordinaryCopper = [...repaired.escapes, ...repaired.traces],
    buses = busLengthReports(scoped, ordinaryCopper)
  const pairAudit = auditSequentialNativePair(sample, repaired.retained)
  const empty = drive(
    ordinaryRepairBlocksPeer(
      { ...state, retained: [], traces: [], escapes: [] },
      repaired,
      blocked,
    ),
    20000,
  )
  const audit = {
    scope: "Completed DQS0 pair and D0 net only; full BYTE0 and SBC incomplete",
    valid:
      pairAudit.valid &&
      drc.valid &&
      nativeSignalsConnected(scoped, ordinaryCopper) &&
      buses.every((b) => b.matched && b.withinLengthLimit) &&
      empty.completed &&
      empty.value === false &&
      before === JSON.stringify(sample),
    drc,
    buses,
    pairs: pairAudit.pairs,
    coupling: pairAudit.coupling,
    inputUnchanged: before === JSON.stringify(sample),
    repairYields: work.steps,
    repairAndAuditSeconds: (performance.now() - started) / 1000,
    ordinaryPrefix: repaired.traces.map((t) => t.connection_name),
    pairUnchanged: JSON.stringify(paired) === JSON.stringify(repaired.retained),
    peersHaveNoEmptyDomain: empty.completed && empty.value === false,
    pairAudit,
  }
  if (!audit.valid) throw Error("Invalid native counterfactual repair")
  return { sample, input, repaired, audit }
}
