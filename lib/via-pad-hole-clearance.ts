import type { Connection, Point, SimpleRouteJson } from "./types"
import { clearanceToCopper, fixedCopper } from "./vector-scene"

/** A same-net pad is transparent to copper clearance, but not to a drill. */
export function createViaPadHoleClearanceChecker({
  input,
  connection,
}: {
  input: SimpleRouteJson
  connection: Connection
}): (point: Point) => boolean {
  // Keep its physical hole out of SMT pads unless fabrication permits it.
  const ownPads =
    input.allowViaInPad === true
      ? []
      : input.obstacles.filter(
          (o) =>
            o.componentId &&
            (o.connectedTo.includes(connection.name) ||
              o.connectedTo.includes(
                connection.source_trace_id ?? connection.name,
              ) ||
              connection.pointsToConnect.some(
                (p) => p.pcb_port_id && o.connectedTo.includes(p.pcb_port_id),
              )),
        )
  const holeRadius = (input.minViaHoleDiameter ?? 0.15) / 2
  const padCopper = fixedCopper({ ...input, obstacles: ownPads, traces: [] })
  return (point: Point): boolean =>
    padCopper.every(
      (pad) => clearanceToCopper(point, point, pad) >= holeRadius + 1e-5,
    )
}
