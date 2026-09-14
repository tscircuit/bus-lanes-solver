# Contribution workflow

- Make future changes on a branch and submit a pull request. Do not push changes directly to main.
- Every routing PR must include visual snapshots for each of the four DDR samples, including iteration zero, intermediate routing, and the completed output. Inspect the images before submitting.
- Run `./benchmark.sh` and report connectivity, DRC, per-bus total copper length skew, and runtime. Do not count a routing-only pass as a length-matching pass.
- Keep fixed FanoutSolver outputs immutable and retain their provenance. Matching measurements include both fixed fanouts and the new interconnect.
