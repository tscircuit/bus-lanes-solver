import { backwardFacingPackageTerminals } from "./backward-facing-package-terminals"
import {
  pairHasUnroutedNativePads,
  pairRouteKey,
  routeCoupledPair,
} from "./coupled-pair-routing"
import { negotiateLanes } from "./negotiate-lanes"
import { repairGridJogs } from "./repair-grid-jogs"
import type { SimpleRouteJson, Trace } from "./types"
import { type Copper, routeCopper } from "./vector-scene"

/** Independent signal layers can finish their bus before the next layer is
 * searched. Bound each fresh paired topology so a closed package approach
 * cannot consume the entire board's routing budget. */
export function independentBusGroups(
  input: SimpleRouteJson,
): SimpleRouteJson[] | null {
  if ((input.buses?.length ?? 0) < 2) return null
  const constrained = new Set([
    ...(input.buses ?? []).flatMap((b) => b.connectionNames),
    ...(input.differentialPairs ?? []).flatMap((p) => p.connectionNames),
  ])
  if (
    input.connections.some(
      (c) =>
        !constrained.has(c.name) ||
        c.pointsToConnect.some((p) => p.layer !== c.pointsToConnect[0].layer),
    )
  )
    return null
  const layers = [
    ...new Set(input.connections.map((c) => c.pointsToConnect[0].layer)),
  ]
  if (layers.length < 2) return null
  const groups = layers.map((layer) => {
    const connections = input.connections.filter(
      (c) => c.pointsToConnect[0].layer === layer,
    )
    const names = new Set(connections.map((c) => c.name))
    const buses = (input.buses ?? []).filter((b) =>
      b.connectionNames.some((n) => names.has(n)),
    )
    const differentialPairs = (input.differentialPairs ?? []).filter((p) =>
      p.connectionNames.some((n) => names.has(n)),
    )
    const pairMemberNames = differentialPairs.flatMap((p) => p.connectionNames)
    const singleLayerCohorts =
      buses.length > 0 &&
      buses.every(
        (b) => b.allowedLayers?.length === 1 && b.allowedLayers[0] === layer,
      )
    if (
      buses.some((b) => b.connectionNames.some((n) => !names.has(n))) ||
      differentialPairs.some((p) =>
        p.connectionNames.some((n) => !names.has(n)),
      ) ||
      (differentialPairs.length > 1 && !singleLayerCohorts) ||
      new Set(pairMemberNames).size !== pairMemberNames.length ||
      buses.some(
        (b) =>
          differentialPairs.filter((p) =>
            p.connectionNames.some((n) => b.connectionNames.includes(n)),
          ).length > 1,
      ) ||
      differentialPairs.some((p) =>
        buses.some(
          (b) =>
            b.connectionNames.some((n) => p.connectionNames.includes(n)) &&
            !p.connectionNames.every((n) => b.connectionNames.includes(n)),
        ),
      )
    )
      return null
    return { ...input, connections, buses, differentialPairs }
  })
  return groups.every((g) => g !== null) ? (groups as SimpleRouteJson[]) : null
}

export function* routeIndependentBuses(
  groups: SimpleRouteJson[],
  fixed: Copper[],
  widths: Map<string, number>,
  finish: (input: SimpleRouteJson, traces: Trace[]) => Trace[] | null,
): Generator<Trace[], Trace[] | null> {
  const completed: Trace[] = []
  for (const input of groups) {
    const pairs = input.differentialPairs ?? []
    const pairedConnectionNames = new Set(
      pairs.flatMap((pair) => pair.connectionNames),
    )
    const ordinary = input.connections.filter(
      (c) => !pairedConnectionNames.has(c.name),
    )
    let solved: Trace[] | null = null
    const attemptedPairRoutes = new Set<string>()
    const attemptedSinglePairRoutes =
      pairs.length === 1 ? attemptedPairRoutes : undefined
    // Alternate nearby and distant handoffs for backward-facing packages;
    // consecutive neighboring retries often repeat the same closed topology.
    const variants = backwardFacingPackageTerminals(input)
      ? [0, 5, 1, 4, 2, 3]
      : [0, 1, 2, 3, 4, 5]
    for (const variant of variants) {
      if (solved) break
      const paired: Trace[] = []
      let pairsRouted = true
      for (const pair of pairs) {
        const search = routeCoupledPair(
          input,
          pair,
          paired.length ? [...fixed, ...paired.flatMap(routeCopper)] : fixed,
          {
            copper: [],
            penalty: 0,
            variant,
            excludedPairRoutes: attemptedSinglePairRoutes,
          },
        )
        let state = search.next(),
          steps = 0
        try {
          while (!state.done && steps++ < 12000) {
            yield [...completed, ...paired]
            state = search.next()
          }
        } finally {
          if (!state.done) search.return(null)
        }
        if (!state.done || !state.value) {
          pairsRouted = false
          break
        }
        paired.push(...state.value)
      }
      if (!pairsRouted) continue
      if (pairs.length > 0) {
        const pairKey = pairRouteKey(paired)
        if (attemptedPairRoutes.has(pairKey)) continue
        attemptedPairRoutes.add(pairKey)
      }
      if (!ordinary.length) {
        solved = finish(input, paired)
        continue
      }
      const search = negotiateLanes(
        input,
        ordinary,
        fixed,
        paired,
        widths,
        undefined,
        new Map(),
        () => false,
        false,
        pairs.some((pair) => pairHasUnroutedNativePads(input, pair)),
      )
      let state = search.next(),
        steps = 0
      try {
        while (!state.done && steps++ < 12000) {
          yield [...completed, ...state.value]
          state = search.next()
        }
      } finally {
        if (!state.done) search.return(null)
      }
      if (state.done && state.value) {
        const repair = repairGridJogs(input, state.value, fixed)
        let repaired = repair.next(),
          repairSteps = 0
        try {
          while (!repaired.done && repairSteps++ < 6000) {
            yield [...completed, ...state.value]
            repaired = repair.next()
          }
        } finally {
          if (!repaired.done) repair.return(false)
        }
        if (!repaired.done || !repaired.value) continue
        solved = finish(input, state.value)
      }
    }
    if (!solved) return null
    completed.push(...solved)
    yield completed
  }
  return completed
}
