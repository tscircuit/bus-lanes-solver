import { length, simplify } from "../geometry"
import type { Point, Trace } from "../types"
import { LengthSearchGrid } from "./length-search-grid"
import { searchFromRouteAnchors } from "./search-from-route-anchors"

type GridParams = ConstructorParameters<typeof LengthSearchGrid>[0]
/** Join two clearance-checked shortest path trees at a length-compatible point.
 * Keeping the original copper outside the join preserves otherwise inaccessible pad exits. */
export function* routeThroughLengthWindow(
  params: GridParams & { tuningSlackMm: number; split: boolean },
): Generator<Trace> {
  const grid = new LengthSearchGrid(params)
  if (!grid.size) return
  const start = searchFromRouteAnchors(grid, {
    fromStart: true,
    split: params.split,
  })
  const end = searchFromRouteAnchors(grid, {
    fromStart: false,
    split: params.split,
  })
  const { trace, window, tuningSlackMm } = params
  const tileColumns = Math.ceil(grid.columns / 2),
    tileRows = Math.ceil(grid.rows / 2)
  const layerCount = grid.layers.length
  // Only the best join in each two-by-two cell and layer pair enters the search.
  // Coalescing before sorting avoids allocating and sorting discarded candidates.
  const slots = new Int32Array(
    tileColumns * tileRows * layerCount * layerCount,
  ).fill(-1)
  const joins: {
    left: number
    right: number
    score: number
    lengthMm: number
    order: number
  }[] = []
  for (let cell = 0; cell < grid.area; cell++) {
    for (let z = 0; z < grid.layers.length; z++) {
      const left = z * grid.area + cell
      if (start.parents[left] < 0) continue
      for (let k = 0; k < grid.layers.length; k++) {
        const right = k * grid.area + cell
        if (
          end.parents[right] < 0 ||
          (z !== k && grid.viaBlocked[cell]) ||
          (z === k && start.parents[left] === end.parents[right])
        )
          continue
        const vias = start.viaCounts[left] + end.viaCounts[right]
        const lengthMm =
          start.costs[left] + end.costs[right] - vias * grid.viaCost
        if (
          lengthMm > window.maxMm + 1e-6 ||
          lengthMm <
            window.minMm - Math.max(tuningSlackMm, window.maxMm - window.minMm)
        )
          continue
        // A join inside the window wins over a join that needs more meander space.
        const score =
          Math.max(0, window.minMm - lengthMm) * 5 +
          Math.abs(window.targetMm - lengthMm) * 0.005 +
          (vias + Number(z !== k)) * 0.002
        const tile =
          Math.floor((cell % grid.columns) / 2) +
          tileColumns * Math.floor(Math.floor(cell / grid.columns) / 2)
        const slot = (tile * layerCount + z) * layerCount + k,
          index = slots[slot]
        const order = (cell * layerCount + z) * layerCount + k
        if (index < 0) {
          slots[slot] = joins.length
          joins.push({ left, right, score, lengthMm, order })
        } else if (score < joins[index].score)
          joins[index] = { left, right, score, lengthMm, order }
      }
    }
  }
  joins.sort((a, b) => a.score - b.score || a.order - b.order)
  let considered = 0
  for (const { left, right, lengthMm } of joins) {
    const prefix: number[] = [],
      suffix: number[] = []
    for (let id = left; id >= 0; id = start.parents[id]) prefix.push(id)
    const used = new Set(prefix)
    let crosses = false
    for (let id = right; id >= 0; id = end.parents[id]) {
      if (used.has(id) && !(id === right && left === right)) {
        crosses = true
        break
      }
      suffix.push(id)
    }
    if (crosses) continue
    const entry = start.roots.get(prefix.at(-1)!)!,
      exit = end.roots.get(suffix.at(-1)!)!
    if (entry.routeIndex >= exit.routeIndex) continue
    if (considered++ > 1000) return
    const path = [...prefix.reverse(), ...suffix.slice(left === right ? 1 : 0)]
    let layer = grid.layers[Math.floor(path[0] / grid.area)]
    const route = trace.route.slice(0, Math.ceil(entry.routeIndex))
    if (entry.entryLayer !== layer)
      route.push(
        grid.wire(entry.point, entry.entryLayer),
        grid.via(entry.point, { from: entry.entryLayer, to: layer }),
      )
    let points: Point[] = [entry.point]
    for (const id of path) {
      const next = grid.layers[Math.floor(id / grid.area)],
        point = grid.point(id)
      if (next !== layer) {
        route.push(
          ...simplify(points).map((p) => grid.wire(p, layer)),
          grid.via(point, { from: layer, to: next }),
        )
        points = []
        layer = next
      }
      points.push(point)
    }
    points.push(exit.point)
    route.push(...simplify(points).map((p) => grid.wire(p, layer)))
    if (exit.exitLayer !== layer)
      route.push(
        grid.via(exit.point, { from: layer, to: exit.exitLayer }),
        grid.wire(exit.point, exit.exitLayer),
      )
    route.push(...trace.route.slice(Math.floor(exit.routeIndex) + 1))
    if (Math.abs(length(route) - lengthMm) <= 1e-4) yield { ...trace, route }
  }
}
