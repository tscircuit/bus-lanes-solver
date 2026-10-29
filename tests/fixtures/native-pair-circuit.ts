import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, Trace } from "../../lib"

/** Circuit JSON for the small synthetic isolation controls; no SVG drawing. */
export function nativePairCircuit(
  input: SimpleRouteJson,
  traces: Trace[],
  title: string,
): AnyCircuitElement[] {
  const b = input.bounds
  const pads = input.obstacles.length
    ? input.obstacles
    : input.connections.flatMap((c) =>
        c.pointsToConnect.map((p) => ({
          center: p,
          width: input.minTraceWidth,
          componentId: undefined,
        })),
      )
  return [
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
      outline: input.outline,
      thickness: 1.6,
      material: "fr4",
      num_layers: input.layerCount,
    },
    ...pads.map((o, i) => ({
      type: "pcb_smtpad",
      pcb_smtpad_id: `pad_${i}`,
      pcb_component_id: o.componentId,
      pcb_port_id: `port_${i}`,
      shape: "circle",
      x: o.center.x,
      y: o.center.y,
      radius: o.width / 2,
      layer: "top",
    })),
    ...traces,
    ...traces.flatMap((t) =>
      t.route
        .filter((p) => p.route_type === "via")
        .map((p, i) => ({
          type: "pcb_via",
          pcb_via_id: `${t.pcb_trace_id}_via_${i}`,
          x: p.x,
          y: p.y,
          outer_diameter: p.via_diameter,
          hole_diameter: p.via_hole_diameter,
          layers: p.layers ?? [p.from_layer, p.to_layer],
        })),
    ),
    {
      type: "pcb_silkscreen_text",
      pcb_silkscreen_text_id: "status",
      anchor_position: { x: (b.minX + b.maxX) / 2, y: b.maxY - 0.7 },
      text: title,
      font: "tscircuit2024",
      font_size: 0.25,
      anchor_alignment: "center",
      layer: "top",
    },
  ] as AnyCircuitElement[]
}
