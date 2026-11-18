import { expect, test } from "bun:test"
import {
  PendingPeerAccess,
  PendingPeerAccessUnknownError,
  type PendingPeerLink,
} from "../lib/pending-peer-access"
import type { SimpleRouteJson, Trace } from "../lib/types"

function finish<T>(search: Generator<void, T>): T {
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value
}

function fixture() {
  const input: SimpleRouteJson = {
    layerCount: 1,
    bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    allowedLayers: ["top"],
    obstacles: [],
    traces: [],
    connections: [
      {
        name: "FUTURE_BRANCHES",
        width: 0.1,
        pointsToConnect: [-3, -1, 1].map((x) => ({ x, y: 0, layer: "top" })),
      },
    ],
  }
  const enclosures: Trace[] = [-1, 1].map((x, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `independent_enclosure_${index}`,
    connection_name: `FOREIGN_${index}`,
    route: [
      { route_type: "wire", x: x - 0.5, y: -0.35, layer: "top", width: 0.1 },
      { route_type: "wire", x: x - 0.5, y: 0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: x + 0.5, y: 0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: x + 0.5, y: -0.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: x - 0.5, y: -0.5, layer: "top", width: 0.1 },
    ],
  }))
  return { input, connection: input.connections[0], enclosures }
}

test("independently blocked links of one future connection keep distinct stable obligations", () => {
  const { input, connection, enclosures } = fixture()
  const original = structuredClone(input)
  const access = new PendingPeerAccess(input, connection)
  const links = finish(access.getBaselineLinks())
  expect(links).toEqual([
    { sourceTerminalIndex: 0, targetTerminalIndex: 1 },
    { sourceTerminalIndex: 0, targetTerminalIndex: 2 },
  ])
  expect(Object.isFrozen(links)).toBe(true)
  for (const link of links) expect(Object.isFrozen(link)).toBe(true)
  expect(
    finish(access.getBlockedLinks({ ...input, traces: enclosures })),
  ).toEqual([...links])
  for (const [index, enclosure] of enclosures.entries()) {
    const blocked = finish(
      access.getBlockedLinks({ ...input, traces: [enclosure] }),
    )
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toBe(links[index])
  }
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(finish(access.getBaselineLinks())).toBe(links)
  expect(
    finish(access.getUncertifiedConnections({ ...input, traces: enclosures })),
  ).toBe(true)
  expect(finish(access.getUncertifiedConnections(input))).toBe(false)
  expect(input).toEqual(original)
})

test("link scopes use exact original identities and existential answers do not erase other links", () => {
  const { input, connection, enclosures } = fixture()
  const access = new PendingPeerAccess(input, connection)
  const links = finish(access.getBaselineLinks())
  const candidate = { ...input, traces: enclosures }
  for (const link of links) {
    const blocked = finish(
      access.getBlockedLinks(candidate, { links: new Set([link]) }),
    )
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toBe(link)
  }
  const first = finish(
    access.getBlockedLinks(candidate, { stopAfterFirst: true }),
  )
  expect(first).toHaveLength(1)
  expect(links.includes(first[0])).toBe(true)
  expect(finish(access.getBlockedLinks(candidate))).toEqual([...links])
  expect(
    finish(access.getBlockedLinks(candidate, { links: new Set() })),
  ).toEqual([])
  expect(() =>
    finish(
      access.getBlockedLinks(candidate, {
        links: new Set([structuredClone(links[0])]),
      }),
    ),
  ).toThrow("original baseline link")
  const other = new PendingPeerAccess(input, connection)
  const otherLinks = finish(other.getBaselineLinks())
  expect(() =>
    finish(
      access.getBlockedLinks(candidate, {
        links: new Set([otherLinks[0]]),
      }),
    ),
  ).toThrow("original baseline link")
})

test("unresolved original peers retain required joins without manufacturing positive baseline links", () => {
  const { input, connection, enclosures } = fixture()
  input.traces = [enclosures[1]]
  const access = new PendingPeerAccess(input, connection)
  const links = finish(access.getBaselineLinks())
  expect(links).toEqual([{ sourceTerminalIndex: 0, targetTerminalIndex: 1 }])
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(
    finish(access.getBlockedLinks({ ...input, traces: enclosures })),
  ).toEqual([...finish(access.getRequiredLinks())])
  const isolated = new PendingPeerAccess(
    { ...input, traces: enclosures },
    connection,
  )
  expect(finish(isolated.getBaselineLinks())).toEqual([])
  expect(
    finish(isolated.getBlockedLinks({ ...input, traces: enclosures })),
  ).toEqual([])
  expect(
    finish(
      isolated.getUncertifiedConnections({ ...input, traces: enclosures }),
    ),
  ).toBe(false)
})

test("interleaved or cancelled initializers never replace published baseline link identities", () => {
  const { input, connection } = fixture()
  const access = new PendingPeerAccess(input, connection)
  const first = access.getBaselineLinks()
  const second = access.getBaselineLinks()
  expect(first.next().done).toBe(false)
  expect(second.next().done).toBe(false)
  const links = finish(second)
  expect(finish(first)).toBe(links)
  expect(finish(access.getBaselineLinks())).toBe(links)

  const cancelledAccess = new PendingPeerAccess(input, connection)
  const cancelled = cancelledAccess.getBaselineLinks()
  expect(cancelled.next().done).toBe(false)
  expect(cancelled.return([]).done).toBe(true)
  const afterCancel = finish(cancelledAccess.getBaselineLinks())
  expect(afterCancel).toHaveLength(2)
  expect(finish(cancelledAccess.getBaselineLinks())).toBe(afterCancel)
})

test("suspended link checks snapshot selection sets and keep concurrent witnesses private", () => {
  const { input, connection, enclosures } = fixture()
  const access = new PendingPeerAccess(input, connection)
  const links = finish(access.getBaselineLinks())
  const selected = new Set([links[0]])
  const scoped = access.getBlockedLinks(
    { ...input, traces: enclosures },
    { links: selected },
  )
  expect(scoped.next().done).toBe(false)
  selected.clear()
  selected.add(links[1])
  const other = access.getBlockedLinks({ ...input, traces: [enclosures[1]] })
  expect(other.next().done).toBe(false)
  const answers: Array<PendingPeerLink[] | undefined> = [undefined, undefined]
  const searches = [scoped, other]
  while (answers.some((answer) => answer === undefined))
    for (const [index, search] of searches.entries()) {
      if (answers[index] !== undefined) continue
      const result = search.next()
      if (result.done) answers[index] = result.value
    }
  expect(answers[0]).toHaveLength(1)
  expect(answers[0]![0]).toBe(links[0])
  expect(answers[1]).toHaveLength(1)
  expect(answers[1]![0]).toBe(links[1])
  expect(finish(access.getBlockedLinks(input))).toEqual([])
  expect(finish(access.getBaselineLinks())).toBe(links)
})

test("an unknown original baseline cannot publish a partial or empty successful link list", () => {
  const { input, connection } = fixture()
  input.bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  input.minTraceWidth = 0.01
  const access = new PendingPeerAccess(input, connection)
  for (let attempt = 0; attempt < 2; attempt++)
    expect(() => finish(access.getBaselineLinks())).toThrow(
      PendingPeerAccessUnknownError,
    )
  expect(() => finish(access.getBlockedLinks(input))).toThrow(
    PendingPeerAccessUnknownError,
  )
  expect(() => finish(access.getUncertifiedConnections(input))).toThrow(
    PendingPeerAccessUnknownError,
  )
})
