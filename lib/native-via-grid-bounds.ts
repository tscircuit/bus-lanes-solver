import type { Connection, Point, SimpleRouteJson } from "./types"

/** Align a search lattice with BGA interstices without moving physical copper. */
export function* nativeViaGridBounds({
  input,
  connection,
  stepMm,
  forcedVia,
}: {
  input: SimpleRouteJson
  connection: Connection
  stepMm: number
  forcedVia?: Point
}): Generator<SimpleRouteJson["bounds"]> {
  const anchors: Point[] = []
  if (forcedVia) anchors.push(forcedVia)
  else
    for (const point of connection.pointsToConnect) {
      if (point.layer !== "top") continue
      const owner = input.obstacles.find(
        (pad) =>
          pad.componentId &&
          pad.shape === "circle" &&
          pad.layers.includes("top") &&
          Math.hypot(pad.center.x - point.x, pad.center.y - point.y) < 1e-4,
      )
      if (!owner) continue
      const pads = input.obstacles.filter(
        (pad) =>
          pad.componentId === owner.componentId &&
          pad.shape === "circle" &&
          pad.layers.includes("top"),
      )
      const pitches = (["x", "y"] as const).map((axis) =>
        Math.min(
          ...pads
            .map((pad) => Math.abs(pad.center[axis] - point[axis]))
            .filter((distance) => distance > 1e-4),
        ),
      )
      if (!pitches.every(Number.isFinite)) continue
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          anchors.push({
            x: point.x + (x * pitches[0]) / 2,
            y: point.y + (y * pitches[1]) / 2,
          })
    }
  const seen = new Set<string>()
  for (const anchor of anchors) {
    let shiftX = (((anchor.x - input.bounds.minX) % stepMm) + stepMm) % stepMm
    let shiftY = (((anchor.y - input.bounds.minY) % stepMm) + stepMm) % stepMm
    if (stepMm - shiftX < 1e-9) shiftX = 0
    if (stepMm - shiftY < 1e-9) shiftY = 0
    const key = `${shiftX.toFixed(9)},${shiftY.toFixed(9)}`
    if (seen.has(key) || (shiftX < 1e-9 && shiftY < 1e-9)) continue
    seen.add(key)
    yield {
      ...input.bounds,
      minX: input.bounds.minX + shiftX,
      minY: input.bounds.minY + shiftY,
    }
  }
}
