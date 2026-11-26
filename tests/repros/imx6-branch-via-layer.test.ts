import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BusLanesPipelineSolver, BusLanesSolver } from "../../lib"
import type { SimpleRouteJson, Trace } from "../../lib/types"

type PhysicalInput = SimpleRouteJson & {
  obstacles: (SimpleRouteJson["obstacles"][number] & { type: "rect" })[]
  traces: (Trace & { connection_name: string })[]
}

test("i.MX6 DRAM_DATA8 bottom branch joins its escape via on the bottom layer", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/imx6-branch-via-layer.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as PhysicalInput
  const [connection] = input.connections
  expect(connection!.pointsToConnect.map((point) => point.layer)).toEqual([
    "bottom",
    "top",
    "top",
  ])
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(input).toEqual(original)

  const traces = solver.traces.map((trace) => {
    if (!trace.connection_name) throw Error("Completed DDR trace has no owner")
    return { ...trace, connection_name: trace.connection_name }
  })
  const context = { inputSrj: input, routedSrj: { ...input, traces } }
  const connectivity = validateOriginalEndpointConnectivity(context)
  expect(connectivity.connectedConnectionCount).toBe(1)
  expect(connectivity.connectedEndpointCount).toBe(3)
  expect(connectivity.valid).toBe(true)
  expect(
    validateRoutedCopperDrc({
      ...context,
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    }).issues,
  ).toEqual([])

  const graphics = new BusLanesSolver({ ...input, traces }).visualize()
  graphics.title =
    "i.MX6 DRAM_DATA8: all three terminals connected; the bottom pad joins the escape via on the bottom layer"
  graphics.texts = [
    {
      x: Math.min(
        ...input.obstacles.map((pad) => pad.center.x - pad.width / 2),
      ),
      y:
        Math.max(
          ...input.obstacles.map((pad) => pad.center.y + pad.height / 2),
        ) + 1,
      text: graphics.title,
      color: "#111827",
      fontSize: 0.55,
      anchorSide: "bottom_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
