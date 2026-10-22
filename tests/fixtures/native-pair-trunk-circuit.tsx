import { Circuit, getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import type { SimpleRouteJson } from "../../lib/types"

/** Standard 0402 zero-ohm link pads around a right-angle inner-layer corridor. */
export function compileTrunkPairCircuit() {
  const circuit = new Circuit()
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
      <resistor name="R1" resistance="0" footprint="0402" pcbX={-2} pcbY={-0.09} pcbRotation={-90} />
      <resistor name="R2" resistance="0" footprint="0402" pcbX={-2} pcbY={-1.91} pcbRotation={90} />
      <resistor name="R3" resistance="0" footprint="0402" pcbX={1.91} pcbY={2} pcbRotation={180} />
      <resistor name="R4" resistance="0" footprint="0402" pcbX={0.09} pcbY={2} />
      <trace name="P" from="R2.pin2" to="R3.pin2" width={0.1} />
      <trace name="N" from="R1.pin2" to="R4.pin2" width={0.1} />
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
