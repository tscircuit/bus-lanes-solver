import type { FlexibleSignalState } from "../../lib/flexible-signal-state"
import type { Connection, SimpleRouteJson, Trace } from "../../lib/types"
import { pendingPadAccessFixture } from "./pending-pad-access"

function translatedClosure({
  offset,
  suffix,
}: {
  offset: number
  suffix: string
}) {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  const rename = (name: string) => `${name}_${suffix}`
  const connection: Connection = {
    ...pendingConnection,
    name: rename(pendingConnection.name),
    pointsToConnect: pendingConnection.pointsToConnect.map((point) => ({
      ...point,
      x: point.x + offset,
      pcb_port_id: point.pcb_port_id && rename(point.pcb_port_id),
    })),
  }
  const traces = [upperLeft, lowerRight].map(
    (trace): Trace => ({
      ...trace,
      pcb_trace_id: rename(trace.pcb_trace_id),
      connection_name: rename(trace.connection_name!),
      route: trace.route.map((point) => ({ ...point, x: point.x + offset })),
    }),
  )
  return {
    connection,
    traces,
    obstacles: input.obstacles.map((obstacle) => ({
      ...obstacle,
      center: { ...obstacle.center, x: obstacle.center.x + offset },
      componentId: obstacle.componentId && rename(obstacle.componentId),
      connectedTo: obstacle.connectedTo.map(rename),
    })),
    rules: input,
  }
}

/** Two disjoint copies of the same collective-access conflict. Every route
 * has legal clearance, but each pair encloses a different pending native pad.
 * Repairing either pair leaves the other pair as an immutable local prefix.
 */
export function pendingIndependentClosuresFixture() {
  const closures = [
    translatedClosure({ offset: 0, suffix: "first" }),
    translatedClosure({ offset: 14, suffix: "second" }),
  ]
  const bounds = { minX: -6, maxX: 20, minY: -6, maxY: 6 }
  const outline = [
    { x: -6, y: -6 },
    { x: 20, y: -6 },
    { x: 20, y: 6 },
    { x: -6, y: 6 },
  ]
  const input: SimpleRouteJson = {
    ...closures[0].rules,
    bounds,
    outline,
    obstacles: closures.flatMap((closure) => closure.obstacles),
    connections: closures.flatMap((closure) =>
      closure.traces.map((trace) => ({
        name: trace.connection_name!,
        width: 0.1,
        pointsToConnect: [trace.route[0]!, trace.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: "top",
          }),
        ),
      })),
    ),
    pendingRoutingAccess: [
      {
        ...closures[0].rules.pendingRoutingAccess![0],
        bounds,
        outline,
        connections: closures.map((closure) => closure.connection),
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "supplied_unrelated",
        connection_name: "SUPPLIED",
        route: [
          { route_type: "wire", x: -5, y: -5, layer: "top", width: 0.1 },
          { route_type: "wire", x: -4, y: -5, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const previous: FlexibleSignalState = {
    native: input,
    pending: input,
    retained: [],
    traces: closures.flatMap((closure) => closure.traces),
    escapes: [],
  }
  return { input, previous, closures }
}
