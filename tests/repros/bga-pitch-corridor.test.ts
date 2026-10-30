import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import { bgaPitchCorridor } from "../fixtures/bga-pitch-corridor"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("pitch subdivisions reach the next legal BGA via pocket", async () => {
  const { input, options } = bgaPitchCorridor()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expectCompletedRouting(solver, before)
  const signal = solver.traces.find((trace) => trace.connection_name === "DQ")!
  expect(
    signal.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1100,
      height: 1200,
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

test("pitch subdivisions do not bypass copper on an unused physical plane", () => {
  const { input, options } = bgaPitchCorridor()
  input.obstacles.push({
    type: "rect",
    center: { x: 0.75, y: 9.75 },
    width: 0.47,
    height: 0.47,
    layers: ["inner4"],
    connectedTo: ["immutable_plane"],
  })
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.traces).toEqual([])
  expect(input).toEqual(before)
}, 30000)
