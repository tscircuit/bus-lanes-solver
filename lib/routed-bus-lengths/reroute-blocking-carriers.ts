import { length } from "../geometry"
import type { Trace } from "../types"
import type { RoutedLengthWindow } from "./get-routed-length-windows"
import { routeThroughLengthWindow } from "./route-through-length-window"
import type { RoutedBusCopper } from "./routed-bus-copper"

type TraceId = Trace["pcb_trace_id"]
type BlockerSetKey = string
type CarrierSearch = {
  copper: RoutedBusCopper
  alternatives: Map<TraceId, Trace[]>
  current: Map<TraceId, Trace>
  held: Trace[]
  explored: number
}

function getCarrierOptions(
  {
    window,
    fixedTraces,
    movableTraces,
  }: {
    window: RoutedLengthWindow
    fixedTraces: Trace[]
    movableTraces: Trace[]
  },
  { copper, alternatives, current }: CarrierSearch,
) {
  const options: { trace: Trace; blockers: Trace[] }[] = []
  const known = alternatives.get(window.trace.pcb_trace_id)!
  for (const candidate of known) {
    if (copper.hasConflict(candidate, fixedTraces)) continue
    const blockers = copper.conflicts(candidate, movableTraces)
    options.push({ trace: candidate, blockers })
    if (!blockers.length)
      return options.sort((a, b) => a.blockers.length - b.blockers.length)
  }
  const seeds = [
    ...new Set([
      current.get(window.trace.pcb_trace_id)!,
      window.trace,
      ...known.filter((candidate) => candidate.route.length < 90).slice(0, 2),
    ]),
  ]
  const blockerCounts = new Map<BlockerSetKey, number>()
  for (const pitch of [0.95, 0.65]) {
    for (const seed of seeds) {
      let tuneAttempts = 0,
        visited = 0
      for (let candidate of routeThroughLengthWindow({
        input: copper.input,
        window,
        trace: seed,
        obstacles: fixedTraces,
        step: copper.pitch(pitch),
        tuningSlackMm: 3,
        split: false,
      })) {
        if (copper.hasConflict(candidate, fixedTraces)) continue
        if (length(candidate.route) < window.minMm - 1e-7) {
          if (++tuneAttempts > 9) continue
          const tuned = copper.tune({
            window,
            trace: candidate,
            obstacles: fixedTraces,
          })
          if (!tuned) continue
          candidate = tuned
        }
        visited++
        if (
          copper.meetsWindow(window, candidate) &&
          !copper.hasConflict(candidate, fixedTraces)
        ) {
          const blockers = copper.conflicts(candidate, movableTraces),
            key = blockers
              .map((o) => o.pcb_trace_id)
              .sort()
              .join("/")
          if ((blockerCounts.get(key) ?? 0) < 3) {
            blockerCounts.set(key, (blockerCounts.get(key) ?? 0) + 1)
            options.push({ trace: candidate, blockers })
            known.push(candidate)
          }
          if (!blockers.length)
            return options.sort((a, b) => a.blockers.length - b.blockers.length)
        }
        if (visited > 55) break
      }
    }
  }
  return options.sort((a, b) => a.blockers.length - b.blockers.length)
}

function placeCarriers(
  { order, placed }: { order: RoutedLengthWindow[]; placed: Trace[] },
  search: CarrierSearch,
): Trace[] | undefined {
  const { current, held } = search
  const [next, ...rest] = order
  if (!next) return placed
  const movableTraces = rest.map((w) => current.get(w.trace.pcb_trace_id)!)
  for (const choice of getCarrierOptions(
    {
      window: next,
      fixedTraces: [...held, ...placed],
      movableTraces,
    },
    search,
  ).slice(0, 5)) {
    if (++search.explored > 36) break
    const result = placeCarriers(
      { order: rest, placed: [...placed, choice.trace] },
      search,
    )
    if (result) return result
  }
}
/** Reopen only carriers that collide with the shortest available replacement.
 * Every other route, including a terminal branch, remains a hard obstacle. */
export function rerouteBlockingCarriers({
  window,
  windows,
  routes,
  copper,
  alternatives,
}: {
  window: RoutedLengthWindow
  windows: RoutedLengthWindow[]
  routes: Trace[]
  copper: RoutedBusCopper
  alternatives: Map<TraceId, Trace[]>
}): Trace[] | undefined {
  const current = new Map(routes.map((trace) => [trace.pcb_trace_id, trace]))
  const trace = current.get(window.trace.pcb_trace_id)!
  const others = routes.filter((t) => t !== trace)
  const ranked = alternatives
    .get(trace.pcb_trace_id)!
    .map((candidate) => copper.conflicts(candidate, others))
    .sort((a, b) => a.length - b.length)
  const conflicts = ranked[0]
  if (!conflicts) return
  const byId = new Map(windows.map((w) => [w.trace.pcb_trace_id, w]))
  if (conflicts.some((t) => !byId.has(t.pcb_trace_id))) return
  const group = [window, ...conflicts.map((t) => byId.get(t.pcb_trace_id)!)]
  if (group.length > 8) return
  const groupIds = new Set(group.map((w) => w.trace.pcb_trace_id))
  const held = [
    ...(copper.input.traces ?? []),
    ...routes.filter((t) => !groupIds.has(t.pcb_trace_id)),
  ]
  const chosen = placeCarriers(
    { order: group, placed: [] },
    { copper, alternatives, current, held, explored: 0 },
  )
  if (!chosen) return
  const replacements = new Map(chosen.map((t) => [t.pcb_trace_id, t]))
  return routes.map((t) => replacements.get(t.pcb_trace_id) ?? t)
}
