import {
  applyToPoint,
  compose,
  rotate,
  translate,
  type Matrix,
} from "transformation-matrix"
import { distance } from "./geometry"
import { ROUNDED_PAIR_ARC_SAMPLES } from "./paired-arc-sampling"
import type { Point } from "./types"

export interface PairedLobeOptions {
  a: Point
  b: Point
  spacing: number
  deficit: number
  lobes: number
  side: number
  minRadius: number
}

interface TangentArcTemplate {
  x: number
  radiusSine: number
  offsetY: number
  isRaised: boolean
  railIndex: number
}

interface TangentLobeGeometry {
  arcTemplates: TangentArcTemplate[]
  localToBoardTransform: Matrix
  radius: number
  span: number
  side: number
}

function tangentLobePoint(
  { template, height }: { template: TangentArcTemplate; height: number },
  geometry: TangentLobeGeometry,
): Point {
  let centerY = geometry.radius
  if (template.isRaised) centerY = height - geometry.radius
  const y = geometry.side * (centerY + template.radiusSine) + template.offsetY
  return applyToPoint(geometry.localToBoardTransform, { x: template.x, y })
}

function tangentLobeRails(
  { height }: { height: number },
  geometry: TangentLobeGeometry,
): [Point[], Point[]] {
  const rails: [Point[], Point[]] = [[], []]
  for (const template of geometry.arcTemplates) {
    const point = tangentLobePoint({ template, height }, geometry)
    const rail = rails[template.railIndex]
    if (!rail.length || distance(rail.at(-1)!, point) > 1e-10) rail.push(point)
  }
  return rails
}

function tangentLobeAddition(
  { height }: { height: number },
  geometry: TangentLobeGeometry,
): number {
  let shortest = Infinity
  for (const railIndex of [0, 1]) {
    let previous: Point | undefined
    let total = 0
    for (const template of geometry.arcTemplates) {
      if (template.railIndex !== railIndex) continue
      const point = tangentLobePoint({ template, height }, geometry)
      if (previous) {
        const segmentLength = distance(previous, point)
        if (segmentLength <= 1e-10) continue
        total += segmentLength
      }
      previous = point
    }
    shortest = Math.min(shortest, total - geometry.span)
  }
  return shortest
}

/** Parallel circle tangents preserve copper spacing through paired bends.
 * Board coordinates are mm, +X right/+Y up; angles are counterclockwise radians. */
export function tangentPairedLobes({
  a,
  b,
  spacing,
  deficit,
  lobes,
  side,
  minRadius,
}: PairedLobeOptions): [Point[], Point[]] | null {
  const span = distance(a, b)
  const period = span / lobes
  const radius = minRadius + spacing / 2
  if (spacing <= 0 || deficit <= 0 || lobes < 1 || period < 4 * radius)
    return null
  const samples = Math.max(
    ROUNDED_PAIR_ARC_SAMPLES,
    Math.ceil((Math.PI * radius) / (2 * Math.max(0.005, minRadius / 6))),
  )
  const arcTemplates: TangentArcTemplate[] = []
  for (let lobeIndex = 0; lobeIndex < lobes; lobeIndex++) {
    for (const [
      centerX,
      isRaised,
      startAngleCcwRadians,
      endAngleCcwRadians,
    ] of [
      [0, false, -Math.PI / 2, 0],
      [2 * radius, true, Math.PI, Math.PI / 2],
      [period - 2 * radius, true, Math.PI / 2, 0],
      [period, false, Math.PI, Math.PI * 1.5],
    ] as const) {
      const angleStepCcwRadians =
        (endAngleCcwRadians - startAngleCcwRadians) / samples
      const arcDirection = Math.sign(endAngleCcwRadians - startAngleCcwRadians)
      const lobeOriginX = lobeIndex * period + centerX
      for (let sampleIndex = 0; sampleIndex <= samples + 1; sampleIndex++) {
        let angleCcwRadians = startAngleCcwRadians
        let tangentScale = 1
        if (sampleIndex === samples + 1) angleCcwRadians = endAngleCcwRadians
        else if (sampleIndex > 0) {
          angleCcwRadians =
            startAngleCcwRadians + (sampleIndex - 0.5) * angleStepCcwRadians
          tangentScale = 1 / Math.cos(angleStepCcwRadians / 2)
        }
        const tangentX = -Math.sin(angleCcwRadians) * arcDirection
        const tangentY = side * Math.cos(angleCcwRadians) * arcDirection
        for (const railIndex of [0, 1]) {
          let offset = spacing / 2
          if (railIndex === 1) offset = -offset
          const offsetCircleX =
            radius * Math.cos(angleCcwRadians) - tangentY * offset
          arcTemplates.push({
            x: lobeOriginX + tangentScale * offsetCircleX,
            radiusSine: tangentScale * radius * Math.sin(angleCcwRadians),
            offsetY: tangentScale * tangentX * offset,
            isRaised,
            railIndex,
          })
        }
      }
    }
  }
  const ccwRotationRadians = Math.atan2(b.y - a.y, b.x - a.x)
  const localToBoardTransform = compose(
    translate(a.x, a.y),
    rotate(ccwRotationRadians),
  )
  const geometry = { arcTemplates, localToBoardTransform, radius, span, side }
  const minimumHeight = 2 * radius
  const minimumAddition = tangentLobeAddition(
    { height: minimumHeight },
    geometry,
  )
  if (minimumAddition > deficit + 1e-8) return null
  let height =
    minimumHeight + Math.max(0, deficit - minimumAddition) / (2 * lobes)
  const addition = tangentLobeAddition({ height }, geometry)
  height = Math.max(minimumHeight, height + (deficit - addition) / (2 * lobes))
  return tangentLobeRails({ height }, geometry)
}
