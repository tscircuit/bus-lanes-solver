import type { Connection, Point, SimpleRouteJson } from "./types"

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
  return (p: Point): boolean =>
    ownPads.every((o) => {
      const angle = (-(o.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const dx = p.x - o.center.x,
        dy = p.y - o.center.y
      const x = dx * Math.cos(angle) - dy * Math.sin(angle),
        y = dx * Math.sin(angle) + dy * Math.cos(angle)
      const distance =
        o.shape === "circle"
          ? Math.hypot(dx, dy) - o.width / 2
          : Math.hypot(
              Math.max(0, Math.abs(x) - o.width / 2),
              Math.max(0, Math.abs(y) - o.height / 2),
            )
      return distance >= holeRadius + 1e-5
    })
}
