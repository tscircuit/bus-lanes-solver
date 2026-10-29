import { offsetPath } from "./coupled-pair-routing"
import { distance, length, simplify } from "./geometry"
import { packageApproachRegions, pointInBox } from "./package-approach-regions"
import { fixedCopper, VectorScene } from "./vector-scene"
import { connectors } from "./vector-visibility"
import type { Point, SimpleRouteJson } from "./types"

interface Mouth {
  point: Point
  stub: Point
}

/** Search package faces as well as lateral handoffs for offset native pairs.
 * A pair on a BGA's bottom row may enter from below even when its peer sits to
 * the right. Every actual offset rail is checked against immutable copper. */
export function offsetPackageCenterlines(
  input: SimpleRouteJson,
  defaults: Point[][],
  regions: ReturnType<typeof packageApproachRegions>,
  step: number,
): Point[][][] | undefined {
  if (input.differentialPairs?.length !== 1) return
  const pair = input.differentialPairs[0]
  const connections = pair.connectionNames.map(
    (name) => input.connections.find((c) => c.name === name)!,
  )
  const packages = [0, 1].map(
    (side) =>
      regions.find((r) =>
        pointInBox(connections[0].pointsToConnect[side], r.pads),
      )!,
  )
  if (packages.some((p) => !p)) return
  const center = (b: SimpleRouteJson["bounds"]) => ({
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  })
  const a = center(packages[0].pads),
    b = center(packages[1].pads)
  if (Math.abs(a.x - b.x) < 1e-8 || Math.abs(a.y - b.y) < 1e-8) return
  const halfPitch =
    (input.minTraceWidth +
      (pair.traceGap ?? input.minTraceToPadEdgeClearance ?? 0.075)) /
    2
  const copper = fixedCopper(input)
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
        input.minTraceWidth,
        copper,
      ),
  )
  const preferred = [0, 1].map((side) => ({
    x:
      connections.reduce((sum, c) => sum + c.pointsToConnect[side].x, 0) /
      2,
    y:
      connections.reduce((sum, c) => sum + c.pointsToConnect[side].y, 0) /
      2,
  }))
  const paths: Point[][] = []
  const seen = new Set<string>()
  const add = (candidate: Point[]) => {
    const path = simplify(candidate),
      key = JSON.stringify(path)
    if (seen.has(key) || path.length < 2) return
    seen.add(key)
    try {
      const rails = scenes.map((_, rail) =>
        offsetPath(path, (rail ? 1 : -1) * halfPitch),
      )
      if (
        rails.every(
          (rail, i) =>
            pointInBox(rail[0], packages[0].copper) &&
            pointInBox(rail.at(-1)!, packages[1].copper) &&
            scenes[i].pathVisible(rail),
        )
      )
        paths.push(path)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Pair centerline reverses direction"
      )
        throw error
    }
  }
  add(defaults[0])
  const mouths = (side: number) => {
    const box = packages[side].copper,
      result: Mouth[] = []
    const shifts = [
      0,
      ...Array.from({ length: 16 }, (_, i) => [
        2 * (i + 1),
        -2 * (i + 1),
      ]).flat(),
    ]
    for (const outward of [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]) {
      for (const shift of shifts) {
        const inset = step / 4
        const point = {
          x: outward.x
            ? outward.x < 0
              ? box.minX + inset
              : box.maxX - inset
            : preferred[side].x + shift * step,
          y: outward.y
            ? outward.y < 0
              ? box.minY + inset
              : box.maxY - inset
            : preferred[side].y + shift * step,
        }
        const stub = {
          x: point.x + outward.x * 4 * input.minTraceWidth,
          y: point.y + outward.y * 4 * input.minTraceWidth,
        }
        const path = side ? [stub, point] : [point, stub]
        const rails = scenes.map((_, rail) =>
          offsetPath(path, (rail ? 1 : -1) * halfPitch),
        )
        if (
          rails.every(
            (rail, i) =>
              pointInBox(rail[side ? 1 : 0], box) &&
              scenes[i].pathVisible(rail),
          )
        )
          result.push({ point, stub })
      }
    }
    return result
  }
  const sources = mouths(0),
    targets = mouths(1)
  const candidates = sources
    .flatMap((source) =>
      targets.map((target) => ({
        source,
        target,
        score:
          distance(preferred[0], source.point) +
          distance(source.stub, target.stub) +
          distance(target.point, preferred[1]),
      })),
    )
    .sort((a, b) => a.score - b.score)
  for (const { source, target } of candidates.slice(0, 512)) {
    for (const middle of connectors(source.stub, target.stub)) {
      add([source.point, ...middle, target.point])
      if (paths.length >= 16) break
    }
    if (paths.length >= 16) break
  }
  paths.sort((a, b) => length(a) - length(b))
  return paths.map((path) => [path])
}
