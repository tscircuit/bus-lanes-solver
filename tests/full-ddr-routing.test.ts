import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib"
import { validateTwoFanoutSample } from "../scripts/validate-two-fanout-sample"
const profiles = [
  "ddr_left_io_right",
  "ddr_right_io_left",
  "ddr_top_io_bottom",
  "ddr_bottom_io_top",
]
test("all complete DDR phases route without transitions and pass combined copper DRC", async () => {
  for (const profile of profiles) {
    const input = await Bun.file(
        `tests/fixtures/two-fanouts/${profile}.json`,
      ).json(),
      meta = await Bun.file(
        `tests/fixtures/two-fanouts/${profile}.meta.json`,
      ).json()
    const solver = new BusLanesSolver(input, { maxSearchIterations: 1000 })
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    expect(solver.traces.length).toBe(33)
    expect(
      solver.traces.every((t) => t.route.every((p) => p.route_type === "wire")),
    ).toBe(true)
    expect(
      validateTwoFanoutSample(input, meta, solver.traces).fixedCopperDrcErrors,
    ).toBe(0)
    expect(meta.corePhase.status).toBe("completed")
    expect(meta.corePhase.circuitErrors).toBe(0)
  }
})
test("SoC ball positions and orientation are identical in every DDR layout", async () => {
  let reference: any
  for (const profile of profiles) {
    const record = await Bun.file(
      `examples/fanout-solver-outputs/${profile}-soc.json`,
    ).json()
    const pads = record.input.obstacles
      .filter((o: any) => o.componentId === record.options.sourceComponentId)
      .map((o: any) => ({
        id: o.circuitJsonMetadata?.pcb_smtpad_id,
        x: o.center.x,
        y: o.center.y,
        width: o.width,
        height: o.height,
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id))
    if (reference) expect(pads).toEqual(reference)
    else reference = pads
  }
})
