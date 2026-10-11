import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { pairLengthReports } from "../lib/route-lengths"
import type { Point } from "../lib/types"
import { captureNativePairProposal } from "./fixtures/capture-native-pair-proposal"
import { compileGridPairCircuit } from "./fixtures/native-pair-grid-circuit"
import {
  nativePairDiagnosticSvg,
  writeDiagnosticSnapshot,
} from "./fixtures/native-pair-diagnostic-svg"

test("Core-authored fractional bounds produce native-grid vias that route real balancing approaches", async () => {
  const step = 0.1
  const { input, circuitJson } = compileGridPairCircuit()
  const before = structuredClone(input)
  expect(
    circuitJson.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(6)
  expect(input.bounds).toEqual({
    minX: -4.03,
    maxX: 4.069999999999999,
    minY: -2.03,
    maxY: 2.07,
  })
  expect(input.obstacles).toHaveLength(6)
  expect(input.obstacles.every((obstacle) => obstacle.type === "rect")).toBe(
    true,
  )
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_smtpad" && element.port_hints?.includes("3"),
    ),
  ).toHaveLength(2)
  expect(
    input.obstacles.filter(
      (obstacle) =>
        !input.connections.some((connection) =>
          obstacle.connectedTo.includes(connection.name),
        ),
    ),
  ).toHaveLength(2)
  expect(input.differentialPairs?.[0].lengthTolerance).toBe(0.1)
  const proposal = captureNativePairProposal(input, {
    centerlines: [
      [
        { x: -2.8, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 2.8, y: 0 },
      ],
    ],
    gridStep: step,
    maxApproachPasses: 20,
    maxExpansionsPerRoute: 10000,
  })
  const onNativeGrid = (point: Point) =>
    [
      (point.x - input.bounds.minX) / step,
      (point.y - input.bounds.minY) / step,
    ].every(
      (coordinate) => Math.abs(coordinate - Math.round(coordinate)) < 1e-8,
    )
  expect(proposal.attempts.length).toBeGreaterThan(0)
  expect(proposal.attempts.every(({ point }) => onNativeGrid(point))).toBe(true)
  expect(proposal.attempts.some(({ accepted }) => accepted)).toBe(true)
  // Candidate centers now reach actual native routing; the separate control
  // still proves a physical approach exists without inserting output copper.
  expect(proposal.projectedAlternative).not.toBeNull()
  expect(
    proposal.projectedAlternative!.route.some(
      (point) => point.route_type === "via",
    ),
  ).toBe(true)
  expect(proposal.traces).toHaveLength(2)
  for (const [index, trace] of proposal.traces.entries()) {
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
      routedSrj: { ...input, traces: proposal.traces },
      clearance: 0.05,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  const report = pairLengthReports(input, proposal.traces)[0]
  expect(report.matched).toBe(true)
  expect(report.skewMm!).toBeLessThanOrEqual(report.toleranceMm!)
  const svg = nativePairDiagnosticSvg(
    input,
    proposal,
    "grid",
    "after",
    circuitJson,
  )
  const snapshot = new URL(
    "./__snapshots__/native-pair-grid.after.svg",
    import.meta.url,
  ).pathname
  if (process.env.UPDATE_NATIVE_PAIR_SNAPSHOTS === "1")
    await writeDiagnosticSnapshot(snapshot, svg)
  expect(svg).toBe(await Bun.file(snapshot).text())
  expect(input).toEqual(before)
})
