import type { SimpleRouteJson, Trace, Via } from "../../lib/types"
import { pendingPadAccessFixture } from "./pending-pad-access"

/** Native board-world geometry in mm. The C-shaped current trace leaves a
 * narrow opening that preserves a supplied 0.05 mm conductor, but not a new
 * 0.5 mm future trace. The supplied conductor already exits the CPU field.
 * Parallel legal current traces block every new wide handoff at that exit.
 * This demonstrates existing physical egress, not future full-route proof. */
export function fixedEgressFixture(topology: "wire" | "via_chain" = "via_chain") {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.layerCount = topology === "via_chain" ? 4 : 2
  input.minTraceWidth = 0.05
  input.minTraceToPadEdgeClearance = 0.05
  input.minViaPadDiameter = 0.2
  input.minViaHoleDiameter = 0.1
  input.allowBlindAndBuriedVias = true
  pendingConnection.width = 0.5
  pendingConnection.source_trace_id = "shared_future_source"
  const intent = input.pendingRoutingAccess![0]
  intent.minTraceWidth = 0.5
  intent.minTraceToPadEdgeClearance = 0.1
  intent.minViaPadDiameter = 20
  intent.allowedLayers = ["top"]
  intent.allowBlindAndBuriedVias = false
  const owned = (id: string, route: Trace["route"]): Trace => ({
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: pendingConnection.name,
    source_trace_id: pendingConnection.source_trace_id,
    route,
  })
  const entryVia: Via = {
    route_type: "via", x: 0, y: 0.3,
    from_layer: "top", to_layer: "inner1", layers: ["top", "inner1"],
    via_diameter: 0.2, via_hole_diameter: 0.1,
  }
  const exitVia: Via = {
    route_type: "via", x: -1, y: 3,
    from_layer: "inner1", to_layer: "top", layers: ["top", "inner1"],
    via_diameter: 0.2, via_hole_diameter: 0.1,
  }
  input.traces = topology === "wire" ? [owned("supplied_surface_egress", [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.05 },
    { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.05 },
    { route_type: "wire", x: -1, y: 1, layer: "top", width: 0.05 },
    { route_type: "wire", x: -1, y: 3, layer: "top", width: 0.05 },
  ])] : [
    owned("supplied_entry", [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.05 },
      { route_type: "wire", x: 0, y: 0.3, layer: "top", width: 0.05 },
      entryVia,
    ]),
    owned("supplied_inner_link", [
      { route_type: "wire", x: 0, y: 0.3, layer: "inner1", width: 0.05 },
      { route_type: "wire", x: -1, y: 0.3, layer: "inner1", width: 0.05 },
      { route_type: "wire", x: -1, y: 3, layer: "inner1", width: 0.05 },
    ]),
    owned("supplied_return", [exitVia]),
  ]
  const addedCopper: Trace[] = [
    {
      type: "pcb_trace", pcb_trace_id: "foreign_native_enclosure", connection_name: "ENCLOSURE",
      route: [
        { route_type: "wire", x: -0.2, y: 0.7, layer: "top", width: 0.05 },
        { route_type: "wire", x: -0.7, y: 0.7, layer: "top", width: 0.05 },
        { route_type: "wire", x: -0.7, y: -0.7, layer: "top", width: 0.05 },
        { route_type: "wire", x: 0.7, y: -0.7, layer: "top", width: 0.05 },
        { route_type: "wire", x: 0.7, y: 0.7, layer: "top", width: 0.05 },
        { route_type: "wire", x: 0.2, y: 0.7, layer: "top", width: 0.05 },
      ],
    },
    ...[-1.2, -0.8].map((x, index): Trace => ({
      type: "pcb_trace", pcb_trace_id: `foreign_exit_rail_${index}`, connection_name: `EXIT_RAIL_${index}`,
      route: [
        { route_type: "wire", x, y: 2, layer: "top", width: 0.05 },
        { route_type: "wire", x, y: 3.75, layer: "top", width: 0.05 },
      ],
    })),
  ]
  input.connections = addedCopper.map((trace) => ({
    name: trace.connection_name!, width: 0.05,
    pointsToConnect: [trace.route[0], trace.route.at(-1)!].map((point) => ({
      x: point.x, y: point.y, layer: "top",
    })),
  }))
  return { input, pendingConnection, addedCopper, outside: { x: -1, y: 3 }, topology }
}

export function futureInput(input: SimpleRouteJson): SimpleRouteJson {
  return {
    ...input.pendingRoutingAccess![0],
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    traces: input.traces,
  }
}

export function withCandidate(input: SimpleRouteJson, addedCopper: readonly Trace[]): SimpleRouteJson {
  return { ...input, traces: [...(input.traces ?? []), ...addedCopper] }
}
