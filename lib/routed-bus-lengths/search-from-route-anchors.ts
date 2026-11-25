import { distance } from "../geometry"
import { GridHeap } from "../grid-heap"
import type { LengthSearchGrid } from "./length-search-grid"
import type { RouteAnchor } from "./get-route-anchors"

export function searchFromRouteAnchors(
  grid: LengthSearchGrid,
  { fromStart, split }: { fromStart: boolean; split: boolean },
) {
  const costs = new Float64Array(grid.size).fill(Infinity)
  const parents = new Int32Array(grid.size).fill(-2)
  const viaCounts = new Uint16Array(grid.size)
  const roots = new Map<number, RouteAnchor>()
  const queue = new GridHeap(grid.size)
  const { step, window } = grid.params
  const target = fromStart ? grid.end : grid.start
  for (const anchor of grid.anchors) {
    // The two fronts may overlap. Do not retain an already obstructed prefix or suffix.
    if (
      fromStart
        ? anchor.routeIndex >= grid.firstCollision ||
          anchor.lengthMm > grid.lengthMm * 0.78
        : anchor.routeIndex <= grid.lastCollision ||
          anchor.lengthMm < grid.lengthMm * 0.22
    )
      continue
    const retainedMm = fromStart
      ? anchor.lengthMm
      : grid.lengthMm - anchor.lengthMm
    const cx = Math.round((anchor.point.x - grid.origin.x) / step)
    const cy = Math.round((anchor.point.y - grid.origin.y) / step)
    for (const layer of anchor.layers) {
      const z = grid.layers.indexOf(layer)
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const x = cx + dx,
            y = cy + dy
          if (x < 0 || x >= grid.columns || y < 0 || y >= grid.rows) continue
          const id = z * grid.area + y * grid.columns + x
          if (grid.blocked[id]) continue
          const point = grid.point(id)
          const vias = Number(
            layer !== (fromStart ? anchor.entryLayer : anchor.exitLayer),
          )
          const cost =
            retainedMm + distance(anchor.point, point) + vias * grid.viaCost
          if (
            cost >= costs[id] - 1e-10 ||
            !grid.scenes[z].visible(anchor.point, point)
          )
            continue
          roots.set(id, anchor)
          costs[id] = cost
          viaCounts[id] = vias
          parents[id] = -1
          queue.push(id, cost, cost)
        }
    }
  }
  const spanX = grid.end.x - grid.start.x,
    spanY = grid.end.y - grid.start.y
  const span = Math.hypot(spanX, spanY)
  while (queue.length) {
    queue.pop()
    const id = queue.id,
      cost = queue.g
    if (cost > costs[id] + 1e-8) continue
    const cell = id % grid.area,
      z = Math.floor(id / grid.area),
      x = cell % grid.columns,
      y = Math.floor(cell / grid.columns)
    const point = grid.point(id)
    if (split && span > 0) {
      const along =
        ((point.x - grid.center.x) * spanX +
          (point.y - grid.center.y) * spanY) /
        span
      if ((fromStart ? along : -along) > 1) continue
    }
    if (x < 1 || y < 1 || x >= grid.columns - 1 || y >= grid.rows - 1) continue
    const dx = Math.abs(point.x - target.x),
      dy = Math.abs(point.y - target.y)
    const remaining = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
    if (cost - viaCounts[id] * grid.viaCost + remaining > window.maxMm + 0.22)
      continue
    for (let direction = 0; direction < 8; direction++) {
      const neighbor = id + grid.offsets[direction],
        next = cost + step * (direction < 4 ? 1 : Math.SQRT2)
      if (
        grid.blocked[neighbor] ||
        next >= costs[neighbor] - 1e-9 ||
        !grid.edgeIsClear(id, direction)
      )
        continue
      costs[neighbor] = next
      viaCounts[neighbor] = viaCounts[id]
      parents[neighbor] = id
      queue.push(neighbor, next, next)
    }
    if (
      grid.viaBlocked[cell] ||
      (parents[id] >= 0 && Math.floor(parents[id] / grid.area) !== z)
    )
      continue
    const next = cost + grid.viaCost
    for (let other = 0; other < grid.layers.length; other++) {
      const neighbor = other * grid.area + cell
      if (other === z || next >= costs[neighbor] - 1e-8) continue
      costs[neighbor] = next
      parents[neighbor] = id
      viaCounts[neighbor] = viaCounts[id] + 1
      queue.push(neighbor, next, next)
    }
  }
  return { costs, parents, viaCounts, roots }
}
