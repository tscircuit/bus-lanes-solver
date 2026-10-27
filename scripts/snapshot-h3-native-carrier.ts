import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import type { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"
import type { H3NativeCarrierValidation } from "./validate-h3-native-carrier"

export function snapshotH3NativeCarrier(params: {
  input: SimpleRouteJson
  solver: BusLanesPipelineSolver
  validation: H3NativeCarrierValidation | null
}): string {
  const { input, solver, validation } = params
  const accepted = solver.solved && validation?.valid
  // The explicitly requested failed reproduction is a diagnostic preview,
  // labelled unaccepted. A completed snapshot uses only actual final copper.
  const graphics: GraphicsObject = solver.solved
    ? new BusLanesSolver(solver.getOutput()).visualize()
    : solver.visualize()
  graphics.circles = graphics.circles?.map((circle) => ({
    ...circle,
    fill: circle.layer === "bottom" ? "#bfdbfe" : "#fecaca",
  }))
  const centerX = (input.bounds.minX + input.bounds.maxX) / 2
  const status = validation
    ? `${accepted ? "COMPLETED" : "UNACCEPTED"}: ${validation.connectivity.connectedConnectionCount}/11 physically connected | copper DRC ${validation.copperDrc.issues.length} | drill/pad overlaps ${validation.drillPadOverlaps.length}`
    : `FAILED / UNACCEPTED: ${solver.failureCode} | accepted output 0/11 | DRC not evaluated`
  graphics.texts = [
    {
      x: centerX,
      y: input.bounds.maxY + 5,
      text: "H3 CPU-to-DDR reference: original eleven-signal byte lane",
      fontSize: 0.7,
    },
    {
      x: centerX,
      y: input.bounds.maxY + 3.7,
      text: status,
      color: accepted ? "#166534" : "#b91c1c",
      fontSize: 0.6,
    },
    {
      x: centerX,
      y: input.bounds.maxY + 2.6,
      text: "479 original pads (443 circles), native 2 layers, source clearance 0.0889 mm, wires 0.1143 mm",
      fontSize: 0.55,
    },
    {
      x: centerX,
      y: input.bounds.maxY + 1.5,
      text: validation
        ? `route quality ${validation.routeQuality.issues.length} issues: whole-path turns, ordinary geometry and same-layer self-clearance`
        : "route quality not evaluated",
      color: accepted ? "#166534" : "#b91c1c",
      fontSize: 0.55,
    },
    {
      x: centerX,
      y: input.bounds.maxY + 0.4,
      text: validation
        ? "Original bus has no skew bound; this does not establish electrical timing closure."
        : "Partial copper below is the actual failed solver preview, never an accepted route.",
      fontSize: 0.55,
    },
  ]
  return getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    includeTextLabels: false,
    svgWidth: 1800,
    svgHeight: 1200,
  }).replace(/[ \t]+$/gm, "")
}
