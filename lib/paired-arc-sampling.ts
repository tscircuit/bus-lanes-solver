/** Rounded paired curves use at least this many segments per quarter-circle. */
export const ROUNDED_PAIR_ARC_SAMPLES = 18

/** Planar copper dimensions in mm. Parallel ideal arcs sampled as chords can
 * lose spacing by cos(half the largest segment angle). Only request a new
 * polygon construction when that loss can consume the physical clearance. */
export function pairedArcNeedsTangents({
  width,
  gap,
  clearance,
}: {
  width: number
  gap: number
  clearance: number
}): boolean {
  const segmentAngle = Math.PI / (2 * ROUNDED_PAIR_ARC_SAMPLES)
  const centerlineSpacing = width + gap
  const chordGap = centerlineSpacing * Math.cos(segmentAngle / 2) - width
  return chordGap < clearance - 1e-8
}
