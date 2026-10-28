import type { SimpleRouteJson } from "./types"

/** Centerline distance for returning arms of one trace, in mm. This does not
 * change the spacing between differential rails or any obstacle clearance. */
export function meanderReturnSpacing(input: SimpleRouteJson, width: number) {
  const gap = input.minMeanderGap ?? 0
  if (!Number.isFinite(gap) || gap < 0)
    throw Error("minMeanderGap must be a nonnegative finite number in mm")
  return (
    width +
    Math.max(
      2 * width,
      gap,
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075,
    )
  )
}
