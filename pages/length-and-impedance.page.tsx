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
      maxLengthSkew: 0.01,
      targetImpedance: 50,
      impedanceProfile: {
        layer: "top",
        points: [
          { traceWidth: 0.1, impedance: 60 },
          { traceWidth: 0.2, impedance: 40 },
        ],
      },
    },
  ],
}
export default (
  <FixtureView
    input={input}
    title="Length and impedance constraints"
    description="Synthetic profile demonstration: a 50 Ω target interpolates a 0.15 mm width from the supplied sample table; both lanes tune to 10 mm within 0.01 mm. The example table is not a fabrication stackup specification."
  />
)
