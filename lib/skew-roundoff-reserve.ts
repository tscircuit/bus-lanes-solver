import type { SimpleRouteJson } from "./types"
import { pairedArcNeedsTangents } from "./paired-arc-sampling"

function reserveSkewRoundoff(limit: number): number {
  const margin = Math.min(1e-6, limit / 1000)
  return limit - margin
}

/** Private targets for clearance-limited paired polygons, in board-world mm. Polygon cleanup and envelope
 * optimization use small geometric epsilons; reserve at most 1 nm inside each
 * requested skew bound so final copper also satisfies strict downstream checks.
 * Public input, output constraints and physical clearances remain unchanged. */
export function withSkewRoundoffReserve(
  input: SimpleRouteJson,
): SimpleRouteJson {
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const affectedPairs = new Set(
    (input.differentialPairs ?? []).filter((pair) => {
      // Match BusLanesSolver.coupledPairs: length-only groups have no polygon.
      const isCoupledPair =
        pair.traceGap !== undefined || pair.maxUncoupledLength !== undefined
      if (!isCoupledPair) return false
      const gap = pair.traceGap ?? clearance
      return pair.connectionNames.some((name) => {
        const connection = input.connections.find(
          (connection) => connection.name === name,
        )
        const bus = input.buses?.find((bus) =>
          bus.connectionNames.includes(name),
        )
        const width =
          bus?.traceWidth ??
          connection?.nominalTraceWidth ??
          connection?.width ??
          input.minTraceWidth
        return pairedArcNeedsTangents({ width, gap, clearance })
      })
    }),
  )
  if (!affectedPairs.size) return input
  const affectedNames = new Set(
    [...affectedPairs].flatMap((pair) => pair.connectionNames),
  )
  const buses = input.buses?.map((bus) => {
    if (bus.maxLengthSkew === undefined) return bus
    const includesAffectedPair = bus.connectionNames.some((name) =>
      affectedNames.has(name),
    )
    if (!includesAffectedPair) return bus
    const maxLengthSkew = reserveSkewRoundoff(bus.maxLengthSkew)
    return { ...bus, maxLengthSkew }
  })
  const differentialPairs = input.differentialPairs?.map((pair) => {
    if (!affectedPairs.has(pair)) return pair
    const lengthTolerance = reserveSkewRoundoff(pair.lengthTolerance)
    return { ...pair, lengthTolerance }
  })
  return { ...input, buses, differentialPairs }
}
