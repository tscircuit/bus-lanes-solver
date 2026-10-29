import "bun-match-svg"
import { expect, type MatcherResult } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg, type PcbSvgOptions } from "circuit-to-svg"

// Same PCB renderer as core/tests/fixtures/extend-expect-circuit-snapshot.ts;
// use the shared SVG snapshot matcher rather than a custom drawing/exporter.
expect.extend({
  async toMatchPcbSnapshot(
    received: unknown,
    testPath: string,
    options?: PcbSvgOptions,
  ): Promise<MatcherResult> {
    await expect(
      convertCircuitJsonToPcbSvg(received as AnyCircuitElement[], {
        showDebugObjects: true,
        ...options,
      }),
    ).toMatchSvgSnapshot(testPath, "pcb")
    return { pass: true, message: () => "PCB snapshot matches" }
  },
})

declare module "bun:test" {
  interface Matchers<T = unknown> {
    toMatchPcbSnapshot(
      testPath: string,
      options?: PcbSvgOptions,
    ): Promise<MatcherResult>
  }
}
