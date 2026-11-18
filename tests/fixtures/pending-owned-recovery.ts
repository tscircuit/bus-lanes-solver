import type { FlexibleSignalState } from "../../lib/flexible-signal-state"
import type { Connection, Trace } from "../../lib/types"
import { pendingPadAccessFixture } from "./pending-pad-access"

export type PendingOwnerAlias = "name" | "source_trace_id" | "terminal"

/** Current and later phases may route different branches of the same net.
 * The current phase can manufacture a 0.4 mm via that the later phase reuses
 * as existing copper, even when its own new-via land would have to be 8 mm.
 */
export function pendingOwnedRecoveryFixture(alias: PendingOwnerAlias) {
  const { input, pendingConnection, upperLeft, lowerRight } =
    pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter((obstacle) => obstacle.componentId)
  input.pendingRoutingAccess![0].minViaPadDiameter = 8
  const frozen = [upperLeft, lowerRight].map((trace) => ({
    ...trace,
    route: trace.route.map((point) => ({
      ...point,
      x: point.x * 1.5,
      y: point.y * 1.5,
    })),
  }))
  const ownerName =
    alias === "name"
      ? pendingConnection.name
      : alias === "terminal"
        ? "cpu_strobe"
        : "CURRENT_BRANCH"
  if (alias === "source_trace_id")
    pendingConnection.source_trace_id = "shared_source"
  const currentConnection: Connection = {
    name: ownerName,
    source_trace_id: pendingConnection.source_trace_id,
    width: 0.1,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "cpu_strobe" },
      { x: -4, y: -4, layer: "top" },
    ],
  }
  const owned: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "current_owned_branch",
    connection_name: currentConnection.name,
    source_trace_id: currentConnection.source_trace_id,
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0.5, y: 0.5, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 0.5,
        y: 0.5,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: 0.5, y: 0.5, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: -3.5, y: -3.5, layer: "bottom", width: 0.1 },
      {
        route_type: "via",
        x: -3.5,
        y: -3.5,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.4,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: -3.5, y: -3.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: -4, y: -4, layer: "top", width: 0.1 },
    ],
  }
  input.connections = [
    ...frozen.map(
      (trace): Connection => ({
        name: trace.connection_name!,
        width: 0.1,
        pointsToConnect: [trace.route[0]!, trace.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: "top",
          }),
        ),
      }),
    ),
    currentConnection,
  ]
  const previous: FlexibleSignalState = {
    native: input,
    pending: input,
    escapes: [],
    retained: frozen,
    traces: [owned],
  }
  return {
    input,
    previous,
    frozen,
    owned,
    currentConnection,
    pendingConnection,
  }
}
