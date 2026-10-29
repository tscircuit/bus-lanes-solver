import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { orangecrabByte0, orangecrabCircuit } from "../fixtures/orangecrab"
import provenance from "../fixtures/orangecrab-r0.2.1/provenance.json"

const removedTraceIds = [
  403, 404, 405, 413, 414, 415, 425, 426, 427, 453, 454, 455, 734, 735, 736,
  737, 738, 739, 740,
].map((id) => `pcb_trace_${id}`)
const removedViaIds = [
  178, 179, 180, 181, 186, 187, 188, 189, 190, 191, 196, 197, 198, 199, 200,
  201, 218, 219, 338, 339, 340, 341,
].map((id) => `pcb_via_${id}`)

test("OrangeCrab capture retains its exact source geometry and six-layer constraints", () => {
  for (const [filename, sha256] of [
    [
      "original.circuit.json",
      "22a2fd135fadc363f7712ead3cd05533c4b5c412fb055d1e55e704e1cdbe433e",
    ],
    [
      "byte0.srj.json",
      "d35e1db264568b8994b144526b78e1de788339c02205ff977a955b59d6b9828f",
    ],
  ]) {
    const contents = readFileSync(
      new URL(`../fixtures/orangecrab-r0.2.1/${filename}`, import.meta.url),
    )
    expect(createHash("sha256").update(contents).digest("hex")).toBe(sha256)
    expect(provenance.sha256[filename as keyof typeof provenance.sha256]).toBe(
      sha256,
    )
  }
  const circuit = orangecrabCircuit()
  expect(
    circuit.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(163)
  expect(circuit.filter((element) => element.type === "pcb_via")).toHaveLength(
    441,
  )
  expect(
    circuit.find((element) => element.type === "pcb_board")?.num_layers,
  ).toBe(6)
  const input = orangecrabByte0()
  expect(input.layerCount).toBe(6)
  expect(input.allowedLayers).toEqual(["top", "inner2", "bottom"])
  expect(input.buses).toEqual([
    {
      busId: "DDR3_DQS0_LM1.0",
      connectionNames: [
        "source_net_6",
        "source_net_10",
        "source_net_14",
        "source_net_15",
        "source_net_16",
        "source_net_18",
        "source_net_19",
        "source_net_20",
        "source_net_23",
        "source_net_24",
        "source_net_25",
      ],
      maxLengthSkew: 1,
      traceWidth: 0.089,
      allowedLayers: ["top", "inner2", "bottom"],
    },
  ])
  expect(input.differentialPairs).toEqual([
    {
      connectionNames: ["source_net_10", "source_net_6"],
      lengthTolerance: 1,
      traceGap: 0.089,
    },
  ])
})

test("byte-zero removal changes exactly the named 19 traces and 22 vias", () => {
  const original = orangecrabCircuit()
  const removed = original.filter(
    (element) =>
      (element.type === "pcb_trace" &&
        removedTraceIds.includes(element.pcb_trace_id)) ||
      (element.type === "pcb_via" &&
        removedViaIds.includes(element.pcb_via_id)),
  )
  expect(
    removed
      .filter((element) => element.type === "pcb_trace")
      .map((element) => element.pcb_trace_id)
      .sort(),
  ).toEqual([...removedTraceIds].sort())
  expect(
    removed
      .filter((element) => element.type === "pcb_via")
      .map((element) => element.pcb_via_id)
      .sort(),
  ).toEqual([...removedViaIds].sort())
  expect([...provenance.removed_copper_ids].sort()).toEqual(
    [...removedTraceIds, ...removedViaIds].sort(),
  )
  const retained = original.filter((element) => !removed.includes(element))
  expect(orangecrabCircuit(true)).toEqual(retained)
  expect(retained).toHaveLength(original.length - 41)
})
