# Complete MT8395 HDMI request

Lossless copy of the core 79735a0 capture from fanout-solver's merged HDMI
reproduction. SHA-256 of restored `JSON.stringify(input)`:
`03062c9c48ccc0fdccbfdc1e670b8989b94cdb719daccc31b2a5382054af464b`.
The loader expands dictionary-encoded obstacle ownership aliases and verifies
the hash. Both signals, all obstacles, and all 138 fixed DDR traces are retained.

The explicit SRJ `allowBlindAndBuriedVias: true` is retained; supplied vias do
not confer permission. This tests the existing HDI prototype, not a through-via
redesign. The full 100 x 75 mm request reaches package coupling after the lanes
route, then attempts a board-wide grid exceeding eight million cells.

The user-requested before/after snapshot contains the relevant TSX excerpt and
actual pads. The failed baseline shows no unaccepted candidate copper. The fix
must replace it with completed routes only after connectivity, full-board DRC,
length, coupling, and fixed-input preservation checks pass. The snapshot hides
unrelated retained DDR copper for legibility; the solver and checks retain it.
