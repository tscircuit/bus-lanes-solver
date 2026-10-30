import type { SimpleRouteJson } from "./types"

/** Exact oval unions for the native checker's rectangle/circle boundary. */
export function toNativeValidationSrj(input: SimpleRouteJson) {
  return {
    ...input,
    obstacles: input.obstacles.flatMap((obstacle) => {
      if (obstacle.type !== "oval" || obstacle.shape === "circle")
        return [{ ...obstacle, type: "rect" as const }]
      const diameter = Math.min(obstacle.width, obstacle.height)
      const span = Math.abs(obstacle.width - obstacle.height)
      if (span < 1e-12)
        return [
          { ...obstacle, type: "rect" as const, shape: "circle" as const },
        ]
      const rotation =
        (obstacle.ccwRotationDegrees ?? 0) +
        (obstacle.width < obstacle.height ? 90 : 0)
      const angle = (rotation * Math.PI) / 180
      return [
        {
          ...obstacle,
          type: "rect" as const,
          shape: undefined,
          width: span,
          height: diameter,
          ccwRotationDegrees: rotation,
        },
        ...[-1, 1].map((side) => ({
          ...obstacle,
          type: "rect" as const,
          shape: "circle" as const,
          center: {
            x: obstacle.center.x + (side * span * Math.cos(angle)) / 2,
            y: obstacle.center.y + (side * span * Math.sin(angle)) / 2,
          },
          width: diameter,
          height: diameter,
        })),
      ]
    }),
    traces: input.traces?.map((trace) => {
      const connection_name =
        trace.connection_name ??
        input.connections.find(
          (connection) => connection.source_trace_id === trace.source_trace_id,
        )?.name
      if (!connection_name)
        throw Error("Native validation requires fixed-copper ownership")
      return { ...trace, connection_name }
    }),
  }
}
