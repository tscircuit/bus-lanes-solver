import { Circuit, getSimpleRouteJsonFromCircuitJson, type Board } from "@tscircuit/core"
import type { SimpleRouteJson } from "../../lib"

/** Two physical one-pin pads at each end; the shorter lane needs 10 mm of tuning. */
export async function meanderReturnGapInput() {
  const circuit = new Circuit()
  circuit.add(
    <board width="26mm" height="20mm" routingDisabled>
      {[
        ["A", -10, -3],
        ["B", 0, -3],
        ["C", -10, 3],
        ["D", 10, 3],
      ].map(([name, x, y]) => (
        <chip
          key={name}
          name={String(name)}
          pcbX={Number(x)}
          pcbY={Number(y)}
          pinLabels={{ pin1: "signal" }}
          footprint={
            <footprint>
              <smtpad portHints={["pin1"]} pcbX={0} pcbY={0}
                width="0.3mm" height="0.3mm" shape="rect" />
            </footprint>
          }
        />
      ))}
      <trace name="SHORT" from=".A > .pin1" to=".B > .pin1" thickness="0.1mm" />
      <trace name="LONG" from=".C > .pin1" to=".D > .pin1" thickness="0.1mm" />
      <bus name="DATA" connections={["SHORT", "LONG"]}
        pcbTraceWidth="0.1mm" maxLengthSkew="0.01mm" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const board = circuit.firstChild as Board
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson(),
    subcircuitComponent: board,
    subcircuit_id: board.subcircuit_id,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
  })
  return simpleRouteJson as SimpleRouteJson
}
