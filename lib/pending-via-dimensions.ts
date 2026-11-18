import type { SimpleRouteJson } from "./types"

/** Future access uses the native bridge's manufacturing defaults. Explicit
 * future phase dimensions override these independently; current-phase rules
 * are never inherited for an omitted future field. */
export function pendingViaDimensions(
  input: Pick<SimpleRouteJson, "minViaPadDiameter" | "minViaHoleDiameter">,
): { padDiameter: number; holeDiameter: number } {
  return {
    padDiameter: input.minViaPadDiameter ?? 0.3,
    holeDiameter: input.minViaHoleDiameter ?? 0.15,
  }
}
