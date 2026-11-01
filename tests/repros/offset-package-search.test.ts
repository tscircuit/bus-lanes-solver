import { expect, test } from "bun:test"
import { offsetPath } from "../../lib/coupled-pair-routing"
import { length } from "../../lib/geometry"
import { offsetPackageCenterlines } from "../../lib/offset-package-centerlines"
import { packageApproachRegions } from "../../lib/package-approach-regions"
import { fixedCopper, VectorScene } from "../../lib/vector-scene"
import { offsetNativePair } from "../fixtures/offset-native-pair"

// Later legal corridors must remain available after early package approaches fail.
test("offset search retains more than 512 distinct legal corridors, including longer approaches", () => {
  const input = offsetNativePair()
  const before = structuredClone(input)
  const candidates = offsetPackageCenterlines({
    input,
    defaults: [
      [
        { x: -5.575, y: -1 },
        { x: -4.375, y: -1 },
        { x: -2.375, y: 1 },
        { x: 5.575, y: 1 },
      ],
    ],
    regions: packageApproachRegions(input, 0.25),
    stepMm: 0.1,
  })
  expect(candidates).toBeDefined()
  const scenes = input.connections.map(
    (connection) =>
      new VectorScene(
        input,
        {
          ...connection,
          pointsToConnect: connection.pointsToConnect.map((point) => ({
            ...point,
            layer: "inner1",
          })),
        },
        0.1,
        fixedCopper(input),
      ),
  )
  const corridors: string[] = []
  const lengthsMm: number[] = []
  for (const candidate of candidates!) {
    if (!candidate) continue
    const [centerline] = candidate
    expect(
      scenes.every((scene, rail) =>
        scene.pathVisible(offsetPath(centerline, rail ? 0.1 : -0.1)),
      ),
    ).toBe(true)
    corridors.push(JSON.stringify(centerline))
    lengthsMm.push(length(centerline))
    if (corridors.length === 513) break
  }
  expect(corridors).toHaveLength(513)
  expect(new Set(corridors).size).toBe(513)
  expect(Math.max(...lengthsMm)).toBeGreaterThan(Math.min(...lengthsMm) + 0.5)
  expect(input).toEqual(before)
})
