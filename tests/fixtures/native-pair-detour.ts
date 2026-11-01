import { offsetNativePair } from "./offset-native-pair"

/** A fixed wall blocks every monotone corridor between the offset packages.
 * A manufactured coupled detour fits below it without changing the input. */
export function nativePairDetour() {
  const input = offsetNativePair()
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 1.4 },
    width: 1,
    height: 7.2,
    layers: ["inner1"],
    connectedTo: ["fixed_wall"],
  })
  const centerlines = [
    [
      { x: -5.6, y: -1 },
      { x: -4.5, y: -1 },
      { x: -4, y: -1.5 },
      { x: -4, y: -2.5 },
      { x: -3.5, y: -3 },
      { x: 3.5, y: -3 },
      { x: 4, y: -2.5 },
      { x: 4, y: 0.5 },
      { x: 4.5, y: 1 },
      { x: 5.6, y: 1 },
    ],
  ]
  return { input, centerlines }
}
