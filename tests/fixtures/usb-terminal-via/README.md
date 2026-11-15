Native AM3352 USB phase regression, captured 2026-10-25. Board-world XY mm.
The four original CPU/ESD links retain their original differential-pair gap
(0.10 mm) and skew (0.15 mm). The native fanout handoffs use full-stack
0.30 mm drills / 0.50 mm lands. All 94 supplied traces are immutable, including
prior DDR and eight FanoutSolver-generated CPU/ESD stubs. They are fixture
obstacles, never copied into production board output.

Decompressed input SHA-256:
`195d0a480b5e34fc0e7f261990371df324559e5fead564ad35ded5f50251c257`.
The fixture contains routing input only: all four carriers must be freshly solved.
The base solver reports success but its length correction for source_trace_703
returns through the existing ESD via land. Per-fragment self-short checks miss
this contact; joining the immutable fanout and new carrier exposes the shortcut.
The test checks the carrier against the actual supplied terminal lands directly.
