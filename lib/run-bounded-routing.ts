/** Numeric limits retain the legacy null result. A caller that must distinguish
 * an unfinished search from a proved failure supplies an exhaustion error. */
export type RoutingStepLimit =
  | number
  | {
      maxSteps: number
      onExhausted: () => Error
    }

export function exhaustedRoutingResult(limit: RoutingStepLimit): null {
  if (typeof limit !== "number") throw limit.onExhausted()
  return null
}

/** Keep child searches cancellable and charge every yield to the parent. */
export function* runBoundedRouting<T>(
  generator: Generator<unknown, T>,
  limit: RoutingStepLimit,
): Generator<void, T | null> {
  const maxSteps = typeof limit === "number" ? limit : limit.maxSteps
  let state = generator.next()
  let steps = 0
  try {
    while (!state.done && steps++ < maxSteps) {
      yield
      state = generator.next()
    }
    return state.done ? state.value : exhaustedRoutingResult(limit)
  } finally {
    if (!state.done) generator.return(null as T)
  }
}
