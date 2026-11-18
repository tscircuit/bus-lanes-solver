/** Exact byte accounting shared by the live routing search structures. A
 * failed reservation records exhaustion without charging unallocated memory. */
export class RoutingMemoryBudget {
  private currentBytes = 0
  private maximumUsedBytes = 0
  private reservationFailed = false

  constructor(readonly maxBytes: number) {
    validateBytes(maxBytes)
  }

  get usedBytes(): number {
    return this.currentBytes
  }

  get peakBytes(): number {
    return this.maximumUsedBytes
  }

  get exhausted(): boolean {
    return this.reservationFailed
  }

  reserve(bytes: number): boolean {
    validateBytes(bytes)
    if (bytes > this.maxBytes - this.currentBytes) {
      this.reservationFailed = true
      return false
    }
    this.currentBytes += bytes
    this.maximumUsedBytes = Math.max(this.maximumUsedBytes, this.currentBytes)
    return true
  }

  release(bytes: number): void {
    validateBytes(bytes)
    if (bytes > this.currentBytes)
      throw new RangeError("Cannot release more routing memory than reserved")
    this.currentBytes -= bytes
  }
}

function validateBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new RangeError(
      "Routing memory bytes must be a nonnegative safe integer",
    )
}

export class RoutingMemoryBudgetExceeded extends Error {
  readonly code = "search_memory_budget_exhausted"

  constructor(message = "Routing search exhausted its memory budget") {
    super(message)
    this.name = "RoutingMemoryBudgetExceeded"
  }
}

/** A bounded frontier remains unresolved; work exhaustion is not absence. */
export class PendingRoutingWorkBudgetExceeded extends Error {
  readonly code = "search_expansion_budget_exhausted"

  constructor(
    message = "Pending routing search exhausted its aggregate expansion budget",
  ) {
    super(message)
    this.name = "PendingRoutingWorkBudgetExceeded"
  }
}
