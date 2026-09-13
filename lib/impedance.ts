import type { Bus } from "./types"
/** Interpolates a stackup-specific field-solver/fabricator width-vs-impedance table.
 * No default dielectric or stackup assumptions; never extrapolates. */
export function resolveBusWidth(bus: Bus, layer: string) {
  if (bus.targetImpedance === undefined) return bus.traceWidth
  const profile = bus.impedanceProfile
  if (!profile || profile.layer !== layer)
    throw Error(
      `${bus.busId}: targetImpedance requires an impedanceProfile for ${layer}`,
    )
  const points = [...profile.points].sort((a, b) => a.traceWidth - b.traceWidth)
  if (
    points.length < 2 ||
    points.some(
      (p, i) =>
        !Number.isFinite(p.traceWidth) ||
        !Number.isFinite(p.impedance) ||
        p.traceWidth <= 0 ||
        p.impedance <= 0 ||
        (i > 0 &&
          (p.traceWidth <= points[i - 1].traceWidth ||
            p.impedance >= points[i - 1].impedance)),
    )
  )
    throw Error(
      `${bus.busId}: impedance profile must have increasing widths and decreasing positive impedances`,
    )
  const target = bus.targetImpedance
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (target <= a.impedance && target >= b.impedance) {
      const width =
        a.traceWidth +
        ((b.traceWidth - a.traceWidth) * (a.impedance - target)) /
          (a.impedance - b.impedance)
      if (
        bus.traceWidth !== undefined &&
        Math.abs(bus.traceWidth - width) > 1e-6
      )
        throw Error(`${bus.busId}: traceWidth conflicts with targetImpedance`)
      return width
    }
  }
  throw Error(`${bus.busId}: targetImpedance is outside the supplied profile`)
}
