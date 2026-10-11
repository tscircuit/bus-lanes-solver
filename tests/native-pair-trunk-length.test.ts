import { expect, spyOn, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { planNativePairedCarriers } from "../lib/plan-native-paired-carriers"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("native pair rebalancing preserves whole-copper skew across unequal offset trunks", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -4, maxX: 2, minY: -2, maxY: 4 },
    connections: ["P", "N"].map((name, i) => ({
      name,
      pointsToConnect: [
        { x: -3, y: i ? -0.4 : 0.4, layer: "top" },
        { x: i ? -0.4 : 0.4, y: 3, layer: "top" },
      ],
    })),
    obstacles: ["P", "N"].flatMap((name, i) =>
      [0, 1].map((side) => ({
        type: "rect",
        shape: "circle" as const,
        componentId: `package_${side}`,
        center: side
          ? { x: i ? -0.4 : 0.4, y: 3 }
          : { x: -3, y: i ? -0.4 : 0.4 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [name],
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.1, lengthTolerance: 0.1 },
    ],
  }
  const before = structuredClone(input),
    stopped = new Error("Captured the complete pair before residual tuning")
  let proposals: Trace[] = []
  // Observe the actual routed approaches at the next stage boundary. This
  // isolates via rebalancing from the later, much larger meander search.
  const matching = spyOn(BusLanesSolver, "forRefinement").mockImplementation(
    (prepared, carriers) => {
      proposals = carriers.map((trace) =>
        joinSignalEscapes(
          trace,
          prepared.traces!.filter(
            (escape) => escape.connection_name === trace.connection_name,
          ),
        ),
      )
      throw stopped
    },
  )
  try {
    const search = planNativePairedCarriers(input, {
      centerlines: [
        [
          { x: -2.8, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 2.8 },
        ],
      ],
      maxApproachPasses: 20,
      maxExpansionsPerRoute: 10000,
    })
    expect(() => {
      let result = search.next()
      while (!result.done) result = search.next()
    }).toThrow(stopped)
  } finally {
    matching.mockRestore()
  }
  expect(proposals).toHaveLength(2)
  for (const [index, trace] of proposals.entries()) {
    const endpoints = input.connections[index].pointsToConnect
    expect(trace.route[0]).toMatchObject(endpoints[0])
    expect(trace.route.at(-1)).toMatchObject(endpoints[1])
    expect(
      trace.route.filter((point) => point.route_type === "via"),
    ).toHaveLength(2)
  }
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: proposals },
      clearance: 0.05,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  const totals = proposals.map((trace) => length(trace.route))
  expect(Math.abs(totals[0] - totals[1])).toBeLessThanOrEqual(0.1)
  expect(input).toEqual(before)
})
