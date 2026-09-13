import type { Point } from "./types"
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export function pointSegmentDistance(p: Point, edge: [Point, Point]) {
  const [a, b] = edge,
    dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    )
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
export function segmentDistance(ab: [Point, Point], cd: [Point, Point]) {
  const [a, b] = ab,
    [c, d] = cd
  if (
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) >= Math.min(a.y, b.y) &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  )
    return 0
  return Math.min(
    pointSegmentDistance(a, cd),
    pointSegmentDistance(b, cd),
    pointSegmentDistance(c, ab),
    pointSegmentDistance(d, ab),
  )
}
export const length = (path: Point[]) =>
  path.slice(1).reduce((sum, p, i) => sum + distance(path[i], p), 0)
export function simplify(path: Point[]) {
  return path.filter(
    (p, i) =>
      !i ||
      i === path.length - 1 ||
      Math.abs(cross(path[i - 1], p, path[i + 1])) > 1e-9,
  )
}
