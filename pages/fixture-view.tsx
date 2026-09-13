import { useState, useEffect } from "react"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BusLanesSolver, type SimpleRouteJson } from "../lib"
export function FixtureView({
  input,
  title,
  description,
  metadata,
}: {
  input: SimpleRouteJson
  title: string
  description: string
  metadata?: {
    socRegion: SimpleRouteJson["bounds"]
    ramRegion: SimpleRouteJson["bounds"]
  }
}) {
  const [step, setStep] = useState(0)
  return (
    <main style={{ fontFamily: "system-ui", padding: 20, color: "#0f172a" }}>
      <header
        style={{
          borderBottom: "1px solid #cbd5e1",
          paddingBottom: 16,
          marginBottom: 16,
        }}
      >
        <small style={{ letterSpacing: 2 }}>TSCIRCUIT / BUS LANES</small>
        <h1>{title}</h1>
        <p style={{ maxWidth: 1000, lineHeight: 1.6 }}>{description}</p>
        <p>
          Blue: source terminals · Amber: fixed destinations · Cyan: search
          frontier · Pink: current candidate · Colored lines: committed lanes
        </p>
        <label>
          Grid resolution{" "}
          <select
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          >
            <option value={0}>Automatic (0.10 → 0.025 mm)</option>
            <option value={0.1}>0.10 mm</option>
            <option value={0.05}>0.05 mm</option>
            <option value={0.025}>0.025 mm</option>
          </select>
        </label>
      </header>
      <GenericSolverDebugger
        key={step}
        createSolver={() => {
          const solver = new BusLanesSolver(input, {
            gridStep: step || undefined,
          })
          if (metadata) {
            const visualize = solver.visualize.bind(solver)
            solver.visualize = () => {
              const graphics = visualize()
              return {
                ...graphics,
                rects: [
                  ...(graphics.rects ?? []),
                  ...(["socRegion", "ramRegion"] as const).map((key, i) => {
                    const b = metadata[key]
                    return {
                      center: {
                        x: (b.minX + b.maxX) / 2,
                        y: (b.minY + b.maxY) / 2,
                      },
                      width: b.maxX - b.minX,
                      height: b.maxY - b.minY,
                      fill: "transparent",
                      stroke: i ? "#9333ea" : "#2563eb",
                      label: i ? "RAM fanout" : "SoC fanout",
                    }
                  }),
                ],
              }
            }
          }
          return solver
        }}
      />
    </main>
  )
}

export function FixtureLoader({
  url,
  metadataUrl,
  title,
  description,
}: {
  url: string
  metadataUrl?: string
  title: string
  description: string
}) {
  const [input, setInput] = useState<SimpleRouteJson>()
  const [metadata, setMetadata] = useState<{
    socRegion: SimpleRouteJson["bounds"]
    ramRegion: SimpleRouteJson["bounds"]
  }>()
  const [error, setError] = useState("")
  useEffect(() => {
    setInput(undefined)
    setMetadata(undefined)
    Promise.all([
      fetch(url).then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`)
        return r.json()
      }),
      metadataUrl
        ? fetch(metadataUrl).then((r) => r.json())
        : Promise.resolve(undefined),
    ])
      .then(([input, meta]) => {
        setInput(input)
        setMetadata(meta)
      })
      .catch((e) => setError(String(e)))
  }, [url, metadataUrl])
  return input ? (
    <FixtureView
      input={input}
      title={title}
      description={description}
      metadata={metadata}
    />
  ) : (
    <p>{error || "Loading captured routing problem…"}</p>
  )
}
