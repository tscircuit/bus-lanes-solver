import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  freshRoutingSnapshot,
  renderRoutingSnapshot,
} from "../repros/handheld-gaming-console/routing-snapshot"
import { loadInput } from "../repros/handheld-gaming-console/input"
test("fresh handheld connectivity result reproduces this revision's board snapshot", async () => {
  const { svg } = freshRoutingSnapshot()
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 900000)
test("completed handheld snapshot rejects incomplete output", () => {
  expect(() => renderRoutingSnapshot(loadInput(), [], true)).toThrow(
    "every requested signal",
  )
})
