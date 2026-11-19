import { routeAlternateSignalDogbones } from "./alternate-signal-dogbones"
import {
  expandedSignalSites,
  generatedEscapeHolesConflict,
} from "./expanded-signal-sites"
import { isUnroutedComponentPad } from "./is-unrouted-component-pad"
import type { Connection, SimpleRouteJson, Trace } from "./types"

type Options = Parameters<typeof routeAlternateSignalDogbones>[1]
type DogboneResult = ReturnType<typeof routeAlternateSignalDogbones>

const MAX_EXPANDED_SITE_STEPS = 8_000

function assignExpandedConnectionEscape(
  input: SimpleRouteJson,
  connection: Connection,
  targetLayer: string,
): { connection: Connection; escapes: Trace[] } | null {
  for (const allowPadEdgeSites of [false, true]) {
    const generator = expandedSignalSites({
      input,
      connection,
      targetLayer,
      allowPadEdgeSites,
    })
    let next = generator.next()
    let steps = 0
    try {
      while (!next.done && steps++ < MAX_EXPANDED_SITE_STEPS) {
        next = generator.next()
      }
      if (!next.done) continue
    } finally {
      if (!next.done) generator.return([[], []])
    }
    const [starts, goals] = next.value
    if (!starts.length || !goals.length) continue
    const pairs = starts
      .flatMap((start) => goals.map((goal) => ({ start, goal })))
      .sort(
        (a, b) =>
          a.start.length + a.goal.length - (b.start.length + b.goal.length),
      )
    for (const { start, goal } of pairs) {
      if (generatedEscapeHolesConflict(input, [start.escape], [goal.escape]))
        continue
      const escapes = [start, goal]
        .filter((site) =>
          site.escape.route.some((point) => point.route_type === "via"),
        )
        .map((site) => site.escape)
      return {
        connection: {
          ...connection,
          pointsToConnect: [start.point, goal.point],
        },
        escapes,
      }
    }
  }
  return null
}

function tryExpandedDogboneFallback(
  input: SimpleRouteJson,
  options: Options,
  targets: ReadonlyMap<string, string>,
  attempt: number,
  soloBlockedNames: ReadonlySet<string>,
): DogboneResult | null {
  const needsVia = (connection: Connection) => {
    const target = targets.get(connection.name)
    return (
      target !== undefined &&
      connection.pointsToConnect.some(
        (point) => !(point.layers ?? [point.layer]).includes(target),
      )
    )
  }
  if (!input.connections.some(needsVia)) return null

  const runHybridOrFull = (expandAll: boolean): DogboneResult | null => {
    const expandedByName = new Map<string, Connection>()
    const expandedEscapes: Trace[] = []
    let workingTraces = [...(input.traces ?? [])]

    for (const connection of input.connections) {
      const target = targets.get(connection.name)
      if (!target) return null
      if (!needsVia(connection)) {
        if (expandAll) {
          expandedByName.set(connection.name, {
            ...connection,
            pointsToConnect: connection.pointsToConnect.map((point) => {
              const { layers: _layers, ...rest } = point
              return { ...rest, layer: target }
            }),
          })
        }
        continue
      }
      if (!expandAll && !soloBlockedNames.has(connection.name)) continue
      const resolved = assignExpandedConnectionEscape(
        { ...input, traces: workingTraces },
        connection,
        target,
      )
      if (!resolved) return null
      expandedByName.set(connection.name, resolved.connection)
      expandedEscapes.push(...resolved.escapes)
      workingTraces = [...workingTraces, ...resolved.escapes]
    }

    if (expandedByName.size === input.connections.length) {
      return {
        connections: input.connections.map(
          (c) => expandedByName.get(c.name)!,
        ) as DogboneResult["connections"],
        traces: expandedEscapes as DogboneResult["traces"],
      }
    }

    const remainingConnections = input.connections.filter(
      (c) => !expandedByName.has(c.name),
    )
    try {
      const localResult = routeAlternateSignalDogbones(
        {
          ...input,
          connections: remainingConnections,
          buses: (input.buses ?? []).flatMap((bus) => {
            const connectionNames = bus.connectionNames.filter(
              (name) => !expandedByName.has(name),
            )
            return connectionNames.length ? [{ ...bus, connectionNames }] : []
          }),
          differentialPairs: (input.differentialPairs ?? []).filter((pair) =>
            pair.connectionNames.every((name) => !expandedByName.has(name)),
          ),
          traces: workingTraces,
        },
        { ...options, targetLayers: targets },
        attempt,
      )
      const localByName = new Map(
        localResult.connections.map((c) => [c.name, c]),
      )
      return {
        connections: input.connections.map(
          (c) =>
            (expandedByName.get(c.name) ??
              localByName.get(c.name)!) as DogboneResult["connections"][number],
        ),
        traces: [
          ...expandedEscapes,
          ...localResult.traces,
        ] as DogboneResult["traces"],
      }
    } catch (failure) {
      if (
        !(failure instanceof Error) ||
        failure.message !== "No collision-free local dogbone assignment"
      )
        throw failure
      return null
    }
  }

  if (soloBlockedNames.size > 0) {
    const hybrid = runHybridOrFull(false)
    if (hybrid) return hybrid
  }
  return runHybridOrFull(true)
}

/** A pad-layer route needs no local via. If the preferred carrier allocation
 * fails, keep signals with no legal local via on their allowed native surface.
 * Bus co-location is a preference; differential partners must remain together.
 * Only solver-owned approaches change. Supplied copper remains immutable. */
export function initialSignalDogbones(
  input: SimpleRouteJson,
  options: Options,
  attempt: number,
): ReturnType<typeof routeAlternateSignalDogbones> {
  try {
    return routeAlternateSignalDogbones(input, options, attempt)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "No collision-free local dogbone assignment"
    )
      throw error
    const targets = new Map(options.targetLayers)
    const available = (c: Connection, layer: string) =>
      (!input.allowedLayers || input.allowedLayers.includes(layer)) &&
      c.pointsToConnect.every(
        (p) =>
          (p.layers ?? [p.layer]).includes(layer) &&
          (p.layers !== undefined || isUnroutedComponentPad(input, c, p)),
      ) &&
      (input.buses ?? []).every(
        (b) =>
          !b.connectionNames.includes(c.name) ||
          !b.allowedLayers ||
          b.allowedLayers.includes(layer),
      )
    const unavailableLocalVia: string[] = []
    const nativeFallbacks: {
      connectionName: string
      fromLayer: string | undefined
      toLayer: string
    }[] = []
    let cohortTrials = 0
    const contextualError = (cause: Error, stage: string) =>
      new Error(
        `${cause.message}; stage=${stage}; attempt=${attempt}; fixedTraces=${input.traces?.length ?? 0}; unavailableLocalVia=${JSON.stringify(unavailableLocalVia)}; nativeFallbacks=${JSON.stringify(nativeFallbacks)}; cohortTrials=${cohortTrials}`,
        { cause },
      )
    let changed = false
    for (const c of input.connections) {
      const layer = c.pointsToConnect[0].layer
      if (targets.get(c.name) === layer || !available(c, layer)) continue
      const local = {
        ...input,
        connections: [c],
        buses: [],
        differentialPairs: [],
      }
      let hasSite = false
      for (let turn = 0; turn < 4 && !hasSite; turn++) {
        try {
          routeAlternateSignalDogbones(
            local,
            { ...options, targetLayers: targets },
            turn,
          )
          hasSite = true
        } catch {}
      }
      if (hasSite) continue
      unavailableLocalVia.push(c.name)
      const pair = input.differentialPairs?.find((p) =>
        p.connectionNames.includes(c.name),
      )
      const cohort = input.connections.filter((p) =>
        pair ? pair.connectionNames.includes(p.name) : p.name === c.name,
      )
      if (!cohort.every((p) => available(p, layer))) continue
      for (const p of cohort) {
        nativeFallbacks.push({
          connectionName: p.name,
          fromLayer: targets.get(p.name),
          toLayer: layer,
        })
        targets.set(p.name, layer)
      }
      changed = true
    }
    const tryTargets = (candidate: Map<string, string>) => {
      try {
        return routeAlternateSignalDogbones(
          input,
          { ...options, targetLayers: candidate },
          attempt,
        )
      } catch (failure) {
        if (
          !(failure instanceof Error) ||
          failure.message !== "No collision-free local dogbone assignment"
        )
          throw failure
        return null
      }
    }
    if (changed) {
      const result = tryTargets(targets)
      if (result) return result
    }
    // Nonempty individual site domains do not imply a compatible collective
    // assignment. Relax one eligible native-pad cohort at a time, ordinary
    // signals before pairs, while preserving all supplied copper and layers.
    const cohorts = input.connections.map((c) => new Set([c.name]))
    for (const pair of input.differentialPairs ?? []) {
      const related = cohorts.filter((cohort) =>
        pair.connectionNames.some((name) => cohort.has(name)),
      )
      const merged = new Set(related.flatMap((cohort) => [...cohort]))
      for (const cohort of related) cohorts.splice(cohorts.indexOf(cohort), 1)
      cohorts.push(merged)
    }
    cohorts.sort((a, b) => a.size - b.size)
    const alternatives = cohorts.flatMap((names) => {
      const members = input.connections.filter((c) => names.has(c.name))
      const layer = members[0].pointsToConnect[0].layer
      return members.every((c) => available(c, layer)) &&
        members.some((c) => targets.get(c.name) !== layer)
        ? [{ members, layer }]
        : []
    })
    // Bound this fallback to at most two trials per eligible cohort rather than
    // enumerating every subset of native/carrier allocations.
    for (const { members, layer } of alternatives) {
      const candidate = new Map(targets)
      for (const member of members) candidate.set(member.name, layer)
      cohortTrials++
      const result = tryTargets(candidate)
      if (result) return result
    }
    if (alternatives.length > 1) {
      const candidate = new Map(targets)
      for (const [index, { members, layer }] of alternatives.entries()) {
        for (const member of members) candidate.set(member.name, layer)
        if (index === 0) continue // Already tried this one-cohort allocation.
        cohortTrials++
        const result = tryTargets(candidate)
        if (result) return result
      }
    }
    const hasSingleLayerNonNativeCohort = (input.buses ?? []).some(
      (b) =>
        b.allowedLayers?.length === 1 &&
        input.connections.some(
          (c) =>
            b.connectionNames.includes(c.name) &&
            c.pointsToConnect.some(
              (p) => !(p.layers ?? [p.layer]).includes(b.allowedLayers![0]!),
            ),
        ),
    )
    if (
      input.traces?.length &&
      hasSingleLayerNonNativeCohort &&
      attempt >= Math.min(3, Math.max(0, input.layerCount - 1))
    ) {
      const expanded = tryExpandedDogboneFallback(
        input,
        options,
        targets,
        attempt,
        new Set(unavailableLocalVia),
      )
      if (expanded) return expanded
    }
    throw contextualError(
      error,
      changed ? "native_fallback_assignment" : "preferred_assignment",
    )
  }
}
