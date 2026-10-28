import type { SimpleRouteJson } from "./types"

/** Centerline distance for returning arms of one trace, in mm. This does not
 * change the spacing between differential rails or any obstacle clearance.
 * Omission preserves each tuner's existing default and electrical clearance. */
export function meanderReturnSpacing(
  input: SimpleRouteJson,
  width: number,
  defaultGap = 0,
) {
  const gap = input.minMeanderGap ?? defaultGap
  if (!Number.isFinite(gap) || gap < 0)
    throw Error("minMeanderGap must be a nonnegative finite number in mm")
  return (
    width +
    Math.max(
      gap,
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075,
    )
  )
}
