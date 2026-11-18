import { expect, test } from "bun:test"
import { PendingPeerAccess } from "../lib/pending-peer-access"
import type { Connection, SimpleRouteJson, Trace } from "../lib/types"

function finish<Result>(search: Generator<void, Result>): Result {
  let step = search.next()
  while (!step.done) step = search.next()
  return step.value
}

function fixture(): {
  input: SimpleRouteJson
  connection: Connection
  wall: Trace
} {
  const connection: Connection = {
    name: "FUTURE",
    width: 0.1,
    pointsToConnect: [
      { x: -1, y: 0, layer: "top" },
      { x: 1, y: 1, layer: "top" },
    ],
  }
  const traces: Trace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "horizontal",
      connection_name: connection.name,
      route: [
        {
          route_type: "via",
          x: -1,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          layers: ["top", "inner1"],
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: -1, y: 0, layer: "inner1", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "inner1", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "vertical",
      connection_name: connection.name,
      route: [
        { route_type: "wire", x: 1, y: -1, layer: "inner1", width: 0.1 },
        { route_type: "wire", x: 1, y: 1, layer: "inner1", width: 0.1 },
        {
          route_type: "via",
          x: 1,
          y: 1,
          from_layer: "top",
          to_layer: "inner1",
          layers: ["top", "inner1"],
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
      ],
    },
  ]
  return {
    connection,
    input: {
      layerCount: 4,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [connection],
      obstacles: [],
      traces,
      allowedLayers: ["top"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      minViaPadDiameter: 8,
      minViaHoleDiameter: 0.2,
      allowBlindAndBuriedVias: false,
    },
    wall: {
      type: "pcb_trace",
      pcb_trace_id: "foreign_top_wall",
      connection_name: "OTHER",
      route: [
        { route_type: "wire", x: 0, y: -2.95, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 2.95, layer: "top", width: 0.1 },
      ],
    },
  }
}

test("existing peer conductivity includes off-carrier wire contacts at segment interiors", () => {
  const { input, connection, wall } = fixture()
  const original = structuredClone(input)
  const access = new PendingPeerAccess(input, connection)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [...input.traces!, wall],
      }),
    ),
  ).toBe(false)
  expect(input).toEqual(original)
})

test("cached fixed components revalidate actual conductor extent, ownership and layers", () => {
  const { input, connection, wall } = fixture()
  const access = new PendingPeerAccess(input, connection)
  const retained = { ...input, traces: [...input.traces!, wall] }
  expect(finish(access.getUncertifiedConnections(retained))).toBe(false)
  const variants = [
    (traces: Trace[]) =>
      traces.filter((trace) => trace.pcb_trace_id !== "vertical"),
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "vertical"
          ? { ...trace, connection_name: "OTHER" }
          : trace,
      ),
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "vertical"
          ? {
              ...trace,
              route: trace.route.map((point) => ({
                ...point,
                x: point.x + 1.5,
              })),
            }
          : trace,
      ),
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "vertical"
          ? {
              ...trace,
              route: trace.route.map((point) =>
                point.route_type === "wire"
                  ? { ...point, layer: "inner2" }
                  : {
                      ...point,
                      to_layer: "inner2",
                      layers: ["top", "inner1", "inner2"],
                    },
              ),
            }
          : trace,
      ),
    (traces: Trace[]) =>
      traces.map((trace) =>
        trace.pcb_trace_id === "horizontal"
          ? {
              ...trace,
              route: trace.route.map((point) =>
                point.route_type === "via"
                  ? {
                      ...point,
                      from_layer: "inner1",
                      to_layer: "inner2",
                      layers: ["inner1", "inner2"],
                    }
                  : point,
              ),
            }
          : trace,
      ),
  ]
  for (const mutate of variants) {
    const traces = mutate(structuredClone(input.traces!))
    expect(
      finish(
        access.getUncertifiedConnections({
          ...input,
          traces: [...traces, wall],
        }),
      ),
    ).toBe(true)
    expect(finish(access.getUncertifiedConnections(retained))).toBe(false)
  }
})

test("an already manufactured fixed connection keeps its physical widths under a wider future rule", () => {
  const { input, connection, wall } = fixture()
  connection.width = 0.8
  const access = new PendingPeerAccess(input, connection)
  expect(
    finish(
      access.getUncertifiedConnections({
        ...input,
        traces: [...input.traces!, wall],
      }),
    ),
  ).toBe(false)
})
