import type { Point, SimpleRouteJson } from "../../lib/types"
import { pendingOffGridWindow } from "./pending-off-grid-window"

function turn(point: Point): Point { return { x: -point.y, y: point.x } }

function turnBounds(bounds: SimpleRouteJson["bounds"]): SimpleRouteJson["bounds"] {
  return { minX: -bounds.maxY, maxX: -bounds.minY, minY: bounds.minX, maxY: bounds.maxX }
}

/** A rigid quarter turn of every physical object, terminal and board boundary. */
export function pendingOffGridQuarterTurn(viaClearance = 0.1) {
  const source = pendingOffGridWindow(viaClearance)
  const future = { ...source.future, pointsToConnect: source.future.pointsToConnect.map(point => ({ ...point, ...turn(point) })) }
  const candidate = { ...source.candidate, route: source.candidate.route.map(point => ({ ...point, ...turn(point) })) }
  const control = { ...source.control, pointsToConnect: source.control.pointsToConnect.map(point => ({ ...point, ...turn(point) })) }
  const obstacles = source.input.obstacles.map(obstacle => ({ ...obstacle,
    center: turn(obstacle.center), width: obstacle.height, height: obstacle.width,
  }))
  const input: SimpleRouteJson = { ...source.input, bounds: turnBounds(source.input.bounds), obstacles,
    connections: [control], pendingRoutingAccess: source.input.pendingRoutingAccess!.map(phase => ({
      ...phase, bounds: turnBounds(phase.bounds), connections: [future],
    })) }
  const futureInput: SimpleRouteJson = { ...source.futureInput,
    bounds: turnBounds(source.futureInput.bounds), obstacles, connections: [future] }
  const via = turn(source.via)
  const witness = { ...source.witness, path: source.witness.path.map(turn),
    via: { point: via, layers: [...source.witness.via!.layers] } }
  return { ...source, input, futureInput, future, candidate, control, via, witness,
    opening: turnBounds(source.opening), admissibleViaCenters: turnBounds(source.admissibleViaCenters) }
}
