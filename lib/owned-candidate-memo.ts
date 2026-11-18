/** A result memo may reference choices already owned by live routing state.
 * Eviction changes only recomputation: it never removes a routing alternative. */
export class OwnedCandidateMemo<T extends object> {
  private readonly entries = new Map<string, T | null>()
  private readonly maxBytes: number
  private retained: (() => ReadonlySet<T>) | undefined
  private bytes = 0

  constructor({
    maxBytes,
    retained,
  }: {
    maxBytes: number
    retained: () => ReadonlySet<T>
  }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError(
        "Candidate memo bytes must be a nonnegative safe integer",
      )
    this.maxBytes = maxBytes
    this.retained = retained
  }

  get usedBytes(): number {
    return this.bytes
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): T | null | undefined {
    if (!this.retained) return undefined
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    if (value !== null && !this.retained().has(value)) {
      this.remove(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: T | null): void {
    if (!this.retained) return
    const retained = this.retained()
    this.prune(retained)
    this.remove(key)
    if (value !== null && !retained.has(value)) return
    const bytes = this.entryBytes(key)
    if (bytes > this.maxBytes) return
    while (this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!
      this.remove(oldest)
    }
    this.entries.set(key, value)
    this.bytes += bytes
  }

  dispose(): void {
    this.entries.clear()
    this.bytes = 0
    this.retained = undefined
  }

  private prune(retained: ReadonlySet<T>): void {
    for (const [key, value] of this.entries)
      if (value !== null && !retained.has(value)) this.remove(key)
  }

  private remove(key: string): void {
    if (this.entries.delete(key)) this.bytes -= this.entryBytes(key)
  }

  private entryBytes(key: string): number {
    return 128 + 2 * key.length + 8
  }
}
