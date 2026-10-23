import {
  pairHasUnroutedNativePads,
  routeCoupledPair,
} from "./coupled-pair-routing"
import { signalLayers } from "./flexible-signal-state"
import { length } from "./geometry"
import { maximumCarrierLength } from "./route-lengths"
import { runBoundedRouting } from "./run-bounded-routing"
import { fixedCopper } from "./vector-scene"
import type { SimpleRouteJson, Trace } from "./types"

export const NATIVE_PAIR_SEARCH_STEPS = 60000
export const NATIVE_PAIR_REPAIR_STEPS = 300000

/** Try original native pad endpoints before generated via handoffs around
 * previous-phase copper. Positions are board-world XY mm, +X right/+Y up.
 * Only an explicitly hard-length paired bus on an allowed common pad layer
 * participates. Supplied copper is fixed and never retargeted or removed. */
export function nativePairSeedEligible(
  input: SimpleRouteJson,
  allowFirstPhase = false,
): boolean {
  const pair = input.differentialPairs?.[0]
  if (
    !pair ||
    input.differentialPairs!.length !== 1 ||
    (!allowFirstPhase && !input.traces?.length) ||
    !input.buses?.some(
      (bus) =>
        bus.maxLength !== undefined &&
        pair.connectionNames.every((name) =>
          bus.connectionNames.includes(name),
        ),
    ) ||
    !pairHasUnroutedNativePads(input, pair)
  )
    return false
  const members = input.connections.filter((c) =>
    pair.connectionNames.includes(c.name),
  )
  if (members.length !== 2) return false
  const layer = members[0].pointsToConnect[0].layer
  return members.every(
    (c) =>
      signalLayers(input, c).includes(layer) &&
      c.pointsToConnect.every((p) => p.layer === layer),
  )
}

export function* planNativePairSeed(
  input: SimpleRouteJson,
  maxSteps = NATIVE_PAIR_SEARCH_STEPS,
  seedOptions: { allowFirstPhase?: boolean } = {},
): Generator<void, Trace[] | null> {
  if (!nativePairSeedEligible(input, seedOptions.allowFirstPhase)) return null
  const pair = input.differentialPairs![0]
  const paired = yield* runBoundedRouting(
    routeCoupledPair(input, pair, fixedCopper(input), {
      copper: [],
      penalty: 0,
      variant: 0,
      preferPackageOnlyTuning: true,
    }),
    maxSteps,
  )
  return paired?.every(
    (t) =>
      length(t.route) <= maximumCarrierLength(input, t.connection_name!) + 1e-7,
  )
    ? paired
    : null
}
