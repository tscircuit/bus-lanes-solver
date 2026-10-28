import { meanderReturnSpacing } from "./meander-spacing"
import { tuningPathIsSelfClear } from "./length-tuning"
import { nativeSignalGeometryIsValid } from "./native-signal-geometry"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Validate the actual pad-to-pad wire runs after generated approaches join.
 * Vias separate planar runs; neither a repeated point nor a layer handoff may
 * hide a returning arm. Smooth routing also checks native headings and turns;
 * explicitly unsmoothed routing retains its existing ordinary-angle contract. */
export function joinedSignalGeometryIsValid(params: {
  input: SimpleRouteJson
  trace: Trace
  smoothTuning?: boolean
}): boolean {
  const { input, trace } = params
  if (params.smoothTuning !== false && !nativeSignalGeometryIsValid(trace))
    return false
  let run: Wire[] = []
  const runIsClear = () =>
    run.length < 2 ||
    tuningPathIsSelfClear(
      run,
      meanderReturnSpacing(
        input,
        run.reduce((w, p) => Math.max(w, p.width), 0),
        0,
      ),
    )
  for (const point of trace.route) {
    if (
      point.route_type !== "wire" ||
      (run.length > 0 && run[0].layer !== point.layer)
    ) {
      if (!runIsClear()) return false
      run = []
    }
    if (point.route_type === "wire") run.push(point)
  }
  return runIsClear()
}
