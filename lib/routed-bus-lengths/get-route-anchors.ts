import type { CopperIndex } from "../copper-index"
import { distance } from "../geometry"
import type { Point, Trace } from "../types"
import { clearanceToCopper, type VectorScene } from "../vector-scene"

export interface RouteAnchor {
  point: Point
  routeIndex: number
  lengthMm: number
  layers: string[]
  entryLayer: string
  exitLayer: string
}

/** Keep existing pad approaches up to the first obstruction, and past the last.
 * Wire samples allow a replacement to start or end between existing vertices. */
export function getRouteAnchors({
  trace,
  layers,
  viaLayers,
  scenes,
  copperIndex,
  viaMargin,
}: {
  trace: Trace
  layers: string[]
  viaLayers: string[]
  scenes: VectorScene[]
  copperIndex: CopperIndex
  viaMargin: number
}) {
  const anchors: RouteAnchor[] = []
  let cumulativeMm = 0,
    firstCollision = Infinity,
    lastCollision = -Infinity
  for (const [i, p] of trace.route.entries()) {
    const previous = trace.route[i - 1],
      next = trace.route[i + 1]
    if (previous) cumulativeMm += distance(p, previous)
    if (p.route_type === "via") {
      const reachableLayers = (p.layers ?? viaLayers).filter((layer) =>
        layers.includes(layer),
      )
      anchors.push({
        point: p,
        routeIndex: i,
        lengthMm: cumulativeMm,
        layers: reachableLayers,
        entryLayer: p.from_layer,
        exitLayer: p.to_layer,
      })
      if (
        copperIndex.some(
          {
            minX: p.x - viaMargin,
            maxX: p.x + viaMargin,
            minY: p.y - viaMargin,
            maxY: p.y + viaMargin,
          },
          (obstacle) => clearanceToCopper(p, p, obstacle) < viaMargin - 1e-8,
        )
      ) {
        firstCollision = Math.min(firstCollision, i)
        lastCollision = Math.max(lastCollision, i)
      }
      continue
    }
    const layerIndex = layers.indexOf(p.layer)
    if (
      previous?.route_type === "wire" &&
      (layerIndex < 0 || !scenes[layerIndex].visible(previous, p))
    ) {
      firstCollision = Math.min(firstCollision, i - 0.5)
      lastCollision = Math.max(lastCollision, i - 0.5)
    }
    if (layerIndex < 0) continue
    const anchor = {
      point: p,
      routeIndex: i,
      lengthMm: cumulativeMm,
      layers: [p.layer],
      entryLayer: p.layer,
      exitLayer: p.layer,
    }
    if (i === 0 || i === trace.route.length - 1) anchors.push(anchor)
    if (next?.route_type !== "wire" || next.layer !== p.layer) continue
    const spanMm = distance(p, next)
    if (spanMm < 0.08) continue
    const samples = Math.max(1, Math.ceil(spanMm / 0.35))
    for (let j = 0; j < samples; j++) {
      const fraction = (j + 0.5) / samples
      anchors.push({
        ...anchor,
        point: {
          x: p.x + (next.x - p.x) * fraction,
          y: p.y + (next.y - p.y) * fraction,
        },
        routeIndex: i + fraction,
        lengthMm: cumulativeMm + spanMm * fraction,
      })
    }
  }
  return { anchors, firstCollision, lastCollision, lengthMm: cumulativeMm }
}
