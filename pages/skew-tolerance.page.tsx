import { FixtureView } from "./fixture-view"
import type { SimpleRouteJson } from "../lib"
const input: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.075,
  bounds: { minX: -2, maxX: 14, minY: -5, maxY: 7 },
  obstacles: [],
  connections: [
    {
      name: "DATA0",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 10, y: 0, layer: "top" },
      ],
    },
    {
      name: "DATA1",
      pointsToConnect: [
        { x: 0, y: 3, layer: "top" },
        { x: 8, y: 3, layer: "top" },
      ],
    },
  ],
  buses: [
    {
      busId: "DATA",
      connectionNames: ["DATA0", "DATA1"],
      maxLengthSkew: 0.5,
      traceWidth: 0.15,
    },
  ],
}
export default (
  <FixtureView
    input={input}
    title="Skew tolerance"
    description="The shorter lane grows only to 9.5 mm: the requested 0.5 mm bus skew permits it to remain shorter than the 10 mm lane. Width is supplied explicitly."
  />
)
