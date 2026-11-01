import { distance, simplify } from "./geometry"
import type { Point, SimpleRouteJson } from "./types"

function crossesSeparatingWall({
  input,
  path,
}: {
  input: SimpleRouteJson
  path: Point[]
}) {
  const pairNames = new Set(input.differentialPairs![0].connectionNames)
  const names = new Set(
    input.connections
      .filter((connection) => pairNames.has(connection.name))
      .flatMap((connection) => [
        connection.name,
        connection.source_trace_id,
        ...connection.pointsToConnect.flatMap((point) => [
          point.pointId,
          point.pcb_port_id,
        ]),
      ])
      .filter((name): name is string => !!name),
  )
  const start = path[0]
  const end = path.at(-1)!
  return input.obstacles.some((obstacle) => {
    if (
      obstacle.type !== "rect" ||
      obstacle.shape === "circle" ||
      (obstacle.ccwRotationDegrees ?? 0) % 180 !== 0 ||
      !obstacle.layers.includes(input.allowedLayers![0]) ||
      obstacle.connectedTo.some((owner) => names.has(owner))
    )
      return false
    const minX = obstacle.center.x - obstacle.width / 2
    const maxX = obstacle.center.x + obstacle.width / 2
    const minY = obstacle.center.y - obstacle.height / 2
    const maxY = obstacle.center.y + obstacle.height / 2
    return (
      (minY <= input.bounds.minY &&
        maxY >= input.bounds.maxY &&
        Math.min(start.x, end.x) < minX &&
        Math.max(start.x, end.x) > maxX) ||
      (minX <= input.bounds.minX &&
        maxX >= input.bounds.maxX &&
        Math.min(start.y, end.y) < minY &&
        Math.max(start.y, end.y) > maxY)
    )
  })
}

/** Longer coupled corridors, with cooperative yields even in blocked space. */
export function* packageCenterlineDetours({
  input,
  path,
  halfPitchMm,
  preferredAddedLengthMm,
}: {
  input: SimpleRouteJson
  path: Point[]
  halfPitchMm: number
  preferredAddedLengthMm: number
}): Generator<Point[] | null> {
  // No in-board excursion can cross a solid rectangle spanning the board.
  if (crossesSeparatingWall({ input, path })) return
  const bevelMm = Math.max(2 * halfPitchMm, input.minTraceWidth)
  const incrementMm = 2 * bevelMm
  const extentMm = Math.hypot(
    input.bounds.maxX - input.bounds.minX,
    input.bounds.maxY - input.bounds.minY,
  )
  const preferredHeightMm =
    preferredAddedLengthMm / 2 + (2 - Math.SQRT2) * bevelMm
  const heights = Array.from(
    { length: Math.floor(extentMm / incrementMm) },
    (_, index) => (index + 1) * incrementMm,
  ).sort(
    (a, b) => Math.abs(a - preferredHeightMm) - Math.abs(b - preferredHeightMm),
  )
  const segments = path
    .slice(1)
    .map((end, index) => ({ index, spanMm: distance(path[index], end) }))
    .sort((a, b) => b.spanMm - a.spanMm)
  let attempted = 0
  for (const { index, spanMm } of segments) {
    if (spanMm < 5 * incrementMm) continue
    const start = path[index]
    const end = path[index + 1]
    const forward = {
      x: (end.x - start.x) / spanMm,
      y: (end.y - start.y) / spanMm,
    }
    const normal = { x: -forward.y, y: forward.x }
    for (const heightMm of heights)
      for (
        let widthMm = 3 * incrementMm;
        widthMm <= spanMm - 2 * incrementMm + 1e-8;
        widthMm += incrementMm
      )
        for (
          let alongMm = incrementMm;
          alongMm + widthMm <= spanMm - incrementMm + 1e-8;
          alongMm += incrementMm
        )
          for (const side of [-1, 1]) {
            if (++attempted % 256 === 0) yield null
            const excursion = [
              [0, 0],
              [bevelMm, bevelMm],
              [bevelMm, heightMm - bevelMm],
              [2 * bevelMm, heightMm],
              [widthMm - 2 * bevelMm, heightMm],
              [widthMm - bevelMm, heightMm - bevelMm],
              [widthMm - bevelMm, bevelMm],
              [widthMm, 0],
            ].map(([along, across]) => ({
              x:
                start.x +
                forward.x * (alongMm + along) +
                normal.x * side * across,
              y:
                start.y +
                forward.y * (alongMm + along) +
                normal.y * side * across,
            }))
            if (
              excursion.some(
                (point) =>
                  point.x < input.bounds.minX ||
                  point.x > input.bounds.maxX ||
                  point.y < input.bounds.minY ||
                  point.y > input.bounds.maxY,
              )
            )
              continue
            yield simplify([
              ...path.slice(0, index + 1),
              ...excursion,
              ...path.slice(index + 1),
            ])
          }
  }
}
