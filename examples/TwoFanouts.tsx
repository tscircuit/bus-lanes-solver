import React from "react"

/** Both saved path sets are independently generated pad-to-boundary fanouts.
 * No carrier routes are loaded. Requires the bus_lanes core/props integration. */
export function TwoFanouts({ input, metadata }: { input: any; metadata: any }) {
  const connections = input.connections
  const names = connections.map((c: any) => c.name)
  return (
    <board
      width={
        2 * Math.max(Math.abs(input.bounds.minX), Math.abs(input.bounds.maxX))
      }
      height={
        2 * Math.max(Math.abs(input.bounds.minY), Math.abs(input.bounds.maxY))
      }
      pcbX={0}
      pcbY={0}
      layers={8}
      minTraceWidth={0.075}
      minTraceToPadEdgeClearance={0.075}
      minPadEdgeToPadEdgeClearance={0.075}
      minViaEdgeToPadEdgeClearance={0.075}
      minViaPadDiameter={0.22}
      minViaHoleDiameter={0.1}
      allowBlindAndBuriedVias
      isViaInPadAllowed
    >
      {(["soc", "ram"] as const).map((side) => {
        const name = side === "soc" ? "SOC" : "RAM",
          center = metadata[`${side}Center`]
        const traces = input.traces.filter((t: any) =>
          t.pcb_trace_id.startsWith(`${side}_fanout_`),
        )
        const pads = input.obstacles.filter((o: any) =>
          side === "soc"
            ? o.componentId === "pcb_component_0"
            : o.componentId !== "pcb_component_0",
        )
        const signalsForPad = (o: any) =>
          traces
            .filter(
              (t: any) =>
                Math.hypot(
                  t.route[0].x - o.center.x,
                  t.route[0].y - o.center.y,
                ) < 1e-6,
            )
            .map((t: any) => t.connection_name)
        return (
          <fanout
            key={side}
            name={`${name}_FANOUT`}
            pcbRelative
            pcbX={center.x}
            pcbY={center.y}
            pcbTracePaths={traces.map((t: any) => ({
              connection: `${name}.${t.connection_name}`,
              route: t.route.map((p: any) => ({
                ...p,
                x: p.x - center.x,
                y: p.y - center.y,
              })),
            }))}
          >
            <chip
              name={name}
              pcbX={0}
              pcbY={0}
              pinLabels={Object.fromEntries(
                pads.map((o: any, i: number) => [
                  `pin${i + 1}`,
                  [
                    ...signalsForPad(o),
                    o.circuitJsonMetadata?.source_port_name ?? `P${i + 1}`,
                  ],
                ]),
              )}
            >
              <footprint>
                {pads.map((o: any, i: number) => (
                  <smtpad
                    key={i}
                    shape="circle"
                    radius={o.width / 2}
                    pcbX={o.center.x - center.x}
                    pcbY={o.center.y - center.y}
                    portHints={[`pin${i + 1}`]}
                  />
                ))}
              </footprint>
            </chip>
          </fanout>
        )
      })}
      <autoroutingphase
        name="DDR_INTERCONNECT"
        phaseIndex={0}
        autorouter="bus_lanes"
        connections={names}
      />
      {connections.map((c: any) => (
        <trace
          key={c.name}
          name={c.name}
          from={`.SOC > .${c.name}`}
          to={`.RAM > .${c.name}`}
          routingPhaseIndex={0}
        />
      ))}
      {input.buses.map((b: any) => (
        <bus
          key={b.busId}
          name={b.busId}
          connections={b.connectionNames}
          routingPhaseIndex={0}
          pcbAllowedLayers={b.allowedLayers}
          maxLengthSkew={b.maxLengthSkew}
        />
      ))}
    </board>
  )
}
