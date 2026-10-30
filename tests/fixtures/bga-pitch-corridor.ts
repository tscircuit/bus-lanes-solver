import { denseBgaViaGrid } from "./dense-bga-via-grid"

/** A 0.5 mm BGA crosses two interstices before reaching its only via pocket.
 * Immutable inner4 copper leaves a 0.47 mm aperture for a 0.28 mm
 * through-via with 0.089 mm clearance. TOP channels remain 0.003 mm wide. */
export function bgaPitchCorridor() {
  const { input, options } = denseBgaViaGrid()
  input.bounds.maxY = 15
  input.bounds.maxX = 12
  input.connections.push({
    name: "DQ",
    pointsToConnect: [
      { x: 0, y: 10, layer: "top" },
      { x: 8, y: 10, layer: "top" },
    ],
  })
  for (const x of [-1, -0.5, 0, 0.5, 1, 1.5])
    for (const y of [9.5, 10, 10.5])
      input.obstacles.push({
        type: "rect",
        shape: "circle",
        componentId: "dense_dq",
        center: { x, y },
        width: 0.23,
        height: 0.23,
        layers: ["top"],
        connectedTo: x === 0 && y === 10 ? ["DQ"] : [`land_${x}_${y}`],
      })
  for (const x of [-0.25, 0.25])
    for (const y of [9.75, 10.25])
      input.obstacles.push({
        type: "rect",
        shape: "circle",
        center: { x, y },
        width: 0.23,
        height: 0.23,
        layers: ["inner1"],
        connectedTo: ["blocker"],
      })
  input.obstacles.push({
    type: "rect",
    shape: "circle",
    componentId: "dq_target",
    center: { x: 8, y: 10 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: ["DQ"],
  })
  const gap = {
    minX: 0.75 - 0.235,
    maxX: 0.75 + 0.235,
    minY: 9.75 - 0.235,
    maxY: 9.75 + 0.235,
  }
  for (const b of [
    { minX: -4, maxX: gap.minX, minY: 6.5, maxY: 14 },
    { minX: gap.maxX, maxX: 4.5, minY: 6.5, maxY: 14 },
    { minX: gap.minX, maxX: gap.maxX, minY: 6.5, maxY: gap.minY },
    { minX: gap.minX, maxX: gap.maxX, minY: gap.maxY, maxY: 14 },
  ])
    input.obstacles.push({
      type: "rect",
      center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
      layers: ["inner4"],
      connectedTo: ["immutable_plane"],
    })
  options.maxRoutingTimeMs = 30000
  return { input, options }
}
