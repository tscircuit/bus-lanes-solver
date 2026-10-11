import { Circuit, getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import type { SimpleRouteJson } from "../../lib/types"

/** Fractional board origin comes from authored board size and placement. */
export function compileGridPairCircuit() {
  const circuit = new Circuit()
  const footprint = (
    <footprint>
      <smtpad portHints={["1"]} shape="circle" radius={0.2} pcbY={0.4} />
      <smtpad portHints={["2"]} shape="circle" radius={0.2} pcbY={-0.4} />
    </footprint>
  )
  circuit.add(
    <board
      width={8.1}
      height={4.1}
      pcbX={0.02}
      pcbY={0.02}
      layers={4}
      routingDisabled
      minTraceWidth={0.1}
      minTraceToPadEdgeClearance={0.05}
      minViaPadDiameter={0.3}
      minViaHoleDiameter={0.15}
    >
      <chip
        name="U1"
        pcbX={-3.02}
        pcbY={-0.02}
        pinLabels={{ pin1: "P", pin2: "N" }}
        footprint={footprint}
      />
      <chip
        name="U2"
        pcbX={2.98}
        pcbY={-0.02}
        pinLabels={{ pin1: "P", pin2: "N" }}
        footprint={footprint}
      />
      <trace name="P" from="U1.P" to="U2.P" width={0.1} />
      <trace name="N" from="U1.N" to="U2.N" width={0.1} />
      <differentialpair
        name="CLOCK"
        positiveConnection="P"
        negativeConnection="N"
        pcbTraceGap={0.1}
        maxLengthSkew={0.1}
      />
    </board>,
  )
  circuit.render()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    db: circuit.db,
    subcircuit_id: circuit.firstChild!.getSubcircuit().subcircuit_id,
    subcircuitComponent: circuit.firstChild!,
  })
  // Use the compiled pads, ownership and pair constraint, selecting inner1 for
  // this isolated routing phase. No coordinates or obstacle shapes are edited.
  const input = {
    ...simpleRouteJson,
    allowedLayers: ["inner1"],
  } as unknown as SimpleRouteJson
  return { circuitJson: circuit.getCircuitJson(), input }
}
