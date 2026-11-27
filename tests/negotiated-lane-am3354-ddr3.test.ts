import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { NegotiatedLaneSolver, type SimpleRouteJson } from "../lib"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"

// AM3354 processor to one 96-ball DDR3 device on a four-layer board (top and bottom
// carry signals, the inner layers are planes). The ball order needs about eight
// crossing-free layers, so the matched signals must change layer along the route.
test("routes the AM3354 DDR3 block on two signal layers inside TI's length windows", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/am3354-ddr3-block/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  )
  // TI SPRS717L Table 7-68 item 2: CK and address/control within 25 mil of each other
  for (const b of input.buses!)
    if (b.busId === "DDR_ADDR_CTRL_CK") b.maxLengthSkew = 0.635
  const bus = (id: string) =>
    input.buses!.find((b) => b.busId === id)!.connectionNames
  const pairs = input.differentialPairs!.flatMap((p) => p.connectionNames)
  const bytes = [...bus("DDR_BYTE0"), ...bus("DDR_BYTE1")]
  const zone = [-61, -54]
  const shared = {
    zone,
    maxKicks: 4,
    kickGrowth: 1,
    // data nets pay more per via, so the extra layer changes land on address/control
    viaCostByBus: { DDR_BYTE0: 8, DDR_BYTE1: 8, DDR_ADDR_CTRL_CK: 1.2 },
  }
  const solver = new NegotiatedLaneSolver(input, {
    region: { minX: -84, maxX: -45.4, minY: 1.95, maxY: 30.2 },
    router: {
      zoneRows: [2.5, 29.5],
      allowViaInPad: true,
      // layer 3 can be VDDS_DDR only west of the processor's other supply balls
      keepouts: [
        { layer: "bottom", minX: -48.05, maxX: 0, minY: -100, maxY: 100 },
        { layer: "bottom", minX: -48.85, maxX: 0, minY: 10.95, maxY: 12.95 },
        { layer: "bottom", minX: -49.65, maxX: 0, minY: 20.55, maxY: 21.75 },
      ],
    },
    attemptsPerStage: 1,
    maxPromotions: 0,
    stages: [
      {
        // the three differential pairs alone, then frozen
        connectionNames: pairs,
        options: { ...shared, maxIters: 200, congestionByBus: {} },
      },
      {
        // every single-ended net in one joint negotiation
        connectionNames: input.connections
          .map((c) => c.name)
          .filter((n) => !pairs.includes(n)),
        options: {
          ...shared,
          maxIters: 700,
          stallIters: 60,
          viaCost: 1.2,
          presMax: 100,
          histInc: 5,
        },
      },
    ],
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(solver.traces.length).toBe(50)

  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj: input,
    routedSrj: output,
  } as unknown as Parameters<typeof validateOriginalEndpointConnectivity>[0])
  expect(connectivity.issues).toEqual([])
  expect(connectivity.connectedConnectionCount).toBe(50)
  // the supplied power fanout belongs to nets outside this routing problem
  const supplied = [
    ...new Set(input.traces!.map((t) => t.connection_name)),
  ].map((name) => ({ name, pointsToConnect: [] }))
  const drc = validateRoutedCopperDrc({
    inputSrj: { ...input, connections: [...input.connections, ...supplied] },
    routedSrj: { ...output, connections: [...input.connections, ...supplied] },
    clearance: 0.1,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])

  for (const report of busLengthReports(input, solver.traces)) {
    expect(report.aboveMinimumLength).toBe(true)
    expect(report.withinLengthLimit).toBe(true)
    expect(report.matched).toBe(true)
  }
  expect(
    pairLengthReports(input, solver.traces).every((pair) => pair.matched),
  ).toBe(true)
  // the extra layer changes land on the least important signals
  const vias = (name: string) =>
    solver.traces
      .find((t) => t.connection_name === name)!
      .route.filter((p) => p.route_type === "via").length
  expect(Math.max(...bytes.map(vias))).toBeLessThanOrEqual(4)
  for (const pair of input.differentialPairs!)
    expect(vias(pair.connectionNames[0])).toBe(vias(pair.connectionNames[1]))

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
}, 3_600_000)
