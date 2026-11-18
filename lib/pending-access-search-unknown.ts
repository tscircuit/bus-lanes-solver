/** A finite sampling miss is not a proof of continuous inaccessibility. */
export class PendingAccessSearchUnknownError extends Error {
  readonly code = "pending_access_search_unknown"

  constructor(
    message = "Routing could not certify access for later connections",
  ) {
    super(message)
    this.name = "PendingAccessSearchUnknownError"
  }
}
