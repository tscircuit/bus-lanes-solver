# Pull-request benchmarks

Comment `/benchmark` on an open pull request to compare the latest `main`
commit with that PR's current head. The requester must have write, maintain, or
admin access to the repository. The workflow posts a queued comment, then
updates it with completion counts, P50/P80/P90/P95 times, completion changes,
and every case's result. Exact commit SHAs and raw artifacts are linked.

The default solver budget is 3600 seconds per case and revision. For a
shorter diagnostic run, use `/benchmark --timeout-seconds 120`. Only this
integer option, from 1 through 3600, is accepted. Short budgets can leave
otherwise routable placements unfinished. The workflow can also be dispatched
manually from Actions on the default branch with a PR number and budget.

## What is compared

All twelve cases are included: eleven AM3352 placements and the reduced
`coupled-offset-shortening` pair regression. The baseline is the latest `main`,
including for stacked PRs whose GitHub base is another feature branch. Both
commit SHAs and the trusted harness SHA are pinned before any solver runs.

Each case runs main and PR sequentially on the same GitHub-hosted machine,
in fresh processes with Bun 1.3.14. The order alternates between cases.
Dependencies are installed before either revision is timed; committed lockfiles
are respected, when present. This repository currently does not commit a
lockfile, so dependency ranges resolve at installation time. Three case
jobs can run concurrently. Each job has a 150-minute limit, and each worker
also has a process deadline beyond its solver budget. A full comparison can
take several hours.

The default-branch harness supplies the fixture, input hash, and independent
acceptance checks for both solvers. Each AM3352 placement requires all 47 signals, native
combined-copper DRC, full-copper bus and pair matching, coupling, and unchanged
161 fixed power dogbones with their provenance. The additional complete-CA
timing group does not add signals. The per-placement table includes DRC status,
bus and pair copper skews, runtime, and input hashes.

The reduced case uses each revision’s public `BusLanesPipelineSolver` with
`fanout: "none"`, preserving the original fixture decimals. It requires both
signals and all four terminal joins, native full-copper DRC, conventional angles,
self-clearance, continuous interconductor clearance, shared spacing, coupling,
and one pair’s total-length skew within 0.127 mm. It has no fixed power copper
or buses; its trusted report requirements are 2 signals / 0 fixed fanouts /
0 buses / 1 pair. These requirements cannot replace the AM3352 47/161 checks.

## Reading the timing tables

The tables follow the autorouter's layout: metrics are rows, with Main, PR,
and Change columns. The first table includes Completion, Timeouts, Other
failures, and P50/P80/P90/P95 **budgeted time to valid completion** across all
twelve cases. Completion changes use percentage points; timing changes
use relative percentages, with negative values faster. Accepted cases use
their routing time. Failed, timed-out, crashed, invalid, or missing cases
receive the full solver budget.
This keeps a PR that loses slow successes from appearing faster by dropping
those cases.

The second table reports actual routing times on the **same cases accepted
by both revisions**, with percentile changes. It is suppressed when input or
revision evidence is inconsistent or results are incomplete. Lost and gained
accepted cases are listed separately. A failure of the first revision
does not prevent the second from running. Missing results remain visible and
are never presented as evidence of no regression.

Percentiles use linear interpolation at sorted index `(n - 1) * p`. These are
twelve distinct routing problems, with one run per revision and case;
percentile changes are descriptive and can vary with the runner. Only solver
execution is timed; installation, fixture loading, and independent validation
are excluded. Worker wall time is retained in the JSON. Twelve-case aggregates
should not be compared directly with historical eleven-placement aggregates.

## CI and activation

Normal CI runs smoke tests, visual snapshot checks, and focused regressions
with a 120-second default per-test limit. The expensive full-board tests and
automatic long benchmark job are replaced by this explicit benchmark command.
Small AM62L full-DDR smoke cases and immutable-fanout, geometry, DRC, matching,
and tamper checks remain in the ordinary suite.

GitHub only runs `issue_comment` workflows from the default branch. Merge the
benchmark harness and its updated manifest into `main` before `/benchmark`
will include the reduced case. A PR-only manifest change does not alter the
trusted default-branch controller. The infrastructure belongs on main so a
solver change can be measured before it is merged.

PR solver execution has read-only repository permissions and receives no
write token. A separate job on a fresh runner renders typed JSON artifacts
using trusted reporting code and updates the result comment. Only repository
writers can request the potentially expensive execution of PR code. Raw JSON
and worker logs are retained for 14 days; no partial-route images are exported.
