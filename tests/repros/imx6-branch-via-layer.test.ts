import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../../lib"
import type { SimpleRouteJson } from "../../lib/types"

test("i.MX6 DRAM_DATA8 bottom branch asks for a new via beside the escape via it joins", () => {
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
})
