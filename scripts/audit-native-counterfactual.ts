import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import type { SimpleRouteJson, Trace } from "../lib/types"
import { loadNativeCounterfactual } from "./native-counterfactual"
export function nativeSignalsConnected(
  input: SimpleRouteJson,
  traces: Trace[],
) {
  return input.connections.every((c) => {
    const edges = new Map<string, Set<string>>()
    const key = (x: number, y: number, layer: string) =>
      `${x.toFixed(8)},${y.toFixed(8)},${layer}`
    const join = (a: string, b: string) => {
      if (!edges.has(a)) edges.set(a, new Set())
      if (!edges.has(b)) edges.set(b, new Set())
      edges.get(a)!.add(b)
      edges.get(b)!.add(a)
    }
    for (const t of traces.filter((t) => t.connection_name === c.name)) {
      let last: { x: number; y: number; layers: string[] } | undefined
      for (const p of t.route) {
        const layers =
          p.route_type === "wire"
            ? [p.layer]
            : (p.layers ?? [p.from_layer, p.to_layer])
        for (const layer of layers)
          for (const other of layers)
            join(key(p.x, p.y, layer), key(p.x, p.y, other))
        if (last)
          for (const layer of layers.filter((l) => last!.layers.includes(l)))
            join(key(last.x, last.y, layer), key(p.x, p.y, layer))
        last = { x: p.x, y: p.y, layers }
      }
    }
    const [a, b] = c.pointsToConnect,
      start = key(a.x, a.y, a.layer),
      target = key(b.x, b.y, b.layer),
      seen = new Set([start]),
      queue = [start]
    while (queue.length) {
      const current = queue.pop()!
      for (const n of edges.get(current) ?? [])
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
    }
    return seen.has(target)
  })
}
export function completedCounterfactualControl() {
  const r = loadNativeCounterfactual(),
    choice = r.probes
      .filter((p) => p.next.value)
      .sort((a, b) => a.length - b.length)[0]
  if (!choice) throw Error("No completed reachable counterfactual control")
  const input = r.sample.secondInput,
    names = new Set([choice.choice.connection.name]),
    traces = [...choice.choice.escapes, choice.choice.trace],
    fixed = input.traces ?? []
  const scoped = {
    ...input,
    connections: input.connections.filter((c) => names.has(c.name)),
    buses: input.buses!.map((b) => ({
      ...b,
      connectionNames: b.connectionNames.filter((n) => names.has(n)),
    })),
    differentialPairs: [],
  }
  const combined = {
    ...scoped,
    connections: [...r.sample.firstInput.connections, ...scoped.connections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: { ...combined, traces: [...fixed, ...traces] } as never,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  const buses = busLengthReports(scoped, traces),
    firstBuses = busLengthReports(r.sample.firstInput, fixed),
    firstPairs = pairLengthReports(r.sample.firstInput, fixed),
    firstCoupling = exteriorPairSpacingReports(r.sample.firstInput, fixed)
  const audit = {
    inputUnchanged: r.inputUnchanged,
    scope:
      "Completed D0 net only around freshly solved BYTE1; full BYTE0 and SBC incomplete",
    connected: nativeSignalsConnected(scoped, traces),
    drc,
    buses,
    firstBuses,
    firstPairs,
    firstCoupling,
    dqm0Lookahead: choice.next.steps,
    probes: r.probes.map((p) => ({
      layer: p.choice.layer,
      length: p.length,
      selected: p.selected,
      dqm0Reachable: !!p.next.value,
      completed: p.next.completed,
      yields: p.next.steps,
    })),
  }
  if (
    !audit.inputUnchanged ||
    !audit.connected ||
    !drc.valid ||
    [...buses, ...firstBuses].some((b) => !b.matched || !b.withinLengthLimit) ||
    [...firstPairs, ...firstCoupling].some((p) => !p.matched)
  )
    throw Error("Invalid completed counterfactual control")
  return { input, traces, fixed, audit }
}
