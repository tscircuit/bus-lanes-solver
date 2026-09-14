import { MinHeap } from "./min-heap"
import { distance, length, simplify } from "./geometry"
import { VectorScene } from "./vector-scene"
import type { Point } from "./types"
/** Analytic octilinear connections: direct, two Ls, and the two possible
 * diagonal/axis tangencies. All bends are derived from endpoint coordinates. */
export function connectors(a: Point, b: Point): Point[][] {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    sx = Math.sign(dx),
    sy = Math.sign(dy),
    d = Math.min(Math.abs(dx), Math.abs(dy))
  if (
    Math.min(Math.abs(dx), Math.abs(dy)) < 1e-10 ||
    Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-10
  )
    return [[a, b]]
  const lead = (Math.max(Math.abs(dx), Math.abs(dy)) - d) / 2
  const centered =
    Math.abs(dx) > Math.abs(dy)
      ? [a, { x: a.x + sx * lead, y: a.y }, { x: b.x - sx * lead, y: b.y }, b]
      : [a, { x: a.x, y: a.y + sy * lead }, { x: b.x, y: b.y - sy * lead }, b]
  return [
    centered,
    [a, { x: a.x + sx * d, y: a.y + sy * d }, b],
    [a, { x: b.x - sx * d, y: b.y - sy * d }, b],
    [a, { x: a.x, y: b.y }, b],
    [a, { x: b.x, y: a.y }, b],
  ]
}
interface Label {
  id: number
  g: number
  f: number
  parent?: Label
  edge?: Point[]
}
export class VectorVisibilitySearch {
  readonly vertices: Point[]
  readonly open = new MinHeap<Label>()
  readonly best = new Map<number, number>()
  expanded = 0
  failed = false
  solved = false
  result: Point[] = []
  private geometryLoaded = false
  current?: Label
  visibleEdges: Point[][] = []
  constructor(
    readonly scene: VectorScene,
    readonly start: Point,
    readonly end: Point,
  ) {
    this.vertices = [start, end]
    this.open.push({ id: 0, g: 0, f: distance(start, end) })
    this.best.set(0, 0)
  }
  step() {
    if (!this.geometryLoaded) {
      this.geometryLoaded = true
      // A clear analytic octilinear shortest path cannot be improved by a
      // visibility search. Avoid constructing unrelated package geometry.
      const lowerBound =
        Math.max(
          Math.abs(this.end.x - this.start.x),
          Math.abs(this.end.y - this.start.y),
        ) +
        (Math.SQRT2 - 1) *
          Math.min(
            Math.abs(this.end.x - this.start.x),
            Math.abs(this.end.y - this.start.y),
          )
      for (const path of connectors(this.start, this.end)) {
        if (length(path) > lowerBound + 1e-9 || !this.scene.pathVisible(path))
          continue
        this.visibleEdges = [path]
        this.result = simplify(path)
        this.solved = true
        this.expanded = 1
        return
      }
      this.vertices.push(...this.scene.vertices())
    }
    if (!this.open.length) {
      this.failed = true
      return
    }
    const cur = this.open.pop()
    if (cur.g > (this.best.get(cur.id) ?? Infinity) + 1e-9) return
    this.current = cur
    this.expanded++
    this.visibleEdges = []
    if (cur.id === 1) {
      const edges: Point[][] = []
      for (let c: Label | undefined = cur; c?.parent; c = c.parent)
        edges.push(c.edge!)
      this.result = simplify([
        this.start,
        ...edges.reverse().flatMap((p) => p.slice(1)),
      ])
      this.solved = true
      return
    }
    const from = this.vertices[cur.id]
    // The visibility graph is implicit: only geometry-derived vertices exist.
    // Each expansion examines whole vector connections, never incremental steps.
    for (let id = 1; id < this.vertices.length; id++) {
      if (id === cur.id) continue
      const to = this.vertices[id],
        lower = cur.g + distance(from, to)
      if (lower >= (this.best.get(id) ?? Infinity) - 1e-9) continue
      const candidates = connectors(from, to).sort(
        (a, b) => length(a) - length(b),
      )
      for (const path of candidates) {
        const g = cur.g + length(path)
        if (g >= (this.best.get(id) ?? Infinity) - 1e-9) continue
        if (!this.scene.pathVisible(path)) continue
        this.best.set(id, g)
        this.open.push({
          id,
          g,
          f: g + distance(to, this.end),
          parent: cur,
          edge: path,
        })
        if (this.visibleEdges.length < 100) this.visibleEdges.push(path)
        break
      }
    }
  }
  currentPath() {
    const edges: Point[][] = []
    for (let c = this.current; c?.parent; c = c.parent) edges.push(c.edge!)
    return [this.start, ...edges.reverse().flatMap((e) => e.slice(1))]
  }
}
