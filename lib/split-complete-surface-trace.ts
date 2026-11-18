import type { SurfaceBridgeRoute } from "./route-surface-bridge"
import type { Trace, Wire } from "./types"

interface SplitSurfaceTraceOptions {
  readonly carrierLayers?: readonly string[]
  readonly usedTraceIds?: ReadonlySet<string>
}
interface WireRun {
  start: number
  end: number
  layer: string
}

/** Re-express mutable complete copper as one planar carrier and native
 * approaches. Coordinates, widths, existing barrel spans/drills and curve
 * chords are copied exactly; joining the parts reconstructs the same path. */
export function splitCompleteSurfaceTrace(
  trace: Trace,
  options: SplitSurfaceTraceOptions = {},
): SurfaceBridgeRoute {
  const copy = structuredClone(trace)
  const { route } = copy
  if (
    route.length < 2 ||
    route[0].route_type !== "wire" ||
    route.at(-1)!.route_type !== "wire"
  )
    throw Error("A complete surface trace needs native wire endpoints")
  const runs: WireRun[] = []
  let start = 0
  for (let index = 0; index < route.length; index++) {
    const point = route[index]
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw Error("Trace coordinates must be finite")
    if (point.route_type === "wire") {
      if (!Number.isFinite(point.width) || point.width <= 0)
        throw Error("Wire widths must be positive and finite")
      if (
        index &&
        route[index - 1].route_type === "wire" &&
        (route[index - 1] as Wire).layer !== point.layer
      )
        throw Error("A wire changes layer without a via")
      continue
    }
    if (point.from_layer === point.to_layer)
      throw Error("A mutable native via must change its logical routing layer")
    const before = route[index - 1]
    const after = route[index + 1]
    if (
      !before ||
      !after ||
      before.route_type !== "wire" ||
      after.route_type !== "wire" ||
      before.layer !== point.from_layer ||
      after.layer !== point.to_layer ||
      Math.hypot(before.x - point.x, before.y - point.y) > 1e-8 ||
      Math.hypot(after.x - point.x, after.y - point.y) > 1e-8
    )
      throw Error("Each via must join coincident wires on its logical layers")
    runs.push({ start, end: index - 1, layer: before.layer })
    start = index + 1
  }
  runs.push({
    start,
    end: route.length - 1,
    layer: (route.at(-1)! as Wire).layer,
  })
  for (const index of copy.curvedSegments ?? [])
    if (
      !Number.isInteger(index) ||
      index < 1 ||
      index >= route.length ||
      route[index - 1].route_type !== "wire" ||
      route[index].route_type !== "wire"
    )
      throw Error("A curve chord must join two wire vertices")
  const section = copy.coupledSection
  if (
    section &&
    (section.length !== 2 ||
      section.some((index) => !Number.isInteger(index)) ||
      section[0] < 0 ||
      section[1] < section[0] ||
      section[1] >= route.length)
  )
    throw Error("A coupled section must use ordered trace vertex indexes")
  const eligible = runs.filter(
    (run) =>
      run.end > run.start &&
      (!options.carrierLayers || options.carrierLayers.includes(run.layer)) &&
      (!section || (section[0] >= run.start && section[1] <= run.end)),
  )
  const run =
    eligible.find(
      (candidate) => candidate.start > 0 && candidate.end < route.length - 1,
    ) ?? eligible[0]
  if (!run)
    throw Error(
      "Complete trace has no planar carrier covering its coupling on a permitted layer",
    )
  if (runs.length === 1) return { carrier: copy, escapes: [] }
  const ids = new Set(options.usedTraceIds)
  ids.add(copy.pcb_trace_id)
  const allocate = (suffix: string): string => {
    const stem = `${copy.pcb_trace_id}_${suffix}`
    for (let index = 0; index <= ids.size; index++) {
      const id = index ? `${stem}_${index}` : stem
      if (!ids.has(id)) {
        ids.add(id)
        return id
      }
    }
    throw Error("Could not allocate a surface approach identifier")
  }
  const curves = copy.curvedSegments ?? []
  const prefixCurves = curves.filter((index) => index <= run.start)
  const carrierCurves = curves
    .filter((index) => index > run.start && index <= run.end)
    .map((index) => index - run.start)
  const suffixCurves = curves
    .filter((index) => index > run.end)
    .map((index) => route.length - index)
    .sort((a, b) => a - b)
  const carrier: Trace = {
    ...copy,
    route: route.slice(run.start, run.end + 1),
    curvedSegments: carrierCurves.length ? carrierCurves : undefined,
    coupledSection: section
      ? [section[0] - run.start, section[1] - run.start]
      : undefined,
  }
  const prefix: Trace = {
    ...copy,
    pcb_trace_id: allocate("source_approach"),
    route: route.slice(0, run.start + 1),
    curvedSegments: prefixCurves.length ? prefixCurves : undefined,
    coupledSection: undefined,
  }
  const suffix: Trace = {
    ...copy,
    pcb_trace_id: allocate("target_approach"),
    route: route
      .slice(run.end)
      .toReversed()
      .map((point) =>
        point.route_type === "via"
          ? { ...point, from_layer: point.to_layer, to_layer: point.from_layer }
          : point,
      ),
    curvedSegments: suffixCurves.length ? suffixCurves : undefined,
    coupledSection: undefined,
  }
  return { carrier, escapes: [prefix, suffix] }
}
