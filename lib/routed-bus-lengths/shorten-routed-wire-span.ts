import { distance, length } from "../geometry"
import { fixedCopper, VectorScene } from "../vector-scene"
import type { Connection, SimpleRouteJson, Trace, Wire } from "../types"

/** Straighten a portion of an existing planar run. Bisection stops at the
 * target copper length and the vector scene checks every replacement chord. */
export function shortenRoutedWireSpan({
  input,
  connection,
  trace,
  obstacles,
  targetMm,
}: {
  input: SimpleRouteJson
  connection: Connection
  trace: Trace
  obstacles: Trace[]
  targetMm: number
}): Trace | undefined {
  const copper = fixedCopper({ ...input, traces: obstacles })
  type LayerAndWidth = `${string}:${number}`
  const scenes = new Map<LayerAndWidth, VectorScene>()
  let route = trace.route,
    excess = length(route) - targetMm
  if (excess < 1e-7) return trace
  for (let pass = 0; pass < 7; pass++) {
    const chords: {
      i: number
      j: number
      start: number
      distances: Float64Array
      original: number
      saving: number
      rank: number
    }[] = []
    for (let start = 0; start < route.length; ) {
      let end = start
      while (end < route.length && route[end].route_type === "wire") end++
      if (end - start >= 3) {
        const last = end - 1,
          distances = new Float64Array(end - start)
        for (let i = start + 1; i <= last; i++)
          distances[i - start] =
            distances[i - start - 1] + distance(route[i], route[i - 1])
        const stride = Math.max(1, Math.floor((last - start) / 30))
        const indices = [start]
        for (let i = start + stride; i < last; i += stride) indices.push(i)
        indices.push(last)
        for (const [l, i] of indices.entries())
          for (const j of indices.slice(l + 1)) {
            if (j <= i + 1) continue
            const original = distances[j - start] - distances[i - start],
              saving = original - distance(route[i], route[j])
            if (saving <= 1e-5) continue
            const rank =
              saving >= excess
                ? -1 + Math.abs(saving - excess) * 1e-4
                : (-saving / excess) * 0.99
            chords.push({ i, j, start, distances, original, saving, rank })
          }
      }
      start = end + 1
    }
    let best:
      | { i: number; j: number; replacement: Wire[]; saved: number }
      | undefined
    for (const chord of chords.sort((a, b) => a.rank - b.rank)) {
      const { i, j, start, distances, original, saving } = chord
      const a = route[i] as Wire,
        b = route[j] as Wire,
        desired = Math.min(saving, excess)
      if (best && desired < best.saved + 1e-7) continue
      const key: LayerAndWidth = `${a.layer}:${a.width}`
      let scene = scenes.get(key)
      if (!scene) {
        scene = new VectorScene(
          input,
          {
            ...connection,
            pointsToConnect: connection.pointsToConnect.map((p) => ({
              ...p,
              layer: a.layer,
            })),
          },
          a.width,
          copper,
        )
        scenes.set(key, scene)
      }
      const arc = route.slice(i, j + 1) as Wire[]
      const flatten = (fraction: number) =>
        arc.map((p, k) => {
          if (!k || k === arc.length - 1) return p
          const progress =
            (distances[i + k - start] - distances[i - start]) / original
          return {
            ...p,
            x: p.x + (a.x + (b.x - a.x) * progress - p.x) * fraction,
            y: p.y + (a.y + (b.y - a.y) * progress - p.y) * fraction,
          }
        })
      let replacement = [a, b]
      if (saving > excess + 1e-8) {
        let lo = 0,
          hi = 1
        for (let k = 0; k < 32; k++) {
          const mid = (lo + hi) / 2
          if (original - length(flatten(mid)) > desired) hi = mid
          else lo = mid
        }
        replacement = flatten((lo + hi) / 2)
      }
      if (!scene.pathVisible(replacement)) continue
      best = { i, j, replacement, saved: original - length(replacement) }
      if (Math.abs(excess - best.saved) < 1e-6) break
    }
    if (!best) break
    route = [
      ...route.slice(0, best.i),
      ...best.replacement,
      ...route.slice(best.j + 1),
    ]
    excess = length(route) - targetMm
    if (Math.abs(excess) < 1e-6) return { ...trace, route }
  }
}
