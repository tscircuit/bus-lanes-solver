import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import type { Point, SimpleRouteJson, Trace, Via } from "../lib/types"

type NativeSrj = Parameters<typeof validateRoutedCopperDrc>[0]["inputSrj"]
type ViaDrill = { center: Point; radius: number; layers: string[] }
export interface H3NativeCarrierValidation {
  connectivity: ReturnType<typeof validateOriginalEndpointConnectivity>
  copperDrc: ReturnType<typeof validateRoutedCopperDrc>
  drillPadOverlaps: Array<{ connectionName: string | undefined; componentId: string | undefined; center: Point }>
  uniqueViaDrillCount: number
}

function drillForVia(via: Via): ViaDrill {
  if (via.via_hole_diameter === undefined || via.via_hole_diameter <= 0)
    throw Error("H3 routed via must retain its explicit source drill diameter")
  if (via.from_layer === via.to_layer || ![via.from_layer, via.to_layer].every(layer => ["top", "bottom"].includes(layer)))
    throw Error("H3 vias must connect its two native copper layers")
  return { center: via, radius: via.via_hole_diameter / 2, layers: ["top", "bottom"] }
}

function padDrillOverlaps(input: SimpleRouteJson, traces: Trace[]): Pick<H3NativeCarrierValidation, "drillPadOverlaps" | "uniqueViaDrillCount"> {
  const drills: ViaDrill[] = []
  const drillPadOverlaps: H3NativeCarrierValidation["drillPadOverlaps"] = []
  for (const trace of traces) {
    for (const via of trace.route.filter((point): point is Via => point.route_type === "via")) {
      const drill = drillForVia(via)
      if (drills.some(existing => Math.hypot(existing.center.x - drill.center.x, existing.center.y - drill.center.y) < 1e-8 && existing.radius === drill.radius)) continue
      drills.push(drill)
      for (const pad of input.obstacles) {
        if (!pad.layers.some(layer => drill.layers.includes(layer))) continue
        const dx = drill.center.x - pad.center.x, dy = drill.center.y - pad.center.y
        const angle = (pad.ccwRotationDegrees ?? 0) * Math.PI / 180
        const x = dx * Math.cos(angle) + dy * Math.sin(angle)
        const y = -dx * Math.sin(angle) + dy * Math.cos(angle)
        const clearance = pad.shape === "circle"
          ? Math.max(0, Math.hypot(dx, dy) - pad.width / 2)
          : Math.hypot(Math.max(0, Math.abs(x) - pad.width / 2), Math.max(0, Math.abs(y) - pad.height / 2))
        if (clearance < drill.radius - 1e-7)
          drillPadOverlaps.push({ connectionName: trace.connection_name, componentId: pad.componentId, center: drill.center })
      }
    }
  }
  return { drillPadOverlaps, uniqueViaDrillCount: drills.length }
}

export function validateH3NativeCarrier(params: { input: SimpleRouteJson; output: SimpleRouteJson & { traces: Trace[] } }): H3NativeCarrierValidation {
  const { input, output } = params
  // This source fixture has only single-layer pad terminals and two-layer
  // through vias, satisfying the validators' stricter SRJ boundary.
  const nativeInput = input as NativeSrj
  const nativeOutput = output as NativeSrj
  return {
    connectivity: validateOriginalEndpointConnectivity({ inputSrj: nativeInput, routedSrj: nativeOutput }),
    copperDrc: validateRoutedCopperDrc({ inputSrj: nativeInput, routedSrj: nativeOutput, clearance: 0.0889, allowBlindAndBuriedVias: false }),
    ...padDrillOverlaps(input, output.traces),
  }
}
