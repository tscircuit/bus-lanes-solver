import {
  RoutingMemoryBudget,
  RoutingMemoryBudgetExceeded,
} from "./routing-memory-budget"

export interface SurfaceLabelCost {
  id: number
  signature?: number
  g: number
  routeLength: number
}

const epsilon = 1e-9
const mapBytes = 256
const mapEntryBytes = 128
const pageHeaderBytes = 128
// Modest shared pages avoid spending a small search's live-label allowance on
// unused closed-record capacity. The quantum changes storage, never domains.
const pageRecords = 256
const recordFields = 3
const recordBytes = recordFields * Float64Array.BYTES_PER_ELEMENT
const noRecord = -1

/** Closed frontiers link scalar g/length/next records in shared numeric pages.
 * No frontier owns a buffer or retains a label and its parent chain. Removed
 * records return to the shared free list instead of allocating replacements. */
export class SurfaceLabelCosts {
  private readonly physicalStates: number
  private readonly memory: RoutingMemoryBudget
  private readonly frontiers: Map<number, number>
  private readonly pages: Float64Array[]
  private pageUsed = 0
  private freeHead = noRecord
  private disposed = false

  constructor({
    physicalStates,
    memory,
  }: {
    physicalStates: number
    memory: RoutingMemoryBudget
  }) {
    if (!Number.isSafeInteger(physicalStates) || physicalStates <= 0)
      throw new RangeError(
        "Physical routing states must be a positive safe integer",
      )
    if (!memory.reserve(mapBytes))
      throw new RoutingMemoryBudgetExceeded(
        "Closed-state map exceeds routing memory budget",
      )
    this.physicalStates = physicalStates
    this.memory = memory
    this.frontiers = new Map()
    this.pages = []
  }

  dominates(label: SurfaceLabelCost): boolean {
    let record = this.frontiers.get(this.key(label)) ?? noRecord
    while (record !== noRecord) {
      const page = this.pages[Math.floor(record / pageRecords)]
      const at = (record % pageRecords) * recordFields
      if (
        page[at] <= label.g + epsilon &&
        page[at + 1] <= label.routeLength + epsilon
      )
        return true
      record = page[at + 2]
    }
    return false
  }

  contains(label: SurfaceLabelCost): boolean {
    let record = this.frontiers.get(this.key(label)) ?? noRecord
    while (record !== noRecord) {
      const page = this.pages[Math.floor(record / pageRecords)]
      const at = (record % pageRecords) * recordFields
      if (
        Math.abs(page[at] - label.g) <= epsilon &&
        Math.abs(page[at + 1] - label.routeLength) <= epsilon
      )
        return true
      record = page[at + 2]
    }
    return false
  }

  dispose(): void {
    if (this.disposed) return
    let bytes = mapBytes + this.frontiers.size * mapEntryBytes
    for (const page of this.pages) bytes += pageHeaderBytes + page.byteLength
    this.frontiers.clear()
    this.pages.length = 0
    this.pageUsed = 0
    this.freeHead = noRecord
    this.disposed = true
    this.memory.release(bytes)
  }

  remember(label: SurfaceLabelCost): void {
    const key = this.key(label)
    const oldHead = this.frontiers.get(key)
    let reuse = noRecord
    let record = oldHead ?? noRecord
    while (record !== noRecord) {
      const page = this.pages[Math.floor(record / pageRecords)]
      const at = (record % pageRecords) * recordFields
      if (
        page[at] <= label.g + epsilon &&
        page[at + 1] <= label.routeLength + epsilon
      )
        return
      if (
        reuse === noRecord &&
        label.g <= page[at] + epsilon &&
        label.routeLength <= page[at + 1] + epsilon
      )
        reuse = record
      record = page[at + 2]
    }

    // Reserve every potentially failing allocation before changing a live
    // frontier. A page failure rolls back the new key's accounting as well.
    const newKey = oldHead === undefined
    if (newKey && !this.memory.reserve(mapEntryBytes))
      throw new RoutingMemoryBudgetExceeded(
        "Closed-state key exceeds routing memory budget",
      )
    let replacement: number
    try {
      replacement = reuse === noRecord ? this.allocateRecord() : reuse
    } catch (error) {
      if (newKey) this.memory.release(mapEntryBytes)
      throw error
    }

    let head = noRecord
    let tail = noRecord
    record = oldHead ?? noRecord
    while (record !== noRecord) {
      const page = this.pages[Math.floor(record / pageRecords)]
      const at = (record % pageRecords) * recordFields
      const next = page[at + 2]
      if (
        label.g <= page[at] + epsilon &&
        label.routeLength <= page[at + 1] + epsilon
      ) {
        if (record !== replacement) this.freeRecord(record)
      } else {
        if (tail === noRecord) head = record
        else this.setNext(tail, record)
        tail = record
      }
      record = next
    }
    const page = this.pages[Math.floor(replacement / pageRecords)]
    const at = (replacement % pageRecords) * recordFields
    page[at] = label.g
    page[at + 1] = label.routeLength
    page[at + 2] = noRecord
    if (tail === noRecord) head = replacement
    else this.setNext(tail, replacement)
    this.frontiers.set(key, head)
  }

  private allocateRecord(): number {
    if (this.freeHead !== noRecord) {
      const record = this.freeHead
      const page = this.pages[Math.floor(record / pageRecords)]
      this.freeHead = page[(record % pageRecords) * recordFields + 2]
      return record
    }
    const last = this.pages.at(-1)
    if (!last || this.pageUsed === last.length / recordFields)
      this.allocatePage()
    return (this.pages.length - 1) * pageRecords + this.pageUsed++
  }

  private allocatePage(): void {
    const available = this.memory.maxBytes - this.memory.usedBytes
    let records = pageRecords
    while (records > 1 && pageHeaderBytes + records * recordBytes > available)
      records /= 2
    const bytes = pageHeaderBytes + records * recordBytes
    if (!this.memory.reserve(bytes))
      throw new RoutingMemoryBudgetExceeded(
        "Closed-state records exceed routing memory budget",
      )
    try {
      this.pages.push(new Float64Array(records * recordFields))
      this.pageUsed = 0
    } catch (error) {
      this.memory.release(bytes)
      throw error
    }
  }

  private freeRecord(record: number): void {
    this.setNext(record, this.freeHead)
    this.freeHead = record
  }

  private setNext(record: number, next: number): void {
    const page = this.pages[Math.floor(record / pageRecords)]
    page[(record % pageRecords) * recordFields + 2] = next
  }

  private key(label: SurfaceLabelCost): number {
    if (this.disposed) throw new Error("SurfaceLabelCosts has been disposed")
    const signature = label.signature ?? 0
    const key = label.id + signature * this.physicalStates
    if (
      !Number.isSafeInteger(label.id) ||
      label.id < 0 ||
      label.id >= this.physicalStates ||
      !Number.isSafeInteger(signature) ||
      signature < 0 ||
      !Number.isSafeInteger(key)
    )
      throw new RoutingMemoryBudgetExceeded(
        "Routing label state cannot be indexed exactly",
      )
    return key
  }
}
