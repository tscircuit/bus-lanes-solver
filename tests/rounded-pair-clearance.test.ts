import { expect, test } from "bun:test"
import { distance, length, segmentDistance } from "../lib/geometry"
import { tangentPairedLobes } from "../lib/smooth-tuning"

// Board-world mm, +X right/+Y up. Measure the emitted copper polylines, rather
// than ideal circle offsets: their chord gaps previously fell below clearance.
test("rounded paired tuning preserves copper clearance along every bend", () => {
  const width = 0.089
  const gap = 0.089
  const spacing = width + gap
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
    const a = { x: 12.3, y: -8.2 }
    const b = { x: a.x + 8 * Math.cos(angle), y: a.y + 8 * Math.sin(angle) }
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
    for (const side of [-1, 1]) {
      for (const lobes of [1, 2]) {
        const rails = tangentPairedLobes(
          a,
          b,
          spacing,
          4,
          lobes,
          side,
          width * 1.2,
        )
        expect(rails).not.toBeNull()
        if (!rails) throw Error("Expected a feasible paired tuning cell")
        for (const [railIndex, rail] of rails.entries()) {
          const offset = ((railIndex === 0 ? 1 : -1) * spacing) / 2
          for (const [endpoint, center] of [
            [rail[0], a],
            [rail.at(-1)!, b],
          ]) {
            expect(
              distance(endpoint, {
                x: center.x + normal.x * offset,
                y: center.y + normal.y * offset,
              }),
            ).toBeLessThan(1e-9)
          }
          expect(Math.abs(length(rail) - distance(a, b) - 4)).toBeLessThan(1e-6)
        }
        let minimumSeparation = Infinity
        for (let i = 1; i < rails[0].length; i++) {
          for (let j = 1; j < rails[1].length; j++) {
            minimumSeparation = Math.min(
              minimumSeparation,
              segmentDistance(
                [rails[0][i - 1], rails[0][i]],
                [rails[1][j - 1], rails[1][j]],
              ),
            )
          }
        }
        expect(minimumSeparation - width).toBeGreaterThanOrEqual(gap - 1e-8)
      }
    }
  }
})
