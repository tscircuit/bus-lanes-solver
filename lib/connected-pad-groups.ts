import type { Obstacle, SimpleRouteJson } from "./types"

type ConnectivityAlias = Obstacle["connectedTo"][number]
type ConnectedPadGroup = {
  pads: Set<Obstacle>
  aliases: Set<ConnectivityAlias>
}

/** Retain pad and group order while merging each electrical alias group once. */
export function getConnectedPadGroups(pads: Obstacle[]): Set<Obstacle>[] {
  const groups = new Map<ConnectivityAlias, ConnectedPadGroup>()
  for (const pad of pads) {
    const touching = new Set(
      pad.connectedTo.flatMap((alias) =>
        groups.has(alias) ? [groups.get(alias)!] : [],
      ),
    )
    const group: ConnectedPadGroup = {
      pads: new Set([
        pad,
        ...[...touching].flatMap((previous) => [...previous.pads]),
      ]),
      aliases: new Set([
        ...pad.connectedTo,
        ...[...touching].flatMap((previous) => [...previous.aliases]),
      ]),
    }
    for (const alias of group.aliases) groups.set(alias, group)
  }
  return [...new Set(groups.values())].map((group) => group.pads)
}

/** Connected physical pads whose net is absent from both this request and supplied traces. */
export function getPendingPadGroups(
  input: SimpleRouteJson,
  pads: Obstacle[],
): Set<Obstacle>[] {
  const assigned = new Set([
    ...input.connections.flatMap((connection) => [
      connection.name,
      connection.source_trace_id,
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ]),
    ...(input.traces ?? []).flatMap((trace) => [
      trace.connection_name,
      trace.source_trace_id,
    ]),
  ])
  return getConnectedPadGroups(pads).filter((group) => {
    if (group.size < 2) return false
    const ports = new Set<string>()
    for (const pad of group) {
      if (pad.connectedTo.some((owner) => assigned.has(owner))) return false
      const port = pad.circuitJsonMetadata?.pcb_port_id
      if (port) ports.add(port)
    }
    return ports.size >= 2
  })
}
