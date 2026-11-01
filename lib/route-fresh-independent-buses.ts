import { BusLanesSolver } from "./bus-lanes-solver"
import type { RepairedBusDogbones } from "./repair-bus-dogbones"
import type { SimpleRouteJson, SolverOptions, Trace } from "./types"

const MAX_TOPOLOGY_STEPS = 40000
// Visit separated handoff choices before sweeping adjacent alternatives.
const PAIR_VARIANTS = [0, 4, 1, 5, 2, 3]

type CarrierCandidate = {
  input: SimpleRouteJson
  traces: Trace[]
  escapes: Trace[]
}
type FinishedCarrier = { traces: Trace[]; escapes: Trace[] }

/** Jointly placed vias remain fixed across all disjoint carrier searches.
 * Finish each DQS approach before accepting that group's topology; a connected
 * and matched carrier alone can still fail physical coupling at its package. */
export function* routeFreshIndependentBuses({
  input,
  groups,
  escapes: originalEscapes,
  options,
  maxSteps,
  finish,
}: {
  input: SimpleRouteJson
  groups: SimpleRouteJson[]
  escapes: Trace[]
  options: SolverOptions
  maxSteps: number
  finish: (candidate: CarrierCandidate) => Generator<void, FinishedCarrier>
}): Generator<void, RepairedBusDogbones | null> {
  const completed: Trace[] = []
  let escapes = originalEscapes
  let remaining = maxSteps
  for (const group of groups) {
    let accepted: FinishedCarrier | undefined
    for (const variant of PAIR_VARIANTS) {
      if (remaining <= 0) return null
      const solver = BusLanesSolver.forPairVariant({
        input: { ...group, traces: escapes },
        options: {
          ...options,
          maxSearchIterations: Math.min(
            options.maxSearchIterations ?? Infinity,
            remaining,
            MAX_TOPOLOGY_STEPS,
          ),
        },
        variant,
      })
      try {
        while (!solver.solved && !solver.failed && remaining > 0) {
          solver.step()
          remaining--
          yield
        }
        if (!solver.solved) continue
        const finishing = finish({
          input: solver.input,
          traces: solver.traces,
          escapes,
        })
        let state = finishing.next()
        try {
          while (!state.done && remaining > 0) {
            remaining--
            yield
            state = finishing.next()
          }
          if (!state.done) return null
          accepted = state.value
          break
        } finally {
          if (!state.done) finishing.return({ traces: [], escapes })
        }
      } catch {
        // A matched carrier may still have an unusable paired package entry.
        // Retry that generated topology without discarding the other group.
      } finally {
        if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
      }
    }
    if (!accepted) return null
    completed.push(...accepted.traces)
    escapes = accepted.escapes
  }
  return { input: { ...input, traces: escapes }, traces: completed, escapes }
}
