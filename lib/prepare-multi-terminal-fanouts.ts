import { distance } from "./geometry"
import { effectiveCarrierLayers } from "./effective-carrier-layers"
import {
  BusLanesPipelineSolver,
  type BusLanesPipelineOptions,
} from "./bus-lanes-pipeline-solver"
import { initialSignalDogbones } from "./initial-signal-dogbones"
import { isUnroutedComponentPad } from "./is-unrouted-component-pad"
import type { Connection, SimpleRouteJson, Trace } from "./types"

/** Reserve actual escapes for every terminal of a fresh branched net before
 * unrelated carriers can close its pad exits. Geometry is board-world mm,
 * +X right and +Y up. Supplied copper and physical pads stay immutable. */
export function* prepareMultiTerminalFanouts({
  input,
  connections,
  options,
}: {
  input: SimpleRouteJson
  connections: Connection[]
  options: BusLanesPipelineOptions
}): Generator<
  void,
  { connections: Connection[]; traces: Trace[]; escapes: Trace[] }
> {
  const traces: Trace[] = []
  const generatedEscapes: Trace[] = []
  const branched = connections.filter(
    (connection) => connection.pointsToConnect.length > 2,
  )
  if (
    input.traces?.length ||
    branched.some(
      (connection) =>
        new Set(connection.pointsToConnect.map((point) => point.layer)).size <
        2,
    ) ||
    branched.some((connection) =>
      connection.pointsToConnect.some(
        (point) => !isUnroutedComponentPad(input, connection, point),
      ),
    )
  )
    return { connections, traces, escapes: generatedEscapes }
  const prepared = structuredClone(connections)
  for (const connection of prepared.filter(
    (connection) => connection.pointsToConnect.length > 2,
  )) {
    const nativeLayers = new Set(
      connection.pointsToConnect.map((point) => point.layer),
    )
    const allowed = effectiveCarrierLayers(input, connection)
    const targetLayer =
      allowed.find((layer) => !nativeLayers.has(layer)) ?? allowed[0]
    if (!targetLayer)
      throw Error("No permitted carrier for a branched connection")
    for (
      let terminalIndex = 0;
      terminalIndex < connection.pointsToConnect.length;
      terminalIndex += 2
    ) {
      const terminals = [
        connection.pointsToConnect[terminalIndex],
        connection.pointsToConnect[terminalIndex + 1] ??
          connection.pointsToConnect[0],
      ]
      const result = initialSignalDogbones(
        {
          ...input,
          connections: [{ ...connection, pointsToConnect: terminals }],
          buses: [],
          differentialPairs: [],
          traces,
        },
        {
          targetLayers: new Map([[connection.name, targetLayer]]),
          viaDiameter: input.minViaPadDiameter ?? 0.6,
          viaHoleDiameter: input.minViaHoleDiameter ?? 0.3,
          traceWidth:
            connection.nominalTraceWidth ??
            connection.width ??
            input.minTraceWidth,
          clearance:
            input.minTraceToPadEdgeClearance ??
            input.defaultObstacleMargin ??
            0.075,
          boardEdgeClearance: input.minBoardEdgeClearance,
          holeToHoleClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
        },
        0,
      )
      const escapes: Trace[] = result.traces.map((trace) => ({
        ...trace,
        pcb_trace_id: `multi_terminal_escape_${terminalIndex}_${trace.pcb_trace_id}`,
        source_trace_id: connection.source_trace_id ?? connection.name,
      })) as Trace[]
      for (const [
        index,
        point,
      ] of result.connections[0].pointsToConnect.entries()) {
        if (terminalIndex + index >= connection.pointsToConnect.length) continue
        const escape = escapes.find(
          (trace) => distance(trace.route[0], terminals[index]) < 1e-8,
        )
        const via = escape?.route.find((point) => point.route_type === "via")
        connection.pointsToConnect[terminalIndex + index] = {
          ...point,
          layer: "layer" in point ? point.layer : targetLayer,
          ...(via?.route_type === "via" ? { layers: via.layers } : {}),
        }
      }
      traces.push(...escapes)
      generatedEscapes.push(...escapes)
    }
  }
  // Finish the local termination branches while their package exits are still
  // clear. The global carrier then connects the two primary handoffs around
  // these completed local fanouts, rather than trapping a later branch.
  const terminalCount = Math.max(
    ...prepared.map((connection) => connection.pointsToConnect.length),
  )
  for (let terminalIndex = 2; terminalIndex < terminalCount; terminalIndex++) {
    const branches = prepared
      .filter((connection) => connection.pointsToConnect[terminalIndex])
      .map((connection) => {
        const terminal = connection.pointsToConnect[terminalIndex]
        const attachment = connection.pointsToConnect
          .slice(0, 2)
          .sort((a, b) => distance(a, terminal) - distance(b, terminal))[0]
        return { ...connection, pointsToConnect: [attachment, terminal] }
      })
    const names = new Set(branches.map((connection) => connection.name))
    const solver = new BusLanesPipelineSolver(
      {
        ...input,
        connections: branches,
        traces,
        differentialPairs: [],
        buses: input.buses
          ?.filter((bus) => bus.connectionNames.some((name) => names.has(name)))
          .map((bus) => ({
            busId: bus.busId,
            name: bus.name,
            connectionNames: bus.connectionNames.filter((name) =>
              names.has(name),
            ),
            allowedLayers: bus.allowedLayers,
            traceWidth: bus.traceWidth,
            preferredLayer: bus.preferredLayer,
            preferredLayers: bus.preferredLayers,
          })),
      },
      options,
    )
    while (!solver.solved && !solver.failed) {
      solver.step()
      yield
    }
    if (!solver.solved)
      throw Error(solver.error ?? "Local termination routing failed")
    traces.push(
      ...solver.traces.map((trace) => ({
        ...trace,
        pcb_trace_id: `multi_terminal_local_${terminalIndex}_${trace.pcb_trace_id}`,
      })),
    )
  }
  return {
    connections: prepared.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.slice(0, 2),
    })),
    traces,
    escapes: generatedEscapes,
  }
}
