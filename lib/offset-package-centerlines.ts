import { offsetPath } from "./coupled-pair-routing"
import { distance, length, simplify } from "./geometry"
import { packageCenterlineDetours } from "./package-centerline-detours"
import { nativePairHalfPitch } from "./native-pair-spacing"
import { packageApproachRegions, pointInBox } from "./package-approach-regions"
import { fixedCopper, VectorScene } from "./vector-scene"
import { connectors } from "./vector-visibility"
import type { Point, SimpleRouteJson } from "./types"

type PackageRegion = ReturnType<typeof packageApproachRegions>[number]
interface PackageMouth {
  point: Point
  stub: Point
}
interface OffsetPackageSearch {
  input: SimpleRouteJson
  defaults: Point[][]
  packages: PackageRegion[]
  scenes: VectorScene[]
  preferred: Point[]
  halfPitchMm: number
  stepMm: number
  targetLengthMm?: number
}

function boxCenter(bounds: SimpleRouteJson["bounds"]): Point {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

function centerlineIsClear(
  search: OffsetPackageSearch,
  path: Point[],
): boolean {
  try {
    return search.scenes.every((scene, rail) => {
      const conductor = offsetPath(path, (rail ? 1 : -1) * search.halfPitchMm)
      return (
        pointInBox(conductor[0], search.packages[0].copper) &&
        pointInBox(conductor.at(-1)!, search.packages[1].copper) &&
        scene.pathVisible(conductor)
      )
    })
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Pair centerline reverses direction"
    )
      throw error
    return false
  }
}

function packageMouths(
  search: OffsetPackageSearch,
  side: number,
): PackageMouth[] {
  const bounds = search.packages[side].copper
  const mouths: PackageMouth[] = []
  for (const outward of [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ]) {
    const lateral = outward.x ? "y" : "x"
    const lower = outward.x ? bounds.minY : bounds.minX
    const upper = outward.x ? bounds.maxY : bounds.maxX
    const preferred = search.preferred[side][lateral]
    const first = Math.ceil((lower - preferred) / search.stepMm)
    const last = Math.floor((upper - preferred) / search.stepMm)
    const shifts = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_, index) => first + index,
    ).sort((a, b) => Math.abs(a) - Math.abs(b))
    for (const shift of shifts) {
      const insetMm = search.stepMm / 4
      const point = {
        x: outward.x
          ? outward.x < 0
            ? bounds.minX + insetMm
            : bounds.maxX - insetMm
          : preferred + shift * search.stepMm,
        y: outward.y
          ? outward.y < 0
            ? bounds.minY + insetMm
            : bounds.maxY - insetMm
          : preferred + shift * search.stepMm,
      }
      const stub = {
        x: point.x + outward.x * 4 * search.input.minTraceWidth,
        y: point.y + outward.y * 4 * search.input.minTraceWidth,
      }
      const path = side ? [stub, point] : [point, stub]
      const clear = search.scenes.every((scene, rail) => {
        const conductor = offsetPath(path, (rail ? 1 : -1) * search.halfPitchMm)
        return (
          pointInBox(conductor[side ? 1 : 0], bounds) &&
          scene.pathVisible(conductor)
        )
      })
      if (clear) mouths.push({ point, stub })
    }
  }
  return mouths
}

function* searchOffsetPackageCenterlines(
  search: OffsetPackageSearch,
): Generator<Point[][] | null> {
  const seen = new Set<string>()
  const preferred = simplify(search.defaults[0])
  const detourBases: Point[][] = preferred.length >= 2 ? [preferred] : []
  if (preferred.length >= 2 && centerlineIsClear(search, preferred)) {
    seen.add(JSON.stringify(preferred))
    yield [preferred]
  }
  const sources = packageMouths(search, 0)
  const targets = packageMouths(search, 1)
  const candidates = sources
    .flatMap((source) =>
      targets.map((target) => ({
        source,
        target,
        approachLengthMm:
          distance(search.preferred[0], source.point) +
          distance(source.stub, target.stub) +
          distance(target.point, search.preferred[1]),
      })),
    )
    .sort((a, b) => a.approachLengthMm - b.approachLengthMm)
  // Enumerate lazily through every legal package-face combination. A shorter
  // corridor can have an impossible pad approach; the caller must try longer
  // alternatives until success, search exhaustion, or its existing time budget.
  for (const { source, target } of candidates) {
    for (const middle of connectors(source.stub, target.stub)) {
      const path = simplify([source.point, ...middle, target.point])
      const key = JSON.stringify(path)
      if (path.length < 2 || seen.has(key)) continue
      seen.add(key)
      detourBases.push(path)
      if (centerlineIsClear(search, path)) yield [path]
    }
  }
  // Retain every established direct choice first. A blocked direct corridor
  // can also seed a legal excursion outside the monotone package envelope.
  for (const path of detourBases) {
    const approachMm = search.preferred.reduce(
      (sum, point, side) =>
        sum + distance(point, path[side ? path.length - 1 : 0]),
      0,
    )
    for (const detour of packageCenterlineDetours({
      input: search.input,
      path,
      halfPitchMm: search.halfPitchMm,
      preferredAddedLengthMm: Math.max(
        0,
        (search.targetLengthMm ?? 0) - length(path) - approachMm,
      ),
    })) {
      if (!detour) {
        yield null
        continue
      }
      if (!centerlineIsClear(search, detour)) continue
      const key = JSON.stringify(detour)
      if (seen.has(key)) continue
      seen.add(key)
      yield [detour]
    }
  }
}

/** Search actual rail copper on every face of two offset native packages. */
export function offsetPackageCenterlines({
  input,
  defaults,
  regions,
  stepMm,
  targetLengthMm,
}: {
  input: SimpleRouteJson
  defaults: Point[][]
  regions: ReturnType<typeof packageApproachRegions>
  stepMm: number
  targetLengthMm?: number
}): Generator<Point[][] | null> | undefined {
  if (input.differentialPairs?.length !== 1) return
  const pair = input.differentialPairs[0]
  const connections = pair.connectionNames.map(
    (name) => input.connections.find((connection) => connection.name === name)!,
  )
  const packages = [0, 1].map(
    (side) =>
      regions.find((region) =>
        pointInBox(connections[0].pointsToConnect[side], region.pads),
      )!,
  )
  if (packages.some((region) => !region)) return
  const sourceCenter = boxCenter(packages[0].pads)
  const targetCenter = boxCenter(packages[1].pads)
  if (
    Math.abs(sourceCenter.x - targetCenter.x) < 1e-8 ||
    Math.abs(sourceCenter.y - targetCenter.y) < 1e-8
  )
    return
  const copper = fixedCopper(input)
  const scenes = connections.map(
    (connection) =>
      new VectorScene(
        input,
        {
          ...connection,
          pointsToConnect: connection.pointsToConnect.map((point) => ({
            ...point,
            layer: input.allowedLayers![0],
          })),
        },
        input.minTraceWidth,
        copper,
      ),
  )
  const preferred = [0, 1].map((side) => ({
    x:
      connections.reduce(
        (sum, connection) => sum + connection.pointsToConnect[side].x,
        0,
      ) / 2,
    y:
      connections.reduce(
        (sum, connection) => sum + connection.pointsToConnect[side].y,
        0,
      ) / 2,
  }))
  return searchOffsetPackageCenterlines({
    input,
    defaults,
    packages,
    scenes,
    preferred,
    halfPitchMm: nativePairHalfPitch(input, pair),
    stepMm,
    targetLengthMm,
  })
}
