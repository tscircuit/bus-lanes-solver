import {
  applyToPoint,
  compose,
  inverse,
  rotateDEG,
  translate,
} from "transformation-matrix"
import type { Connection, Point, SimpleRouteJson } from "./types"

/** A same-net pad is transparent to copper clearance, but not to a drill. */
export function createViaPadHoleClearanceChecker({
  input,
  connection,
}: {
  input: SimpleRouteJson
  connection: Connection
}): (point: Point) => boolean {
  const ownPads = input.obstacles
    .filter(
      (pad) =>
        input.allowViaInPad !== true &&
        pad.componentId &&
        (pad.connectedTo.includes(connection.name) ||
          pad.connectedTo.includes(
            connection.source_trace_id ?? connection.name,
          ) ||
          connection.pointsToConnect.some(
            (point) =>
              point.pcb_port_id && pad.connectedTo.includes(point.pcb_port_id),
          )),
    )
    .map((pad) => ({
      pad,
      boardToPad: inverse(
        compose(
          translate(pad.center.x, pad.center.y),
          rotateDEG(pad.ccwRotationDegrees ?? 0),
        ),
      ),
    }))
  const holeRadius = (input.minViaHoleDiameter ?? 0.15) / 2
  return (point: Point): boolean =>
    ownPads.every(({ pad, boardToPad }): boolean => {
      const local = applyToPoint(boardToPad, point)
      let gap = Math.hypot(
        Math.max(0, Math.abs(local.x) - pad.width / 2),
        Math.max(0, Math.abs(local.y) - pad.height / 2),
      )
      if (pad.shape === "circle")
        gap = Math.hypot(local.x, local.y) - pad.width / 2
      return gap >= holeRadius + 1e-5
    })
}
