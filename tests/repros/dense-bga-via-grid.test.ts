import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { nativeViaGridBounds } from "../../lib/native-via-grid-bounds"
import { denseBgaViaGrid } from "../fixtures/dense-bga-via-grid"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("native grid alternatives complete a dense BGA pair without moving fixed copper", async () => {
  const { input, options } = denseBgaViaGrid()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  expect(
    circuit.filter((element) => element.type === "pcb_smtpad"),
  ).toHaveLength(11)
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1200,
      height: 550,
      showSolderMask: false,
      hiddenLayerOpacity: 1,
      xRayElementIds: circuit.flatMap((element) =>
        element.type === "pcb_trace"
          ? [element.pcb_trace_id]
          : element.type === "pcb_smtpad"
            ? [element.pcb_smtpad_id]
            : [],
      ),
    },
  })
}, 30000)

test("aligned grid alternatives retain plated-via checks on every physical plane", () => {
  const { input, options } = denseBgaViaGrid()
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layers: ["inner4"],
    connectedTo: ["fixed_barrier"],
  })
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 30000)

test("BGA grid alternatives preserve board coordinates and explicit via constraints", () => {
  const { input } = denseBgaViaGrid()
  const before = structuredClone(input)
  const forcedVia = { x: 0.25, y: -0.25 }
  const stepMm = input.minTraceWidth
  const bounds = [
    ...nativeViaGridBounds({
      input,
      connection: input.connections[0],
      stepMm,
      forcedVia,
    }),
  ]
  expect(bounds).toHaveLength(1)
  for (const axis of ["x", "y"] as const) {
    const start = axis === "x" ? bounds[0].minX : bounds[0].minY
    const cell = (forcedVia[axis] - start) / stepMm
    expect(Math.abs(cell - Math.round(cell))).toBeLessThan(1e-9)
  }
  expect(bounds[0].minX).toBeGreaterThanOrEqual(input.bounds.minX)
  expect(bounds[0].minY).toBeGreaterThanOrEqual(input.bounds.minY)
  expect(bounds[0].maxX).toBe(input.bounds.maxX)
  expect(bounds[0].maxY).toBe(input.bounds.maxY)
  expect(input).toEqual(before)
})
