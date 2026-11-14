# WIC: settlement model and change plan

Companion input to `.ai/specs/2026-09-01-wic-score-skill.md`. Translated from the original Polish
working note in revision 2 (2026-11-14); local paths and session identifiers removed. Where this
note and the spec disagree, the spec wins — discrepancies are listed under "Superseded by the
current spec".

Code: branch `feat/wic-evaluator-skill`, commit `6d28c125c` in the `open-mercato` repository.
Work happens on a worktree.

## Settlement model (agreed)

**The unit of settlement is a PR merged into a long-lived branch** of a public, non-archived
repository in the `open-mercato` organization. The merge is the only booking moment, because it is
the only irreversible one: the date and the diff no longer change.

**Scope: 12 repositories** (public, not archived): `open-mercato`, `official-modules`,
`skills`, `cezar`, `cezar-legacy`, `ready-apps`, `ready-app-oss-prm`, `open-mercato-evals`,
`n8n-nodes`, `open-mercato-infra`, `api-client-example`, `aida-ux`.
The mechanical criterion is "public and not archived", not the presence of a license file: five of
them (`cezar`, `ready-apps`, `ready-app-oss-prm`, `open-mercato-infra`, `aida-ux`) have no
`LICENSE`, which looks like an oversight to fix separately rather than a reason to cut payouts.

**Long-lived branches:** `develop` where it exists (`open-mercato`, `official-modules`,
`cezar`, `ready-app-oss-prm`) and each repository's default branch. Both book, because in a repo
with `develop` the `main` branch also receives ordinary work (#4957, #4917 in `open-mercato`).

**Rollup exclusion:** a PR whose source branch is itself a long-lived branch does not book at all.
Otherwise the author of a release PR (#3594 `release: v0.6.6`, +156,065 lines) would book a whole
quarter of the team's work.

**Deduplication:** the same source branch merged into two long-lived branches of the same repo
(the hotfix pattern) books once. Original key: (repo, `headRefName`). See "Superseded by the
current spec" below — revision 2 keys this on the head SHA.

**Month:** the month of the merge. Splitting into months is a projection of the report at the end,
not a query at the input.

**Input:** a start marker plus a register of booked PRs keyed by (repo, PR number). A run appends,
never rewrites. A repository that only becomes public starts booking from the marker, so history
does not open up.

**Bug report** credit books to the reporter at the moment of the merge of the PR that closes it
(`closingIssuesReferences`). A report with no fix is worth zero.

**Specification** added under `.ai/` books like any other merged PR; it is recognized
mechanically by file paths.

## What this model deletes from earlier plan versions

The `--as-of` cutoff, acceptance signals mined from comments, self-certification, the exception
for unmerged PRs with an APPROVED review, the dispute about month assignment, and the payload
hash as an audit anchor. All of those problems came from settling a mutable state instead of an
irreversible event. The register of booked PRs replaces the hash.

## Per-PR settlement (settled)

We pay for every merged PR separately. We do not group PRs into one feature: splitting work into
smaller PRs is desirable and has to pay off, because that is our process
(`om-auto-create-pr-loop`).

A consciously accepted consequence: the same feature delivered in ten small PRs costs more than
delivered in one large one, and two partners doing the same work may receive different amounts
depending on how they sliced the delivery.

## Fetcher changes

### F1. Query by organization instead of one repo

Today `repo:open-mercato/open-mercato` is hard-coded. New: a repo list from
`gh repo list open-mercato --json name,isPrivate,isArchived`, filtered to public and not
archived, then `is:pr is:merged author:<login> merged:>=<watermark>` per repo, fetching
`baseRefName`, `headRefName`, `mergedAt`, `closingIssuesReferences`.

### F2. Hard errors instead of silent zeros

`ghJson()` catches everything and returns `null` (`:12-16`), and callers do `|| []` (`:163-172`),
so a limit or a 422 yields a data-less artifact with exit code 0. Change: `ghJson` throws; errors
go to `payload.errors[]`; a non-empty list means a non-zero exit code. Three retries with backoff
on 403/429 before the hard error, because the search limit is 30 requests a minute and we now go
through 12 repositories. Write to a temp file and `mv` at the end.

### F3. Pagination and the search ceiling

`--paginate` without `--slurp` on `search/issues` breaks JSON past a hundred results (reproduced on
gh 2.72: `gh` exits 0 while emitting unparsable output). Separately, `search/issues` has a
1000-result ceiling and returns 422. Change: `--slurp`, merge `.items`, assert
`items.length === total_count`, mismatch is a hard error. (The per-PR spec drops the search API
entirely, which supersedes this item for the verdict path.)

### F4. Determinism hygiene

`generatedAt` goes to a sidecar file. Sort comments by `id`, not by content (`:41-44`), because
editing a comment currently reshuffles the whole artifact. Replace `localeCompare` (`:46`, `:53`,
`:57`, `:196`) with codepoint comparison.

### F5. One format

The wrapper forces `FORMAT="markdown"`, and the markdown renderer loses artifact dates (`:285`
prints only `merged=true, closed=true`). Change: `FORMAT="json"` and delete the markdown branch.
The spec records the change in its changelog because it defined the fixture as markdown.

## Rubric changes

### R1. Merged PRs only

The whole "unmerged PR with Core Team approval" path and the whole soft-acceptance path from
comments disappear. An entry is either booked by a merge or it does not exist.

### R2. Two cells in the level table

PoC from L2 to L4, Complex Bug / Deep Refactor from L1 to L3. The level becomes a function of base
points (1.0 = L4, 0.5 = L3, 0.25 = L1), L2 retired. To be checked on the PRM side whether the
disappearance of L2 breaks the tier mapping.

### R3. Impact bonus computed, not judged

+0.25 when a PR touches at least three packages or modules (path prefixes from `filesSummary`),
+0.25 when it touches test paths. Thresholds are literal constants in the rubric. Bounty only with
an explicit number in the PR body; the bounty path is currently inactive because the repo has no
`bounty` label, and the rubric has to note that. Revision 2 adds: bonuses apply only when the base
class is above 0.

### R4. Small-items ceiling

The sum of small items is capped at 1.0 per month; the excess is shown in an exclusions column so
the partner sees the work was noticed but not paid above the ceiling.

The ceiling's scope, stated plainly so nobody counts on more: it closes splitting within one
month (ten small PRs yield 1.0, the same as one large one), it does not close spreading the same
PRs across three months (up to 2.5) or a mix of one large plus nine small (2.0), because only
small items are capped. We do not introduce a global monthly ceiling, because it would punish
months with genuinely large delivery.

It changes payouts and enters only after the program owner's approval.

## Tooling and versioning

### C1. Comparator

`parseReport` reads only `lines[headerIndex + 2]` and silently ignores further rows, and
`Why bonus` (free prose) gates the exit code. Change: all rows, key (profile, range `from..to`), a
missing row is a difference, `Why bonus` outside the gating fields. No `--strict` flag; there is
one caller.

### C2. Version and status of historical reports

Version `2.0-agent`, a changelog entry in the spec, and an explicit sentence: the March and April
2026 reports were produced under a different settlement model, are not comparable with the new
ones, and do not serve to set tiers. Their PRs enter the register as booked so they are not
counted twice.

## Order

1. F2, F3 (without them no dump is credible)
2. F1, F4, F5 (scope and data shape)
3. Register, watermark, rollup exclusion, deduplication
4. R1, R2, C1, C2 (no business decision required)
5. R3, R4 and the grouping rule (they change payouts, after approval)

## Superseded by the current spec

Revision 2 of `.ai/specs/2026-09-01-wic-score-skill.md` settles the points this note left open or
answered differently for the per-PR design:

| This note | Current spec |
|---|---|
| Dedupe key `(repo, headRefName)` | `(repo, headRefOid)`; a branch name can be reused across forks or months |
| `develop` is the second long-lived branch | `develop` retired in `open-mercato/open-mercato` on 2026-10-21; long-lived = default branch + `release/v*` |
| Scope discovered by `gh repo list` (the list above is stale: `cezar-legacy` does not exist, `official-modules` and `ready-apps` are archived) | Explicit allowlist `scripts/wic/repos.json` seeded from public, non-archived, non-fork repos (14 at the 2026-11-14 snapshot) and re-validated on every run |
| Backfill from the March/April reports | Those reports are not in the repository; `BOOKING_START` (default `2026-10-01`) makes pre-history non-bookable, and `scripts/wic/booked.json` accepts an owner-supplied list |
| Small-items cap per partner | Cap per company (the registry maps several logins to one company) |
| Issue credit from `closingIssuesReferences` | API refs plus body-keyword fallback for non-default-branch merges, minus self-dealt credits, deduped by `(repo, issueNumber)` |
