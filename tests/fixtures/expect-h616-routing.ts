import { expect } from "bun:test"
import { validateOriginalEndpointConnectivity, validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { Bus, ConnectionName, SimpleRouteJson, Trace } from "../../lib"
import { nativeValidationSrj } from "./expect-completed-routing"
import { createCopperPathMeasurer } from "./h616-reference-skew/path-length"

type Rule = {
  name: string
  names: ConnectionName[]
  tolerance: number
  skewReference?: "mean" | "references"
  references: ConnectionName[]
}
export type H616Fixture = {
  input: SimpleRouteJson
  phases: { names: ConnectionName[]; buses: Bus[] }[]
  constraints: Rule[]
  preservation: { name: string; names: ConnectionName[]; range: number }[]
}

function measureSignalLength({
  input,
  clockBuses,
  generatedTraces,
  connectionName,
}: {
  input: SimpleRouteJson
  clockBuses: Bus[]
  generatedTraces: Trace[]
  connectionName: ConnectionName
}): number {
  const connection = input.connections.find((c) => c.name === connectionName)!
  const path = clockBuses
    .flatMap((b) => b.lengthMatchingPaths ?? [])
    .find((p) => p.connectionName === connectionName)
  const ends = path
    ? path.pcbPortIds.map(
        (id) => connection.pointsToConnect.find((p) => p.pcb_port_id === id)!,
      )
    : connection.pointsToConnect.slice(0, 2)
  const ports = new Map(
    ends.map((p, i) => [
      String(i),
      { ...p, layers: p.layers ?? [p.layer], source_port_id: String(i) },
    ]),
  )
  const traces = generatedTraces.filter(
    (t) => t.connection_name === connectionName,
  )
  const vias = traces.flatMap((t) =>
    t.route.flatMap((p) =>
      p.route_type === "via"
        ? [
            {
              ...p,
              pcb_trace_id: t.pcb_trace_id,
              layers: p.layers ?? ["top", "inner1", "inner2", "bottom"],
            },
          ]
        : [],
    ),
  )
  const length = createCopperPathMeasurer({ routes: traces, ports, vias })(
    "0",
    "1",
  )
  expect(length).not.toBeNull()
  return length!
}

export function expectH616Routing({ input, generated, clockBuses, constraints, preservation }: {
  input: SimpleRouteJson
  generated: Trace[]
  clockBuses: Bus[]
  constraints: H616Fixture["constraints"]
  preservation: H616Fixture["preservation"]
}): void {
  const native = nativeValidationSrj(input)
  const routed = nativeValidationSrj({ ...input, traces: generated })
  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj: native,
    routedSrj: routed,
  })
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(53)
  expect(
    validateRoutedCopperDrc({
      inputSrj: native,
      routedSrj: routed,
      clearance: 0.1,
      allowBlindAndBuriedVias: false,
    }).valid,
  ).toBe(true)
  const lengths = new Map(
    input.connections.map((connection) => [
      connection.name,
      measureSignalLength({
        input,
        clockBuses,
        generatedTraces: generated,
        connectionName: connection.name,
      }),
    ]),
  )
  expect(constraints).toHaveLength(9)
  for (const rule of constraints) {
    const memberLengthsMm = rule.names.map((name) => lengths.get(name)!),
      meanLengthMm =
        memberLengthsMm.reduce((sum, lengthMm) => sum + lengthMm, 0) /
        memberLengthsMm.length
    const skew =
      rule.skewReference === "mean"
        ? Math.max(
            ...memberLengthsMm.map((lengthMm) =>
              Math.abs(lengthMm - meanLengthMm),
            ),
          )
        : rule.skewReference === "references"
          ? Math.max(
              ...rule.names
                .filter((n) => !rule.references.includes(n))
                .flatMap((n) =>
                  rule.references.map((ref) =>
                    Math.abs(lengths.get(n)! - lengths.get(ref)!),
                  ),
                ),
            )
          : Math.max(...memberLengthsMm) - Math.min(...memberLengthsMm)
    expect(skew, rule.name).toBeLessThanOrEqual(rule.tolerance + 1e-6)
  }
  for (const rule of preservation) {
    const memberLengthsMm = rule.names.map((name) => lengths.get(name)!)
    expect(
      Math.max(...memberLengthsMm) - Math.min(...memberLengthsMm),
      rule.name,
    ).toBeLessThanOrEqual(rule.range + 1e-6)
  }
}
