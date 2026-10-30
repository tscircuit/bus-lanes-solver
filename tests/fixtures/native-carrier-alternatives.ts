import { offsetNativePair } from "./offset-native-pair"

/** The data signal can meet the pair's bus target on bottom. The existing
 * inner1 copper wall makes its inner1 detour exceed that target. */
export function nativeCarrierAlternatives() {
  const input = offsetNativePair()
  for (const connection of input.connections)
    connection.pointsToConnect[1].y -= 2
  for (const obstacle of input.obstacles)
    if (obstacle.componentId === "package_1") obstacle.center.y -= 2
  input.allowedLayers = ["top", "inner1", "bottom"]
  input.connections.push({
    name: "DQ",
    pointsToConnect: [
      { x: -6, y: 3, layer: "top" },
      { x: 6, y: 3, layer: "top" },
    ],
  })
  for (const [index, point] of input.connections[2].pointsToConnect.entries())
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: `package_${index}`,
      center: { x: point.x, y: point.y },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["DQ"],
    })
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 2.5 },
    width: 1,
    height: 5,
    layers: ["inner1"],
    connectedTo: ["immutable_wall"],
  })
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 10,
    layers: ["top"],
    connectedTo: ["immutable_surface_wall"],
  })
  input.buses = [
    {
      busId: "byte",
      connectionNames: ["P", "N", "DQ"],
      maxLengthSkew: 1,
      allowedLayers: ["top", "inner1", "bottom"],
    },
  ]
  return {
    input,
    options: {
      maxRoutingTimeMs: 10000,
      singleCarrier: {
        carrierLayer: "inner1",
        ordinaryCarrierLayers: ["inner1", "bottom"],
        centerlines: [
          [
            { x: -5.6, y: -1 },
            { x: 5.6, y: -1 },
          ],
        ],
        busTargetLength: 12,
      },
    },
  }
}
