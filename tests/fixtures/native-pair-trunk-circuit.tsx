import { Circuit, getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import type { SimpleRouteJson } from "../../lib/types"

/** Two real two-pad packages placed around a right-angle inner-layer corridor. */
export function compileTrunkPairCircuit() {
  const circuit = new Circuit()
  const footprint = (
    <footprint>
      <smtpad portHints={["1"]} shape="circle" radius={0.2} pcbY={0.4} />
      <smtpad portHints={["2"]} shape="circle" radius={0.2} pcbY={-0.4} />
    </footprint>
  )
  circuit.add(
    <board
      width={6}
      height={6}
      pcbX={-1}
      pcbY={1}
      layers={4}
      routingDisabled
      minTraceWidth={0.1}
      minTraceToPadEdgeClearance={0.05}
      minViaPadDiameter={0.3}
      minViaHoleDiameter={0.15}
    >
      <chip
        name="U1"
        pcbX={-2}
        pcbY={-1}
        pinLabels={{ pin1: "P", pin2: "N" }}
        footprint={footprint}
      />
      <chip
        name="U2"
        pcbX={1}
        pcbY={2}
        pcbRotation={-90}
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
  // Native pair planning receives the same Core pads, ports, obstacle ownership,
  // and pair constraint. Restrict its carrier to the intended inner-layer phase.
  const input = {
    ...simpleRouteJson,
    allowedLayers: ["inner1"],
  } as unknown as SimpleRouteJson
  return { circuitJson: circuit.getCircuitJson(), input }
}
