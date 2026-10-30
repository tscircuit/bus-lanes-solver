import { nativeCarrierAlternatives } from "./native-carrier-alternatives"

/** Both data signals can individually meet the bus window on inner1, but its
 * aperture has room for only one wire. Bottom remains an original permission. */
export function nativeCarrierCongestion() {
  const { input, options } = nativeCarrierAlternatives()
  input.obstacles = input.obstacles.filter(
    (obstacle) => !obstacle.connectedTo.includes("immutable_wall"),
  )
  for (const point of input.connections[2].pointsToConnect) point.y = 2.6
  for (const obstacle of input.obstacles)
    if (obstacle.connectedTo.includes("DQ")) obstacle.center.y = 2.6
  const secondSignal = {
    name: "DQ2",
    pointsToConnect: [
      { x: -6, y: 3.4, layer: "top" },
      { x: 6, y: 3.4, layer: "top" },
    ],
  }
  input.connections.push(secondSignal)
  input.buses![0].connectionNames.push(secondSignal.name)
  for (const [index, point] of secondSignal.pointsToConnect.entries())
    input.obstacles.push({
      type: "rect",
      shape: "circle",
      componentId: `package_${index}`,
      center: { x: point.x, y: point.y },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: [secondSignal.name],
    })
  for (const [minY, maxY] of [
    [0, 2.825],
    [3.175, 5],
  ])
    input.obstacles.push({
      type: "rect",
      center: { x: 0, y: (minY + maxY) / 2 },
      width: 1,
      height: maxY - minY,
      layers: ["inner1"],
      connectedTo: ["immutable_aperture"],
    })
  return {
    input,
    options: {
      ...options,
      singleCarrier: {
        ...options.singleCarrier,
        maxPasses: 1,
        maxLocalPasses: 1,
      },
    },
  }
}
