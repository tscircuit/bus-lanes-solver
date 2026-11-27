import type { Obstacle, Point, SimpleRouteJson } from "./types"

type PackageRoutingGrid = { step: number; origin: Point }

/** Align a uniform raster to a regular package's pads and half-pitch channels.
 * Board-world points are mm, +X right and +Y up. Board bounds do not determine
 * which narrow passages between existing barrels receive raster samples. */
export function getPackageRoutingGrid(
  input: SimpleRouteJson,
  maximumStep: number,
): PackageRoutingGrid | undefined {
  const padsByComponent = new Map<NonNullable<Obstacle["componentId"]>, Obstacle[]>()
  for (const pad of input.obstacles) {
    if (!pad.componentId) continue
    const pads = padsByComponent.get(pad.componentId) ?? []
    pads.push(pad)
    padsByComponent.set(pad.componentId, pads)
  }
  const pads = [...padsByComponent.values()].sort((a, b) => b.length - a.length)[0]
  if (!pads || pads.length < 4) return undefined
  const coordinates = (axis: "x" | "y") =>
    pads.map((pad) => pad.center[axis]).sort((a, b) => a - b)
      .filter((value, index, sorted) => index === 0 || value - sorted[index - 1] > 1e-6)
  const xs = coordinates("x"), ys = coordinates("y")
  if (xs.length < 2 || ys.length < 2) return undefined
  const pitch = Math.min(
    ...xs.slice(1).map((value, index) => value - xs[index]),
    ...ys.slice(1).map((value, index) => value - ys[index]),
  )
  const onLattice = (values: number[]) => values.every((value) =>
    Math.abs((value - values[0]) / pitch - Math.round((value - values[0]) / pitch)) < 1e-6,
  )
  if (!onLattice(xs) || !onLattice(ys)) return undefined
  // Align the raster to fixed fanout channels only when the existing barrels
  // inside this package share its half-pitch lattice. Imported, rounded fanouts
  // keep their established raster rather than changing their routing topology.
  const barrels = (input.traces ?? []).flatMap((trace) => trace.route).filter((point) =>
    point.route_type === "via" && point.x >= xs[0] && point.x <= xs.at(-1)! &&
    point.y >= ys[0] && point.y <= ys.at(-1)!,
  )
  if (barrels.some((point) =>
    Math.abs((point.x - xs[0]) / (pitch / 2) - Math.round((point.x - xs[0]) / (pitch / 2))) > 1e-6 ||
    Math.abs((point.y - ys[0]) / (pitch / 2) - Math.round((point.y - ys[0]) / (pitch / 2))) > 1e-6,
  )) return undefined
  const divisions = 2 * Math.ceil(pitch / maximumStep / 2)
  const step = pitch / divisions
  // Keep the established raster when its resolution already fits the half-pitch.
  if (step < 0.01 || Math.abs(step - maximumStep) < 1e-9) return undefined
  return { step, origin: { x: xs[0], y: ys[0] } }
}
