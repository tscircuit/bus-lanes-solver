import type { SimpleRouteJson, Trace, Wire, Point } from "./types"
import { VectorScene, fixedCopper, routeCopper } from "./vector-scene"
import { simplify } from "./geometry"
/** Open a central tuning corridor without changing the fixed handoff points. */
export function spreadTuningLanes(
  input: SimpleRouteJson,
  traces: Trace[],
  pitch: number,
): Trace[] | null {
  const dx = traces.reduce((s, t) => s + t.route.at(-1)!.x - t.route[0].x, 0)
  const dy = traces.reduce((s, t) => s + t.route.at(-1)!.y - t.route[0].y, 0)
  const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
    ux = Math.cos(angle),
    uy = Math.sin(angle)
  const uv = (p: Point) => ({ u: p.x * ux + p.y * uy, v: -p.x * uy + p.y * ux })
  const xy = (u: number, v: number) => ({
    x: u * ux - v * uy,
    y: u * uy + v * ux,
  })
  const result: Trace[] = []
  for (const layer of new Set(traces.map((t) => (t.route[0] as Wire).layer))) {
    const group = traces
      .filter((t) => (t.route[0] as Wire).layer === layer)
      .sort((a, b) => uv(a.route[0]).v - uv(b.route[0]).v)
    const center =
      group.reduce(
        (s, t) => s + (uv(t.route[0]).v + uv(t.route.at(-1)!).v) / 2,
        0,
      ) / group.length
    for (const [index, t] of group.entries()) {
      const a = uv(t.route[0]),
        b = uv(t.route.at(-1)!),
        v = center + (index - (group.length - 1) / 2) * pitch
      const da = Math.abs(v - a.v),
        db = Math.abs(v - b.v),
        space = b.u - a.u - da - db
      if (space < 1) return null
      const lead = space * 0.15
      const points = simplify([
        xy(a.u, a.v),
        xy(a.u + lead, a.v),
        xy(a.u + lead + da, v),
        xy(b.u - lead - db, v),
        xy(b.u - lead, b.v),
        xy(b.u, b.v),
      ])
      result.push({
        ...t,
        route: points.map((p) => ({
          ...p,
          route_type: "wire",
          layer,
          width: (t.route[0] as Wire).width,
        })),
      })
    }
  }
  const copper = [...fixedCopper(input), ...result.flatMap(routeCopper)]
  for (const t of result) {
    const c = input.connections.find((c) => c.name === t.connection_name)!
    if (
      !new VectorScene(
        input,
        c,
        (t.route[0] as Wire).width,
        copper,
      ).pathVisible(t.route)
    )
      return null
  }
  return traces.map(
    (t) => result.find((r) => r.connection_name === t.connection_name)!,
  )
}
