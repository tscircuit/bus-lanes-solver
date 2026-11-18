import { expect, test } from "bun:test"
import { applyToPoint, rotateDEG } from "transformation-matrix"
import { PendingPadScene } from "../lib/pending-pad-escape"
import {
  pendingPadAccessFixture,
  rotatePendingPadAccessFixture,
} from "./fixtures/pending-pad-access"

function fixture(angle: number, crossing: boolean) {
  const source = pendingPadAccessFixture()
  source.pendingConnection.pointsToConnect[0].x = 2
  source.input.obstacles.find(
    (pad) =>
      pad.componentId === "CPU" && pad.center.x === 2 && pad.center.y === 0,
  )!.connectedTo = [source.pendingConnection.name, "cpu_strobe"]
  source.input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "supplied_boundary_conductor",
      connection_name: source.pendingConnection.name,
      route: [
        {
          route_type: "wire",
          x: 2,
          y: 0,
          layer: "top",
          width: crossing ? 0.02 : 0.01,
        },
        {
          route_type: "wire",
          x: crossing ? 2.145 : 1.99,
          y: 0,
          layer: "top",
          width: crossing ? 0.02 : 0.01,
        },
      ],
    },
  ]
  const result = rotatePendingPadAccessFixture(source, angle)
  const rotation = rotateDEG(angle)
  result.input.traces = source.input.traces.map((trace) => ({
    ...trace,
    route: trace.route.map((point) => ({
      ...point,
      ...applyToPoint(rotation, point),
    })),
  }))
  return result
}

test("old copper touching a rotated field boundary cannot masquerade as physical egress", () => {
  for (const angle of [0, 1, 5, 17, 30, 45, 60, 73, 89, 90, 135]) {
    const touching = fixture(angle, false)
    const original = structuredClone(touching.input)
    const touchingScene = new PendingPadScene({
      input: touching.input,
      connection: touching.pendingConnection,
      terminalIndex: 0,
    })
    expect(touchingScene.existingEgress()).toBeUndefined()
    // Transforming an exact boundary corner through two physical frames may
    // add one floating-point ulp; cached witnesses need the same separation
    // test as new support-point witnesses.
    const boundary = applyToPoint(rotateDEG(angle), { x: 2.15, y: 0.15 })
    expect(
      touchingScene.existingEgressIsClear({ point: boundary, layer: "top" }),
    ).toBe(false)

    const crossing = fixture(angle, true)
    const crossingScene = new PendingPadScene({
      input: crossing.input,
      connection: crossing.pendingConnection,
      terminalIndex: 0,
    })
    const contact = crossingScene.existingEgress()
    expect(contact).toBeDefined()
    if (!contact) continue
    // Its centerline stays inside. The actual 0.02 mm body extends 0.005 mm
    // beyond the pad field, although a new 0.1 mm wire center would not exit.
    for (const point of crossing.input.traces![0].route) {
      const local = applyToPoint(crossingScene.frame!.boardToPackage, point)
      expect(local.x).toBeLessThanOrEqual(
        crossingScene.frame!.field.maxX + 1e-8,
      )
      expect(local.y).toBeLessThanOrEqual(
        crossingScene.frame!.field.maxY + 1e-8,
      )
    }
    expect(crossingScene.surfaceExit(contact.point)).toBe(false)
    expect(crossingScene.existingEgressIsClear(contact)).toBe(true)
    expect(touchingScene.existingEgressIsClear(contact)).toBe(false)
    expect(touching.input).toEqual(original)
  }
})
