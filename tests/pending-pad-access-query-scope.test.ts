import { expect, test } from "bun:test"
import { applyToPoint, rotateDEG } from "transformation-matrix"
import { PendingPadAccess } from "../lib/pending-pad-access"
import { PendingPeerAccessUnknownError } from "../lib/pending-peer-access"
import type { Connection, Trace } from "../lib/types"
import {
  addUnrelatedFutureConnection,
  pendingPadAccessFixture,
  rotatePendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

type Search = Generator<void, Connection[]>

function finish(search: Search): Connection[] {
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value
}

function fixture(angle = 0) {
  const value = rotatePendingPadAccessFixture(pendingPadAccessFixture(), angle)
  const { input, pendingConnection } = value
  const group = input.pendingRoutingAccess![0]
  group.allowedLayers = ["top"]
  const other = addUnrelatedFutureConnection(input)
  const rotation = rotateDEG(angle)
  const peer: Connection = {
    name: "UNFRAMED_PEER",
    width: 0.1,
    pointsToConnect: [-4, 4].map((x) => ({
      ...applyToPoint(rotation, { x, y: 0 }),
      layer: "top",
    })),
  }
  group.connections.push(peer)
  // The same exact connection appears in two future phases with independent
  // rules. A scope must keep both obligations, including the wider bus.
  input.pendingRoutingAccess!.push({
    ...group,
    connections: [pendingConnection],
    buses: [
      {
        busId: "wider_future",
        connectionNames: [pendingConnection.name],
        traceWidth: 0.3,
      },
    ],
  })
  // Equal names in different phases do not make distinct connection objects
  // interchangeable. This one uses the unrelated pads through their aliases.
  const sameName = { ...other, name: pendingConnection.name }
  input.pendingRoutingAccess!.push({ ...group, connections: [sameName] })
  return { ...value, targets: [pendingConnection, other, peer, sameName] }
}

for (const angle of [0, 37, 90]) {
  test(`scoped deletion questions equal the global membership result across phases and rules at ${angle} degrees`, () => {
    const { input, targets, upperLeft, lowerRight, leftWall } = fixture(angle)
    const original = structuredClone(input)
    const candidates = [
      [],
      [upperLeft],
      [upperLeft, lowerRight],
      [leftWall],
      [upperLeft, lowerRight, leftWall],
    ]
    const reference = new PendingPadAccess(input)
    const partialFirst = new PendingPadAccess(input)
    const subsets = [
      new Set(targets.slice(0, 2)),
      new Set(targets.slice(2)),
      new Set<Connection>(),
    ].map((subset) => ({ subset, access: new PendingPadAccess(input) }))
    let foundBlocked = false
    for (const candidate of candidates) {
      const global = finish(reference.getUncertifiedConnections(candidate))
      foundBlocked ||= global.length > 0
      const existential = finish(
        partialFirst.getUncertifiedConnections(candidate, {
          stopAfterFirst: true,
        }),
      )
      expect(existential.length > 0).toBe(global.length > 0)
      expect(existential.length).toBeLessThanOrEqual(1)
      expect(
        existential.every((connection) => global.includes(connection)),
      ).toBe(true)
      for (const target of targets)
        expect(
          finish(
            partialFirst.getUncertifiedConnections(candidate, {
              connection: target,
            }),
          ),
        ).toEqual(global.includes(target) ? [target] : [])
      // A partial result must never be cached as complete scene evidence.
      expect(finish(partialFirst.getUncertifiedConnections(candidate))).toEqual(
        global,
      )
      // A complete cached result must still be filtered by exact identity.
      for (const target of targets)
        expect(
          finish(
            partialFirst.getUncertifiedConnections(candidate, {
              connection: target,
            }),
          ),
        ).toEqual(global.includes(target) ? [target] : [])
      for (const { subset, access } of subsets) {
        const first = finish(
          access.getUncertifiedConnections(candidate, {
            connections: subset,
            stopAfterFirst: true,
          }),
        )
        expect(first.length > 0).toBe(
          global.some((connection) => subset.has(connection)),
        )
        expect(
          first.every(
            (connection) =>
              subset.has(connection) && global.includes(connection),
          ),
        ).toBe(true)
        expect(finish(access.getUncertifiedConnections(candidate))).toEqual(
          global,
        )
      }
    }
    expect(foundBlocked).toBe(true)
    expect(input).toEqual(original)
  }, 15_000)
}

test("scoped and global checks remain independent while their union leases are interleaved", () => {
  const { input, targets, upperLeft, lowerRight, leftWall } = fixture()
  const requests: Array<{
    traces: Trace[]
    connection?: Connection
    connections?: ReadonlySet<Connection>
    stopAfterFirst?: boolean
  }> = [
    { traces: [upperLeft, lowerRight], connection: targets[0] },
    { traces: [leftWall], connection: targets[2] },
    { traces: [upperLeft, lowerRight] },
    { traces: [lowerRight], connection: targets[3] },
    { traces: [upperLeft, lowerRight, leftWall], stopAfterFirst: true },
    {
      traces: [upperLeft, lowerRight, leftWall],
      connections: new Set([targets[2]]),
      stopAfterFirst: true,
    },
  ]
  const original = structuredClone({ input, requests })
  const expected = requests.map(({ traces, ...scope }) =>
    finish(
      new PendingPadAccess(input).getUncertifiedConnections(traces, scope),
    ),
  )
  const access = new PendingPadAccess(input)
  finish(access.getUncertifiedConnections([]))
  const searches = requests.map(({ traces, ...scope }) =>
    access.getUncertifiedConnections(traces, scope),
  )
  const answers: Array<Connection[] | undefined> = searches.map(() => undefined)
  while (answers.some((answer) => answer === undefined))
    for (const [index, search] of searches.entries()) {
      if (answers[index] !== undefined) continue
      const result = search.next()
      if (result.done) answers[index] = result.value
    }
  expect(answers).toEqual(expected)
  expect(
    finish(access.getUncertifiedConnections([upperLeft, lowerRight])),
  ).toEqual(
    finish(
      new PendingPadAccess(input).getUncertifiedConnections([
        upperLeft,
        lowerRight,
      ]),
    ),
  )
  expect({ input, requests }).toEqual(original)
}, 15_000)

test("a query scope must reference an exact connection owned by the access request", () => {
  const { input, targets } = fixture()
  const access = new PendingPadAccess(input)
  expect(() =>
    finish(
      access.getUncertifiedConnections([], {
        connection: structuredClone(targets[0]),
      }),
    ),
  ).toThrow("declared connection")
  expect(() =>
    finish(
      access.getUncertifiedConnections([], {
        connections: new Set([structuredClone(targets[0])]),
        stopAfterFirst: true,
      }),
    ),
  ).toThrow("declared connections")
})

test("an unfinished requested obligation propagates from an existential query", () => {
  const { input, targets, upperLeft } = fixture()
  const bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  input.bounds = bounds
  input.outline = undefined
  for (const group of input.pendingRoutingAccess!) {
    group.bounds = bounds
    group.outline = undefined
    group.minTraceWidth = 0.01
  }
  const access = new PendingPadAccess(input)
  expect(() =>
    finish(
      access.getUncertifiedConnections([upperLeft], {
        connections: new Set([targets[2]]),
        stopAfterFirst: true,
      }),
    ),
  ).toThrow(PendingPeerAccessUnknownError)
})

test("a suspended scoped query retains its requested connection set", () => {
  const { input, targets, upperLeft, lowerRight } = fixture()
  const candidate = [upperLeft, lowerRight]
  const expected = finish(
    new PendingPadAccess(input).getUncertifiedConnections(candidate, {
      connections: new Set([targets[1]]),
      stopAfterFirst: true,
    }),
  )
  expect(expected).toEqual([])
  const scope = { connections: new Set([targets[1]]), stopAfterFirst: true }
  const search = new PendingPadAccess(input).getUncertifiedConnections(
    candidate,
    scope,
  )
  expect(search.next().done).toBe(false)
  scope.connections.clear()
  scope.connections.add(targets[0])
  scope.stopAfterFirst = false
  expect(finish(search)).toEqual(expected)
})
