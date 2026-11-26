import type { Obstacle, Point } from "./types"

type BallChannel = { direction: Point; pitch: number }

/** A missing row in a ball array leaves room for a via beside the adjacent ball.
 * Measure the row and column directions from the balls in board-world mm. */
export function getBallChannel(
  ball: Obstacle,
  footprintBalls: Obstacle[],
): BallChannel | undefined {
  const offsets = footprintBalls
    .filter((other) => other !== ball && other.layers[0] === ball.layers[0])
    .map(({ center }) => ({
      x: center.x - ball.center.x,
      y: center.y - ball.center.y,
    }))
  const pitch = offsets.reduce(
    (nearest, { x, y }) => Math.min(nearest, Math.hypot(x, y)),
    Infinity,
  )
  if (!Number.isFinite(pitch) || pitch <= 0) return
  const tolerance = pitch * 0.01
  for (const offset of offsets) {
    const length = Math.hypot(offset.x, offset.y)
    if (Math.abs(length - pitch) > tolerance) continue
    const direction = { x: -offset.x / length, y: -offset.y / length }
    let nextBall = Infinity
    let hasColumnNeighbor = false
    for (const { x, y } of offsets) {
      const along = x * direction.x + y * direction.y
      const across = x * direction.y - y * direction.x
      if (Math.abs(across) <= tolerance && along > tolerance)
        nextBall = Math.min(nextBall, along)
      if (
        Math.abs(along) <= tolerance &&
        Math.abs(Math.abs(across) - pitch) <= tolerance
      )
        hasColumnNeighbor = true
    }
    if (
      hasColumnNeighbor &&
      Number.isFinite(nextBall) &&
      nextBall >= 2 * pitch - tolerance
    )
      return { direction, pitch }
  }
}
