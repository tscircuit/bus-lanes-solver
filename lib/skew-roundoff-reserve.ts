import type { SimpleRouteJson } from "./types"

/** Private routing targets in board-world mm. Polygon cleanup and envelope
 * optimization use small geometric epsilons; reserve at most 1 nm inside each
 * requested skew bound so final copper also satisfies strict downstream checks.
 * Public input, output constraints and physical clearances remain unchanged. */
export function withSkewRoundoffReserve(
  input: SimpleRouteJson,
): SimpleRouteJson {
  const reserved = (limit: number) => limit - Math.min(1e-6, limit / 1000)
  return {
    ...input,
    buses: input.buses?.map((bus) =>
      bus.maxLengthSkew === undefined
        ? bus
        : { ...bus, maxLengthSkew: reserved(bus.maxLengthSkew) },
    ),
    differentialPairs: input.differentialPairs?.map((pair) => ({
      ...pair,
      lengthTolerance: reserved(pair.lengthTolerance),
    })),
  }
}
