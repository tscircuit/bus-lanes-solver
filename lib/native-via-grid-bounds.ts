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
  const anchors: Point[] = forcedVia
    ? [forcedVia]
    : nativeBgaFields({ input, connection }).flatMap(({ point, pitches }) =>
        [-1, 1].flatMap((x) =>
          [-1, 1].map((y) => ({
            x: point.x + (x * pitches[0]) / 2,
            y: point.y + (y * pitches[1]) / 2,
          })),
        ),
      )
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

function nativeBgaFields({
  input,
  connection,
}: {
  input: SimpleRouteJson
  connection: Connection
}) {
  const fields: Array<{ point: Point; pitches: number[] }> = []
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
    if (pitches.every(Number.isFinite)) fields.push({ point, pitches })
  }
  return fields
}

/** Preserve the old phase search first. If it fails, subdivisions of the actual
 * pad pitch keep successive narrow channels and via pockets on the same grid. */
export function* nativeViaGridSearches(context: {
  input: SimpleRouteJson
  connection: Connection
  stepMm: number
  forcedVia?: Point
}) {
  for (const bounds of nativeViaGridBounds(context))
    yield { bounds, stepMm: context.stepMm }
  const steps = new Map<string, number>()
  for (const { pitches } of nativeBgaFields(context))
    for (const pitch of pitches) {
      if (pitch < context.stepMm) continue
      const stepMm = pitch / Math.ceil(pitch / context.stepMm)
      if (stepMm >= context.stepMm - 1e-8) continue
      steps.set(stepMm.toFixed(9), stepMm)
    }
  for (const stepMm of [...steps.values()].sort((a, b) => a - b)) {
    yield { bounds: context.input.bounds, stepMm }
    for (const bounds of nativeViaGridBounds({ ...context, stepMm }))
      yield { bounds, stepMm }
  }
}
