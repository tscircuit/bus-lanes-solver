import type { FlexibleSignalState } from "./flexible-signal-state"
import type { Trace } from "./types"
/** Pair-only keys discard useful new ordinary prefixes. Ignore trace IDs and
 * ordering, but include every solver-owned escape and accepted carrier. */
export function surfaceRepairKey(state: FlexibleSignalState): string {
  const encode = (traces: Trace[]) =>
    traces.map((t) => JSON.stringify([t.connection_name, t.route])).sort()
  return JSON.stringify([
    encode(state.retained),
    encode(state.traces),
    encode(state.escapes),
  ])
}
