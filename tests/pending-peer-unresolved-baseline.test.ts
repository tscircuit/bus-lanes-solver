import { expect, test } from "bun:test"
import { PendingAccessSearchUnknownError } from "../lib/pending-access-search-unknown"
import {
  PendingPeerAccess,
  PendingPeerAccessUnknownError,
} from "../lib/pending-peer-access"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "../lib/types"

function finish<T>(search: Generator<void, T>): T {
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value
}

/** A physically clear 0.1002 mm channel whose legal centerline is between
 * the existing 0.1 mm raster rows. This fixture deliberately does not request
 * another raster: an original finite miss must remain unresolved. */
function narrowChannel() {
  const connection: Connection = {
    name: "FUTURE_CHANNEL",
    width: 0.1,
    pointsToConnect: [
      { x: -1, y: 0.05, layer: "top" },
      { x: 1, y: 0.05, layer: "top" },
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    allowedLayers: ["top"],
    connections: [connection],
    traces: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.50005 },
        width: 4,
        height: 0.9999,
        layers: ["top"],
        connectedTo: ["GND"],
      },
      {
        type: "rect",
        center: { x: 0, y: 0.55005 },
        width: 4,
        height: 0.8999,
        layers: ["top"],
        connectedTo: ["GND"],
      },
    ],
  }
  const owned: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "manufactured_channel",
    connection_name: connection.name,
    route: connection.pointsToConnect.map((point) => ({
      ...point,
      route_type: "wire",
      width: 0.05,
    })),
  }
  const wall: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "new_foreign_crossing",
    connection_name: "GND",
    route: [-0.4, 0.4].map((y) => ({
      route_type: "wire",
      x: 0,
      y,
      layer: "top",
      width: 0.05,
    })),
  }
  return { input, connection, owned, wall }
}

test("a clear physical path missed by the original raster retains a required unresolved relation", () => {
  const { input, connection, wall } = narrowChannel(),
    original = structuredClone(input)
  const continuous = new VectorScene(
    input,
    connection,
    connection.width!,
    fixedCopper(input),
  )
  expect(continuous.pathVisible(connection.pointsToConnect)).toBe(true)
  const access = new PendingPeerAccess(input, connection)
  const positive = finish(access.getBaselineLinks())
  expect(positive).toEqual([])
  const required = finish(access.getRequiredLinks())
  expect(required).toEqual([{ sourceTerminalIndex: 0, targetTerminalIndex: 1 }])
  expect(Object.isFrozen(required)).toBe(true)
  expect(Object.isFrozen(required[0])).toBe(true)
  expect(access.isBaselineUnresolved(required[0])).toBe(true)
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(
    finish(access.getBlockedLinks(input, { requireCertificates: true })),
  ).toEqual([...required])
  const blocked = { ...input, traces: [wall] }
  expect(
    new VectorScene(
      blocked,
      connection,
      connection.width!,
      fixedCopper(blocked),
    ).pathVisible(connection.pointsToConnect),
  ).toBe(false)
  expect(finish(access.getBlockedLinks(blocked))).toEqual([...required])
  expect(() => finish(access.getBlockedConnections(blocked))).toThrow(
    PendingAccessSearchUnknownError,
  )
  expect(finish(access.getBaselineLinks())).toBe(positive)
  expect(finish(access.getRequiredLinks())).toBe(required)
  expect(input).toEqual(original)
})

test("a candidate positive witness never reclassifies an unresolved original relation", () => {
  const { input, connection, owned, wall } = narrowChannel()
  const access = new PendingPeerAccess(input, connection),
    required = finish(access.getRequiredLinks())
  const connected = { ...input, traces: [owned] }
  expect(
    finish(access.getBlockedLinks(connected, { requireCertificates: true })),
  ).toEqual([])
  expect(access.isBaselineUnresolved(required[0])).toBe(true)
  expect(finish(access.getBaselineLinks())).toEqual([])
  expect(finish(access.getRequiredLinks())).toBe(required)
  // Returning to the original scene must revalidate the cached manufactured
  // component; the previous candidate cannot retroactively certify baseline.
  expect(
    finish(access.getBlockedLinks(input, { requireCertificates: true })),
  ).toEqual([...required])
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(
    finish(
      access.getBlockedLinks(
        { ...input, traces: [wall] },
        { links: new Set(required) },
      ),
    ),
  ).toEqual([...required])
  expect(
    finish(access.getBlockedLinks(connected, { requireCertificates: true })),
  ).toEqual([])
  expect(() =>
    access.isBaselineUnresolved(structuredClone(required[0])),
  ).toThrow("original baseline link")
  expect(() =>
    finish(
      access.getBlockedLinks(connected, {
        links: new Set([structuredClone(required[0])]),
      }),
    ),
  ).toThrow("original baseline link")
})

test("required joins connect all positive original components with stable exact identities", () => {
  const { input, connection, owned } = narrowChannel()
  connection.pointsToConnect.splice(1, 0, { x: -0.5, y: 0.05, layer: "top" })
  owned.route[1].x = -0.5
  input.traces = [owned]
  const access = new PendingPeerAccess(input, connection),
    positive = finish(access.getBaselineLinks())
  expect(positive).toEqual([{ sourceTerminalIndex: 0, targetTerminalIndex: 1 }])
  const required = finish(access.getRequiredLinks())
  expect(required).toHaveLength(2)
  expect(required[0]).toBe(positive[0])
  expect(access.isBaselineUnresolved(required[0])).toBe(false)
  expect(access.isBaselineUnresolved(required[1])).toBe(true)
  expect(required[1]).toEqual({
    sourceTerminalIndex: 0,
    targetTerminalIndex: 2,
  })
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(
    finish(access.getBlockedLinks(input, { requireCertificates: true })),
  ).toEqual([required[1]])
  const completion: Trace = {
    ...owned,
    pcb_trace_id: "manufactured_completion",
    route: [
      { route_type: "wire", x: -0.5, y: 0.05, layer: "top", width: 0.05 },
      { route_type: "wire", x: 1, y: 0.05, layer: "top", width: 0.05 },
    ],
  }
  expect(
    finish(
      access.getBlockedLinks(
        { ...input, traces: [completion, owned] },
        { requireCertificates: true },
      ),
    ),
  ).toEqual([])
  expect(access.isBaselineUnresolved(required[1])).toBe(true)
  // Exact copper order does not change relational no-new-loss; a policy change
  // is still a new query requiring a physical certificate.
  expect(
    finish(
      access.getBlockedLinks({
        ...input,
        traces: structuredClone(input.traces),
      }),
    ),
  ).toEqual([])
  expect(
    finish(access.getBlockedLinks({ ...input, minViaHoleDiameter: 0.2 })),
  ).toEqual([required[1]])
  const explicitUndefined = { ...input, differentialPairs: undefined }
  const exactKeys = new PendingPeerAccess(explicitUndefined, connection)
  const exactRequired = finish(exactKeys.getRequiredLinks())
  const swapped = { ...explicitUndefined, minViaHoleDiameter: 0.2 }
  delete swapped.differentialPairs
  expect(Object.keys(swapped)).toHaveLength(
    Object.keys(explicitUndefined).length,
  )
  expect(finish(exactKeys.getBlockedLinks(swapped))).toEqual([exactRequired[1]])
})

test("interleaved, scoped and cancelled unresolved queries retain atomic required identities", () => {
  const { input, connection, owned, wall } = narrowChannel()
  const access = new PendingPeerAccess(input, connection)
  const first = access.getRequiredLinks(),
    second = access.getRequiredLinks()
  expect(first.next().done).toBe(false)
  expect(second.next().done).toBe(false)
  const required = finish(second)
  expect(finish(first)).toBe(required)
  const selected = new Set(required)
  const blockedSearch = access.getBlockedLinks(
    { ...input, traces: [wall] },
    { links: selected, requireCertificates: true },
  )
  expect(blockedSearch.next().done).toBe(false)
  selected.clear()
  expect(
    finish(
      access.getBlockedLinks(
        { ...input, traces: [owned] },
        { requireCertificates: true },
      ),
    ),
  ).toEqual([])
  expect(finish(blockedSearch)).toEqual([...required])
  expect(finish(access.getRequiredLinks())).toBe(required)
  const cancelledAccess = new PendingPeerAccess(input, connection),
    cancelled = cancelledAccess.getRequiredLinks()
  expect(cancelled.next().done).toBe(false)
  expect(cancelled.return([]).done).toBe(true)
  const afterCancel = finish(cancelledAccess.getRequiredLinks())
  expect(afterCancel).toHaveLength(1)
  expect(finish(cancelledAccess.getRequiredLinks())).toBe(afterCancel)
  expect(cancelledAccess.isBaselineUnresolved(afterCancel[0])).toBe(true)
})

test("resource exhaustion cannot publish an unresolved or empty successful original forest", () => {
  const { input, connection } = narrowChannel()
  input.bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  input.minTraceWidth = 0.01
  const access = new PendingPeerAccess(input, connection)
  expect(() => finish(access.getRequiredLinks())).toThrow(
    PendingPeerAccessUnknownError,
  )
  expect(() => finish(access.getBaselineLinks())).toThrow(
    PendingPeerAccessUnknownError,
  )
})
