import { expect, test } from "bun:test"
import {
  pendingPadEscapeIsClear,
  type PendingPadEscape,
} from "../lib/pending-pad-escape"
import type { Trace } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

function viaWireScene() {
  const { input, pendingConnection } = pendingPadAccessFixture()
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.layers.includes("bottom"),
  )
  const wire: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_bottom_wire",
    connection_name: "FOREIGN_BOTTOM_WIRE",
    route: [
      { route_type: "wire", x: -1, y: 0.45, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 2, y: 0.45, layer: "bottom", width: 0.1 },
    ],
  }
  input.traces = [wire]
  const escape: PendingPadEscape = {
    path: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ],
    layer: "top",
    via: { point: { x: 0.5, y: 0 }, layers: ["top", "bottom"] },
  }
  return { input, pendingConnection, escape }
}

test("via-to-pad rules do not impose a pad-only margin on an existing wire", () => {
  for (const rule of [
    "minViaEdgeToPadEdgeClearance",
    "minPadEdgeToPadEdgeClearance",
  ] as const) {
    const { input, pendingConnection, escape } = viaWireScene()
    input.pendingRoutingAccess![0][rule] = 0.4
    const future = { ...input, ...input.pendingRoutingAccess![0] }
    const request = {
      input: future,
      connection: pendingConnection,
      terminalIndex: 0,
    }

    // The annulus edge is 0.2 mm from wire copper, satisfying the ordinary
    // 0.1 mm trace-to-pad rule despite the larger pad-specific requirement.
    expect(pendingPadEscapeIsClear(request, escape)).toBe(true)

    const pad = {
      type: "rect",
      center: { x: 0.5, y: 0.45 },
      width: 3,
      height: 0.1,
      layers: ["bottom"],
      connectedTo: ["FOREIGN_PAD"],
    }
    expect(
      pendingPadEscapeIsClear(
        {
          ...request,
          input: {
            ...future,
            traces: [],
            obstacles: [...future.obstacles, pad],
          },
        },
        escape,
      ),
    ).toBe(false)

    const oldVia: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "foreign_via_pad",
      connection_name: "FOREIGN_VIA_PAD",
      route: [
        {
          route_type: "via",
          x: 0.5,
          y: 0.45,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.1,
          via_hole_diameter: 0.05,
        },
      ],
    }
    // An existing via annulus is a pad too. Its drill is sufficiently far
    // away, so this rejection specifically exercises the pad-edge rule.
    expect(
      pendingPadEscapeIsClear(
        {
          ...request,
          input: { ...future, traces: [oldVia], [rule]: 0.1 },
        },
        escape,
      ),
    ).toBe(true)
    expect(
      pendingPadEscapeIsClear(
        {
          ...request,
          input: { ...future, traces: [oldVia] },
        },
        escape,
      ),
    ).toBe(false)
  }
})

test("a non-plated-hole rule does not impose a plated-via drill to wire exclusion", () => {
  const { input, pendingConnection, escape } = viaWireScene()
  input.pendingRoutingAccess![0].minTraceToHoleEdgeClearance = 0.4
  const future = { ...input, ...input.pendingRoutingAccess![0] }
  const request = {
    input: future,
    connection: pendingConnection,
    terminalIndex: 0,
  }

  // Copper clears by 0.2 mm. Both objects are plated conductors, so changing
  // the separate NPTH-to-trace rule does not change this legal transition.
  expect(
    pendingPadEscapeIsClear(
      {
        ...request,
        input: { ...future, minTraceToHoleEdgeClearance: 0.2 },
      },
      escape,
    ),
  ).toBe(true)
  expect(pendingPadEscapeIsClear(request, escape)).toBe(true)
})
