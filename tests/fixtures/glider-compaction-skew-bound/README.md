Captured from the unchanged native Glider TSX board in Core at
`0da3941efbb22eb80b600f4a497bcbcb763aae74`, using the original-group constraint
compiler at `ShiboSoftwareDev/core-ddr-benchmark@b0734c93acbc906c4065276657a3aaaa03fd5f80`.
Core used released Bus 0.0.67; this capture contains no third-party PR implementation.

Public capture: https://github.com/tscircuit/core/actions/runs/45689841701

The input is the second data byte, with the first byte retained as native fixed
traces. `fixedConnections` contains the first byte's original terminal definitions
for independent connectivity and DRC validation. Geometry is in board-world mm:
+X right, +Y up, +Z above, a right-handed frame; coordinates are points.

No pad geometry, routing groups, layer rules, widths or numeric goals were changed.
The numeric snapshot exposes a compaction overrun too small to inspect visually.
