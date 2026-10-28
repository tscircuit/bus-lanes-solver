import type { SimpleRouteJson } from "./types"

/** Centerline distance for returning arms of one trace, in mm. This does not
 * change the spacing between differential rails or any obstacle clearance.
 * New tuning defaults to 3W centerline. Pass defaultGap=0 when validating or
 * rounding existing geometry: retain its physical clearance unless the caller
 * explicitly requests a larger gap. */
export function meanderReturnSpacing(
  input: SimpleRouteJson,
  width: number,
  defaultGap = 2 * width,
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
