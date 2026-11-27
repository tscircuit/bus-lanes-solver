import {
  getCopperLayerNames,
  getRouteViaSpanLayers,
} from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "./bus-lanes-solver"
import { distance } from "./geometry"
import type {
  Connection,
  SimpleRouteJson,
  SolverOptions,
  Terminal,
  Trace,
  Via,
  Wire,
} from "./types"

export interface RouteViaOptimizationOptions<T extends Trace = Trace> {
  /** Audit the complete copper, including unchanged routes. Called before every
   * accepted edit, so integrations can enforce their own manufacturing rules. */
  validate: (traces: readonly T[]) => boolean
  /** Additional connection names whose routed copper must remain immutable. */
  protectedConnectionNames?: readonly string[]
  /** Maximum number of existing transitions considered in a single span. */
  maxViasPerSpan?: number
  /** Maximum number of replacement spans attempted across the board. */
  maxCandidates?: number
  /** Optional search padding in mm around each original span. */
  searchPadding?: number
  laneSolverOptions?: Pick<
    SolverOptions,
    "denseSearch" | "maxLaneIterations" | "maxSearchIterations"
  >
}

type RoutePoint = Wire | Via
type Replacement = { start: number; end: number; retain?: number }
type Board = Omit<SimpleRouteJson, "traces">
const JOIN_TOLERANCE_MM = 1e-7

function spansToReplace(
  route: readonly RoutePoint[],
  maxVias: number,
): Replacement[] {
  const offsets = route.flatMap((point, index) =>
    point.route_type === "via" ? [index] : [],
  )
  const spans: Replacement[] = []
  // A longer detour can traverse an obstacle that makes each individual
  // return to the original layer necessary. Try those spans before local cuts.
  for (let count = Math.min(maxVias, offsets.length); count >= 2; count--) {
    for (let offset = 0; offset + count <= offsets.length; offset++) {
      const before = offsets[offset] - 1
      const after = offsets[offset + count - 1] + 1
      const outerStart = (offsets[offset - 1] ?? -1) + 1
      const outerEnd = (offsets[offset + count] ?? route.length) - 1
      if (outerStart > before || outerEnd < after) continue
      const anchors = [
        [outerStart, outerEnd],
        [before, after],
        [
          Math.floor((before + outerStart) / 2),
          Math.ceil((after + outerEnd) / 2),
        ],
      ] as const
      const seen = new Set<string>()
      for (const [start, end] of anchors) {
        const key = `${start}:${end}`
        if (seen.has(key)) continue
        seen.add(key)
        if (count % 2 === 0) {
          spans.push({ start, end })
        } else {
          // Between different endpoint layers at least one transition remains
          // necessary. Keep an already drilled site with the right direction.
          for (let index = offset; index < offset + count; index += 2) {
            spans.push({ start, end, retain: offsets[index] })
          }
        }
      }
    }
  }
  return spans
}

function rankReplacementSpans(
  route: readonly RoutePoint[],
  maxViasPerSpan: number,
  minTraceWidth: number,
): Replacement[] {
  const pathLengths = [0]
  const viaCounts = [0]
  for (let i = 1; i < route.length; i++) {
    pathLengths[i] = pathLengths[i - 1] + distance(route[i - 1], route[i])
    viaCounts[i] = viaCounts[i - 1] + Number(route[i].route_type === "via")
  }
  return spansToReplace(route, maxViasPerSpan)
    .map((span) => {
      const eliminated =
        viaCounts[span.end] -
        viaCounts[span.start] -
        Number(span.retain !== undefined)
      const length = pathLengths[span.end] - pathLengths[span.start]
      // Prefer the spans that remove many transitions without disturbing large
      // stretches of the original lane.
      return { span, priority: eliminated / Math.max(length, minTraceWidth) }
    })
    .sort((a, b) => b.priority - a.priority)
    .map(({ span }) => span)
}

function containsTerminal(wire: Wire, terminal: Terminal): boolean {
  return (
    (terminal.layers ?? [terminal.layer]).includes(wire.layer) &&
    distance(wire, terminal) <= JOIN_TOLERANCE_MM
  )
}

function ownsCompleteRoute(trace: Trace, connection: Connection): boolean {
  const first = trace.route[0]
  const last = trace.route.at(-1)
  if (first?.route_type !== "wire" || last?.route_type !== "wire") return false
  const [a, b] = connection.pointsToConnect
  return (
    (containsTerminal(first, a) && containsTerminal(last, b)) ||
    (containsTerminal(first, b) && containsTerminal(last, a))
  )
}

function localBounds(
  board: Board,
  span: readonly RoutePoint[],
  padding: number | undefined,
): Board["bounds"] {
  if (padding === undefined) return board.bounds
  return {
    minX: Math.max(
      board.bounds.minX,
      Math.min(...span.map((p) => p.x)) - padding,
    ),
    maxX: Math.min(
      board.bounds.maxX,
      Math.max(...span.map((p) => p.x)) + padding,
    ),
    minY: Math.max(
      board.bounds.minY,
      Math.min(...span.map((p) => p.y)) - padding,
    ),
    maxY: Math.min(
      board.bounds.maxY,
      Math.max(...span.map((p) => p.y)) + padding,
    ),
  }
}

function solvePlanarSpan({
  input,
  connection,
  start,
  end,
  fixed,
  bounds,
  solverOptions,
}: {
  input: Board
  connection: Connection
  start: Wire
  end: Wire
  fixed: Trace[]
  bounds: Board["bounds"]
  solverOptions: RouteViaOptimizationOptions["laneSolverOptions"]
}): Wire[] | undefined {
  if (
    start.layer !== end.layer ||
    input.allowedLayers?.includes(start.layer) === false
  ) {
    return undefined
  }
  if (distance(start, end) <= JOIN_TOLERANCE_MM) return [start, end]
  const terminals = [start, end].map(({ x, y, layer }) => ({ x, y, layer }))
  const solver = new BusLanesSolver(
    {
      ...input,
      bounds,
      allowedLayers: [start.layer],
      traces: fixed,
      buses: [],
      differentialPairs: [],
      connections: [
        {
          ...connection,
          pointsToConnect: terminals,
          width: start.width,
          nominalTraceWidth: start.width,
        },
      ],
    },
    {
      denseSearch: true,
      maxLaneIterations: 2500,
      maxSearchIterations: 5000,
      ...solverOptions,
    },
  )
  solver.solve()
  const route = solver.traces[0]?.route
  if (
    !solver.solved ||
    solver.traces.length !== 1 ||
    !route ||
    route.length < 2 ||
    !route.every(
      (point): point is Wire =>
        point.route_type === "wire" &&
        point.layer === start.layer &&
        point.width === start.width,
    )
  )
    return undefined

  const first = route[0]
  const last = route.at(-1)!
  if (
    distance(start, first) <= JOIN_TOLERANCE_MM &&
    distance(end, last) <= JOIN_TOLERANCE_MM
  )
    return route
  if (
    distance(start, last) <= JOIN_TOLERANCE_MM &&
    distance(end, first) <= JOIN_TOLERANCE_MM
  )
    return route.toReversed()
  return undefined
}

function replaceSpan({
  input,
  trace,
  connection,
  span,
  otherTraces,
  options,
}: {
  input: Board
  trace: Trace
  connection: Connection
  span: Replacement
  otherTraces: Trace[]
  options: Pick<
    RouteViaOptimizationOptions,
    "searchPadding" | "laneSolverOptions"
  >
}): RoutePoint[] | undefined {
  const start = trace.route[span.start]
  const end = trace.route[span.end]
  if (
    start?.route_type !== "wire" ||
    end?.route_type !== "wire" ||
    start.width !== end.width
  )
    return undefined
  const removed = trace.route.slice(span.start, span.end + 1)
  // Changing width or removing an intermediate port attachment would change
  // the physical net contract even if the two selected anchors still join.
  if (
    removed.some(
      (point, i) =>
        point.route_type === "wire" &&
        (point.width !== start.width ||
          (i > 0 &&
            i < removed.length - 1 &&
            (point.start_pcb_port_id || point.end_pcb_port_id))),
    )
  )
    return undefined
  const prefix = trace.route.slice(0, span.start + 1)
  const suffix = trace.route.slice(span.end)
  const bounds = localBounds(input, removed, options.searchPadding)
  const fragments = [prefix, suffix]
  const retained =
    span.retain === undefined ? undefined : trace.route[span.retain]
  const crossing =
    retained?.route_type === "via"
      ? {
          entry: {
            route_type: "wire" as const,
            x: retained.x,
            y: retained.y,
            layer: retained.from_layer,
            width: start.width,
          },
          via: retained,
          exit: {
            route_type: "wire" as const,
            x: retained.x,
            y: retained.y,
            layer: retained.to_layer,
            width: start.width,
          },
        }
      : undefined
  if (crossing) fragments.push([crossing.entry, crossing.via, crossing.exit])
  const fixed = [
    ...otherTraces,
    ...fragments.map((route) => ({ ...trace, route })),
  ]
  const solve = (a: Wire, b: Wire) =>
    solvePlanarSpan({
      input,
      connection,
      start: a,
      end: b,
      fixed,
      bounds,
      solverOptions: options.laneSolverOptions,
    })

  if (!crossing) {
    const lane = solve(start, end)
    return lane ? [...prefix, ...lane.slice(1, -1), ...suffix] : undefined
  }
  const left = solve(start, crossing.entry)
  const right = left && solve(crossing.exit, end)
  if (!left || !right) return undefined
  return [
    ...prefix,
    ...(distance(start, crossing.entry) > JOIN_TOLERANCE_MM
      ? left.slice(1)
      : []),
    crossing.via,
    ...(distance(crossing.exit, end) > JOIN_TOLERANCE_MM
      ? right.slice(0, -1)
      : []),
    ...suffix,
  ]
}

function countPhysicalVias(input: Board, traces: readonly Trace[]): number {
  const sites = new Set<string>()
  const layerNames = getCopperLayerNames(input.layerCount)
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const layers = getRouteViaSpanLayers({
        fromLayer: point.from_layer,
        toLayer: point.to_layer,
        layers: point.layers,
        layerNames,
        allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
      })
      sites.add(`${point.x},${point.y},${layers.join(",")}`)
    }
  }
  return sites.size
}

/** Reduce drilled vias on a complete, audited routing. Existing constrained
 * nets, split routes, fixed copper and terminal anchors stay in place. */
export function optimizeRouteVias<T extends Trace>(
  input: Board & { traces: readonly T[] },
  options: RouteViaOptimizationOptions<T>,
): T[] {
  const { traces: copper, ...board } = input
  const { maxViasPerSpan = 6, maxCandidates = 1000, searchPadding } = options
  if (!Number.isInteger(maxViasPerSpan) || maxViasPerSpan < 2)
    throw Error("maxViasPerSpan must be an integer of at least two")
  if (!Number.isInteger(maxCandidates) || maxCandidates < 0)
    throw Error("maxCandidates must be a nonnegative integer")
  if (
    searchPadding !== undefined &&
    (!Number.isFinite(searchPadding) || searchPadding < 0)
  )
    throw Error("searchPadding must be finite and nonnegative")
  if (!options.validate(copper))
    throw Error("Via optimization requires valid pre-routed copper")

  const traces = [...copper]
  const protectedNames = new Set([
    ...(options.protectedConnectionNames ?? []),
    ...(input.differentialPairs?.flatMap((pair) => pair.connectionNames) ?? []),
    ...(input.buses?.flatMap((bus) => [
      ...bus.connectionNames,
      ...(bus.referenceConnectionNames ?? []),
      ...(bus.lengthMatchingPaths?.map((path) => path.connectionName) ?? []),
    ]) ?? []),
  ])
  const eligible = input.connections
    .flatMap((connection) => {
      if (
        connection.pointsToConnect.length !== 2 ||
        protectedNames.has(connection.name)
      )
        return []
      const owned = traces.flatMap((trace, index) =>
        trace.connection_name === connection.name ||
        trace.source_trace_id ===
          (connection.source_trace_id ?? connection.name)
          ? [{ trace, index }]
          : [],
      )
      if (owned.length !== 1) return []
      const [{ trace, index }] = owned
      if (
        trace.isFixed ||
        trace.curvedSegments?.length ||
        trace.coupledSection ||
        !ownsCompleteRoute(trace, connection)
      )
        return []
      const vias = trace.route.filter(
        (point) => point.route_type === "via",
      ).length
      return vias >= 2 ? [{ connection, index, vias }] : []
    })
    .sort((a, b) => b.vias - a.vias || a.index - b.index)

  let remaining = maxCandidates
  let viaCount = countPhysicalVias(board, traces)
  const getSpans = (index: number) =>
    rankReplacementSpans(
      traces[index].route,
      maxViasPerSpan,
      input.minTraceWidth,
    )
  let pending = eligible.map((route) => ({
    ...route,
    spans: getSpans(route.index),
    cursor: 0,
  }))
  // Share the global budget in rounds. A densely routed connection can have
  // hundreds of candidate spans and should not starve the other connections.
  while (remaining > 0 && pending.length > 0) {
    for (const candidate of pending) {
      if (remaining === 0) break
      const { index, connection } = candidate
      const span = candidate.spans[candidate.cursor++]
      if (!span) continue
      remaining--
      const trace = traces[index]
      const otherTraces = traces.filter((_, i) => i !== index)
      const route = replaceSpan({
        input: board,
        trace,
        connection,
        span,
        otherTraces,
        options,
      })
      if (!route) continue
      const proposal = traces.with(index, { ...trace, route })
      const proposedViaCount = countPhysicalVias(board, proposal)
      if (proposedViaCount >= viaCount || !options.validate(proposal)) continue
      traces[index] = proposal[index]
      viaCount = proposedViaCount
      candidate.spans = getSpans(index)
      candidate.cursor = 0
    }
    pending = pending.filter(
      (candidate) => candidate.cursor < candidate.spans.length,
    )
  }
  return traces
}
