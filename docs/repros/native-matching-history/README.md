# Native matching congestion handoff

The [TSX circuit](../../../tests/fixtures/native-matching-history.tsx) declares a 12 × 6 mm, four-layer board with twelve circular SMT pads, six crossing signals and two inner1 keepouts. Published Core 0.0.2125 compiles its Circuit JSON and routing input. The only adaptation is declaring inner1 as the native matcher's carrier layer; pad coordinates, ownership, obstacles, connections and board bounds come from Core.

Run `bun test tests/native-matching-history-crossing.test.tsx` for the end-to-end routing regression, or `bun scripts/snapshot-native-matching-history.ts` to regenerate the labeled SVG, PNG and numeric report for the current implementation. The regression compares its actual result's generated SVG and numeric report with the committed artifacts, preventing stale labels, geometry or measurements.

The fixture uses a supported bounded configuration: one coarse pass, one pass in each local repair stage, and 100,000 search expansions per route. It provides no saved routes, mocks or manually constructed obstacles. On main, the coarse stage finds one physical S0/S4 copper conflict. Each of the six fine repair stages still has that conflict and the matcher returns `null`. The before panel shows the **final rejected candidate**, whose endpoints are connected but whose copper fails real DRC. It is a diagnostic, not a successfully routed board.

Preserving history lets the first fine stage remove the conflict. All six accepted traces connect their compiled endpoints; their twelve full-span plated vias and route copper pass the native DRC validator. The after panel is generated only after these checks pass. Colors identify S0–S5 on both layer panels, endpoint labels identify A/B pads, gray rectangles are the compiled keepouts, and red halos identify the actual conflicting copper. Lengths include both TOP approaches and inner1 carriers. No bus length constraints are requested in this connectivity/clearance fixture.

This demonstrates a failed bounded repair and repeated conflict after each history reset. Increasing main's global or local pass budget to two allows it to recover; this is not evidence that the default matching settings inevitably fail. The original AM3352 board and the separate eleven-sample benchmark remain independent validation work.

Core's published package imports several runtime packages without declaring them as dependencies. The pinned development dependencies supply those imports and align Circuit JSON with Core's schema. The existing fanout solver stays pinned to its original algorithm version. A behavior-neutral `ReturnType<typeof routeAlternateSignalDogbones>` annotation makes `initialSignalDogbones` declarations portable when Core introduces another autorouter version; no routing logic changes in the reproduction.

![Before: final rejected candidate with S0/S4 clearance conflict](before.png)
