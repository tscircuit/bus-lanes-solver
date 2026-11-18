import {
  RoutingMemoryBudgetExceeded,
  PendingRoutingWorkBudgetExceeded,
} from "./routing-memory-budget"
import { PendingAccessSearchUnknownError } from "./pending-access-search-unknown"

/** Resource limits and uncertified access leave a candidate unknown. Continue
 * the existing domain; a later positive candidate can still solve it. */
export class CandidateSearchOutcomes {
  private resourceUnknowns = 0
  private lastResourceError?:
    | RoutingMemoryBudgetExceeded
    | PendingRoutingWorkBudgetExceeded
    | PendingAccessSearchUnknownError

  get unknownCount(): number {
    return this.resourceUnknowns
  }

  *run<T>(search: Generator<void, T | null>): Generator<void, T | null> {
    try {
      return yield* search
    } catch (error) {
      if (
        !(error instanceof RoutingMemoryBudgetExceeded) &&
        !(error instanceof PendingRoutingWorkBudgetExceeded) &&
        !(error instanceof PendingAccessSearchUnknownError)
      )
        throw error
      this.resourceUnknowns++
      this.lastResourceError = error
      return null
    } finally {
      search.return(null)
    }
  }

  noSolution(): null {
    if (this.lastResourceError) throw this.lastResourceError
    return null
  }
}
