import "../fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../../lib"
import type { Connection, Trace } from "../../lib/types"
import { NativeCarrierRouter } from "../../lib/native-carrier-router"
import { toNativeValidationSrj } from "../../lib/native-validation-input"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { denseBgaViaGrid } from "../fixtures/dense-bga-via-grid"
import { nativeCarrierAlternatives } from "../fixtures/native-carrier-alternatives"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("ordinary signals match on a permitted alternative while the pair keeps its carrier", async () => {
  const { input, options } = nativeCarrierAlternatives()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, options)
  solver.solve()
  expectCompletedRouting(solver, before)
  const signal = solver.traces.find((trace) => trace.connection_name === "DQ")!
  expect(
    signal.route.some(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    ),
  ).toBe(true)
  for (const trace of solver.traces.filter((trace) => trace !== signal))
    expect(
      trace.route.some(
        (point) => point.route_type === "wire" && point.layer === "inner1",
      ),
    ).toBe(true)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 1100,
      height: 750,
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
}, 20000)

for (const restriction of ["caller", "bus"] as const)
  test(`ordinary carrier selection honors the ${restriction} restriction`, () => {
    const { input, options } = nativeCarrierAlternatives()
    if (restriction === "caller")
      options.singleCarrier.ordinaryCarrierLayers = ["inner1"]
    else input.buses![0].allowedLayers = ["top", "inner1"]
    const before = structuredClone(input)
    const solver = new BusLanesPipelineSolver(input, options)
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.traces).toEqual([])
    expect(input).toEqual(before)
  }, 20000)

test("carrier options cannot enlarge the original permitted layer set", () => {
  const { input, options } = nativeCarrierAlternatives()
  input.allowedLayers = ["top", "inner1"]
  const before = structuredClone(input)
  expect(() => new BusLanesPipelineSolver(input, options)).toThrow(
    "permitted by the input",
  )
  expect(input).toEqual(before)
})

test("strict plated vias also avoid movable wires on another carrier", () => {
  const { input, options } = denseBgaViaGrid()
  const before = structuredClone(input)
  const connection: Connection = {
    name: "P_0",
    source_trace_id: "P",
    pointsToConnect: [
      input.connections[0].pointsToConnect[0],
      { x: 0.835, y: 0, layer: "inner2" },
    ],
  }
  const crossing: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "crossing",
    connection_name: "crossing",
    route: [
      { route_type: "wire", x: -1, y: -0.25, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1, y: -0.25, width: 0.1, layer: "bottom" },
    ],
  }
  const step = input.minTraceWidth
  const cells =
    (Math.ceil((input.bounds.maxX - input.bounds.minX) / step) + 1) *
    (Math.ceil((input.bounds.maxY - input.bounds.minY) / step) + 1)
  for (const strict of [false, true]) {
    const router = new NativeCarrierRouter({
      input,
      step,
      history: [new Float32Array(cells), new Float32Array(cells)],
    })
    const work = router.route(connection, {
      strict,
      softTraces: [crossing],
      forcedVia: { x: 0.25, y: -0.25 },
      carrierRegion: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    })
    let result = work.next()
    while (!result.done) result = work.next()
    if (strict) expect(result.value).toBeNull()
    else {
      expect(result.value).not.toBeNull()
      const native = toNativeValidationSrj({
        ...input,
        differentialPairs: [],
        buses: [],
        connections: [
          connection,
          ...options.singleCarrier!.fixedConnections!,
          {
            name: "crossing",
            pointsToConnect: [
              { x: -1, y: -0.25, layer: "bottom" },
              { x: 1, y: -0.25, layer: "bottom" },
            ],
          },
        ],
      })
      const report = validateRoutedCopperDrc({
        inputSrj: native,
        routedSrj: toNativeValidationSrj({
          ...input,
          connections: native.connections,
          traces: [...input.traces!, result.value!.trace, crossing],
        }),
        clearance: input.minTraceToPadEdgeClearance!,
        allowBlindAndBuriedVias: false,
      })
      expect(
        report.issues.some(
          (issue) => issue.code === "different-net-trace-via-clearance",
        ),
      ).toBe(true)
    }
  }
  expect(input).toEqual(before)
})
