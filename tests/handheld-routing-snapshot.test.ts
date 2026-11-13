import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  freshRoutingSnapshot,
  renderRoutingSnapshot,
} from "../repros/handheld-gaming-console/routing-snapshot"
import { loadInput } from "../repros/handheld-gaming-console/input"
test("fresh handheld connectivity result reproduces this revision's board snapshot", () => {
  const { svg } = freshRoutingSnapshot()
  expect(svg).toBe(
    readFileSync(
      new URL(
        "../repros/handheld-gaming-console/board.snap.svg",
        import.meta.url,
      ),
      "utf8",
    ),
  )
}, 900000)
test("completed handheld snapshot rejects incomplete output", () => {
  expect(() => renderRoutingSnapshot(loadInput(), [], true)).toThrow(
    "every requested signal",
  )
})
