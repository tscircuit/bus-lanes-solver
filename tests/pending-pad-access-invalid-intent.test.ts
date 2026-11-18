import { expect, test } from "bun:test"
import { PendingPadAccess } from "../lib/pending-pad-access"
import type { PendingRoutingAccess } from "../lib/types"
import { pendingPadAccessFixture } from "./fixtures/pending-pad-access"

test("invalid future physical intent is rejected before inaccessible-baseline filtering", () => {
  const { input } = pendingPadAccessFixture()
  const valid = input.pendingRoutingAccess![0]!
  const invalid: PendingRoutingAccess[] = [
    { ...valid, allowedLayers: ["inner99"] },
    { ...valid, minTraceToPadEdgeClearance: -1 },
    {
      ...valid,
      minTraceWidth: Number.NaN,
      connections: valid.connections.map((connection) => ({
        ...connection,
        width: undefined,
      })),
    },
  ]
  for (const intent of invalid) {
    const malformedInput = { ...input, pendingRoutingAccess: [intent] }
    const original = structuredClone(malformedInput)
    expect(() => new PendingPadAccess(malformedInput)).toThrow()
    expect(malformedInput).toEqual(original)
  }
})
