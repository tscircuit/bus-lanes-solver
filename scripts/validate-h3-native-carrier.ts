import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { Point, SimpleRouteJson, Trace, Via, Wire } from "../lib/types"

type NativeSrj = Parameters<typeof validateRoutedCopperDrc>[0]["inputSrj"]
type ViaDrill = { center: Point; radius: number; layers: string[] }
export interface H3NativeCarrierValidation {
  valid: boolean
  connectivity: ReturnType<typeof validateOriginalEndpointConnectivity>
  copperDrc: ReturnType<typeof validateRoutedCopperDrc>
  drillPadOverlaps: Array<{
    connectionName: string | undefined
    componentId: string | undefined
    center: Point
  }>
  uniqueViaDrillCount: number
  routeQuality: {
    valid: boolean
    issues: Array<{
      connectionName: string | undefined
      reason:
        | "nonconventional-turn"
        | "invalid-ordinary-geometry"
        | "same-layer-self-clearance"
    }>
  }
}

function validateH3RouteQuality(params: {
  traces: Trace[]
  clearance: number
}): H3NativeCarrierValidation["routeQuality"] {
  const issues: H3NativeCarrierValidation["routeQuality"]["issues"] = []
  for (const trace of params.traces) {
    if (!routeAnglesAreConventional([trace]))
      issues.push({
        connectionName: trace.connection_name,
        reason: "nonconventional-turn",
      })
    else if (!nativeSignalGeometryIsValid(trace))
      issues.push({
        connectionName: trace.connection_name,
        reason: "invalid-ordinary-geometry",
      })
    const runs: Wire[][] = []
    let run: Wire[] = []
    for (const point of trace.route) {
      if (point.route_type !== "wire") {
        run = []
        continue
      }
      if (!run.length || run.at(-1)!.layer !== point.layer) {
        run = []
        runs.push(run)
      }
      run.push(point)
    }
    if (
      runs.some(
        (points) =>
          points.length > 1 &&
          !tuningPathIsSelfClear(
            points,
            points.reduce((width, point) => Math.max(width, point.width), 0) +
              params.clearance,
          ),
      )
    )
      issues.push({
        connectionName: trace.connection_name,
        reason: "same-layer-self-clearance",
      })
  }
  return { valid: issues.length === 0, issues }
}

function drillForVia(via: Via): ViaDrill {
  if (via.via_hole_diameter === undefined || via.via_hole_diameter <= 0)
    throw Error("H3 routed via must retain its explicit source drill diameter")
  if (
    via.from_layer === via.to_layer ||
    ![via.from_layer, via.to_layer].every((layer) =>
      ["top", "bottom"].includes(layer),
    )
  )
    throw Error("H3 vias must connect its two native copper layers")
  return {
    center: via,
    radius: via.via_hole_diameter / 2,
    layers: ["top", "bottom"],
  }
}

function padDrillOverlaps(
  input: SimpleRouteJson,
  traces: Trace[],
): Pick<H3NativeCarrierValidation, "drillPadOverlaps" | "uniqueViaDrillCount"> {
  const drills: ViaDrill[] = []
  const drillPadOverlaps: H3NativeCarrierValidation["drillPadOverlaps"] = []
  for (const trace of traces) {
    for (const via of trace.route.filter(
      (point): point is Via => point.route_type === "via",
    )) {
      const drill = drillForVia(via)
      if (
        drills.some(
          (existing) =>
            Math.hypot(
              existing.center.x - drill.center.x,
              existing.center.y - drill.center.y,
            ) < 1e-8 && existing.radius === drill.radius,
        )
      )
        continue
      drills.push(drill)
      for (const pad of input.obstacles) {
        if (!pad.layers.some((layer) => drill.layers.includes(layer))) continue
        const dx = drill.center.x - pad.center.x,
          dy = drill.center.y - pad.center.y
        const angle = ((pad.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const x = dx * Math.cos(angle) + dy * Math.sin(angle)
        const y = -dx * Math.sin(angle) + dy * Math.cos(angle)
        const clearance =
          pad.shape === "circle"
            ? Math.max(0, Math.hypot(dx, dy) - pad.width / 2)
            : Math.hypot(
                Math.max(0, Math.abs(x) - pad.width / 2),
                Math.max(0, Math.abs(y) - pad.height / 2),
              )
        if (clearance < drill.radius - 1e-7)
          drillPadOverlaps.push({
            connectionName: trace.connection_name,
            componentId: pad.componentId,
            center: drill.center,
          })
      }
    }
  }
  return { drillPadOverlaps, uniqueViaDrillCount: drills.length }
}

export function validateH3NativeCarrier(params: {
  input: SimpleRouteJson
  output: SimpleRouteJson & { traces: Trace[] }
}): H3NativeCarrierValidation {
  const { input, output } = params
  // This source fixture has only single-layer pad terminals and two-layer
  // through vias, satisfying the validators' stricter SRJ boundary.
  const nativeInput = input as NativeSrj
  const nativeOutput = output as NativeSrj
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin
  if (clearance === undefined)
    throw Error("H3 source fixture must retain its authored copper clearance")
  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj: nativeInput,
    routedSrj: nativeOutput,
  })
  const copperDrc = validateRoutedCopperDrc({
    inputSrj: nativeInput,
    routedSrj: nativeOutput,
    clearance,
    allowBlindAndBuriedVias: false,
  })
  const drills = padDrillOverlaps(input, output.traces)
  const routeQuality = validateH3RouteQuality({
    traces: output.traces,
    clearance,
  })
  return {
    valid:
      connectivity.valid &&
      copperDrc.valid &&
      drills.drillPadOverlaps.length === 0 &&
      routeQuality.valid,
    connectivity,
    copperDrc,
    ...drills,
    routeQuality,
  }
}
