import "bun-match-svg"
import { expect, type MatcherResult } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg, type PcbSvgOptions } from "circuit-to-svg"

type PcbSnapshotOptions = { testPath: string; svgOptions?: PcbSvgOptions }

// One shared adapter to core's PCB renderer and the existing SVG matcher.
expect.extend({
  async toMatchPcbSnapshot(
    received: unknown,
    { testPath, svgOptions }: PcbSnapshotOptions,
  ): Promise<MatcherResult> {
    if (!Array.isArray(received)) throw Error("Expected Circuit JSON elements")
    const circuit: AnyCircuitElement[] = received
    await expect(
      convertCircuitJsonToPcbSvg(circuit, {
        showDebugObjects: true,
        ...svgOptions,
      }),
    ).toMatchSvgSnapshot(testPath, "pcb")
    return { pass: true, message: () => "PCB snapshot matches" }
  },
})

declare module "bun:test" {
  interface Matchers<T = unknown> {
    toMatchPcbSnapshot(options: PcbSnapshotOptions): Promise<MatcherResult>
  }
}
