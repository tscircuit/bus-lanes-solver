import { expect, test } from "bun:test"
import {
  routeSurfaceBridge,
  surfaceBridgeGridStep,
  type SurfaceBridgeRoute,
} from "../lib/route-surface-bridge"
import { RoutingMemoryBudgetExceeded } from "../lib/routing-memory-budget"
import type { Connection, SimpleRouteJson } from "../lib/types"

function bridgeInput(): { input: SimpleRouteJson; connection: Connection } {
  const connection: Connection = {
    name: "DATA",
    width: 0.1,
    pointsToConnect: [
      { x: -0.5, y: 0, layer: "top" },
      { x: 0.5, y: 0, layer: "top" },
    ],
  }
  const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  return {
    connection,
    input: {
      layerCount: 2,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      bounds,
      connections: [connection],
      obstacles: [],
      traces: [],
      pendingRoutingAccess: [
        {
          minTraceWidth: 0.1,
          bounds,
          connections: [
            {
              name: "FUTURE",
              pointsToConnect: [
                { x: 0, y: 0.6, layer: "top", pcb_port_id: "future_a" },
                { x: 0.2, y: 0.6, layer: "top", pcb_port_id: "future_b" },
              ],
            },
          ],
        },
      ],
    },
  }
}

function drain<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

test("the real bridge propagates accounted terminal-storage exhaustion without accepting output", () => {
  const { input, connection } = bridgeInput()
  const gridStep = 0.05
  const maxGridCells = 1_000_000
  const maxVias = 2
  const rangeX = input.bounds.maxX - input.bounds.minX
  const rangeY = input.bounds.maxY - input.bounds.minY
  const step = surfaceBridgeGridStep(rangeX, rangeY, gridStep, maxGridCells)
  const cells =
    (Math.floor(rangeX / step) + 1) * (Math.floor(rangeY / step) + 1)
  // With no expansion allowance, the bridge budget contains only its former
  // physical cost slots. Each declared terminal needs 192 accounted bytes;
  // exceed that storage before the interner copies or allocates its vectors.
  const oldCostBytes = cells * maxVias * 2 * Float64Array.BYTES_PER_ELEMENT
  const terminalCount = Math.floor(oldCostBytes / 192) + 1
  input.pendingRoutingAccess![0].connections[0].pointsToConnect = Array.from(
    { length: terminalCount },
    (_, index) => ({
      x: 0,
      y: 0.6,
      layer: "top",
      pcb_port_id: `future_port_${index}`,
      pointId: `future_point_${index}`,
    }),
  )
  const original = structuredClone(input)
  let acceptedCalls = 0
  let output: SurfaceBridgeRoute | null | undefined
  let failure: unknown
  try {
    output = drain(
      routeSurfaceBridge(input, connection, {
        gridStep,
        maxGridCells,
        maxVias,
        maxExpansions: 0,
        acceptRoute: function* () {
          acceptedCalls++
          return true
        },
      }),
    )
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(RoutingMemoryBudgetExceeded)
  expect((failure as RoutingMemoryBudgetExceeded).code).toBe(
    "search_memory_budget_exhausted",
  )
  expect(output).toBeUndefined()
  expect(acceptedCalls).toBe(0)
  expect(input).toEqual(original)
})

test("an ordinary pending intent with zero expansions returns no solved route", () => {
  const { input, connection } = bridgeInput()
  const original = structuredClone(input)
  let acceptedCalls = 0
  const result = drain(
    routeSurfaceBridge(input, connection, {
      gridStep: 0.05,
      maxVias: 2,
      maxExpansions: 0,
      acceptRoute: function* () {
        acceptedCalls++
        return true
      },
    }),
  )

  expect(result).toBeNull()
  expect(acceptedCalls).toBe(0)
  expect(input).toEqual(original)
})
