import { length } from "../geometry"
import type { Trace } from "../types"
import type { RoutedLengthWindow } from "./get-routed-length-windows"
import type { RoutedBusCopper } from "./routed-bus-copper"
import { routeThroughLengthWindow } from "./route-through-length-window"

/** Check the actual wire and via lands at nominal width. A distant contact
 * on the same net can bypass a meander without crossing its centerline. */
export function fitNominalCarrier({
  copper,
  window,
  trace,
  obstacles,
  refine,
}: {
  copper: RoutedBusCopper
  window: RoutedLengthWindow
  trace: Trace
  obstacles: Trace[]
  refine: boolean
}): Trace | undefined {
  const accepted = (t: Trace) =>
    !copper.hasConflict(t, obstacles) &&
    copper.meetsWindow(window, t) &&
    !copper.isSelfShort(t) &&
    copper.clearsBoard(t)
  for (const seed of new Set([trace, copper.prepareNominal(window.trace)])) {
    if (accepted(seed)) return seed
    if (length(seed.route) < window.targetMm && !copper.isSelfShort(seed)) {
      const tuned = copper.tune({ window, trace: seed, obstacles })
      if (tuned) {
        const candidate = copper.prepareNominal(tuned)
        if (accepted(candidate)) return candidate
      }
    }
    for (const pitch of refine
      ? [1.4, 0.95, 0.65, 0.5]
      : [2.2, 1.6, 1.05, 0.65]) {
      let tuneAttempts = 0
      for (const routed of routeThroughLengthWindow({
        input: copper.input,
        window,
        trace: seed,
        obstacles,
        step: copper.pitch(pitch),
        tuningSlackMm: 6,
        split: refine,
      })) {
        let candidate = copper.prepareNominal(routed)
        if (
          copper.hasConflict(candidate, obstacles) ||
          copper.isSelfShort(candidate)
        )
          continue
        if (length(candidate.route) < window.minMm) {
          if (++tuneAttempts > 25) continue
          const tuned = copper.tune({ window, trace: candidate, obstacles })
          if (!tuned) continue
          candidate = copper.prepareNominal(tuned)
        }
        if (accepted(candidate)) return candidate
      }
    }
  }
}
