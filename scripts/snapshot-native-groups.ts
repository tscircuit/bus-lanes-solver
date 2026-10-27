import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { dirname, resolve } from "node:path"
import { createHash } from "node:crypto"
import {
  getPngBufferFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import { loadNativeGroupFixture } from "./native-group-fixtures"
import { validateNativeGroups } from "./validate-native-groups"
import type { Trace } from "../lib/types"

// Revalidate a successful fresh benchmark output before exporting any image.
// Board-world millimetres, +X right and +Y up; each panel is a translated view.
const directory = resolve(process.argv[2])
const destination = resolve(process.argv[3])
const report = JSON.parse(readFileSync(`${directory}/report.json`, "utf8"))
if (
  report.status !== "solved" ||
  !report.inputUnchanged ||
  !report.validation?.valid
)
  throw Error("Refusing a failed, partial or unvalidated routing snapshot")
const { input, native } = loadNativeGroupFixture(report.sample)
if (
  createHash("sha256").update(JSON.stringify(input)).digest("hex") !==
  report.inputSha256
)
  throw Error("Benchmark input does not match the snapshot fixture")
const traces: Trace[] = JSON.parse(
  gunzipSync(readFileSync(`${directory}/routes.json.gz`)).toString(),
)
if (!(await validateNativeGroups(input, native, traces)).valid)
  throw Error("Snapshot route no longer passes independent acceptance")
const points = traces.flatMap((t) => t.route)
const minX = Math.min(...points.map((p) => p.x)) - 1
const maxX = Math.max(...points.map((p) => p.x)) + 1
const minY = Math.min(...points.map((p) => p.y)) - 1
const maxY = Math.max(...points.map((p) => p.y)) + 1
const width = maxX - minX,
  height = maxY - minY,
  gap = 3
const graphics: GraphicsObject = {
  coordinateSystem: "cartesian",
  lines: [],
  circles: [],
  rects: [],
  texts: [],
  title: `${report.sample}: 47/47 DDR; connectivity, DRC, timing and coupling passed`,
}
const colors = ["#e99567", "#67c8a0", "#77baff", "#d59cf0"]
for (const [i, layer] of ["top", "inner2", "inner3", "bottom"].entries()) {
  const dx = i * (width + gap)
  graphics.rects!.push({
    center: { x: (minX + maxX) / 2 + dx, y: (minY + maxY) / 2 },
    width,
    height,
    fill: "none",
    stroke: "#536779",
  })
  for (const obstacle of input.obstacles.filter(
    (o) =>
      o.center.x >= minX &&
      o.center.x <= maxX &&
      o.center.y >= minY &&
      o.center.y <= maxY &&
      o.layers.includes(layer),
  )) {
    const center = { x: obstacle.center.x + dx, y: obstacle.center.y }
    if (obstacle.shape === "circle")
      graphics.circles!.push({
        center,
        radius: obstacle.width / 2,
        fill: "#505d6c",
        stroke: "none",
      })
    else
      graphics.rects!.push({
        center,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        fill: "#505d6c",
        stroke: "none",
      })
  }
  for (const trace of traces) {
    for (let j = 1; j < trace.route.length; j++) {
      const a = trace.route[j - 1],
        b = trace.route[j]
      const routeLayer =
        a.route_type === "wire"
          ? a.layer
          : b.route_type === "wire"
            ? b.layer
            : undefined
      if (
        routeLayer === layer &&
        (a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer === b.layer)
      )
        graphics.lines!.push({
          points: [
            { x: a.x + dx, y: a.y },
            { x: b.x + dx, y: b.y },
          ],
          strokeColor: colors[i],
          strokeWidth:
            a.route_type === "wire"
              ? a.width
              : b.route_type === "wire"
                ? b.width
                : input.minTraceWidth,
        })
    }
    for (const p of trace.route)
      if (p.route_type === "via") {
        // Through vias cross all six layers, including the two ground layers.
        graphics.circles!.push({
          center: { x: p.x + dx, y: p.y },
          radius: (p.via_diameter ?? input.minViaPadDiameter!) / 2,
          fill: colors[i],
          stroke: "none",
        })
        graphics.circles!.push({
          center: { x: p.x + dx, y: p.y },
          radius: (p.via_hole_diameter ?? input.minViaHoleDiameter!) / 2,
          fill: "#10151b",
          stroke: "none",
        })
      }
  }
  graphics.texts!.push({
    x: minX + dx,
    y: maxY + 0.8,
    text: layer,
    fontSize: 0.9,
    color: colors[i],
    anchorSide: "bottom_left",
  })
}
graphics.texts!.push({
  x: minX,
  y: maxY + 2.6,
  text: `${report.sample} | 47/47 DDR connected | ${Math.round(report.solveMilliseconds / 1000)} s fresh solve`,
  fontSize: 0.9,
  color: "#e5edf5",
  anchorSide: "bottom_left",
})
graphics.texts!.push({
  x: minX,
  y: minY - 1.0,
  text: "Six layers; inner1/inner4 reserved for ground. 0.10 mm tracks; 0.30/0.15 mm vias.",
  fontSize: 0.65,
  color: "#b5c3d0",
  anchorSide: "top_left",
})
graphics.texts!.push({
  x: minX,
  y: minY - 2.3,
  text: "DDR area shown. Peripheral and power nets are not routed by this benchmark.",
  fontSize: 0.65,
  color: "#b5c3d0",
  anchorSide: "top_left",
})
const png = await getPngBufferFromGraphicsObject(graphics, {
  pngWidth: 2600,
  pngHeight: Math.round((2600 * (height + 7)) / (4 * width + 3 * gap)),
  yFlip: true,
  backgroundColor: "#10151b",
  includeTextLabels: false,
})
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, png)
console.log(
  JSON.stringify({
    destination,
    bytes: png.length,
    validatedConnections: traces.length,
  }),
)
