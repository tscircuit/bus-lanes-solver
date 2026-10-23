import { negotiateSignalSites } from "./negotiate-signal-sites"
import { runBoundedRouting } from "./run-bounded-routing"
import { length } from "./geometry"
import type { FlexibleSignalState } from "./flexible-signal-state"
import type { Connection, Trace } from "./types"

/** Collect computed alternatives without changing the negotiator's default
 * selection order. No supplied copper is removed or edited. */
export function* planOrdinaryRepairCandidates(
  state: FlexibleSignalState,
  blocked: string,
): Generator<void, FlexibleSignalState[]> {
  const choices: { connection: Connection; trace: Trace; escapes: Trace[] }[] =
    []
  const original = yield* runBoundedRouting(
    negotiateSignalSites(state, new Set([blocked]), false, false, {
      allowExpandedSites: true,
      expandEmptyDomainsOnly: true,
      maxCandidateSearchNodes: 12000,
      onCandidate: (c) => {
        if (c.connection.name === blocked) choices.push(c)
      },
    }),
    12000,
  )
  if (!original) return []
  const candidates = choices
    .sort((a, b) => length(a.trace.route) - length(b.trace.route))
    .map((c) => ({
      ...original,
      pending: {
        ...original.pending,
        connections: original.pending.connections.map((p) =>
          p.name === blocked ? c.connection : p,
        ),
      },
      traces: [c.trace],
      escapes: [
        ...original.escapes.filter((t) => t.connection_name !== blocked),
        ...c.escapes,
      ],
    }))
  candidates.push(original)
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = JSON.stringify([c.traces, c.escapes])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** An empty peer escape domain around the ordinary reservation cannot be
 * repaired by adding pair copper. Unknown/budget-limited probes are retained.
 * These are individual feasibility checks, not a claim of joint completion. */
export function* ordinaryRepairBlocksPeer(
  state: FlexibleSignalState,
  ordinary: FlexibleSignalState,
  blocked: string,
): Generator<void, boolean> {
  const paired = new Set(
    state.native.differentialPairs?.flatMap((p) => p.connectionNames),
  )
  const held = {
    ...state,
    traces: [...state.traces, ...ordinary.traces],
    escapes: ordinary.escapes,
  }
  const reserved = new Set(
    [...state.retained, ...held.traces].map((t) => t.connection_name),
  )
  for (const c of state.native.connections) {
    if (c.name === blocked || paired.has(c.name) || reserved.has(c.name))
      continue
    let empty = false
    yield* runBoundedRouting(
      negotiateSignalSites(held, new Set([c.name]), false, false, {
        allowExpandedSites: true,
        expandEmptyDomainsOnly: true,
        maxCandidateSearchNodes: 12000,
        onBlockedConnection: () => {
          empty = true
        },
      }),
      2000,
    )
    if (empty) return true
  }
  return false
}
