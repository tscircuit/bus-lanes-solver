import React from "react"
import { Circuit, getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { length } from "../../lib/geometry"
import {
  matchNativeCarrierSignals,
  type NativeCarrierProgress,
} from "../../lib/match-native-carrier-signals"
import type { SimpleRouteJson, Trace } from "../../lib/types"

const endpoints = [
  [-1, 1],
  [-0.6, -1],
  [-0.2, 0.6],
  [0.2, 0.2],
  [0.6, -0.2],
  [1, -0.6],
] as const

/** Six signals cross around two inner-layer keepouts. No saved routes or
 * manually assembled obstacles are supplied to the matcher. */
export default function NativeMatchingHistoryFixture() {
  return (
    <board
      width={12}
      height={6}
      layers={4}
      routingDisabled
      schematicDisabled
      minTraceWidth={0.1}
      minTraceToPadEdgeClearance={0.075}
      minViaPadDiameter={0.3}
      minViaHoleDiameter={0.15}
      minBoardEdgeClearance={0.1}
    >
      {endpoints.flatMap((ends, i) =>
        ends.map((y, side) => (
          <React.Fragment key={`P${i}_${side}`}>
            <chip
              name={`P${i}_${side}`}
              pcbX={side ? 5 : -5}
              pcbY={y}
              footprint={
                <footprint>
                  <smtpad portHints={["pin1"]} shape="circle" radius={0.125} />
                </footprint>
              }
            />
          </React.Fragment>
        )),
      )}
      {endpoints.map((_, i) => (
        <React.Fragment key={`S${i}`}>
          <trace
            name={`S${i}`}
            from={`.P${i}_0 > .pin1`}
            to={`.P${i}_1 > .pin1`}
          />
        </React.Fragment>
      ))}
      <keepout
        shape="rect"
        pcbX={-0.9}
        pcbY={0.6}
        width={0.3}
        height={2}
        layers={["inner1"]}
      />
      <keepout
        shape="rect"
        pcbX={0.9}
        pcbY={-1}
        width={0.5}
        height={2}
        layers={["inner1"]}
      />
    </board>
  )
}

export async function compileNativeMatchingHistoryFixture() {
  const circuit = new Circuit()
  circuit.add(<NativeMatchingHistoryFixture />)
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minBoardEdgeClearance: 0.1,
  })
  // The native matcher requires one carrier layer. All coordinates, pad
  // ownership, keepouts, bounds and connections come directly from Core.
  const input = {
    ...simpleRouteJson,
    allowedLayers: ["inner1"],
  } as unknown as SimpleRouteJson
  const signalNames = Object.fromEntries(
    circuitJson.flatMap((element) =>
      element.type === "source_trace"
        ? [[element.source_trace_id, element.name!]]
        : [],
    ),
  ) as Record<string, string>
  return { input, circuitJson, signalNames }
}

export const nativeMatchingHistoryOptions = {
  gridStep: 0.3,
  fineGridStep: 0.1,
  // This is a bounded repair case: one pass per stage, with all six local
  // repair attempts available and a substantial real search budget.
  maxPasses: 1,
  maxLocalPasses: 1,
  maxExpansionsPerRoute: 100000,
  maxStrictExpansionsPerRoute: 100000,
}

export function runNativeMatchingHistoryFixture(input: SimpleRouteJson) {
  const stages: NativeCarrierProgress[] = []
  const iterator = matchNativeCarrierSignals(
    input,
    [],
    nativeMatchingHistoryOptions,
    (state) => stages.push(structuredClone(state)),
  )
  let result = iterator.next()
  while (!result.done) result = iterator.next()
  // A rejected candidate is only a diagnostic; it is never returned as a
  // successful route or inserted into the circuit.
  const diagnosticTraces = result.value ?? stages.at(-1)?.traces ?? []
  const validation = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces: diagnosticTraces },
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  const complete = input.connections.every((connection) => {
    const trace = diagnosticTraces.find(
      (candidate) => candidate.connection_name === connection.name,
    )
    return (
      trace &&
      connection.pointsToConnect.every((terminal, side) => {
        const point = side ? trace.route.at(-1)! : trace.route[0]
        return (
          point.route_type === "wire" &&
          point.layer === terminal.layer &&
          Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-8
        )
      })
    )
  })
  return {
    traces: result.value as Trace[] | null,
    diagnosticTraces,
    stages,
    validation,
    complete,
    lengths: diagnosticTraces.map((trace) => ({
      connectionName: trace.connection_name!,
      copperLengthMm: length(trace.route),
    })),
  }
}
