// Native source: https://github.com/orangecrab-fpga/orangecrab-hardware/blob/c511d569fe2af39467041f888bc231020f40c6ac/hardware/orangecrab_r0.2.1/OrangeCrab.kicad_pcb
import type { ReactElement } from "react"
import { SourcePart } from "../source-part"
import source from "../source-data/orangecrab.json"

export default function Board({
  routingDisabled = false,
  staged = false,
}: {
  routingDisabled?: boolean
  staged?: boolean
}): ReactElement {
  return (
    <board
      title="OrangeCrab rev 0.2.1 ECP5 DDR3 \u2014 core bus lanes"
      width={source.width}
      height={source.height}
      layers={6}
      minTraceWidth={Math.min(...source.rules.widths)}
      minTraceToPadEdgeClearance={source.rules.appliedGlobalClearance}
      minViaPadDiameter={source.rules.viaPad}
      minViaHoleDiameter={source.rules.viaDrill}
      routeRemaining={false}
      schematicDisabled
      routingDisabled={routingDisabled}
    >
      <SourcePart part={source.parts.find((part) => part.name === "U3")!} />
      <SourcePart part={source.parts.find((part) => part.name === "R13")!} />
      <SourcePart part={source.parts.find((part) => part.name === "R5")!} />
      <SourcePart part={source.parts.find((part) => part.name === "C27")!} />
      <SourcePart part={source.parts.find((part) => part.name === "U4")!} />
      {!staged && (
        <autoroutingphase
          name="DDR_ALL_BUSES"
          phaseIndex={0}
          autorouter="bus_lanes"
        />
      )}
      {staged && (
        <autoroutingphase
          name="ROUTE_DDR_BYTE0"
          phaseIndex={0}
          autorouter="bus_lanes"
          connections={[
            "DDR_D0",
            "DDR_D1",
            "DDR_D2",
            "DDR_D3",
            "DDR_D4",
            "DDR_D5",
            "DDR_D6",
            "DDR_D7",
            "DDR_LDM",
            "DDR_LDQSP",
            "DDR_LDQSN",
          ]}
        />
      )}
      <bus
        name="DDR_BYTE0"
        routingPhaseIndex={staged ? 0 : 0}
        connections={[
          "DDR_D0",
          "DDR_D1",
          "DDR_D2",
          "DDR_D3",
          "DDR_D4",
          "DDR_D5",
          "DDR_D6",
          "DDR_D7",
          "DDR_LDM",
          "DDR_LDQSP",
          "DDR_LDQSN",
        ]}
        pcbAllowedLayers={["inner1"]}
        maxLengthSkew="0.5mm"
      />
      {staged && (
        <autoroutingphase
          name="ROUTE_DDR_BYTE1"
          phaseIndex={1}
          autorouter="bus_lanes"
          connections={[
            "DDR_D10",
            "DDR_D11",
            "DDR_D12",
            "DDR_D13",
            "DDR_D14",
            "DDR_D15",
            "DDR_D8",
            "DDR_D9",
            "DDR_UDM",
            "DDR_UDQSP",
            "DDR_UDQSN",
          ]}
        />
      )}
      <bus
        name="DDR_BYTE1"
        routingPhaseIndex={staged ? 1 : 0}
        connections={[
          "DDR_D10",
          "DDR_D11",
          "DDR_D12",
          "DDR_D13",
          "DDR_D14",
          "DDR_D15",
          "DDR_D8",
          "DDR_D9",
          "DDR_UDM",
          "DDR_UDQSP",
          "DDR_UDQSN",
        ]}
        pcbAllowedLayers={["inner2"]}
        maxLengthSkew="0.5mm"
      />
      {staged && (
        <autoroutingphase
          name="ROUTE_DDR_ADDRESS_CONTROL"
          phaseIndex={2}
          autorouter="bus_lanes"
          connections={[
            "DDR_A0",
            "DDR_A1",
            "DDR_A10",
            "DDR_A11",
            "DDR_A12",
            "DDR_A13",
            "DDR_A14",
            "DDR_A15",
            "DDR_A2",
            "DDR_A3",
            "DDR_A4",
            "DDR_A5",
            "DDR_A6",
            "DDR_A7",
            "DDR_A8",
            "DDR_A9",
            "DDR_BA0",
            "DDR_BA1",
            "DDR_BA2",
            "DDR_CASN",
            "DDR_CKE",
            "DDR_CSN",
            "DDR_ODT",
            "DDR_RASN",
            "DDR_RESETN",
            "DDR_WEN",
          ]}
        />
      )}
      <bus
        name="DDR_ADDRESS_CONTROL"
        routingPhaseIndex={staged ? 2 : 0}
        connections={[
          "DDR_A0",
          "DDR_A1",
          "DDR_A10",
          "DDR_A11",
          "DDR_A12",
          "DDR_A13",
          "DDR_A14",
          "DDR_A15",
          "DDR_A2",
          "DDR_A3",
          "DDR_A4",
          "DDR_A5",
          "DDR_A6",
          "DDR_A7",
          "DDR_A8",
          "DDR_A9",
          "DDR_BA0",
          "DDR_BA1",
          "DDR_BA2",
          "DDR_CASN",
          "DDR_CKE",
          "DDR_CSN",
          "DDR_ODT",
          "DDR_RASN",
          "DDR_RESETN",
          "DDR_WEN",
        ]}
        pcbAllowedLayers={["bottom"]}
      />
      {staged && (
        <autoroutingphase
          name="ROUTE_DDR_ADDRESS_CONTROL_TERMINATION"
          phaseIndex={3}
          autorouter="bus_lanes"
          connections={["DDR_TERMINATION_TERMINATIONR13"]}
        />
      )}
      <bus
        name="DDR_ADDRESS_CONTROL_TERMINATION"
        routingPhaseIndex={staged ? 3 : 0}
        connections={["DDR_TERMINATION_TERMINATIONR13"]}
        pcbAllowedLayers={["bottom"]}
      />
      {staged && (
        <autoroutingphase
          name="ROUTE_DDR_CLOCK"
          phaseIndex={4}
          autorouter="bus_lanes"
          connections={["DDR_CKP", "DDR_CKN"]}
        />
      )}
      <bus
        name="DDR_CLOCK"
        routingPhaseIndex={staged ? 4 : 0}
        connections={["DDR_CKP", "DDR_CKN"]}
        pcbAllowedLayers={["bottom"]}
      />
      <differentialpair
        name="PAIR_DDR_CKP"
        positiveConnection="DDR_CKP"
        negativeConnection="DDR_CKN"
        maxLengthSkew="0.1mm"
        pcbTraceGap={source.rules.appliedGlobalClearance}
      />
      <differentialpair
        name="PAIR_DDR_LDQSP"
        positiveConnection="DDR_LDQSP"
        negativeConnection="DDR_LDQSN"
        maxLengthSkew="0.1mm"
        pcbTraceGap={source.rules.appliedGlobalClearance}
      />
      <differentialpair
        name="PAIR_DDR_UDQSP"
        positiveConnection="DDR_UDQSP"
        negativeConnection="DDR_UDQSN"
        maxLengthSkew="0.1mm"
        pcbTraceGap={source.rules.appliedGlobalClearance}
      />
      <trace
        name="DDR_TERMINATION_TERMINATIONR13"
        routingPhaseIndex={staged ? 3 : 0}
        thickness={0.0889}
        path={[".R13 > .pin1", ".R5 > .pin1", ".C27 > .pin1"]}
      />
      <trace
        name="DDR_A0"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin19"
        to=".U4 > .pin75"
      />
      <trace
        name="DDR_A1"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin25"
        to=".U4 > .pin82"
      />
      <trace
        name="DDR_A10"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin5"
        to=".U4 > .pin64"
      />
      <trace
        name="DDR_A11"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin17"
        to=".U4 > .pin88"
      />
      <trace
        name="DDR_A12"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin12"
        to=".U4 > .pin76"
      />
      <trace
        name="DDR_A13"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin16"
        to=".U4 > .pin93"
      />
      <trace
        name="DDR_A14"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin1"
        to=".U4 > .pin94"
      />
      <trace
        name="DDR_A15"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin21"
        to=".U4 > .pin70"
      />
      <trace
        name="DDR_A2"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin26"
        to=".U4 > .pin81"
      />
      <trace
        name="DDR_A3"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin2"
        to=".U4 > .pin74"
      />
      <trace
        name="DDR_A4"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin3"
        to=".U4 > .pin83"
      />
      <trace
        name="DDR_A5"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin27"
        to=".U4 > .pin80"
      />
      <trace
        name="DDR_A6"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin18"
        to=".U4 > .pin89"
      />
      <trace
        name="DDR_A7"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin9"
        to=".U4 > .pin86"
      />
      <trace
        name="DDR_A8"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin8"
        to=".U4 > .pin95"
      />
      <trace
        name="DDR_A9"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin24"
        to=".U4 > .pin87"
      />
      <trace
        name="DDR_BA0"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin28"
        to=".U4 > .pin68"
      />
      <trace
        name="DDR_BA1"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin13"
        to=".U4 > .pin77"
      />
      <trace
        name="DDR_BA2"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin4"
        to=".U4 > .pin69"
      />
      <trace
        name="DDR_CASN"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin169"
        to=".U4 > .pin57"
      />
      <trace
        name="DDR_CKP"
        routingPhaseIndex={staged ? 4 : 0}
        thickness={0.0889}
        path={[".U3 > .pin214", ".R5 > .pin2", ".U4 > .pin52"]}
      />
      <trace
        name="DDR_CKN"
        routingPhaseIndex={staged ? 4 : 0}
        thickness={0.0889}
        path={[".U3 > .pin223", ".R13 > .pin2", ".U4 > .pin58"]}
      />
      <trace
        name="DDR_CKE"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin173"
        to=".U4 > .pin60"
      />
      <trace
        name="DDR_CSN"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin145"
        to=".U4 > .pin62"
      />
      <trace
        name="DDR_D0"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin164"
        to=".U4 > .pin27"
      />
      <trace
        name="DDR_D1"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin170"
        to=".U4 > .pin34"
      />
      <trace
        name="DDR_D10"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin193"
        to=".U4 > .pin17"
      />
      <trace
        name="DDR_D11"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin184"
        to=".U4 > .pin14"
      />
      <trace
        name="DDR_D12"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin212"
        to=".U4 > .pin4"
      />
      <trace
        name="DDR_D13"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin165"
        to=".U4 > .pin2"
      />
      <trace
        name="DDR_D14"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin203"
        to=".U4 > .pin11"
      />
      <trace
        name="DDR_D15"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin187"
        to=".U4 > .pin3"
      />
      <trace
        name="DDR_D2"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin156"
        to=".U4 > .pin32"
      />
      <trace
        name="DDR_D3"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin163"
        to=".U4 > .pin35"
      />
      <trace
        name="DDR_D4"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin147"
        to=".U4 > .pin45"
      />
      <trace
        name="DDR_D5"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin153"
        to=".U4 > .pin47"
      />
      <trace
        name="DDR_D6"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin149"
        to=".U4 > .pin38"
      />
      <trace
        name="DDR_D7"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin146"
        to=".U4 > .pin46"
      />
      <trace
        name="DDR_D8"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin186"
        to=".U4 > .pin22"
      />
      <trace
        name="DDR_D9"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin185"
        to=".U4 > .pin15"
      />
      <trace
        name="DDR_LDM"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin194"
        to=".U4 > .pin28"
      />
      <trace
        name="DDR_LDQSP"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin196"
        to=".U4 > .pin16"
      />
      <trace
        name="DDR_LDQSN"
        routingPhaseIndex={staged ? 0 : 0}
        thickness={0.089}
        from=".U3 > .pin204"
        to=".U4 > .pin10"
      />
      <trace
        name="DDR_ODT"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin161"
        to=".U4 > .pin55"
      />
      <trace
        name="DDR_RASN"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin160"
        to=".U4 > .pin51"
      />
      <trace
        name="DDR_RESETN"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.0889}
        from=".U3 > .pin232"
        to=".U4 > .pin92"
      />
      <trace
        name="DDR_UDM"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin171"
        to=".U4 > .pin21"
      />
      <trace
        name="DDR_UDQSP"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin154"
        to=".U4 > .pin33"
      />
      <trace
        name="DDR_UDQSN"
        routingPhaseIndex={staged ? 1 : 0}
        thickness={0.089}
        from=".U3 > .pin148"
        to=".U4 > .pin39"
      />
      <trace
        name="DDR_WEN"
        routingPhaseIndex={staged ? 2 : 0}
        thickness={0.121}
        from=".U3 > .pin152"
        to=".U4 > .pin63"
      />
    </board>
  )
}
