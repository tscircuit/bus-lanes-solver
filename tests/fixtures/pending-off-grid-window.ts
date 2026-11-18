import type { Connection, Obstacle, SimpleRouteJson, Trace } from "../../lib/types"
import type { PendingPadEscape } from "../../lib/pending-pad-escape"

/** A real continuous via window between adjacent grid samples. All coordinates
 * are board-world millimeters; this does not alter the router's grid or budget. */
export function pendingOffGridWindow(viaClearance = 0) {
  const via = { x: 0.637, y: 0.017 }
  const landMm = 0.4
  const openingMm = landMm + 2 * viaClearance + 0.002
  const opening = {
    minX: via.x - openingMm / 2,
    maxX: via.x + openingMm / 2,
    minY: via.y - openingMm / 2,
    maxY: via.y + openingMm / 2,
  }
  const future: Connection = { name: "FUTURE", width: 0.1, pointsToConnect: [
    { x: 0, y: 0, layer: "top" },
    { x: 0.5, y: 0.5, layer: "top" },
  ] }
  const rules = {
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: viaClearance,
    minPadEdgeToPadEdgeClearance: 0.3,
    minViaPadDiameter: landMm,
    minViaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    allowViaInPad: false,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    allowedLayers: ["bottom"],
  }
  const obstacles: Obstacle[] = [
    { type: "rect", componentId: "CPU", center: { x: 0, y: 0 },
      width: 0.3, height: 0.3, layers: ["top"], connectedTo: ["FUTURE"] },
    { type: "rect", componentId: "RAM", center: { x: 0.5, y: 0.5 },
      width: 0.3, height: 0.3, layers: ["top"], connectedTo: ["FUTURE"] },
  ]
  for (const [minX, maxX, minY, maxY] of [
    [-1, opening.minX, -1, 1], [opening.maxX, 1, -1, 1],
    [opening.minX, opening.maxX, -1, opening.minY],
    [opening.minX, opening.maxX, opening.maxY, 1],
  ]) obstacles.push({
    type: "rect", center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX, height: maxY - minY, layers: ["bottom"], connectedTo: ["GROUND"],
  })
  const candidate: Trace = { type: "pcb_trace", pcb_trace_id: "control", connection_name: "CONTROL", route: [
    { route_type: "wire", x: via.x - 0.05, y: via.y, layer: "bottom", width: 0.1 },
    { route_type: "wire", x: via.x + 0.05, y: via.y, layer: "bottom", width: 0.1 },
  ] }
  const control: Connection = { name: "CONTROL", width: 0.1,
    pointsToConnect: candidate.route.map(point => ({ x: point.x, y: point.y, layer: "bottom" })) }
  const input: SimpleRouteJson = { ...rules, layerCount: 2, obstacles, traces: [],
    connections: [control], pendingRoutingAccess: [{ ...rules, connections: [future] }] }
  const futureInput: SimpleRouteJson = { ...rules, layerCount: 2, obstacles, traces: [], connections: [future] }
  const witness: PendingPadEscape = { path: [future.pointsToConnect[0], via], layer: "top",
    via: { point: via, layers: ["top", "bottom"] } }
  const admissibleViaCenters = {
    minX: opening.minX + landMm / 2 + viaClearance,
    maxX: opening.maxX - landMm / 2 - viaClearance,
    minY: opening.minY + landMm / 2 + viaClearance,
    maxY: opening.maxY - landMm / 2 - viaClearance,
  }
  return { input, futureInput, future, control, candidate, witness, via, opening,
    admissibleViaCenters, viaClearance, landMm }
}
