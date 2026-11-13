# Handheld connectivity stack preview

Review-only composition of clean repro #194 and fix #195. Both this preview
and the standalone fix target main. Neither PR is authorized to merge.

The original repro fixture, source board, saved baseline and input snapshots
remain unchanged. The preview runner uses a 600-second cooperative budget so
a fresh connectivity solve can finish; this budget change is preview-only.
The saved baseline and input snapshots describe the unmodified v0.0.55 run.

Run from the repository root:

    bun repros/handheld-gaming-console/run.ts connectivity

The general solver changes contain no handheld names, coordinates or saved
routes. Local fresh validation returned all 65 signals and passed independent
copper clearance, drill spacing, path continuity, shortcut and self-clearance
checks. Group length matching and differential coupling remain unresolved.
No completed DDR routing or manufacturing readiness is claimed.

The standalone fix is #195, whose four production/test files are identical
in this preview. The required paired AM3352 CI benchmark must pass all eleven
samples; a green compile or package preview is not evidence of no regression.
