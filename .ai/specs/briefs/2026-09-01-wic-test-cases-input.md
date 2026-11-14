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
| M3 | the same head SHA merged into both a `release/v*` line and the default branch (backport pattern) | two verdicts, one booking — ledger dedupe by `(repo, headRefOid)` |
| M4 | a PR in a repo that has only a default branch, no `develop` | books from the default branch |
| M5 | a PR in a private repo of the org | ineligible, zero — repo gate |
| M6 | a PR already present in the ledger, re-scored and re-ratified later | books once — ledger idempotency on `(repo, prNumber)` |
| M7 | a repo turns public with pre-existing old merged PRs | old PRs do not enter the ledger retroactively (`BOOKING_START`) |
| M8 | an issue reported by one account, closed by another account's merged PR | 0.25 credit proposed for the reporter, booked in the merge month |
| M9 | an issue reported by the PR author, closed by that same PR | zero credit — self-dealt issue |
| M10 | a PR that only adds spec files under `.ai/` | books like any other merged PR |
| M11 | a PR declaring `Supersedes #N` where #N closed unmerged | books to #N's author; the declaring author books nothing for it |
| M12 | two PRs from different forks that reuse the same head branch name | both book — different head SHAs |
| M13 | a routine dependency bump touching 3+ packages and a snapshot | 0.0 — bonuses suppressed at base 0 |

## Rubric layer (model judgment; three runs must all match the labeled expectation)

| # | Case | Old outcome | Expected new outcome |
|---|---|---|---|
| R1 | a deep refactor touching ~60 files across 4 packages, including test paths | 0.75, level L1 | 1.00 (base 0.5 + 0.25 packages + 0.25 tests), level L3 |
| R2 | a large working proof-of-concept on its own | 1.00, level L2 | 1.00, level L4 (L2 retired; level derived from points) |
| R3 | one PR touching 4 packages with tests vs. one touching 2 packages without | bonus varied run to run | exactly +0.50 vs. +0.00 — computed, not judged |
| R4 | one month: nine small merged fixes plus one deep refactor | 2.25 + 0.75 = 3.00, L1 | ledger caps small items at 1.00 (totals, not base points); refactor 1.00; total 2.00, L3 |
| R5 | a spec merged in month M, its implementation merged in month M+1 | grouped, capped | per PR: 0.5 then 1.0, no grouping, no cross-month state (approved decision Q1) |
| R6 | an issue fixed by a PR merged to a non-default branch | no credit (no `closingIssuesReferences`) | 0.25 credit emitted from body keywords, `source: "body-keywords"`, confirmed by ratification |

## Ledger layer (Phase 3 fixtures)

| # | Case | Expected |
|---|---|---|
| L1 | a verdict comment edited after its 👍 | flagged, pays nothing until re-scored and re-ratified |
| L2 | a PR body rewritten after the verdict was posted | `bodySha` mismatch → flagged |
| L3 | two ratified verdicts on one PR by different logins | earliest ratification counts; the second is in `exceptions` |
| L4 | a verdict posted by a login other than the PR author | payee is the PR author from the API |
| L5 | a verdict ratified 40 days after its merge month | booked in the ratification month with `lateOf` |
| L6 | a company holding three partner logins, each hitting the small-items cap | one cap per company, not per login |
| L7 | a repo on the allowlist that turned private | reported and skipped, run still completes for the rest |

## Real-data note

The two pilot-month reports (2026-03 and 2026-04) were produced by the 1.0 monthly model from
single-repo dumps missing `baseRefName`, `headRefName`, and `closingIssuesReferences`. They are
not usable as corpus fixtures and not comparable with 2.0 verdicts, and they are not present in
this repository. The ledger therefore refuses to book anything merged before `BOOKING_START`
(default `2026-10-01`) unless the owner supplies the pilot PRs in `scripts/wic/booked.json`, so
nothing double-counts.
