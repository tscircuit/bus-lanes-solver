import { length } from "./geometry"
import {
  measureSignalPath,
  getSignalPathEndpoints,
} from "./measure-signal-path"
import { minimumMeanLengthTargets } from "./minimum-mean-length-targets"
import { reserveSkewRoundoff } from "./skew-roundoff-reserve"
import type {
  Bus,
  ConnectionName,
  LengthSkewConstraint,
  SimpleRouteJson,
  Trace,
} from "./types"

export function hasLengthConstraints(input: SimpleRouteJson): boolean {
  return Boolean(
    input.differentialPairs?.length ||
      input.buses?.some(
        (bus) =>
          bus.minLength !== undefined ||
          bus.maxLength !== undefined ||
          bus.maxLengthSkew !== undefined,
      ),
  )
}

/** Planar copper length already routed for a connection. Via depth and package
 * delay require stackup/package data and are not inferred from XY coordinates. */
export function fixedRouteLength(
  input: SimpleRouteJson,
  name: ConnectionName,
): number {
  const connection = input.connections.find(
    (candidate) => candidate.name === name,
  )
  const selectedPath = input.buses
    ?.flatMap((bus) => bus.lengthMatchingPaths ?? [])
    .find((candidate) => candidate.connectionName === name)
  const path =
    selectedPath && getSignalPathEndpoints({ input, path: selectedPath })
  if (path) {
    if (!connection) {
      const measured = measureSignalPath({
        input,
        traces: input.traces ?? [],
        ...path,
      })
      if (measured === null)
        throw Error("A fixed timing reference has no connected endpoint path")
      return measured
    }
    if (connection.pointsToConnect.length > 2) return 0
    let shortest = Infinity
    for (const ends of [
      connection.pointsToConnect,
      connection.pointsToConnect.toReversed(),
    ]) {
      const prefix = measureSignalPath({
        input,
        traces: input.traces ?? [],
        connectionName: name,
        from: path.from,
        to: ends[0],
      })
      const suffix = measureSignalPath({
        input,
        traces: input.traces ?? [],
        connectionName: name,
        from: path.to,
        to: ends[1],
      })
      if (prefix !== null && suffix !== null)
        shortest = Math.min(shortest, prefix + suffix)
    }
    if (!Number.isFinite(shortest))
      throw Error(
        "Fixed handoffs do not connect to the selected timing endpoints",
      )
    return shortest
  }
  return (input.traces ?? [])
    .filter(
      (t) =>
        t.connection_name === name ||
        t.source_trace_id === (connection?.source_trace_id ?? name),
    )
    .reduce((sum, t) => sum + length(t.route), 0)
}
export interface ConnectionLengthReport {
  name: ConnectionName
  carrierLengthMm: number | null
  fixedLengthMm: number
  totalLengthMm: number | null
}

export interface BusLengthReport {
  busId: Bus["busId"]
  minLengthMm: number | null
  aboveMinimumLength: boolean
  maxLengthMm: number | null
  withinLengthLimit: boolean
  toleranceMm: number | null
  skewMm: number | null
  matched: boolean
  lengths: ConnectionLengthReport[]
}

function getConnectionLengthReport({
  input,
  traces,
  bus,
  connectionName,
}: {
  input: SimpleRouteJson
  traces: Trace[]
  bus: Bus
  connectionName: ConnectionName
}): ConnectionLengthReport {
  const route = traces.find((trace) => trace.connection_name === connectionName)
  const path = bus.lengthMatchingPaths?.find(
    (path) => path.connectionName === connectionName,
  )
  const fixedLengthMm = fixedRouteLength(input, connectionName)
  let carrierLengthMm: number | null = null
  if (route) carrierLengthMm = length(route.route)
  let totalLengthMm: number | null = null
  if (path) {
    totalLengthMm = measureSignalPath({
      input,
      traces: [...(input.traces ?? []), ...traces],
      ...getSignalPathEndpoints({ input, path }),
    })
  } else if (carrierLengthMm !== null) {
    totalLengthMm = carrierLengthMm + fixedLengthMm
  }
  return { name: connectionName, carrierLengthMm, fixedLengthMm, totalLengthMm }
}

function getBusSkewMm(
  bus: Bus,
  lengths: ConnectionLengthReport[],
): number | null {
  if (!lengths.every((member) => member.totalLengthMm !== null)) return null
  if (!bus.connectionNames.length) return null
  const comparisonLengthsMm = lengths.map((member) => member.totalLengthMm!)
  if (bus.skewReference === "mean") {
    const meanLengthMm =
      comparisonLengthsMm.reduce((sum, lengthMm) => sum + lengthMm, 0) /
      comparisonLengthsMm.length
    return Math.max(
      ...comparisonLengthsMm.map((lengthMm) =>
        Math.abs(lengthMm - meanLengthMm),
      ),
    )
  }
  if (bus.skewReference !== "references") {
    return Math.max(...comparisonLengthsMm) - Math.min(...comparisonLengthsMm)
  }

  const referenceLengths = lengths.filter((member) =>
    bus.referenceConnectionNames?.includes(member.name),
  )
  const subjectLengths = lengths.filter(
    (member) =>
      bus.connectionNames.includes(member.name) &&
      !bus.referenceConnectionNames?.includes(member.name),
  )
  let maximumSkewMm = 0
  for (const subject of subjectLengths) {
    for (const reference of referenceLengths) {
      maximumSkewMm = Math.max(
        maximumSkewMm,
        Math.abs(subject.totalLengthMm! - reference.totalLengthMm!),
      )
    }
  }
  return maximumSkewMm
}

function getBusLengthReport({
  input,
  traces,
  bus,
}: {
  input: SimpleRouteJson
  traces: Trace[]
  bus: Bus
}): BusLengthReport {
  const connectionNames = new Set([
    ...bus.connectionNames,
    ...(bus.referenceConnectionNames ?? []),
  ])
  const lengths = [...connectionNames].map((connectionName) =>
    getConnectionLengthReport({ input, traces, bus, connectionName }),
  )
  const complete = lengths.every((member) => member.totalLengthMm !== null)
  const memberLengthsMm = lengths
    .filter((member) => bus.connectionNames.includes(member.name))
    .map((member) => member.totalLengthMm ?? 0)
  const measuredSkewMm = getBusSkewMm(bus, lengths)
  let aboveMinimumLength = true
  if (bus.minLength !== undefined) {
    aboveMinimumLength =
      complete &&
      memberLengthsMm.every((lengthMm) => lengthMm >= bus.minLength! - 1e-7)
  }
  let withinLengthLimit = true
  if (bus.maxLength !== undefined) {
    withinLengthLimit =
      complete &&
      memberLengthsMm.every((lengthMm) => lengthMm <= bus.maxLength! + 1e-7)
  }
  return {
    busId: bus.busId,
    minLengthMm: bus.minLength ?? null,
    aboveMinimumLength,
    maxLengthMm: bus.maxLength ?? null,
    withinLengthLimit,
    toleranceMm: bus.maxLengthSkew ?? null,
    skewMm: measuredSkewMm,
    matched:
      bus.maxLengthSkew !== undefined &&
      measuredSkewMm !== null &&
      measuredSkewMm <= bus.maxLengthSkew + 1e-7,
    lengths,
  }
}

export function busLengthReports(
  input: SimpleRouteJson,
  traces: Trace[],
): BusLengthReport[] {
  return (input.buses ?? []).map((bus) =>
    getBusLengthReport({ input, traces, bus }),
  )
}

/** Existing SRJ skew bounds; omitted bus bounds do not request tuning. */
export function lengthConstraints(
  input: SimpleRouteJson,
): LengthSkewConstraint[] {
  return [
    ...(input.buses ?? [])
      .filter((b) => b.maxLengthSkew !== undefined)
      .map((b) => ({
        names: [
          ...new Set([
            ...b.connectionNames,
            ...(b.referenceConnectionNames ?? []),
          ]),
        ],
        tolerance: b.maxLengthSkew!,
        skewReference: b.skewReference,
        referenceNames: b.referenceConnectionNames,
        reserveSkewOnTune: b.reserveSkewOnTune,
      })),
    ...(input.differentialPairs ?? []).map((p) => ({
      names: p.connectionNames,
      tolerance: p.lengthTolerance,
      reserveSkewOnTune: p.reserveSkewOnTune,
    })),
  ]
}

/** Least non-shortening lengths satisfying every overlapping bus/pair bound.
 * Relax difference constraints rather than collapsing connected groups to equality. */
function initialLengthTargets(
  input: SimpleRouteJson,
  traces: Trace[],
): Map<ConnectionName, number> {
  const targets = new Map(
    traces.map((t) => [
      t.connection_name!,
      length(t.route) + fixedRouteLength(input, t.connection_name!),
    ]),
  )
  for (const bus of input.buses ?? []) {
    if (bus.minLength === undefined) continue
    for (const connectionName of bus.connectionNames) {
      const previousLengthMm = targets.get(connectionName)
      if (previousLengthMm === undefined) continue
      targets.set(connectionName, Math.max(previousLengthMm, bus.minLength))
    }
  }
  for (const { names } of lengthConstraints(input)) {
    for (const name of names) {
      if (!targets.has(name)) targets.set(name, fixedRouteLength(input, name))
    }
  }
  return targets
}

export function minimumBalancedLengthTargets({
  input,
  traces,
}: {
  input: SimpleRouteJson
  traces: Trace[]
}): Map<ConnectionName, number> {
  return minimumMeanLengthTargets({
    input,
    targets: initialLengthTargets(input, traces),
    skewConstraints: lengthConstraints(input),
    balanceCorrections: true,
  })
}

export function minimumLengthTargets(
  input: SimpleRouteJson,
  traces: Trace[],
): Map<ConnectionName, number> {
  const targets = initialLengthTargets(input, traces)
  const constraints = lengthConstraints(input)
  if (
    constraints.some(
      (constraint) =>
        constraint.skewReference === "mean" ||
        constraint.skewReference === "references" ||
        constraint.referenceNames?.some(
          (name) =>
            !input.connections.some((connection) => connection.name === name),
        ),
    )
  ) {
    return minimumMeanLengthTargets({
      input,
      targets,
      skewConstraints: constraints,
    })
  }
  for (let pass = 0; pass < targets.size; pass++) {
    let changed = false
    for (const { names, tolerance, reserveSkewOnTune } of constraints) {
      const ceiling = Math.max(...names.map((n) => targets.get(n)!))
      const floor = ceiling - tolerance
      const tunedFloor = reserveSkewOnTune
        ? ceiling - reserveSkewRoundoff(tolerance)
        : floor
      for (const name of names)
        if (targets.get(name)! < floor - 1e-9) {
          targets.set(name, tunedFloor)
          changed = true
        }
    }
    if (!changed) break
  }
  return targets
}

export function pairLengthReports(
  input: SimpleRouteJson,
  traces: Trace[],
): BusLengthReport[] {
  return busLengthReports(
    {
      ...input,
      buses: (input.differentialPairs ?? []).map((p, i) => ({
        busId: `pair_${i}`,
        connectionNames: p.connectionNames,
        maxLengthSkew: p.lengthTolerance,
      })),
    },
    traces,
  )
}

/** Remaining carrier budget after immutable copper and generated escapes. */
export function maximumCarrierLength(
  input: SimpleRouteJson,
  name: ConnectionName,
): number {
  let maximum = Infinity
  for (const bus of input.buses ?? []) {
    if (!bus.connectionNames.includes(name)) continue
    maximum = Math.min(maximum, bus.maxLength ?? Infinity)
    if (bus.maxLengthSkew === undefined) continue
    for (const referenceName of bus.referenceConnectionNames ?? []) {
      if (
        input.connections.some(
          (connection) => connection.name === referenceName,
        )
      )
        continue
      let referenceTolerance = bus.maxLengthSkew
      if (bus.skewReference === "mean") referenceTolerance *= 2
      maximum = Math.min(
        maximum,
        fixedRouteLength(input, referenceName) + referenceTolerance,
      )
    }
  }
  if (!Number.isFinite(maximum)) return maximum
  return maximum - fixedRouteLength(input, name)
}

export function assertLengthTargets(
  input: SimpleRouteJson,
  targets: ReadonlyMap<ConnectionName, number>,
): void {
  for (const bus of input.buses ?? [])
    if (
      bus.maxLength !== undefined &&
      bus.connectionNames.some(
        (name) => (targets.get(name) ?? Infinity) > bus.maxLength! + 1e-7,
      )
    )
      throw Error(
        `${bus.busId}: matching would exceed maximum length ${bus.maxLength} mm`,
      )
}
