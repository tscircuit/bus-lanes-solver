import { distance } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import { retargetGeneratedEscape } from "./retarget-generated-escape"
import type { Trace } from "./types"

/** Compose owned approaches into the completed paths that use their via
 * handoffs. Global carriers follow local branches in the routing ledger, so
 * visit them first when a primary via also feeds a termination branch.
 * All points remain in board-world mm, +X right and +Y up. */
export function joinMultiTerminalEscapes({
  traces,
  escapes,
}: {
  traces: Trace[]
  escapes: Trace[]
}): Trace[] {
  const remaining = new Set(escapes)
  const joined = traces.filter((trace) => !remaining.has(trace))
  for (let index = joined.length - 1; index >= 0; index--) {
    const carrier = joined[index]
    const attached: Trace[] = []
    for (const escape of remaining) {
      if (escape.connection_name !== carrier.connection_name) continue
      const handoff = escape.route.at(-1)!
      const terminal = [carrier.route[0], carrier.route.at(-1)!].find(
        (point) => distance(point, handoff) < 1e-8,
      )
      if (!terminal || terminal.route_type !== "wire") continue
      const via = escape.route.find((point) => point.route_type === "via")
      if (
        terminal.layer === via?.from_layer &&
        joined.some(
          (other) =>
            other.connection_name === carrier.connection_name &&
            [other.route[0], other.route.at(-1)!].some(
              (point) =>
                point.route_type === "wire" &&
                point.layer !== terminal.layer &&
                distance(point, handoff) < 1e-8,
            ),
        )
      )
        continue
      attached.push(retargetGeneratedEscape(escape, terminal.layer))
      remaining.delete(escape)
    }
    if (attached.length) joined[index] = joinSignalEscapes(carrier, attached)
  }
  return [...remaining, ...joined]
}
