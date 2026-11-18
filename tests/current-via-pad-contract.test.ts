import { expect, test } from "bun:test"
import type { Trace } from "../lib/types"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import {
  currentViaDrillFixture,
  physicalViaPadErrors,
} from "./fixtures/current-via-drill"

const viaAt = (point: { x: number; y: number }): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: "manufacturing-pair",
  connection_name: "SIGNAL",
  route: [
    {
      route_type: "via",
      ...point,
      from_layer: "top",
      to_layer: "bottom",
      layers: ["top", "bottom"],
      via_diameter: 0.4,
      via_hole_diameter: 0.2,
    },
  ],
})

test("primary manufacturing rule permits annulus contact and drill tangency", () => {
  const input = currentViaDrillFixture()
  input.obstacles = input.obstacles.slice(0, 1)
  const origin = input.obstacles[0].center
  const outsideDrill = viaAt({ x: origin.x + 0.35, y: origin.y })
  // .35 is inside the .4 combined copper radius, outside the .3 drill+pad radius.
  expect(0.35).toBeLessThan(0.2 + 0.2)
  expect(0.35).toBeGreaterThan(0.2 + 0.1)
  expect(physicalViaPadErrors(input, [outsideDrill])).toEqual([])
  expect(
    physicalViaPadErrors(input, [viaAt({ x: origin.x + 0.3, y: origin.y })]),
  ).toEqual([])
  const intrusion = viaAt({ x: origin.x + 0.25, y: origin.y })
  expect(physicalViaPadErrors(input, [intrusion])).toHaveLength(1)
  expect(
    physicalViaPadErrors({ ...input, allowViaInPad: true }, [intrusion]),
  ).toEqual([])
})

test("rotated rectangle uses actual pad body and shared layers", () => {
  const input = currentViaDrillFixture({ shape: "rotated-rect" })
  input.obstacles = input.obstacles.slice(0, 1)
  const origin = input.obstacles[0].center
  const alongLocalX = (distance: number) => ({
    x: origin.x + Math.cos(Math.PI / 6) * distance,
    y: origin.y + Math.sin(Math.PI / 6) * distance,
  })
  expect(physicalViaPadErrors(input, [viaAt(alongLocalX(0.3))])).toEqual([])
  expect(physicalViaPadErrors(input, [viaAt(alongLocalX(0.25))])).toHaveLength(
    1,
  )
  const disjoint = viaAt(origin)
  input.layerCount = 4
  input.obstacles[0].layers = ["bottom"]
  disjoint.route = [
    {
      route_type: "via",
      ...origin,
      from_layer: "top",
      to_layer: "inner1",
      layers: ["top", "inner1"],
      via_diameter: 0.4,
      via_hole_diameter: 0.2,
    },
  ]
  expect(physicalViaPadErrors(input, [disjoint])).toEqual([])
})

test("via-in-pad permission never waives foreign copper collision", () => {
  const input = currentViaDrillFixture({ allowViaInPad: true })
  input.obstacles = input.obstacles
    .slice(0, 1)
    .map((pad) => ({ ...pad, connectedTo: ["OTHER_NET"] }))
  const at = { x: input.obstacles[0].center.x + 0.35, y: 0 }
  const landingScene = new VectorScene(
    input,
    input.connections[0],
    input.minViaPadDiameter!,
    fixedCopper(input),
  )
  expect(landingScene.visible(at, at)).toBe(false)
})
