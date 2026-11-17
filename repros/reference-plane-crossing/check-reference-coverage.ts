import type { Point, Trace } from "../../lib/types"
import { fixedPower, referenceRequirement } from "./fixture"

// Intentionally independent of solver geometry, obstacle generation and DRC.
function pointToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const squaredLength = dx * dx + dy * dy
  const t = squaredLength
    ? Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squaredLength),
      )
    : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (abC * abD < 0 && cdA * cdB < 0) return 0
  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  )
}

/** Checks this fixture's declared GND reference, not impedance or SI quality.
 * The GND plane otherwise covers the board. Its only void is the foreign
 * supply capsule expanded by the declared pour clearance. */
export function checkReferenceCoverage(traces: Trace[]) {
  let checkedSegments = 0
  let minimumEdgeGapMm = Infinity
  const violations: Array<{
    traceId: string
    segmentIndex: number
    edgeGapMm: number
  }> = []
  for (const trace of traces) {
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]
      const b = trace.route[i]
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== referenceRequirement.signalLayer ||
        b.layer !== referenceRequirement.signalLayer
      )
        continue
      checkedSegments++
      const c = fixedPower.route[0]
      const d = fixedPower.route[1]
      if (c.route_type !== "wire" || d.route_type !== "wire")
        throw new Error("Invalid fixture")
      const edgeGapMm =
        segmentDistance(a, b, c, d) -
        Math.max(a.width, b.width) / 2 -
        Math.max(c.width, d.width) / 2 -
        referenceRequirement.pourClearanceMm
      minimumEdgeGapMm = Math.min(minimumEdgeGapMm, edgeGapMm)
      if (edgeGapMm < -1e-9)
        violations.push({
          traceId: trace.pcb_trace_id,
          segmentIndex: i,
          edgeGapMm,
        })
    }
  }
  return {
    covered: checkedSegments > 0 && violations.length === 0,
    checkedSegments,
    minimumEdgeGapMm,
    violations,
  }
}
