import type { SimpleRouteJson, Trace, Via } from "../../lib/types"
import type { AnyCircuitElement } from "circuit-json"
import { checkViasInPads } from "@tscircuit/checks"

/** A native top wall makes a bottom bypass necessary. Both terminal pads are
 * explicit physical copper pads; no obstacle pattern or ID spelling is used
 * to derive their shapes. */
export const currentViaDrillFixture = ({
  allowViaInPad = false,
  shape = "circle",
}: { allowViaInPad?: boolean; shape?: "circle" | "rotated-rect" } = {}): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.1,
  minViaPadDiameter: 0.4,
  minViaHoleDiameter: 0.2,
  minViaEdgeToPadEdgeClearance: 0.1,
  allowViaInPad,
  allowedLayers: ["top", "bottom"],
  bounds: { minX: -1.4, maxX: 1.4, minY: -1, maxY: 1 },
  connections: [{ name: "SIGNAL", pointsToConnect: [
    { x: -1, y: 0, layer: "top", pcb_port_id: "PORT_A" },
    { x: 1, y: 0, layer: "top", pcb_port_id: "PORT_B" },
  ] }],
  obstacles: [...[-1, 1].map((x, index) => ({
    componentId: `package_${index}`,
    circuitJsonMetadata: { pcb_smtpad_id: `pad_${index}`, pcb_port_id: index ? "PORT_B" : "PORT_A" },
    type: "rect",
    ...(shape === "circle" ? { shape: "circle" as const } : { ccwRotationDegrees: 30 }),
    center: { x, y: 0 }, width: 0.4, height: shape === "circle" ? 0.4 : 0.2,
    layers: ["top"], connectedTo: ["SIGNAL", index ? "PORT_B" : "PORT_A"],
  })), {
    type: "rect", center: { x: 0, y: 0 }, width: 1.4, height: 2,
    layers: ["top"], connectedTo: ["WALL"],
  }],
  traces: [],
})

export const physicalViaPadErrors = (input: SimpleRouteJson, traces: readonly Trace[]) => {
  const board = { type: "pcb_board", pcb_board_id: "board", center: { x: 0, y: 0 },
    width: 2.8, height: 2, num_layers: input.layerCount, thickness: 1.6,
    is_via_in_pad_allowed: input.allowViaInPad ?? false }
  const pads = input.obstacles.flatMap((pad) => {
    const metadata = (pad as typeof pad & { circuitJsonMetadata?: { pcb_smtpad_id?: string } }).circuitJsonMetadata
    if (typeof metadata?.pcb_smtpad_id !== "string") return []
    return [{
    type: "pcb_smtpad", pcb_smtpad_id: metadata.pcb_smtpad_id,
    x: pad.center.x, y: pad.center.y, layer: pad.layers[0],
    ...(pad.shape === "circle"
      ? { shape: "circle", radius: pad.width / 2 }
      : { shape: pad.ccwRotationDegrees ? "rotated_rect" : "rect", width: pad.width,
          height: pad.height, ccw_rotation: pad.ccwRotationDegrees ?? 0 }),
  }]})
  const vias = traces.flatMap((trace) => trace.route.filter((point): point is Via => point.route_type === "via"))
    .map((via, index) => ({ type: "pcb_via", pcb_via_id: `via_${index}`, x: via.x, y: via.y,
      from_layer: via.from_layer, to_layer: via.to_layer, layers: via.layers ?? [via.from_layer, via.to_layer],
      hole_diameter: via.via_hole_diameter ?? input.minViaHoleDiameter!,
      outer_diameter: via.via_diameter ?? input.minViaPadDiameter! }))
  return checkViasInPads([board, ...pads, ...vias] as AnyCircuitElement[])
}

/** The circle drill is exactly tangent at y=.3; copper annuli still overlap
 * their owned pad. All foreign copper and board edges remain clear. */
export const legalTangentBypass: Trace = {
  type: "pcb_trace", pcb_trace_id: "legal-bypass", connection_name: "SIGNAL",
  route: [
    { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
    { route_type: "wire", x: -1, y: 0.3, layer: "top", width: 0.1 },
    { route_type: "via", x: -1, y: 0.3, from_layer: "top", to_layer: "bottom", layers: ["top", "bottom"], via_diameter: 0.4, via_hole_diameter: 0.2 },
    { route_type: "wire", x: -1, y: 0.3, layer: "bottom", width: 0.1 },
    { route_type: "wire", x: 1, y: 0.3, layer: "bottom", width: 0.1 },
    { route_type: "via", x: 1, y: 0.3, from_layer: "bottom", to_layer: "top", layers: ["top", "bottom"], via_diameter: 0.4, via_hole_diameter: 0.2 },
    { route_type: "wire", x: 1, y: 0.3, layer: "top", width: 0.1 },
    { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
  ],
}
