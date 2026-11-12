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
import { GridVisibilitySearch } from "../../lib/grid-visibility"
import type { Connection, SimpleRouteJson, Trace } from "../../lib/types"
import { fixedCopper, VectorScene } from "../../lib/vector-scene"

type PhysicalInput = SimpleRouteJson & {
  obstacles: (SimpleRouteJson["obstacles"][number] & { type: "rect" })[]
  traces: (Trace & { connection_name: string })[]
}

test("ButterStick pending native-pad access after RAM branches", async (): Promise<void> => {
  const { inputSrj, physicalInputSrj, futureConnection } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/butterstick-branch-attachment.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as {
    inputSrj: SimpleRouteJson
    physicalInputSrj: PhysicalInput
    futureConnection: Connection
  }
  const original = structuredClone(inputSrj)
  const solver = new BusLanesPipelineSolver(inputSrj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(inputSrj).toEqual(original)

  const traces = solver.traces.map((trace) => {
    if (!trace.connection_name) throw Error("Completed DDR trace has no owner")
    return { ...trace, connection_name: trace.connection_name }
  })
  const output = {
    ...physicalInputSrj,
    traces: [...physicalInputSrj.traces, ...traces],
  }
  const context = { inputSrj: physicalInputSrj, routedSrj: output }
  const connectivity = validateOriginalEndpointConnectivity(context)
  expect(connectivity.connectedConnectionCount).toBe(16)
  expect(connectivity.connectedEndpointCount).toBe(48)
  expect(connectivity.valid).toBe(true)
  expect(
    validateRoutedCopperDrc({
      ...context,
      clearance: inputSrj.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    }).issues,
  ).toEqual([])
  const futureInput = {
    ...output,
    connections: [...output.connections, futureConnection],
  }
  const scene = new VectorScene(
    futureInput,
    futureConnection,
    futureConnection.width!,
    fixedCopper(futureInput),
  )
  const [start, end] = futureConnection.pointsToConnect
  const search = new GridVisibilitySearch(scene, start, end, [], 0, undefined, {
    allTerminalAttachments: true,
    checkReachability: true,
  })
  try {
    while (!search.solved && !search.failed) search.step()
    expect(search.solved).toBe(true)
  } finally {
    search.cancel()
  }

  // The later LDQS_N request starts at this native ball. It needs enough
  // planar access to leave the package before choosing its carrier layer.
  const pad = output.obstacles.find(
    (obstacle) =>
      (
        obstacle as typeof obstacle & {
          circuitJsonMetadata?: { pcb_port_id?: string }
        }
      ).circuitJsonMetadata?.pcb_port_id === "pcb_port_381",
  )!
  const edge = Math.max(
    ...output.obstacles
      .filter((obstacle) => obstacle.componentId === pad.componentId)
      .map((obstacle) => obstacle.center.x + obstacle.width / 2),
  )
  const strobeExit: Connection = {
    name: "pcb_port_381",
    width: inputSrj.minTraceWidth,
    pointsToConnect: [
      { ...pad.center, layer: "top", pcb_port_id: "pcb_port_381" },
      {
        x:
          edge +
          inputSrj.minTraceWidth / 2 +
          inputSrj.minTraceToPadEdgeClearance! +
          inputSrj.minViaPadDiameter! / 2,
        y: pad.center.y,
        layer: "top",
      },
    ],
  }
  const exitSearch = new GridVisibilitySearch(
    new VectorScene(output, strobeExit, strobeExit.width!, fixedCopper(output)),
    strobeExit.pointsToConnect[0],
    strobeExit.pointsToConnect[1],
    [],
    0,
    undefined,
    { allTerminalAttachments: true, checkReachability: true },
  )
  try {
    while (!exitSearch.solved && !exitSearch.failed) exitSearch.step()
    const graphics = new BusLanesSolver(futureInput).visualize()
    graphics.title = `ButterStick: 16 DDR nets complete; pending LDQS_N escape ${exitSearch.solved ? "open" : "blocked"}`
    graphics.texts = [
      {
        x: Math.min(
          ...inputSrj.obstacles.map((pad) => pad.center.x - pad.width / 2),
        ),
        y:
          Math.max(
            ...inputSrj.obstacles.map((pad) => pad.center.y + pad.height / 2),
          ) + 1,
        text: graphics.title,
        color: "#111827",
        fontSize: 0.55,
        anchorSide: "bottom_left",
      },
    ]
    graphics.points!.push({
      ...pad.center,
      color: "#e11d48",
      label: "Pending LDQS_N pad",
    })
    await expect(
      getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path)
    expect(exitSearch.solved).toBe(true)
  } finally {
    exitSearch.cancel()
  }
})
