import type { Connection } from "./types"

/** Board XY, +Y up. Sweep terminal fields in both winding directions, then
 * rotate the sweep seam. Like fanout-solver's iterateUniqueRouteOrders, retain
 * deterministic alternatives: a greedy route can cut off a later terminal. */
export function windingOrders(connections: Connection[]): Connection[][] {
  const orders: Connection[][] = []
  const seen = new Set<string>()
  const add = (order: Connection[]) => {
    const key = order.map((c) => c.name).join("\0")
    if (!seen.has(key)) {
      seen.add(key)
      orders.push(order)
    }
  }
  // Sweep perpendicular to the channel direction, independently on each layer.
  // This preserves the boundary winding of facing terminal fields before
  // considering alternate seams for less regular geometries.
  const direction = connections.reduce(
    (v, c) => ({
      x: v.x + c.pointsToConnect[1].x - c.pointsToConnect[0].x,
      y: v.y + c.pointsToConnect[1].y - c.pointsToConnect[0].y,
    }),
    { x: 0, y: 0 },
  )
  const transverse = (c: Connection) =>
    -direction.y * c.pointsToConnect[0].x + direction.x * c.pointsToConnect[0].y
  const sweep = [...connections].sort(
    (a, b) =>
      a.pointsToConnect[0].layer.localeCompare(b.pointsToConnect[0].layer) ||
      transverse(a) - transverse(b) ||
      a.name.localeCompare(b.name),
  )
  add(sweep)
  add([...sweep].reverse())
  add(connections)
  for (const endpoint of [1, 0]) {
    const center = connections.reduce(
      (p, c) => ({
        x: p.x + c.pointsToConnect[endpoint].x / connections.length,
        y: p.y + c.pointsToConnect[endpoint].y / connections.length,
      }),
      { x: 0, y: 0 },
    )
    const angle = (c: Connection) =>
      Math.atan2(
        c.pointsToConnect[endpoint].y - center.y,
        c.pointsToConnect[endpoint].x - center.x,
      )
    const angular = [...connections].sort(
      (a, b) => angle(a) - angle(b) || a.name.localeCompare(b.name),
    )
    add(angular)
    add([...angular].reverse())
    for (const axis of ["x", "y"] as const) {
      const other = axis === "x" ? "y" : "x"
      const sorted = [...connections].sort(
        (a, b) =>
          a.pointsToConnect[endpoint][axis] -
            b.pointsToConnect[endpoint][axis] ||
          a.pointsToConnect[endpoint][other] -
            b.pointsToConnect[endpoint][other],
      )
      add(sorted)
      add([...sorted].reverse())
    }
    for (let i = 1; i < angular.length; i++) {
      const rotated = [...angular.slice(i), ...angular.slice(0, i)]
      add(rotated)
      add([...rotated].reverse())
    }
  }
  return orders
}
