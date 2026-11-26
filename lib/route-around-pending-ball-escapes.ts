import { BusLanesSolver } from "./bus-lanes-solver"
import { getPendingBallChannelEscapes } from "./pending-ball-channel-escapes"
import type { SimpleRouteJson, SolverOptions, Trace } from "./types"

/** If a bus closes a pending channel, move the planar lanes blocking its nearest via.
 * The remaining lanes and all supplied copper stay fixed during the search. */
export function* routeAroundPendingBallEscapes(
  { input, traces }: { input: SimpleRouteJson; traces: Trace[] },
  options: SolverOptions,
): Generator<void, Trace[]> {
  if (
    input.allowedLayers?.length !== 2 ||
    !input.allowedLayers.includes("top") ||
    !input.allowedLayers.includes("bottom") ||
    input.allowBlindAndBuriedVias ||
    input.obstacles.some((obstacle) => obstacle.isNonPlatedHole) ||
    input.differentialPairs?.length ||
    !input.buses?.length ||
    input.buses.some(
      (bus) =>
        bus.maxLengthSkew !== undefined ||
        bus.minLength !== undefined ||
        bus.maxLength !== undefined,
    )
  )
    return traces

  const { reservations, blockingLanes } = getPendingBallChannelEscapes(
    input,
    traces,
  )
  if (!blockingLanes.size) return traces
  const connections = input.connections.filter((connection) =>
    blockingLanes.has(connection.name),
  )
  if (
    connections.length !== blockingLanes.size ||
    connections.some(
      ({ pointsToConnect }) =>
        pointsToConnect.length !== 2 ||
        pointsToConnect[0].layer !== pointsToConnect[1].layer,
    ) ||
    traces.some(
      (trace) =>
        blockingLanes.has(trace.connection_name!) &&
        trace.route.some((point) => point.route_type !== "wire"),
    )
  )
    return traces

  const solver = new BusLanesSolver(
    {
      ...input,
      connections,
      buses: input.buses.map((bus) => ({
        ...bus,
        connectionNames: bus.connectionNames.filter((name) =>
          blockingLanes.has(name),
        ),
      })),
      traces: [
        ...(input.traces ?? []),
        ...traces.filter((trace) => !blockingLanes.has(trace.connection_name!)),
        ...reservations,
      ],
    },
    options,
  )
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      yield
    }
    if (!solver.solved) return traces
    const replacementByName = new Map(
      solver.traces.map((trace) => [trace.connection_name, trace]),
    )
    const candidate = traces.map(
      (trace) => replacementByName.get(trace.connection_name) ?? trace,
    )
    const remaining = getPendingBallChannelEscapes(input, candidate)
    return remaining.blockingLanes.size ? traces : candidate
  } finally {
    if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
  }
}
