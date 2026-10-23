import { spyOn } from "bun:test"
import * as selection from "../lib/solve-signal-candidate-pool"
import { loadSequentialNativeDdr } from "./native-sequential-pair"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { length } from "../lib/geometry"
import type { Trace, Connection } from "../lib/types"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
export interface CounterfactualChoice {
  connection: Connection
  trace: Trace
  escapes: Trace[]
  layer: string
}
export function drive<T>(work: Generator<unknown, T>, cap = 12000) {
  let next = work.next(),
    steps = 0
  try {
    while (!next.done && steps < cap) {
      steps++
      next = work.next()
    }
    return {
      value: next.done ? next.value : null,
      steps,
      completed: !!next.done,
    }
  } finally {
    if (!next.done) work.return(null as T)
  }
}
export const siteOptions = {
  allowExpandedSites: true,
  expandEmptyDomainsOnly: true,
  maxCandidateSearchNodes: 12000,
}
export function loadNativeCounterfactual() {
  const sample = loadSequentialNativeDdr(),
    native = sample.secondInput
  const before = JSON.stringify(native)
  const state: FlexibleSignalState = {
    native,
    pending: native,
    retained: [],
    traces: [],
    escapes: [],
  }
  const original = selection.solveSignalCandidatePool
  let choices: CounterfactualChoice[] = []
  const spy = spyOn(selection, "solveSignalCandidatePool").mockImplementation(
    (domains, compatible, maxNodes, maxChecks) => {
      if (domains.length === 1)
        choices = [...domains[0]] as unknown as CounterfactualChoice[]
      return original(domains, compatible, maxNodes, maxChecks)
    },
  )
  let selected: ReturnType<typeof drive<FlexibleSignalState | null>>
  try {
    selected = drive(
      negotiateSignalSites(
        state,
        new Set(["source_trace_14"]),
        false,
        false,
        siteOptions,
      ),
    )
  } finally {
    spy.mockRestore()
  }
  const probes = choices.map((choice) => {
    const held = { ...state, retained: [choice.trace], escapes: choice.escapes }
    const next = drive(
      negotiateSignalSites(
        held,
        new Set(["source_trace_29"]),
        false,
        false,
        siteOptions,
      ),
    )
    return {
      choice,
      next,
      length: length(choice.trace.route),
      selected:
        JSON.stringify(choice.trace.route) ===
        JSON.stringify(selected.value?.traces[0].route),
    }
  })
  return {
    sample,
    state,
    selected,
    probes,
    inputUnchanged: before === JSON.stringify(native),
  }
}
