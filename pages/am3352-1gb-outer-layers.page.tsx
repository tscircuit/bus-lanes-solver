import { useEffect, useState } from "react"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import type { GraphicsObject } from "graphics-debug"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import packageJson from "../package.json"
import metadata from "../tests/fixtures/am3352-1gb-outer-layers/metadata.json"

const inputUrl = new URL(
  "../tests/fixtures/am3352-1gb-outer-layers/input.simple-route.json.gz",
  import.meta.url,
).href

async function loadBrowserInput(signal: AbortSignal): Promise<SimpleRouteJson> {
  const response = await fetch(inputUrl, { signal })
  if (!response.ok || !response.body)
    throw Error(`Could not load the captured input (HTTP ${response.status})`)
  const bytes = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  if (sha256 !== metadata.inputSha256)
    throw Error("Captured input SHA-256 does not match the recorded case")
  return JSON.parse(new TextDecoder().decode(bytes)) as SimpleRouteJson
}

/** Input-only geometry in board-world mm (+X right, +Y up). These pads and
 * dashed connections show the problem, never accepted or provisional copper. */
function inputDiagnostic(input: SimpleRouteJson): GraphicsObject {
  const signalNames = metadata.signalNames as Record<string, string>
  return {
    title:
      "Input diagnostic: 420 pads and 50 unrouted connections; no accepted routes",
    coordinateSystem: "cartesian",
    rects: [
      {
        center: {
          x: (input.bounds.minX + input.bounds.maxX) / 2,
          y: (input.bounds.minY + input.bounds.maxY) / 2,
        },
        width: input.bounds.maxX - input.bounds.minX,
        height: input.bounds.maxY - input.bounds.minY,
        fill: "transparent",
        stroke: "#64748b",
        label: "Board bounds / input only",
      },
    ],
    circles: input.obstacles.map((pad) => ({
      center: pad.center,
      radius: pad.width / 2,
      layer: pad.layers[0],
      fill: "#ef4444",
      stroke: "#991b1b",
    })),
    lines: input.connections.map((connection) => ({
      points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
      strokeColor: "#64748b80",
      strokeWidth: 0.025,
      strokeDash: [0.3, 0.2],
      layer: "unrouted_connections",
      label: `${signalNames[connection.name]} / unrouted connection`,
    })),
  }
}

function Am3352OneGbOuterLayersPage() {
  const [input, setInput] = useState<SimpleRouteJson>()
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    loadBrowserInput(controller.signal)
      .then((captured) => {
        if (!controller.signal.aborted) setInput(captured)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [])

  return (
    <main style={{ fontFamily: "system-ui", padding: 20, color: "#0f172a" }}>
      <header style={{ maxWidth: 1050 }}>
        <h1>AM3352 / 1 GB DDR3 / outer-layer repro</h1>
        <p>
          Exact captured input: 50 signals, 420 package pads, four physical
          layers. Signals use top/bottom only; through vias are 0.45 mm pad /
          0.25 mm drill. Signal geometry only: power fanouts, decoupling and
          reference pours are absent.
        </p>
        <p>
          The recorded 0.0.35 bundle reached four-minute and twenty-minute
          limits during shared-layer search, with no accepted routes or reported
          solver error. This debugger runs the current source checkout (package{" "}
          {packageJson.version}); those observations do not establish its
          result.
        </p>
        <p>
          Use the debugger controls to step or run. When native visualization is
          empty, the view shows input pads and dashed unrouted connections.
          Candidate geometry is provisional until the solver reports success.
        </p>
        <details style={{ marginBottom: 12 }}>
          <summary>Verified input SHA-256</summary>
          <code style={{ overflowWrap: "anywhere" }}>
            {metadata.inputSha256}
          </code>
        </details>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : input ? (
        <GenericSolverDebugger
          createSolver={() => {
            const fallback = inputDiagnostic(input)
            const solver = new BusLanesPipelineSolver(structuredClone(input), {
              goal: "matched",
            })
            const visualize = solver.visualize.bind(solver)
            solver.visualize = () => {
              const graphics = visualize()
              return [
                graphics.lines,
                graphics.points,
                graphics.rects,
                graphics.circles,
                graphics.polygons,
                graphics.arrows,
              ].some((primitives) => primitives?.length)
                ? graphics
                : fallback
            }
            return solver
          }}
        />
      ) : (
        <p>Loading and verifying the captured input…</p>
      )}
    </main>
  )
}

export default <Am3352OneGbOuterLayersPage />
