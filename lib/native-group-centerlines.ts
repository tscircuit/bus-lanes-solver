import { offsetPath } from "./coupled-pair-routing"
import { packageApproachRegions, pointInBox } from "./package-approach-regions"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Point, SimpleRouteJson } from "./types"

/** Straight coupled corridors in board-world millimetres (+X right, +Y up).
 * Only axis-aligned package pairs are eligible. Points use the board frame;
 * forward/normal are unit directions. Fixed copper is never moved.
 */
export function nativeGroupCenterlines(
  input: SimpleRouteJson,
  packageRegions?: ReturnType<typeof packageApproachRegions>,
) {
  const pair = input.differentialPairs![0]
  const connections = pair.connectionNames.map(
    (name) => input.connections.find((c) => c.name === name)!,
  )
  const width = input.minTraceWidth
  const clearance =
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  const halfPitch = (width + (pair.traceGap ?? clearance)) / 2
  const regions =
    packageRegions ??
    packageApproachRegions(
      input,
      width + (pair.traceGap ?? clearance) / 2 + clearance,
    )
  const source = regions.find((r) =>
    pointInBox(connections[0].pointsToConnect[0], r.pads),
  )!
  const target = regions.find((r) =>
    pointInBox(connections[0].pointsToConnect[1], r.pads),
  )!
  const center = (box: SimpleRouteJson["bounds"]) => ({
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  })
  const a = center(source.pads),
    b = center(target.pads)
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  const forward = { x: (b.x - a.x) / distance, y: (b.y - a.y) / distance }
  if (Math.abs(forward.x) > 1e-8 && Math.abs(forward.y) > 1e-8)
    return [undefined]
  const normal = { x: -forward.y, y: forward.x }
  const project = (point: Point, direction: Point) =>
    point.x * direction.x + point.y * direction.y
  const span = (box: SimpleRouteJson["bounds"], direction: Point) =>
    [box.minX, box.maxX].flatMap((x) =>
      [box.minY, box.maxY].map((y) => project({ x, y }, direction)),
    )
  const step = width
  const out =
    Math.floor(
      (Math.max(...span(source.copper, forward)) - 0.3 * step) / step,
    ) * step
  const incoming =
    Math.ceil((Math.min(...span(target.copper, forward)) + 0.3 * step) / step) *
    step
  const lower =
    Math.max(
      Math.min(...span(source.copper, normal)),
      Math.min(...span(target.copper, normal)),
    ) +
    3 * width
  const upper =
    Math.min(
      Math.max(...span(source.copper, normal)),
      Math.max(...span(target.copper, normal)),
    ) -
    3 * width
  const point = (u: number, v: number) => ({
    x: normal.x * u + forward.x * v,
    y: normal.y * u + forward.y * v,
  })
  const fixed = fixedCopper(input)
  const scenes = connections.map(
    (c) =>
      new VectorScene(
        input,
        {
          ...c,
          pointsToConnect: c.pointsToConnect.map((p) => ({
            ...p,
            layer: input.allowedLayers![0],
          })),
        },
        width,
        fixed,
      ),
  )
  const preferred =
    connections
      .flatMap((c) => c.pointsToConnect)
      .reduce((sum, p) => sum + project(p, normal), 0) / 4
  const candidates: number[] = []
  for (let u = Math.ceil(lower / step) * step; u < upper; u += step) {
    u = Number(u.toFixed(6))
    if (
      scenes.every((scene, rail) =>
        scene.visible(
          point(u + (rail ? halfPitch : -halfPitch), out),
          point(u + (rail ? halfPitch : -halfPitch), incoming),
        ),
      )
    )
      candidates.push(u)
  }
  candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
  const sourceLateral =
    connections.reduce(
      (sum, c) => sum + project(c.pointsToConnect[0], normal),
      0,
    ) / 2
  const targetLateral =
    connections.reduce(
      (sum, c) => sum + project(c.pointsToConnect[1], normal),
      0,
    ) / 2
  const selected: Point[][][] = []
  const add = (path: Point[]) => {
    if (
      scenes.every((scene, rail) =>
        scene.pathVisible(offsetPath(path, (rail ? 1 : -1) * halfPitch)),
      )
    )
      selected.push([path])
  }
  const stem = 8 * width
  for (const u of candidates.filter((_, i) => i % 4 === 0).slice(0, 12)) {
    add([point(u, out), point(u, incoming)])
    // Keep a paired handoff near its native pin column when earlier groups
    // obstruct a long cross-package approach to the centered backbone.
    const sourceU = Math.round(sourceLateral / step) * step
    const sourceShift = Math.abs(sourceU - u)
    if (sourceShift > step && incoming - out > sourceShift + 2 * stem)
      add([
        point(sourceU, out),
        point(sourceU, out + stem),
        point(u, out + stem + sourceShift),
        point(u, incoming),
      ])
    const targetU = Math.round(targetLateral / step) * step
    const targetShift = Math.abs(targetU - u)
    if (targetShift > step && incoming - out > targetShift + 2 * stem)
      add([
        point(u, out),
        point(u, incoming - stem - targetShift),
        point(targetU, incoming - stem),
        point(targetU, incoming),
      ])
  }
  return [undefined, ...selected]
}
