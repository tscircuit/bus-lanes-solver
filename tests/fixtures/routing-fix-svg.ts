import { expect } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesSolver, type SimpleRouteJson, type Trace } from "../../lib"
import { busLengthReports, pairLengthReports } from "../../lib/route-lengths"
import { exteriorPairSpacingReports } from "../../lib/exterior-pair-spacing"

type SnapshotSolver = {
  solved: boolean
  failed: boolean
  error: string | null
  traces: Trace[]
  getOutput(): SimpleRouteJson
}
type NativeInput = Parameters<
  typeof validateOriginalEndpointConnectivity
>[0]["inputSrj"]

/** Use the repository's existing copper visualizer and graphics-debug renderer.
 * A baseline failure is included only for the explicitly requested before/after
 * comparison; it is labelled unaccepted and never shows partial search copper. */
export function routingFixSvg(
  input: SimpleRouteJson,
  traces: Trace[],
  title: string,
  status: string,
  details: string[],
) {
  const graphics = new BusLanesSolver({
    ...input,
    traces: [...(input.traces ?? []), ...traces],
  }).visualize()
  const { minX, maxX, minY, maxY } = input.bounds
  const width = maxX - minX
  const outline = input.outline ?? [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
  graphics.coordinateSystem = "cartesian"
  graphics.title = title
  graphics.lines!.push({
    points: [...outline, outline[0]],
    strokeColor: "#64748b",
    strokeWidth: 0.04,
  })
  graphics.texts = [title, status, ...details].map((text, i) => ({
    x: minX,
    y: maxY + 2 - i * 0.5,
    text,
    fontSize: Math.min(width / 65, width / Math.max(text.length, 1)),
    color: i === 1 ? (traces.length ? "#166534" : "#b91c1c") : "#334155",
    anchorSide: "bottom_left" as const,
  }))
  const svg = getSvgFromGraphicsObject(graphics, {
    includeTextLabels: false,
    backgroundColor: "white",
    svgWidth: 1100,
    svgHeight: Math.round((1100 * (maxY - minY + 3)) / width),
  }).replace(/[ \t]+$/gm, "")
  return { graphics, svg }
}

export function acceptedRoutingFixSvg(
  input: SimpleRouteJson,
  solver: SnapshotSolver,
  title: string,
) {
  if (!solver.solved || solver.failed)
    throw Error("Refusing an after snapshot of unsuccessful routing")
  const output = solver.getOutput()
  const native = {
    inputSrj: input as NativeInput,
    routedSrj: output as NativeInput,
  }
  const connectivity = validateOriginalEndpointConnectivity(native)
  const drc = validateRoutedCopperDrc({
    ...native,
    clearance:
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075,
  })
  const buses = busLengthReports(input, solver.traces)
  const pairs = pairLengthReports(input, solver.traces)
  const coupling = exteriorPairSpacingReports(input, solver.traces)
  if (
    !connectivity.valid ||
    connectivity.connectedConnectionCount !== input.connections.length ||
    !drc.valid ||
    !buses.every(
      (r) => r.matched && r.aboveMinimumLength && r.withinLengthLimit,
    ) ||
    !pairs.every((r) => r.matched) ||
    !coupling.every((r) => r.matched)
  )
    throw Error(
      "Refusing an after snapshot without connectivity, copper DRC, matching and coupling",
    )
  const skew = pairs.length
    ? ` | pair skew ${Math.max(...pairs.map((p) => p.skewMm ?? 0)).toFixed(4)} mm`
    : ""
  return {
    ...routingFixSvg(
      input,
      solver.traces,
      title,
      `AFTER: ${connectivity.connectedConnectionCount}/${input.connections.length} connected | copper DRC passed`,
      [
        `${input.minBoardEdgeClearance ?? 0} mm edge clearance | ${input.minTraceWidth} mm trace width`,
        `${buses.length} bus / ${pairs.length} pair constraints passed${skew}`,
      ],
    ),
    validation: { connectivity, drc, buses, pairs, coupling },
  }
}

export function expectRoutingFixSnapshot(
  name: string,
  input: SimpleRouteJson,
  solver: SnapshotSolver,
  title: string,
) {
  const { svg } = acceptedRoutingFixSvg(input, solver, title)
  const file = new URL(
    `../../docs/routing-fixes/${name}/after.snap.svg`,
    import.meta.url,
  )
  if (process.env.BUN_UPDATE_SNAPSHOTS === "1") writeFileSync(file, svg)
  expect(svg).toBe(readFileSync(file, "utf8"))
}
