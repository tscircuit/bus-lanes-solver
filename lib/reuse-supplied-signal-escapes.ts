import {
  getCopperLayerNames,
  getRouteViaSpanLayers,
} from "@tscircuit/fanout-solver"
import { distance } from "./geometry"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Reuse only an electrically owned, physically continuous pad-to-via prefix.
 * The original fixed routes stay immutable, including their physical via spans. */
export function reuseSuppliedSignalEscapes(
  input: SimpleRouteJson,
  targets: ReadonlyMap<string, string>,
) {
  const aliases = new Map<Trace, Set<string>>()
  const escapes: Trace[] = []
  const connections = input.connections.map((connection) => ({
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((point, endpoint) => {
      const target = targets.get(connection.name)
      if (!target || (point.layers ?? [point.layer]).includes(target))
        return point
      const ids = [point.pointId, point.pcb_port_id].filter(
        (s): s is string => !!s,
      )
      const pad = input.obstacles.find(
        (o) =>
          o.componentId &&
          o.layers.includes(point.layer) &&
          distance(o.center, point) < 1e-7 &&
          o.connectedTo.some(
            (id) => ids.includes(id) || id === connection.name,
          ),
      )
      if (!pad) return point
      for (const trace of input.traces ?? []) {
        if (
          ![trace.connection_name, trace.source_trace_id].some(
            (id) => !!id && pad.connectedTo.includes(id),
          )
        )
          continue
        for (const reversed of [false, true]) {
          const route = reversed
            ? trace.route
                .toReversed()
                .map((p) =>
                  p.route_type === "via"
                    ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
                    : p,
                )
            : trace.route
          const first = route[0]
          if (
            first?.route_type !== "wire" ||
            first.layer !== point.layer ||
            distance(first, point) > 1e-7
          )
            continue
          const index = route.findIndex((p) => p.route_type === "via")
          if (index < 1) continue
          // Curved prefixes need their chord metadata remapped before reuse.
          // Leave those to the existing router until that representation is supported.
          if (trace.curvedSegments?.length) continue
          const prefix = route.slice(0, index)
          if (
            prefix.some(
              (p) =>
                p.route_type !== "wire" ||
                p.layer !== point.layer ||
                !Number.isFinite(p.width) ||
                p.width <= 0 ||
                !Number.isFinite(p.x) ||
                !Number.isFinite(p.y),
            )
          )
            continue
          const via = route[index]
          const afterVia = route[index + 1]
          if (
            via.route_type !== "via" ||
            via.from_layer !== point.layer ||
            distance(prefix.at(-1)!, via) > 1e-8 ||
            afterVia?.route_type !== "wire" ||
            afterVia.layer !== via.to_layer ||
            distance(afterVia, via) > 1e-8
          )
            continue
          const span = getRouteViaSpanLayers({
            fromLayer: via.from_layer,
            toLayer: via.to_layer,
            layers: via.layers,
            layerNames: getCopperLayerNames(input.layerCount),
            allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
          })
          if (!span.includes(target)) continue
          const handoff = {
            ...point,
            x: via.x,
            y: via.y,
            layer: target,
            layers: [target],
          }
          const stub: Trace = {
            type: "pcb_trace",
            pcb_trace_id: `reused_${connection.name}_${endpoint}`,
            connection_name: connection.name,
            source_trace_id: connection.source_trace_id,
            route: [
              ...prefix,
              { ...via, to_layer: target, layers: span },
              {
                ...handoff,
                route_type: "wire",
                width: (prefix.at(-1) as Wire).width,
              },
            ],
          }
          escapes.push(stub)
          const owners = aliases.get(trace) ?? new Set<string>()
          for (const id of ids) owners.add(id)
          aliases.set(trace, owners)
          return handoff
        }
      }
      return point
    }),
  }))
  return {
    escapes,
    input: {
      ...input,
      connections,
      traces: input.traces?.map((trace) =>
        aliases.has(trace)
          ? {
              ...trace,
              connectsTo: [
                ...new Set([
                  ...(trace.connectsTo ?? []),
                  ...aliases.get(trace)!,
                ]),
              ],
            }
          : trace,
      ),
    },
  }
}

/** Joining or tuning must not change any borrowed native-layer copper. A
 * different carrier may tap the same manufactured barrel on another spanned layer. */
export function suppliedEscapesArePreserved(escapes: Trace[], traces: Trace[]) {
  return escapes.every((escape) => {
    const joined = traces.find(
      (t) => t.connection_name === escape.connection_name,
    )
    if (!joined) return false
    const expected = escape.route.slice(0, -1)
    return [joined.route, joined.route.toReversed()].some((route) =>
      expected.every((point, i) => {
        const actual = route[i]
        if (
          !actual ||
          actual.route_type !== point.route_type ||
          distance(actual, point) > 1e-8
        )
          return false
        if (point.route_type === "wire" && actual.route_type === "wire")
          return point.layer === actual.layer && point.width === actual.width
        if (point.route_type === "via" && actual.route_type === "via")
          return (
            point.via_diameter === actual.via_diameter &&
            point.via_hole_diameter === actual.via_hole_diameter &&
            JSON.stringify(point.layers) === JSON.stringify(actual.layers)
          )
        return false
      }),
    )
  })
}
