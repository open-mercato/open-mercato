# WIC test corpus — case inventory

Companion input to `.ai/specs/2026-09-01-wic-score-skill.md`. Cases are anonymized: no real
usernames, PR numbers, or repository names — each case describes the structural shape the
corpus fixture must reproduce. "Old" = the monthly-batch `wic-evaluator` (commit `6d28c125c`);
"new" = the per-PR design in the spec.

Test harness principle: a mock `gh` on `PATH` replays recorded responses keyed by `argv` —
zero network, identical input for every run.

## Script layer (deterministic, CI)

| # | Case | Old behavior | Expected new behavior |
|---|---|---|---|
| S1 | 403 while fetching one artifact's comments | artifact silently empty, exit 0 | retries with backoff, then hard error, non-zero exit, no output file |
| S2 | two `search/issues` pages glued into one stream | `JSON.parse` throws, profile shows zero contributions, exit 0 | obsolete — the search API is not used in the per-PR design |
| S3 | `total_count` larger than the 1000-result search ceiling | scores on a truncated set with no trace | obsolete — same reason as S2 |
| S4 | a comment edited after freezing, `id` unchanged | content-based sort reorders the whole artifact | only the edited field differs (sort by `id`) |
| S5 | crash mid-write | partially written file, exit 0 | no file at all (temp file + `mv`) |
| S6 | report copy with a diverging second row | comparator reads only the first row, exit 0 | obsolete — comparator deleted; canonical JSON + `diff` |
| S7 | a row missing from copy B | comparator passes | obsolete — same reason as S6 |

## Gates layer (mechanical, per PR)

| # | Case | Expected |
|---|---|---|
| M1 | a release rollup PR: head is a long-lived branch (`develop`), base is the default branch, ~150k added lines | books nothing — head-not-long-lived gate |
| M2 | an ordinary fix merged straight to the default branch in a repo that also has `develop` | books |
| M3 | the same head branch merged into both `develop` and the default branch (hotfix pattern) | two verdicts, one booking — ledger dedupe by (repo, head branch) |
| M4 | a PR in a repo that has only a default branch, no `develop` | books from the default branch |
| M5 | a PR in a private repo of the org | ineligible, zero — repo gate |
| M6 | a PR already present in the ledger, re-scored later | books once — ledger idempotency |
| M7 | a repo turns public with pre-existing old merged PRs | old PRs do not enter the ledger retroactively |
| M8 | an issue reported by one account, closed by another account's merged PR | 0.25 credit proposed for the reporter, booked in the merge month |
| M9 | an issue reported and never fixed by any merged PR | zero |
| M10 | a PR that only adds spec files under `.ai/` | books like any other merged PR |

## Rubric layer (model judgment; three runs must all match the labeled expectation)

| # | Case | Old outcome | Expected new outcome |
|---|---|---|---|
| R1 | a deep refactor touching ~60 files across 4 packages, including test paths | 0.75, level L1 | 1.00 (base 0.5 + 0.25 packages + 0.25 tests), level L3 |
| R2 | a large working proof-of-concept on its own | 1.00, level L2 | 1.00, level L4 (L2 retired; level derived from points) |
| R3 | one PR touching 4 packages with tests vs. one touching 2 packages without | bonus varied run to run | exactly +0.50 vs. +0.00 — computed, not judged |
| R4 | one month: nine small merged fixes plus one deep refactor | 2.25 + 0.75 = 3.00, L1 | ledger caps small items at 1.00; refactor 1.00; total 2.00, L3 |
| R5 | a spec merged in month M, its implementation merged in month M+1 | grouped, capped | per PR: 0.5 then 1.0, no grouping, no cross-month state (approved decision Q1) |

## Real-data note

The two pilot-month reports under `.ai/runs/wic/` (2026-03 and 2026-04) were produced by the
1.0 monthly model from single-repo dumps missing `baseRefName`, `headRefName`, and
`closingIssuesReferences`. They are not usable as corpus fixtures and not comparable with 2.0
verdicts; their PRs enter the ledger as already-booked so nothing double-counts.
