import type { Trace, Wire } from "../../lib"

/** Independent measurement of overlapping antiparallel straight legs, excluding
 * sampled bend chords. No solver clearance predicate is used. Units: mm. */
export function measureReturnGap(traces: Trace[]) {
  let closest: { edgeGap: number; centerline: number; a: Wire; b: Wire } | undefined
  for (const trace of traces) {
    const path = trace.route
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]
      if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
      const span = Math.hypot(b.x - a.x, b.y - a.y)
      if (span < 2 * a.width) continue
      const ux = (b.x - a.x) / span, uy = (b.y - a.y) / span
      for (let j = i + 2; j < path.length; j++) {
        const c = path[j - 1], d = path[j]
        if (c.route_type !== "wire" || d.route_type !== "wire" || c.layer !== a.layer || d.layer !== a.layer) continue
        const dx = d.x - c.x, dy = d.y - c.y, other = Math.hypot(dx, dy)
        if (other < 2 * c.width || (ux * dx + uy * dy) / other > -1 + 1e-9) continue
        const project = (p: Wire) => (p.x - a.x) * ux + (p.y - a.y) * uy
        const lo = Math.max(0, project(d)), hi = Math.min(span, project(c))
        if (hi - lo < Math.max(a.width, c.width)) continue
        const offset = (c.x - a.x) * -uy + (c.y - a.y) * ux
        const centerline = Math.abs(offset), edgeGap = centerline - (a.width + c.width) / 2
        if (closest && edgeGap >= closest.edgeGap) continue
        const x = a.x + ux * (lo + hi) / 2, y = a.y + uy * (lo + hi) / 2
        closest = { edgeGap, centerline, a: { ...a, x, y }, b: { ...c, x: x - uy * offset, y: y + ux * offset } }
      }
    }
  }
  if (!closest) throw Error("Fixture did not produce overlapping returning straight legs")
  return closest
}
