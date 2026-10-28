import { Circuit, getSimpleRouteJsonFromCircuitJson, type Board } from "@tscircuit/core"
import type { SimpleRouteJson } from "../../lib"

/** Two physical one-pin pads at each end; the shorter lane needs 10 mm of tuning. */
export async function meanderReturnGapInput({ paired = false, width = 0.1, rotation = 0, extraLength = 10 } = {}) {
  const angle = rotation * Math.PI / 180
  const circuit = new Circuit()
  circuit.add(
    <board width="26mm" height="20mm" routingDisabled>
      {[
        ["A", -10, -3],
        ["B", 0, -3],
        ["C", -10, 3],
        ["D", extraLength, 3],
        ...(paired ? [["E", -10, -3.22], ["F", 0, -3.22]] : []),
      ].map(([name, x, y]) => (
        <chip
          key={name}
          name={String(name)}
          pcbX={Number(x) * Math.cos(angle) - Number(y) * Math.sin(angle)}
          pcbY={Number(x) * Math.sin(angle) + Number(y) * Math.cos(angle)}
          pinLabels={{ pin1: "signal" }}
          footprint={
            <footprint>
              <smtpad portHints={["pin1"]} pcbX={0} pcbY={0}
                width="0.3mm" height={paired ? "0.1mm" : "0.3mm"} shape="rect" />
            </footprint>
          }
        />
      ))}
      <trace name="SHORT" from=".A > .pin1" to=".B > .pin1" thickness={width} />
      <trace name="LONG" from=".C > .pin1" to=".D > .pin1" thickness={width} />
      {paired && <trace name="NEG" from=".E > .pin1" to=".F > .pin1" thickness={width} />}
      {paired && <differentialpair name="PAIR" positiveConnection="SHORT" negativeConnection="NEG" maxLengthSkew="0.01mm" pcbTraceGap="0.12mm" />}
      <bus name="DATA" connections={paired ? ["SHORT", "NEG", "LONG"] : ["SHORT", "LONG"]}
        pcbTraceWidth={width} maxLengthSkew="0.01mm" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const board = circuit.firstChild as Board
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson(),
    subcircuitComponent: board,
    subcircuit_id: board.subcircuit_id,
    minTraceWidth: width,
    minTraceToPadEdgeClearance: 0.1,
  })
  return simpleRouteJson as SimpleRouteJson
}
