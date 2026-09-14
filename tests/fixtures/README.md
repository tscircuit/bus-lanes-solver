# Routing fixtures

`two-fanouts/` contains the four current AM62L phase inputs. Each contains 33 DDR
connections and 66 paths from real fanout-solver 0.0.78 outputs. Provenance lives
in `examples/fanout-solver-outputs`; the `.meta.json` files reference and hash it.
These are captured inputs, not successful full-board builds. Current routing
score is 0/4: 28 left-case handoffs disagree on layer; the other three exhaust
the search budget. Fixed fanout copper passes independent DRC.

The older root-level byte/CA prefix fixtures and raw negative captures remain
for regression history. Prefix fixtures are excluded from the default score.
