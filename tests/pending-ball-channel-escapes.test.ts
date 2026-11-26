import { expect, test } from "bun:test"
import { getPendingBallChannelEscapes } from "../lib/pending-ball-channel-escapes"
import type { Obstacle, SimpleRouteJson, Trace } from "../lib/types"

test("a bus lane is moved only when it closes the last sampled through-via site", (): void => {
  const ball = (x: number, port: string): Obstacle => ({
    center: { x, y: 0 },
    componentId: "ram",
    shape: "circle",
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [port],
    circuitJsonMetadata: { pcb_port_id: port },
  })
  const mask = { ...ball(0, "mask"), connectedTo: ["mask", "mask_net"] }
  const otherMaskPad = {
    ...ball(6, "cpu_mask"),
    componentId: "cpu",
    connectedTo: ["cpu_mask", "mask_net"],
  }
  const input: SimpleRouteJson = {
    bounds: { minX: -4, minY: -4, maxX: 7, maxY: 4 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    allowViaInPad: false,
    connections: [],
    obstacles: [
      mask,
      ball(-1, "west"),
      { ...ball(0, "north"), center: { x: 0, y: 1 } },
      ball(3, "east"),
      otherMaskPad,
    ],
  }
  const laneAt = (x: number): Trace => ({
    type: "pcb_trace",
    pcb_trace_id: "data_lane",
    connection_name: "data_lane",
    route: [-0.8, 0.8].map((y) => ({
      route_type: "wire",
      x,
      y,
      width: 0.1,
      layer: "top",
    })),
  })
  expect(
    getPendingBallChannelEscapes(input, [laneAt(0.9)]).blockingLanes.size,
  ).toBe(0)
  const blocked = getPendingBallChannelEscapes(input, [laneAt(0.27)])
  expect([...blocked.blockingLanes]).toEqual(["data_lane"])
  expect(blocked.reservations).toHaveLength(1)
  const via = blocked.reservations[0].route.find(
    (point) => point.route_type === "via",
  )!
  expect(via.x).toBeGreaterThanOrEqual(0.3 - 1e-9)
  expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  const alreadyClosed = { ...input, traces: [laneAt(0.27)] }
  expect(
    getPendingBallChannelEscapes(alreadyClosed, [laneAt(0.3)]).reservations,
  ).toEqual([])
})
