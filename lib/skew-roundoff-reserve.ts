import type { SimpleRouteJson } from "./types"
import { pairedArcNeedsTangents } from "./paired-arc-sampling"

/** Private targets for clearance-limited paired polygons, in board-world mm. Polygon cleanup and envelope
 * optimization use small geometric epsilons; reserve at most 1 nm inside each
 * requested skew bound so final copper also satisfies strict downstream checks.
 * Public input, output constraints and physical clearances remain unchanged. */
export function withSkewRoundoffReserve(
  input: SimpleRouteJson,
): SimpleRouteJson {
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const pairs = new Set(
    (input.differentialPairs ?? []).filter((pair) => {
      const gap = pair.traceGap ?? clearance
      return pair.connectionNames.some((name) => {
        const connection = input.connections.find(
          (connection) => connection.name === name,
        )
        const width =
          input.buses?.find((bus) => bus.connectionNames.includes(name))
            ?.traceWidth ??
          connection?.nominalTraceWidth ??
          connection?.width ??
          input.minTraceWidth
        return pairedArcNeedsTangents(width, gap, clearance)
      })
    }),
  )
  if (!pairs.size) return input
  const pairedNames = new Set(
    [...pairs].flatMap((pair) => pair.connectionNames),
  )
  const reserved = (limit: number) => limit - Math.min(1e-6, limit / 1000)
  return {
    ...input,
    buses: input.buses?.map((bus) =>
      bus.maxLengthSkew === undefined ||
      !bus.connectionNames.some((name) => pairedNames.has(name))
        ? bus
        : { ...bus, maxLengthSkew: reserved(bus.maxLengthSkew) },
    ),
    differentialPairs: input.differentialPairs?.map((pair) =>
      pairs.has(pair)
        ? {
            ...pair,
            lengthTolerance: reserved(pair.lengthTolerance),
          }
        : pair,
    ),
  }
}
