import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import type { SimpleRouteJson, Trace } from "../lib/types"
import {
  COUPLED_OFFSET_SAMPLE_NAME,
  validateCoupledOffsetShorteningSample,
} from "./coupled-offset-shortening-sample"

interface SnapshotCandidate {
  sample: string
  solved: boolean
  failed: boolean
  error: string | null
  input: SimpleRouteJson
  traces: Trace[]
  output: SimpleRouteJson
}

/** Only completed native worker output can become a review image. */
export function validateCoupledOffsetSnapshot(candidate: SnapshotCandidate) {
  if (
    candidate.sample !== COUPLED_OFFSET_SAMPLE_NAME ||
    candidate.solved !== true ||
    candidate.failed !== false ||
    candidate.error !== null
  )
    throw Error("Refusing incomplete coupled-offset routing")
  const validation = validateCoupledOffsetShorteningSample(
    candidate.input,
    candidate.traces,
  )
  if (
    !validation.valid ||
    !validation.complete ||
    !validation.matched ||
    !validation.combinedDrc?.valid
  )
    throw Error(
      "Refusing coupled-offset copper without connectivity, DRC and matching",
    )
  if (
    JSON.stringify(candidate.output.traces) !==
      JSON.stringify(candidate.traces) ||
    JSON.stringify({ ...candidate.output, traces: undefined }) !==
      JSON.stringify({ ...candidate.input, traces: undefined })
  )
    throw Error(
      "Snapshot output differs from the original input or native traces",
    )
  return validation
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2)
  if (!source || !destination)
    throw Error(
      "Usage: snapshot-coupled-offset-shortening.ts completed-worker-route.json output-directory",
    )
  const candidate: SnapshotCandidate = await Bun.file(source).json()
  const validation = validateCoupledOffsetSnapshot(candidate)
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: "coupled-offset-shortening · 2/2 signals · DRC and matching passed",
    lines: [],
    circles: [],
    // Reserve space around the annotations in both native renderers.
    rects: [
      {
        center: { x: 39.2, y: -15 },
        width: 2.7,
        height: 2,
        fill: "none",
        stroke: "none",
      },
    ],
    texts: [],
  }
  for (const [i, trace] of candidate.traces.entries()) {
    const color = i === 0 ? "#ed8484" : "#80c4fb"
    for (let j = 1; j < trace.route.length; j++)
      graphics.lines!.push({
        points: [trace.route[j - 1], trace.route[j]],
        strokeWidth: 0.1,
        strokeColor: color,
      })
    for (const point of [trace.route[0], trace.route.at(-1)!])
      graphics.circles!.push({
        center: point,
        radius: 0.06,
        fill: color,
        stroke: "none",
      })
    graphics.texts!.push({
      x: trace.route[0].x - 0.1,
      y: trace.route[0].y,
      text: trace.connection_name!,
      fontSize: 0.1,
      color,
      anchorSide: "center_right",
    })
  }
  graphics.texts!.push({
    x: 38.4,
    y: -14.35,
    text: "2/2 signals; DRC + matching passed",
    fontSize: 0.065,
    color: "#ffffff",
    anchorSide: "bottom_left",
  })
  const skew = validation.pairLengths[0].skewMm
  if (skew === null) throw Error("Missing validated pair skew")
  graphics.texts!.push({
    x: 38.4,
    y: -15.65,
    text: `Pair skew: ${skew.toFixed(6)} / 0.127 mm`,
    fontSize: 0.065,
    color: "#ffffff",
    anchorSide: "top_left",
  })
  const png = await getPngBufferFromGraphicsObject(graphics, {
    pngWidth: 1600,
    pngHeight: 1000,
    yFlip: true,
    includeTextLabels: false,
    backgroundColor: "#10151b",
  })
  const svg = getSvgFromGraphicsObject(graphics, {
    svgWidth: 1600,
    svgHeight: 1000,
    includeTextLabels: false,
    backgroundColor: "#10151b",
  }).replace(/[ \t]+$/gm, "")
  await mkdir(destination, { recursive: true })
  await Bun.write(
    join(destination, `${COUPLED_OFFSET_SAMPLE_NAME}-solved.png`),
    png,
  )
  await Bun.write(
    join(destination, `${COUPLED_OFFSET_SAMPLE_NAME}-solved.svg`),
    svg,
  )
}
