import { effectiveCarrierLayers } from "../effective-carrier-layers"
import { distance, length } from "../geometry"
import { getSignalPathEndpoints } from "../measure-signal-path"
import type {
  Connection,
  ConnectionName,
  SimpleRouteJson,
  Terminal,
  Trace,
} from "../types"

function sameTerminal(a: Terminal, b: Terminal) {
  return a.layer === b.layer && distance(a, b) < 1e-6
}

export interface RoutedLengthWindow {
  connection: Connection
  trace: Trace
  from: Terminal
  to: Terminal
  allowedLayers: string[]
  initialMm: number
  minMm: number
  maxMm: number
  targetMm: number
}

/** Intersect the absolute windows and share skew slack between signals that
 * have to match. Absolute targets and reference signals can span several buses. */
export function getRoutedLengthWindows(
  input: SimpleRouteJson,
  traces: Trace[],
) {
  const buses = (input.buses ?? []).filter(
    (bus) =>
      bus.minLength !== undefined ||
      bus.maxLength !== undefined ||
      bus.maxLengthSkew !== undefined,
  )
  const windows = new Map<ConnectionName, RoutedLengthWindow>()
  const anchors = new Map<ConnectionName, number>()
  const skew = new Map<ConnectionName, Map<ConnectionName, number>>()
  for (const connection of input.connections) {
    const name = connection.name
    const related = buses.filter(
      (bus) =>
        bus.connectionNames.includes(name) ||
        bus.referenceConnectionNames?.includes(name),
    )
    if (!related.length) continue
    const members = related.filter((bus) => bus.connectionNames.includes(name))
    const selected = related
      .flatMap((bus) => bus.lengthMatchingPaths ?? [])
      .filter((path) => path.connectionName === name)
    const path =
      selected[0] && getSignalPathEndpoints({ input, path: selected[0] })
    const [from, to] = path ? [path.from, path.to] : connection.pointsToConnect
    if (!from || !to || (!path && connection.pointsToConnect.length !== 2))
      throw new Error(`A timed branch needs two selected terminals on ${name}`)
    for (const other of selected.slice(1)) {
      const endpoints = getSignalPathEndpoints({ input, path: other })
      if (
        ![endpoints.from, endpoints.to].every(
          (p) => sameTerminal(p, from) || sameTerminal(p, to),
        )
      )
        throw new Error(
          `Multiple distinct timing paths on ${name} require separate carriers`,
        )
    }
    const trace = traces.find(
      (trace) =>
        trace.connection_name === name &&
        [from, to].every((terminal) =>
          [trace.route[0], trace.route.at(-1)].some(
            (point) =>
              point?.route_type === "wire" && sameTerminal(point, terminal),
          ),
        ),
    )
    if (!trace)
      throw new Error(
        `No routed carrier between the timed terminals of ${name}`,
      )
    const minMm = Math.max(0, ...members.map((bus) => bus.minLength ?? 0))
    const maxMm = Math.min(
      Infinity,
      ...members.map((bus) => bus.maxLength ?? Infinity),
    )
    if (minMm > maxMm) throw new Error(`Disjoint length windows for ${name}`)
    const initialMm = length(trace.route)
    if (minMm > 0 && Number.isFinite(maxMm))
      anchors.set(name, (minMm + maxMm) / 2)
    windows.set(name, {
      connection,
      trace,
      from,
      to,
      minMm,
      maxMm,
      initialMm,
      targetMm: Math.max(minMm, Math.min(maxMm, initialMm)),
      allowedLayers: effectiveCarrierLayers(input, connection),
    })
    skew.set(name, new Map())
  }
  for (const bus of buses) {
    if (bus.maxLengthSkew === undefined) continue
    const names = [
      ...new Set([
        ...bus.connectionNames,
        ...(bus.referenceConnectionNames ?? []),
      ]),
    ]
    const subjects =
      bus.skewReference === "references" ? bus.connectionNames : names
    const references =
      bus.skewReference === "references"
        ? (bus.referenceConnectionNames ?? [])
        : names
    for (const subject of subjects) {
      for (const reference of references) {
        if (subject === reference) continue
        for (const [from, to] of [
          [subject, reference],
          [reference, subject],
        ]) {
          const neighbors = skew.get(from)
          if (!neighbors || !windows.has(to))
            throw new Error(`Missing routed member of ${bus.busId}`)
          neighbors.set(
            to,
            Math.min(neighbors.get(to) ?? Infinity, bus.maxLengthSkew),
          )
        }
      }
    }
  }
  // Propagate the lower absolute bound along skew edges. This detects
  // contradictory windows before any geometry is changed.
  for (let pass = 0; pass < windows.size; pass++) {
    let changed = false
    for (const [name, window] of windows)
      for (const [neighbor, tolerance] of skew.get(name)!) {
        const lower = windows.get(neighbor)!.minMm - tolerance
        if (lower <= window.minMm + 1e-9) continue
        if (lower > window.maxMm + 1e-8)
          throw new Error(
            `Infeasible timing windows for ${name} and ${neighbor}`,
          )
        window.minMm = lower
        changed = true
      }
    if (!changed) break
  }
  for (const [name, window] of windows) {
    const distanceToAnchor = new Map([[name, 0]])
    const visited = new Set<ConnectionName>()
    let anchor: number | undefined
    while (true) {
      const nearest = [...distanceToAnchor]
        .filter(([n]) => !visited.has(n))
        .sort((a, b) => a[1] - b[1])[0]
      if (!nearest) break
      const [current, distance] = nearest
      visited.add(current)
      anchor = anchors.get(current)
      if (anchor !== undefined) break
      for (const [other, tolerance] of skew.get(current)!) {
        if (distance + tolerance < (distanceToAnchor.get(other) ?? Infinity))
          distanceToAnchor.set(other, distance + tolerance)
      }
    }
    window.targetMm = Math.max(
      window.minMm,
      Math.min(
        window.maxMm,
        anchor ??
          Math.max(...[...visited].map((n) => windows.get(n)!.initialMm)),
      ),
    )
  }
  // The shortest-path envelope of the preferred lengths satisfies every
  // pairwise difference bound. The propagated lower bounds make lowering safe.
  for (let pass = 0; pass < windows.size; pass++) {
    let changed = false
    for (const [name, window] of windows)
      for (const [neighbor, tolerance] of skew.get(name)!) {
        const upper = windows.get(neighbor)!.targetMm + tolerance
        if (window.targetMm <= upper + 1e-9) continue
        window.targetMm = upper
        changed = true
      }
    if (!changed) break
  }
  for (const [name, window] of windows) {
    for (const [neighbor, tolerance] of skew.get(name)!) {
      const remaining =
        tolerance - Math.abs(window.targetMm - windows.get(neighbor)!.targetMm)
      const halfSlack = Math.max(0, remaining / 2 - 1e-7)
      window.minMm = Math.max(window.minMm, window.targetMm - halfSlack)
      window.maxMm = Math.min(window.maxMm, window.targetMm + halfSlack)
    }
  }
  return [...windows.values()]
}
