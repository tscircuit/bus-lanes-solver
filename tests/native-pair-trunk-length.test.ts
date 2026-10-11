import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { pairLengthReports } from "../lib/route-lengths"
import { captureNativePairProposal } from "./fixtures/capture-native-pair-proposal"
import {
  nativePairDiagnosticSvg,
  writeDiagnosticSnapshot,
} from "./fixtures/native-pair-diagnostic-svg"
import { compileTrunkPairCircuit } from "./fixtures/native-pair-trunk-circuit"

test("Core-authored native pair meets its whole-copper length constraint after via balancing", async () => {
  const { input, circuitJson } = compileTrunkPairCircuit()
  const before = structuredClone(input)
  expect(
    circuitJson.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(4)
  expect(input.differentialPairs?.[0].lengthTolerance).toBe(0.1)
  const proposal = captureNativePairProposal(input, {
    centerlines: [
      [
        { x: -2.8, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 2.8 },
      ],
    ],
    gridStep: 0.1,
    maxApproachPasses: 20,
    maxExpansionsPerRoute: 10000,
  })
  const { traces } = proposal
  expect(traces).toHaveLength(2)
  for (const [index, trace] of traces.entries()) {
    const endpoints = input.connections[index].pointsToConnect
    expect(trace.route[0]).toMatchObject({
      x: endpoints[0].x,
      y: endpoints[0].y,
      layer: endpoints[0].layer,
    })
    expect(trace.route.at(-1)).toMatchObject({
      x: endpoints[1].x,
      y: endpoints[1].y,
      layer: endpoints[1].layer,
    })
    expect(
      trace.route.filter((point) => point.route_type === "via"),
    ).toHaveLength(2)
  }
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces },
      clearance: 0.05,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  const report = pairLengthReports(input, traces)[0]
  expect(report.skewMm).toBeLessThanOrEqual(0.1)
  // The same complete copper now meets the authored pair constraint before
  // refinement; the omitted-trunk deficit no longer needs residual tuning.
  expect(report.matched).toBe(true)
  expect(report.skewMm!).toBeLessThanOrEqual(report.toleranceMm!)
  const svg = nativePairDiagnosticSvg(input, proposal, "trunk", "after")
  const snapshot = new URL(
    "./__snapshots__/native-pair-trunk.after.svg",
    import.meta.url,
  ).pathname
  if (process.env.UPDATE_NATIVE_PAIR_SNAPSHOTS === "1")
    await writeDiagnosticSnapshot(snapshot, svg)
  expect(svg).toBe(await Bun.file(snapshot).text())
  expect(input).toEqual(before)
})
