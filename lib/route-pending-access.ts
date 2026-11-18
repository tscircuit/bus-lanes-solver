import { finishGeneratedSurfaceCarriers } from "./finish-generated-surface-carriers"
import { signalLayers } from "./flexible-signal-state"
import { negotiateSurfaceRoutes } from "./negotiate-surface-routes"
import { PendingPadAccess } from "./pending-pad-access"
import { runBoundedRouting } from "./run-bounded-routing"
import { PendingRoutingWorkBudgetExceeded } from "./routing-memory-budget"
import { splitCompleteSurfaceTrace } from "./split-complete-surface-trace"
import type { SimpleRouteJson, SolverOptions, Trace } from "./types"

/** Admit a complete route union only while declared future pads retain their
 * demonstrated physical access. A lost obligation activates the same native
 * surface candidate domain used for ordinary negotiated copper conflicts. */
export function* routePendingAccess({
  input,
  traces,
  options,
  maxSteps,
  access,
}: {
  input: SimpleRouteJson
  traces: Trace[]
  options: SolverOptions
  maxSteps: number
  access: PendingPadAccess
}): Generator<void, Trace[] | null> {
  if (!(yield* access.getBlockedObligations(traces)).length) return traces
  // Negotiation and timing consume planar carriers with owned approaches.
  // Completed native output includes those approaches already: recover their
  // representation without changing manufactured geometry or fixed copper.
  const knownIds = new Set(
    [...(input.traces ?? []), ...traces].map((trace) => trace.pcb_trace_id),
  )
  const fixedIds = new Set(
    (input.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const seeds = traces
    .filter((trace) => !fixedIds.has(trace.pcb_trace_id))
    .map((trace) => {
      const connection = input.connections.find(
        (connection) => connection.name === trace.connection_name,
      )
      if (!connection) return { carrier: trace, escapes: [] }
      const split = splitCompleteSurfaceTrace(trace, {
        carrierLayers: signalLayers(input, connection),
        usedTraceIds: knownIds,
      })
      for (const approach of split.escapes) knownIds.add(approach.pcb_trace_id)
      return split
    })
  const joint = yield* runBoundedRouting(
    negotiateSurfaceRoutes(input, {
      native: input,
      pending: input,
      escapes: seeds.flatMap((seed) => seed.escapes),
      retained: [],
      traces: seeds.map((seed) => seed.carrier),
    }),
    {
      maxSteps,
      onExhausted: () =>
        new PendingRoutingWorkBudgetExceeded(
          "Pending routing repair exhausted its cooperative step budget",
        ),
    },
  )
  if (!joint) return access.noSolution()
  const finished = yield* finishGeneratedSurfaceCarriers({
    input,
    carriers: [...joint.retained, ...joint.traces],
    escapes: joint.escapes,
    options,
    maxSteps,
  })
  if (
    !finished ||
    (yield* access.getBlockedObligations(finished.traces)).length
  )
    return access.noSolution()
  return finished.traces
}
