import { expect, test } from "bun:test"
import {
  am3352OneGbOuterLayersInputSha256,
  am3352OneGbOuterLayersMetadata,
  loadAm3352OneGbOuterLayersInput,
} from "../scripts/load-am3352-1gb-outer-layers"

test("captured AM3352 1 GB case preserves native pads, outer layers, and all DDR timing groups", async () => {
  // Loading verifies the captured bytes before parsing. A future solver fix
  // must remain free to solve this input; historical timeouts are not a gate.
  const input = await loadAm3352OneGbOuterLayersInput()
  const metadata = am3352OneGbOuterLayersMetadata
  expect(am3352OneGbOuterLayersInputSha256).toBe(
    "84e1668ef4e27390c157f11aad3694b323bfb1a3d1f140bbd8891e0e851ada11",
  )
  expect(metadata.inputSha256).toBe(am3352OneGbOuterLayersInputSha256)
  expect(metadata.solverOptions).toEqual({ goal: "matched" })
  expect(metadata.placement.cpu).toEqual({ x: 0, y: 0, rotation: 0 })
  expect(metadata.placement.ram).toEqual({ x: 0, y: -27, rotation: 270 })

  expect(input.layerCount).toBe(4)
  expect(input.allowedLayers).toEqual(["top", "bottom"])
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.allowViaInPad).toBe(false)
  expect(input.minTraceWidth).toBe(0.1016)
  expect(input.minTraceToPadEdgeClearance).toBe(0.1016)
  expect(input.minViaPadDiameter).toBe(0.45)
  expect(input.minViaHoleDiameter).toBe(0.25)
  expect(input.traces ?? []).toEqual([])

  const signalNames = metadata.signalNames as Record<string, string>
  const namedConnections = new Map(
    input.connections.map((connection) => [
      signalNames[connection.name],
      connection,
    ]),
  )
  const byteSignals = (byte: number) => [
    ...Array.from({ length: 8 }, (_, bit) => `DDR_D${byte * 8 + bit}`),
    `DDR_DQM${byte}`,
    `DDR_DQS${byte}`,
    `DDR_DQSn${byte}`,
  ]
  const caSignals = [
    ...Array.from({ length: 16 }, (_, address) => `DDR_A${address}`),
    "DDR_BA0",
    "DDR_BA1",
    "DDR_BA2",
    "DDR_CKE",
    "DDR_CSn0",
    "DDR_RASn",
    "DDR_CASn",
    "DDR_WEn",
    "DDR_ODT",
    "DDR_CK",
    "DDR_CKn",
  ]
  const expectedSignals = [
    ...byteSignals(0),
    ...byteSignals(1),
    ...caSignals,
    "DDR_RESETn",
  ]
  expect(input.connections).toHaveLength(50)
  expect([...namedConnections.keys()].sort()).toEqual(expectedSignals.sort())
  for (const connection of input.connections) {
    expect(connection.pointsToConnect).toHaveLength(2)
    expect(connection.pointsToConnect.map((point) => point.layer)).toEqual([
      "top",
      "top",
    ])
    expect(connection.width).toBe(0.1016)
  }

  // Every package land remains an obstacle, including unrouted power and NC
  // lands. Terminal ownership is matched through the native PCB port identity.
  type CapturedPad = (typeof input.obstacles)[number] & {
    circuitJsonMetadata: {
      pcb_port_id: string
      source_component_name: string
      source_port_name: string
    }
  }
  const pads = input.obstacles as CapturedPad[]
  expect(pads).toHaveLength(420)
  expect(
    pads.filter(
      (pad) => pad.circuitJsonMetadata.source_component_name === "U1",
    ),
  ).toHaveLength(324)
  expect(
    pads.filter(
      (pad) => pad.circuitJsonMetadata.source_component_name === "U2",
    ),
  ).toHaveLength(96)
  const padsByPort = new Map(
    pads.map((pad) => [pad.circuitJsonMetadata.pcb_port_id, pad]),
  )
  expect(padsByPort.size).toBe(420)
  for (const connection of input.connections) {
    for (const terminal of connection.pointsToConnect) {
      const pad = padsByPort.get(terminal.pcb_port_id!)!
      expect(pad).toBeDefined()
      expect(pad.center).toEqual({ x: terminal.x, y: terminal.y })
      expect(pad.layers).toEqual(["top"])
      expect(pad.shape).toBe("circle")
      expect(pad.width).toBe(0.4)
      expect(pad.height).toBe(0.4)
    }
  }
  const address15 = namedConnections.get("DDR_A15")!
  expect(
    address15.pointsToConnect.map((terminal) => {
      const pad = padsByPort.get(terminal.pcb_port_id!)!
      return `${pad.circuitJsonMetadata.source_component_name}.${pad.circuitJsonMetadata.source_port_name}`
    }),
  ).toEqual(["U1.D3", "U2.M7"])

  const buses = new Map(input.buses!.map((bus) => [bus.name, bus]))
  expect([...buses.keys()].sort()).toEqual([
    "DDR_ADDRESS_COMMAND_CLOCK",
    "DDR_BYTE0",
    "DDR_BYTE1",
    "DDR_RESET",
  ])
  const allBusMembers = input.buses!.flatMap((bus) => bus.connectionNames)
  expect(allBusMembers).toHaveLength(50)
  expect(new Set(allBusMembers)).toEqual(
    new Set(input.connections.map((connection) => connection.name)),
  )
  for (const [busName, expectedMembers] of [
    ["DDR_BYTE0", byteSignals(0)],
    ["DDR_BYTE1", byteSignals(1)],
    ["DDR_ADDRESS_COMMAND_CLOCK", caSignals],
    ["DDR_RESET", ["DDR_RESETn"]],
  ] as const) {
    const bus = buses.get(busName)!
    expect(bus.connectionNames.map((name) => signalNames[name]).sort()).toEqual(
      [...expectedMembers].sort(),
    )
    expect(bus.allowedLayers).toEqual(["top", "bottom"])
    expect(bus.traceWidth).toBe(0.1016)
    if (busName !== "DDR_RESET") expect(bus.maxLengthSkew).toBe(0.635)
  }
  expect(buses.get("DDR_BYTE0")!.maxLength).toBeCloseTo(27.4, 10)
  expect(buses.get("DDR_BYTE1")!.maxLength).toBeCloseTo(29.8, 10)
  expect(buses.get("DDR_ADDRESS_COMMAND_CLOCK")!.minLength).toBeCloseTo(
    35.35,
    10,
  )
  expect(buses.get("DDR_ADDRESS_COMMAND_CLOCK")!.maxLength).toBeCloseTo(
    37.89,
    10,
  )

  expect(input.differentialPairs).toHaveLength(3)
  expect(
    input
      .differentialPairs!.map((pair) =>
        pair.connectionNames
          .map((name) => signalNames[name])
          .sort()
          .join("/"),
      )
      .sort(),
  ).toEqual(["DDR_CK/DDR_CKn", "DDR_DQS0/DDR_DQSn0", "DDR_DQS1/DDR_DQSn1"])
  for (const pair of input.differentialPairs!) {
    expect(pair.lengthTolerance).toBe(0.127)
    expect(pair.traceGap).toBe(0.12)
  }
})
