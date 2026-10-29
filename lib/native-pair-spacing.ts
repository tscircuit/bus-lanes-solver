import type { SimpleRouteJson } from "./types"

/** Half the rail center spacing in board-world millimeters. */
export function nativePairHalfPitch(
  input: SimpleRouteJson,
  pair: NonNullable<SimpleRouteJson["differentialPairs"]>[number],
) {
  const edgeGapMm =
    pair.traceGap ??
    input.minTraceToPadEdgeClearance ??
    input.defaultObstacleMargin ??
    0.075
  return (input.minTraceWidth + edgeGapMm) / 2
}
