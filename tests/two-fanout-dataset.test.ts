import { expect, test } from "bun:test"
import { validateTwoFanoutSample } from "../scripts/validate-two-fanout-sample"

test("two-fanout dataset rejects overlap, prefabricated carrier routes and wrong exits", async () => {
  const prefix = new URL(
    "./fixtures/two-fanouts/ddr_left_io_right",
    import.meta.url,
  )
  const input = await Bun.file(`${prefix.pathname}.json`).json(),
    meta = await Bun.file(`${prefix.pathname}.meta.json`).json()
  expect(validateTwoFanoutSample(input, meta).fanoutTraces).toBe(66)
  const overlap = structuredClone(meta)
  overlap.ramRegion = overlap.socRegion
  expect(() => validateTwoFanoutSample(input, overlap)).toThrow("overlapping")
  expect(() =>
    validateTwoFanoutSample(
      {
        ...input,
        traces: [
          { ...meta.fixedFanoutTraces[0], pcb_trace_id: "carrier_fake" },
        ],
      },
      meta,
    ),
  ).toThrow("pre-routed carrier")
  const wrong = structuredClone(input)
  wrong.connections[0].pointsToConnect[0].x += 0.5
  expect(() => validateTwoFanoutSample(wrong, meta)).toThrow(
    "endpoint is not a fanout exit",
  )
})
