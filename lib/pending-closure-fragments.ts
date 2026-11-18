/** A pending-access cut requires at least one selected route to change; it
 * does not prescribe how many must move together. Search release dimensions
 * in increasing order while retaining the complete small-component domain.
 * Oversized components share the existing finite fragment budget between
 * dimensions, so cheap unary probes cannot consume every joint-search slot.
 */
export function* pendingClosureFragments({
  component,
  edges,
  limit,
  maxFragments,
}: {
  component: readonly number[]
  edges: readonly (readonly [number, number])[]
  limit: number
  maxFragments?: number
}): Generator<number[]> {
  const degree = (index: number) =>
    edges.filter(([first, second]) => first === index || second === index)
      .length
  const ordered = [...new Set(component)].sort(
    (first, second) => degree(second) - degree(first),
  )
  const largest = Math.min(limit, ordered.length)
  let sizes = Array.from({ length: largest }, (_, index) => index + 1)
  if (maxFragments === undefined) {
    for (const size of sizes) yield* releaseCombinations(ordered, size)
    return
  }
  let remaining = Math.max(0, Math.floor(maxFragments))
  if (!remaining) return
  // An explicit cap too small to represent every dimension keeps the largest
  // existing joint opportunity, with remaining slots assigned to small probes.
  if (remaining < sizes.length)
    sizes = [...sizes.slice(0, remaining - 1), largest]
  for (const [index, size] of sizes.entries()) {
    const quota = Math.ceil(remaining / (sizes.length - index))
    let emitted = 0
    for (const fragment of releaseCombinations(ordered, size)) {
      yield fragment
      if (++emitted >= quota) break
    }
    remaining -= emitted
  }
}

function* releaseCombinations(
  values: readonly number[],
  size: number,
): Generator<number[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let index = 0; index <= values.length - size; index++)
    for (const tail of releaseCombinations(values.slice(index + 1), size - 1))
      yield [values[index], ...tail]
}
