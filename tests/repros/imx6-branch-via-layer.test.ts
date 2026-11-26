import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BusLanesPipelineSolver, BusLanesSolver } from "../../lib"
import type { SimpleRouteJson } from "../../lib/types"

test("i.MX6 DRAM_DATA8 bottom branch asks for a new via beside the escape via it joins", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/imx6-branch-via-layer.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as SimpleRouteJson
  const [connection] = input.connections
  expect(connection!.pointsToConnect.map((point) => point.layer)).toEqual([
    "bottom",
    "top",
    "top",
  ])
  const solver = new BusLanesPipelineSolver(structuredClone(input))
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("No collision-free local dogbone assignment")

  // Native pads and the three labelled terminals only; no candidate copper.
  const graphics = new BusLanesSolver(input).visualize()
  graphics.title =
    "i.MX6 DRAM_DATA8: FAILED. The bottom-pad branch asks for a new via beside the escape via it joins"
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
  for (const terminal of connection!.pointsToConnect)
    graphics.points!.push({
      x: terminal.x,
      y: terminal.y,
      color: "#e11d48",
      label: `${terminal.pcb_port_id} (${terminal.layer})`,
    })
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
