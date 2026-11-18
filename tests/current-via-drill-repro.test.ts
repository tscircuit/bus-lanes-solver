import { expect, test } from "bun:test"
import {
  routeSurfaceBridge,
  type SurfaceBridgeRoute,
} from "../lib/route-surface-bridge"
import { expectConnectedAndClear } from "./fixtures/expect-connected-and-clear"
import {
  currentViaDrillFixture,
  legalTangentBypass,
  physicalViaPadErrors,
} from "./fixtures/current-via-drill"

const finish = (query: Generator<void, SurfaceBridgeRoute | null>) => {
  const deadline = performance.now() + 2_000
  let result = query.next()
  while (!result.done && performance.now() < deadline) result = query.next()
  if (!result.done) {
    query.return(null)
    throw Error(
      "External test observation deadline; production routing budgets unchanged",
    )
  }
  return result.value
}

for (const shape of ["circle", "rotated-rect"] as const) {
  test(`keeps current bridge drills outside native ${shape} pads`, () => {
    const input = currentViaDrillFixture({ shape })
    const original = JSON.stringify(input)
    // This independent manufactured route is legal before any search. It
    // proves the fixture does not require a via through the native pad.
    expectConnectedAndClear({
      request: input,
      connections: input.connections,
      traces: [legalTangentBypass],
    })
    expect(physicalViaPadErrors(input, [legalTangentBypass])).toEqual([])
    const result = finish(routeSurfaceBridge(input, input.connections[0]))
    expect(result).not.toBeNull()
    const traces = [result!.carrier, ...result!.escapes]
    expect(
      traces.flatMap((trace) =>
        trace.route.filter((point) => point.route_type === "via"),
      ),
    ).toHaveLength(2)
    expect(JSON.stringify(input)).toBe(original)
    expect(physicalViaPadErrors(input, traces)).toEqual([])
  }, 3_000)
}

test("explicit via-in-pad permission retains the same public bridge domain", () => {
  const input = currentViaDrillFixture({ allowViaInPad: true })
  const original = JSON.stringify(input)
  const result = finish(routeSurfaceBridge(input, input.connections[0]))
  expect(result).not.toBeNull()
  const traces = [result!.carrier, ...result!.escapes]
  expect(physicalViaPadErrors(input, traces)).toEqual([])
  // This is a genuine permission control, not an unrelated legal route.
  expect(
    physicalViaPadErrors({ ...input, allowViaInPad: false }, traces).length,
  ).toBeGreaterThan(0)
  expect(JSON.stringify(input)).toBe(original)
}, 3_000)

for (const provenance of ["pcb_trace_id", "pcb_copper_pour_id"] as const) {
  test(`owned ${provenance} copper is not inferred to be a native SMT pad`, () => {
    const input = currentViaDrillFixture()
    input.obstacles = input.obstacles.map((obstacle, index) =>
      index < 2
        ? {
            ...obstacle,
            componentId: undefined,
            circuitJsonMetadata: { [provenance]: `owned_copper_${index}` },
          }
        : obstacle,
    )
    const original = JSON.stringify(input)
    const result = finish(routeSurfaceBridge(input, input.connections[0]))
    expect(result).not.toBeNull()
    const traces = [result!.carrier, ...result!.escapes]
    const vias = traces.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    )
    expect(vias).toHaveLength(2)
    expect(
      vias.some((via) =>
        input.obstacles
          .slice(0, 2)
          .some(
            (copper) =>
              Math.hypot(via.x - copper.center.x, via.y - copper.center.y) <
              0.2 + 0.1 - 1e-9,
          ),
      ),
    ).toBe(true)
    expect(physicalViaPadErrors(input, traces)).toEqual([])
    expect(JSON.stringify(input)).toBe(original)
  }, 3_000)
}
