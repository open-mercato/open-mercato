# wic-score-skill — per-PR partner self-scoring of WIC contribution

Source brief: `.ai/specs/briefs/2026-09-01-wic-score-skill.md` (with companion inputs
`2026-09-01-wic-fix-plan-input.md` and `2026-09-01-wic-test-cases-input.md`).
Supersedes the monthly-batch `wic-evaluator` design (commit `6d28c125c`, PR #1703, closed unmerged).

Revision 2 (2026-11-14) answers the two specification reviews on this PR: the ratification
signal is now a queryable team-membership check, the verdict comment is replay-verified by the
ledger, every fact the model judges is pinned to `mergedAt`, impact bonuses and issue credits are
fully specified, and the Phase 3 ledger has a named enumeration call, a payee unit and one
counted verdict per PR.

Revision 3 (2026-11-17) makes the ledger's cross-run state executable: an append-only monthly
projection register carries `headRefOid` and late bookings, the fetcher's normative call list
gains the closing-issue reference source, and the corpus/label agreement split between PR CI and
the owner-run agreement script is stated explicitly.

## 📝 TLDR

A certified partner runs one skill against their own **merged** PR and gets a WIC verdict:
score, base classification with a rubric-row citation, and bullets explaining every point and
every zero. The verdict is posted as a comment on the merged PR — human bullets plus a
machine-readable JSON block — and stays **proposed** until Core ratifies it. Fairness comes from
three mechanisms, not from trusting the model: the fact file is pinned to the merge (so anyone
re-running the skill sees the same inputs), the ledger recomputes every mechanical field from a
fresh fetch and takes only the judged field from the comment, and the judged field is
auto-trusted only after measured agreement with a corpus of ratified verdicts.

## 📝 Overview

| Aspect | Decision |
|---|---|
| Consumer | Certified partners in `.github/certified-partners.yml`; Core runs the ledger |
| Unit of invocation | One merged PR per skill run, partner-invoked, self-service |
| Unit of record | One merged PR; monthly totals are a projection, not an input |
| Judgment surface | Exactly one 4-way base classification; everything else is computed |
| Payment gate | A Core Team 👍 on the verdict comment, then a ledger run in the month the verdict is **ratified** — a late ratification books in its ratification month with `lateOf: "<merge month>"` |
| Artifacts | `.ai/skills/om-wic-score/` (skill, rubric, fetcher), `scripts/wic/` (ledger, booked list) |
| Non-goals | Acceptance-signal mining, unmerged-PR credit, org-wide date-windowed scanning, a second partner registry |

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen answer | Rationale |
|---|---|---|---|
| Q1 | Spec merged in month M, implementation merged in M+1 — book per PR (0.5 + 1.0 = 1.5) or group by spec id and cap at 1.0? | **Per PR, no grouping, no cross-month state.** Spec PR books 0.5, implementation PR books on its own merits. Approved by matgren in-session, 2026-09-01 | Matches the settled "unit of record = one merged PR" rule; grouping requires ledger state keyed by spec id and reopens the split-work dispute. |
| Q2 | `WIC Level` column: delete, or keep as a derived value? | **Keep, derived only** — level is a pure function of base points (1.0 → L4, 0.5 → L3, 0.25 → L1; L2 retired). Never an independent judgment. Approved by matgren in-session, 2026-09-01 (no consumer named) | No in-repo consumer found. Keeping it derived costs nothing and is reversible. |
| Q3 | One spec or two (per-PR verdict skill vs monthly ledger projection)? | **One spec, phased.** Verdict skill is Phase 1–2; ledger projection is Phase 3. | The ledger is the sole consumer of the verdict JSON schema; splitting would put producer and consumer in different specs. |
| Q4 | Does the skill post the verdict comment itself, or print it for manual paste? | **Skill posts via the partner's own `gh` auth**; on posting failure it prints the comment body and exits non-zero so the partner can paste manually. | One less manual step, same authorship, graceful degradation. |
| Q5 | What counts as ratification? | A 👍 (`content: "+1"`) reaction on the verdict comment **from a member of the `@open-mercato/core-team` team**, verified through the team-membership API, whose login is neither the PR author nor the verdict-comment author. | GitHub reactions carry only `user`, `content` and `created_at` — no `author_association` — so the team membership is the only queryable authority. Naming Core Team (not `@core-partners`) is what makes self-ratification impossible: partners are in the partners team, not the Core Team. |
| Q6 | Where does the skill live? | `.ai/skills/om-wic-score/` in `open-mercato/open-mercato`, listed in the `analysis` tier of `.ai/skills/tiers.json` — the same home and tier as `om-wcag-guardian` (matgren's in-session direction). | Precedent: repo-local analysis skills live under `.ai/skills/` with the `om-` prefix, and `om-wcag-guardian` is the `analysis` tier's only current member (`om-gap-analysis` moved to the shared external set in #7694). |
| Q7 | Does issue-reporter credit require the reporter to be a certified partner? | Credit is **emitted** for any reporter, but the monthly ledger only **counts** verdicts and credits for accounts listed in `.github/certified-partners.yml`. | Keeps the per-PR skill mechanical; identity filtering is a ledger concern, one place. |
| Q8 | Who ratifies, and can they ratify their own verdict? | Ratifiers are `@open-mercato/core-team` members only. A ratifier's login MUST differ from both the PR author and the verdict-comment author. Verified with `GET /orgs/open-mercato/teams/core-team/memberships/{username}` — 200 **and** `state: "active"`, since a pending invitation also returns 200; 404 = not a member. | Direct answer to review finding "the ratification signal cannot be queried as written" and to the self-ratification hole. |
| Q9 | Payee unit — company or login? | **Company.** The ledger joins logins to the company entry in `.github/certified-partners.yml` and applies the monthly small-items cap per company, not per login. | The registry at this base holds 22 companies, 16 of them with several logins (54 logins, up to six per company); a per-login cap would pay one company several times the intended ceiling. The counts are a snapshot — the rule, not the number, is normative |
| Q10 | Does the impact bonus apply to a base-0 PR? | **No.** Bonuses are granted only when `baseClass.points > 0`. | Prevents a routine dependency bump from collecting 0.5 while the rubric says routine maintenance is worth 0.0. |
| Q11 | Repository scope for the ledger | An explicit allowlist (`scripts/wic/repos.json`), re-validated at runtime as public and non-archived. | Bounds the monthly scan to the 14 current partner repos instead of an org-wide date-windowed scan. |

## 📝 Problem Statement

Partner compensation needs a contribution measure that is not "count the PRs". One partner can
merge a single huge PR in a month, another ten tiny ones; raw counts reward neither fairly, and
manual scoring does not scale and invites disputes. The first attempt (`wic-evaluator`,
PR #1703) scored whole months in batch and failed on its own evidence: its March 2026 report
gave nine bug reports 2.25 points while a 63-file refactor got 0.75, its fetcher returned silent
empty artifacts on rate limits (exit 0), and its "CRITICAL DETERMINISM RULE" was prose begging a
model to behave — text does not bind. Meanwhile the repo already has a working partner-identity
mechanism (`.github/certified-partners.yml` + the `/label partner-request` comment flow) that
the WIC design ignored.

## 📝 Proposed Solution

Score **one merged PR per invocation**, partner-invoked, with the judgment surface shrunk to a
single 4-way classification and everything else mechanical.

- **Unit of record = merge.** Only a PR merged to a long-lived branch of a public, non-archived
  repo on the ledger's repo allowlist books anything. A long-lived branch is the repository's
  default branch (`main` in `open-mercato/open-mercato`) or a `release/v*` release line;
  `develop` was retired in `open-mercato/open-mercato` on 2026-10-21 and, where another repo
  still has one, counts as long-lived until that repo retires it. Closed-unmerged scores 0 with
  the rule cited. No acceptance-signal mining from comments, no self-certification.
- **Mechanical gates first**, each able to zero the PR with a reason: org repo public and
  non-archived; base ref long-lived; head ref NOT long-lived (release rollups book nothing);
  PR actually merged.
- **Facts from the PR API, not the search API.** Everything the model judges is pinned to the
  merge: the body is hashed (`bodySha`) and the fetcher records whether the body was edited after
  `mergedAt`, and the fact file carries bounded diff excerpts so the rubric class is checked
  against the code rather than against the author's own prose. The search API — with its
  1000-result ceiling and `--paginate` JSON breakage — is not used at all.
- **The only model judgment left: the base class** (1.0 / 0.5 / 0.25 / 0), citing the rubric
  row, conservative on hesitation. Impact bonuses and issue credits are computed, not judged.
- **Carried-forward work is paid to the author who did it.** A merged PR that declares
  `Supersedes #N` books to the superseded PR's author when that PR closed unmerged, using the
  same Supersede Credit Rule the changelog skill already applies.
- **The verdict is a PR comment** with human bullets and a machine block; **proposed** until
  ratified by Core. Ratified verdicts accumulate into a labeled corpus; the model's base
  classification is auto-trusted only after measured agreement ≥95% against that corpus.

Alternatives considered and rejected:
- *Monthly batch scoring* (the `wic-evaluator` shape): needs the search API, date windows,
  watermarks and multi-profile handling; input drifts under the evaluator; one silent fetch
  failure poisons a whole month. The per-PR shape deletes that entire apparatus.
- *Fully mechanical scoring* (points from diff stats): the brief's own premise is that size is
  not contribution; a formula on lines/files pays for bloat and punishes hard small fixes.
- *A separate WIC identity registry*: `.github/certified-partners.yml` already exists, is
  Core-reviewed, and gates the label flow; a second registry would drift from it.
- *Keying the rollup gate on `isCrossRepository` instead of the head branch name*: it would let
  a fork's deliberately-named `develop` head book as ordinary work. The branch-name rule is
  conservative and the verdict cites it, so the partner can appeal to the program owner. Left
  unchanged; revisit only with evidence of a real mis-scored PR.

## 📝 Architecture

Three layers, deliberately separated by what they can compute:

1. **Per-PR skill** (`.ai/skills/om-wic-score/`) — partner-invoked, one PR per run.
   - `scripts/fetch_pr.mjs` — fetch + gates + pinning. Input: PR URL. Output: canonical fact JSON.
   - `references/wic-rubric.md` — rubric v `2.0-agent`, the only scoring source of truth.
   - `SKILL.md` — the agent workflow: run fetcher, apply rubric, render verdict, post comment.
2. **Ratification** — a Core Team 👍 on the verdict comment (Q5/Q8); no code in the skill. The
   ledger is the only component that interprets it, and it re-derives everything mechanical
   before paying.
3. **Ledger projection** (`scripts/wic/wic_month.mjs`, Phase 3) — owner-side monthly sum over an
   explicit repo allowlist: enumerate merged PRs in the merge-month window plus verdict comments
   ratified in the run month, verify each verdict comment and its ratification, drop the judged
   field's claim when it disagrees with a fresh fetch, filter the **booked** author against
   `certified-partners.yml` (for a supersede booking that is the superseded PR's author, and a
   superseded author who is not in the registry books nothing — the declaring author books nothing
   for that PR either), apply the company-scoped small-items cap, the supersede rule and the
   head-SHA dedupe, and flag merged partner PRs missing verdicts.

What is reused: `gh` CLI auth, `.github/certified-partners.yml`, the org's `@core-team` team as
the ratifier set, the partner comment-flow grammar (comment → check → reaction), `.ai/skills/`
layout and tiers, and the changelog skill's Supersede Credit Rule. What is deleted relative to
commit `6d28c125c`: the org-wide scan, watermark, date windows, multi-profile input, all
search-API code, the bounty branch (no `bounty` label exists; returns as one paragraph when the
first real bounty does), the 146-line markdown comparator plus its smoke test, the fetcher's
markdown output branch, and the determinism prose (replaced by a replay test).

### Scoring pipeline (per run)

```
PR URL
  → gates: org? public? non-archived? merged? base long-lived? head not long-lived?
      any gate fails → verdict: 0, rule cited, stop
  → facts (pinned to mergedAt): changedFiles[] + bounded patch excerpts, packagesTouched[],
      testPaths[], touchesTests, baseRefName, headRefName, headRepositoryOwner, headRefOid,
      mergedAt, body + bodySha + bodyEditedAfterMerge, title,
      closingIssues[] {repo, number, reporter, url, source}, supersedes[] {number, author, state}
  → base class (model judgment, rubric row cited; title/body are claims checked against the
      diff excerpts, never sufficient alone for 0.5 or 1.0): 1.0 | 0.5 | 0.25 | 0
  → impact bonus (computed, granted only when base > 0):
      +0.25 if packagesTouched has ≥ 3 distinct package units  → max +0.5 overall
      +0.25 if touchesTests
  → issue credits (computed): 0.25 for each closed issue whose reporter ≠ PR author;
      deduped at the ledger by (repo, issueNumber); booked to the reporter in the merge month
  → supersede credit (computed): if the PR declares "Supersedes #N" and #N closed unmerged,
      the PR books to #N's author, and the declaring author books nothing
  → verdict JSON → rendered comment → posted on the PR (status: proposed)
```

Maximum score per PR: 1.5 (base 1.0 + impact 0.5). Issue credits are booked to the **reporter**
and are not part of the PR author's per-PR score.

### Definitions the replay test depends on (normative)

- **Package unit** — for a path under `packages/<name>/…` or `apps/<name>/…`, the unit is
  `packages/<name>` or `apps/<name>` (two segments). Every other path (`.ai/`, `.github/`,
  `scripts/`, `docs/`, root files) collapses into the pseudo-unit `repo-root`, which is recorded
  in `packagesTouched[]` for transparency but **never counts** toward the ≥3 threshold.
- **Test path** — matches any of `**/__tests__/**`, `**/__integration__/**`, `**/tests/**`,
  `**/e2e/**`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`. Glob matching is
  case-sensitive and evaluated against the PR-relative path.
- **Bounded diff evidence** — `changedFiles[]` is sorted by path; each entry carries
  `patchExcerpt` (the file's unified patch, truncated to 2,000 codepoints) and `patchTruncated`
  (bool). At most 40 files carry a patch excerpt — the 40 largest by `additions + deletions`,
  tie-broken by path — and every other entry carries `patchExcerpt: null`. This bound is a
  constant, so replay stays byte-identical.
- **Small-items cap** — applies per company per merge month to the sum of (a) the **total score**
  of every entry whose `baseClass.points` is 0.25 and (b) every issue credit, each credit counted
  against the **reporter's** company; the ceiling is 1.0. A 0.25-base PR with both bonuses
  therefore consumes its 0.75 total, not 0.25. Excess is listed as noticed-but-not-paid. No
  global monthly ceiling: it would punish months with real delivery.
- **Head-SHA dedupe** — a booking is keyed by `(repo, headRefOid)`; when the same head SHA reaches
  two long-lived bases of the same repo (the release-line backport pattern) it books once. Two
  different PRs that reuse a branch name have different head SHAs and both book.
- **Cross-run projection register** — `scripts/wic/projections/<YYYY-MM>/<YYYYMMDDTHHMMSSZ>.json`,
  one immutable file per ledger run, written atomically (`temp + mv`) and never rewritten. Each
  file holds the run's entries `{repo, prNumber, headRefOid, booked, payoutMonth, lateOf}` plus
  its totals, and the run's stdout diff is computed against the newest earlier file in the same
  month directory. This register is the ledger's only cross-run state: it supplies the
  `headRefOid` that makes the head-SHA dedupe work across months and the `lateOf` marker that
  records a verdict booked outside its merge month.
- **Dedupe winner** — when two entries collide on the dedupe key (same head SHA, or two PRs
  closing one issue), the earliest merge wins; a tie on the merge timestamp goes to the lower PR
  number. The losing entry is listed in `exceptions[]` and pays nothing, so a month's totals never
  depend on enumeration order.

### Rubric v2 (summary — full text lives in `references/wic-rubric.md`)

| Base points | Level (derived) | Contribution class |
|---:|---|---|
| 1.0 | L4 | Complete core module; new feature with spec + implementation; major working PoC |
| 0.5 | L3 | Comprehensive feature spec on its own; complex bug / deep multi-file refactor |
| 0.25 | L1 | Small hardening, restoration (merged PRs only — bug reports are never a base class; they pay solely through the issue-credit path) |
| 0.0 | — | Routine maintenance (dependency bumps, trivial edits), rollups, anything unmerged |

Rules carried from the fix-plan: levels are derived from points only (L2 retired); impact
thresholds are literal constants; on hesitation between two classes, take the lower; a spec under
`.ai/` books like any other merged PR. Two rubric rules are added in revision 2:

- **Bonuses require a base above 0** (Q10): a base-0 PR scores 0.0 no matter how many packages or
  test paths it touches.
- **The title and body are claims, not evidence.** A 0.5 or 1.0 class requires the diff excerpts
  to corroborate the claim; where the excerpt is truncated or unavailable, the rubric row must
  still be justified by the paths, line counts and excerpt that are present, and hesitation takes
  the lower class.

Determinism is enforced by two different checks, split by who can run them. The **PR CI replay
test** asserts only the mechanical fields (gates, impact, credits, supersede, score arithmetic),
byte-identical across three runs, with no model credential involved. The **owner-run agreement
script** (Implementation Plan step 10) is what compares `baseClass` to the corpus case's expected
label and reports the agreement rate — self-consistency alone proves nothing about a judged field,
and a label comparison in CI would either repeat the stored label or need a model CI does not
have.

## 📝 Data Models

No database. Two JSON shapes, both versioned.

**Fact file** (`wic-facts-2`, fetcher output, canonical, replayable):

```
schemaVersion, repo, defaultBranch, prNumber, url, author, mergedAt, mergeMonth,
baseRefName, baseLongLived, headRefName, headNotLongLived,
headRepositoryOwner, headRefOid, isCrossRepository,
additions, deletions,
changedFiles[] {path, additions, deletions, patchExcerpt, patchTruncated},
packagesTouched[], testPaths[], touchesTests,
title, bodySha, bodyEditedAfterMerge,
closingIssues[] {repo, number, reporter, url, source},   // source: "closing-refs" | "body-keywords"
supersedes[] {number, author, state},                     // state: "closed-unmerged" | "merged" | "open"
gates {eligibleRepo, merged, baseLongLived, headNotLongLived}
```

`bodySha` is the SHA-256 of the body the fetcher used, prefixed `sha256:`. The fetcher also reads
GraphQL `pullRequest.lastEditedAt`; when it is later than `mergedAt`, it sets
`bodyEditedAfterMerge: true` and the verdict lists that in its notes, because the body is an input
the payee can still change after the merge.

Deterministic: keys sorted, arrays sorted by stable ids (files by path, issues by
`(repo, number)`), codepoint string compares, no run timestamps in the payload (`generatedAt`
goes to a sidecar). Written via temp file + `mv`; on any fetch error nothing is written and the
exit code is non-zero (three retries with backoff on 403/429 first).

**Verdict block** (inside the PR comment, in `<details>`):

```json
{
  "wicVerdict": "wic-verdict-2",
  "rubricVersion": "2.0-agent",
  "promptVersion": "2026-09-01",
  "model": "reported by the running agent, e.g. \"claude-sonnet-4-5\"",
  "repo": "open-mercato/open-mercato",
  "pr": 1234,
  "author": "partner-login",
  "mergeMonth": "2026-09",
  "headRefOid": "0f1e2d3c…",
  "bodySha": "sha256:…",
  "gates": {"eligibleRepo": true, "merged": true, "baseLongLived": true, "headNotLongLived": true},
  "baseClass": {"points": 0.5, "level": "L3", "rubricRow": "complex-bug-deep-refactor"},
  "impact": {"packages": 4, "packagesBonus": 0.25, "touchesTests": true, "testsBonus": 0.25, "bonusApplied": true},
  "score": 1.0,
  "credits": [{"repo": "open-mercato/open-mercato", "issue": 987, "reporter": "someone", "points": 0.25, "source": "closing-refs"}],
  "supersedes": [],
  "postedBy": "partner-login",
  "status": "proposed",
  "notes": ["small-items cap, supersede booking and head-SHA dedupe are resolved at the ledger, not here"]
}
```

Sensitive data: none — everything quoted is already public on the PR. The skill never reads
credential stores; `gh` supplies auth.

## 📝 API Contracts

**Fetcher CLI** — `node .ai/skills/om-wic-score/scripts/fetch_pr.mjs <pr-url> [--out <path>]`.
The skill workflow also honors `--no-post` (render the verdict, skip the comment) for dry runs.
Exit 0 with fact JSON only when every fact was fetched; any failure → non-zero exit, no file.
Uses only: `gh api repos/{o}/{r}` (visibility/archived/default branch),
`gh api repos/{o}/{r}/pulls/{n}` (PR facts incl. `merged_at`, `base`, `head`, `body`, `title`),
`gh api repos/{o}/{r}/pulls/{N}` (one read per PR named in a `Supersedes #N` line, for its state
and author), `gh api repos/{o}/{r}/pulls/{n}/files --paginate` (paths, counts, patches),
`gh api repos/{o}/{r}/issues/{i}` (one read per closing issue, for its reporter; this read covers
entries from both `source` values), and one `gh api graphql` query for
`pullRequest.lastEditedAt` and `pullRequest.closingIssuesReferences` —
`closingIssuesReferences` is the `closing-refs` half of `closingIssues[]` and is not present on the
REST pull object, so the GraphQL query (or `gh pr view --json closingIssuesReferences`) is
normative, not optional. It does not use the search API.

**Verdict comment** — one comment, two parts, posted by the partner's account:
- Human bullets: score; base class + rubric-row citation and the excerpt evidence it rests on;
  each bonus granted or not with its computed inputs (`4 packages ≥ 3 → +0.25`, or
  `base 0 → bonus suppressed`); each gate that zeroed anything; each issue credit with its
  `source` (body-derived credits are labelled `unverified from the API — confirmed by
  ratification`); any supersede booking; the ledger note.
- Machine block: the verdict JSON above inside `<details><summary>wic-verdict json</summary>`.
  Monthly summing must be a query over these blocks, never archaeology over prose.

**Ratification** (consumed by the ledger only). The ledger run needs a token that can read
organization teams (`read:org`, or the fine-grained "Members" organization permission), because
team membership is not visible on a reaction object:
1. List reactions with
   `GET /repos/{o}/{r}/issues/comments/{comment_id}/reactions?per_page=100` and follow the
   `Link` pagination; keep `content == "+1"`, ordered by `created_at`, earliest first.
2. Read the comment with `GET /repos/{o}/{r}/issues/comments/{comment_id}`; its `updated_at` is
   the last edit time.
3. For each reactor, resolve membership with
   `GET /orgs/open-mercato/teams/core-team/memberships/{username}` — count it only when the
   response is 200 **and** its `state` is `"active"`; a pending invitation also returns 200, and
   404 means not a member.
4. Drop reactors whose login equals the PR author or the verdict comment's author.
5. Drop the reaction when the comment's `updated_at` is later than the reaction's `created_at`;
   the ledger then recomputes and flags instead of paying.
6. The first surviving reaction is the ratification; its `created_at` is the ratification time.

**Ledger CLI** (Phase 3) —
`node scripts/wic/wic_month.mjs --month 2026-09 [--as-of <ISO date>] [--dry-run]`.

- **Repos** — `scripts/wic/repos.json` (allowlist, see the appendix). Each run re-validates every
  entry as public and non-archived; a repo that fails the check is reported and skipped, never
  silently dropped.
- **Enumeration** — three passes, all hard-failing rather than shrinking the month:
  1. **Merged PRs** — per repo,
     `gh api "repos/{o}/{r}/pulls?state=closed&sort=updated&direction=desc&per_page=100"` page by
     page. Keep PRs with `merged_at` inside the month window and a long-lived `base.ref`. Stop
     paging a repo once an entire page has `updated_at` earlier than the window start; hard-fail
     after 50 pages.
  2. **Late ratifications** — the same repo allowlist queried for verdict comments created or
     reacted to inside the run month
     (`gh api "repos/{o}/{r}/issues/comments?since=<month start>&per_page=100"` page by page,
     keeping only bodies that carry the `wicVerdict` marker and hard-failing after 100 pages, plus
     the `issues/comments/{id}/reactions` reads the ratification check already makes). A comment
     whose ratification time falls in the run month but whose PR merged earlier is a late booking:
     it is verified like any other verdict and paid this month with `lateOf: "<merge month>"`.
     This is the discovery path the merge-month window alone cannot provide.
  3. **Register replay** — every earlier projection file under `scripts/wic/projections/` is read
     so the entries already booked and their `headRefOid` values are known before anything is
     paid; the diff printed for the month is against the newest earlier file in that month's
     directory.
  The repo allowlist plus the stop rule bound the scan; the search API is not used, so the
  1000-result ceiling cannot truncate a month.
- **Cross-month dedupe** — head-SHA and issue dedupe consult the projection register, so the same
  `(repo, headRefOid)` booked in an earlier month is not booked again in this one. The winner rule
  is the Definitions tie-break (earliest merge, then lowest PR number); the loser is listed in
  `exceptions[]`.
- **Hard-error rules, same as the fetcher** — three retries with backoff on 403/429, then a
  non-zero exit with the error; no partial output (`temp + mv`); a page that cannot be fetched
  fails the whole run rather than producing a smaller month.
- **Verification per verdict comment** — re-fetch the PR, recompute gates, `packagesTouched`,
  `touchesTests`, credits, supersede and score arithmetic, and take only `baseClass.points`,
  `baseClass.rubricRow` and `notes` from the comment. Any mismatch (including a `bodySha`
  mismatch, i.e. a body edited after scoring) marks the entry `flagged` in the exceptions column
  and pays nothing until re-scored and re-ratified.
- **One counted verdict per `(repo, prNumber)`** — the earliest ratified verdict wins; a second
  verdict on the same PR, from any author, is listed in exceptions. The payee login is taken from
  the PR API (`author.login`), never from the comment's `author` field.
- **Enumeration of missing verdicts** — the same enumeration minus PRs with a verified ratified
  verdict is printed as the sweep; the ledger exits non-zero with `--fail-on-missing` (owner CI
  uses the flag), so a forgotten run is visible instead of underpaying a month quietly.
- **Output** — a table keyed `company, login, repo, pr, base, impact, score, credits, booked,
  lateOf, exceptions[]`, plus totals per company. `--dry-run` prints it without writing.
- **Provisional vs final** — a run for month M is *provisional* until `--as-of` is later than the
  end of M + 30 days. A later run may only add entries — a late-ratified verdict books in the
  month of its ratification with `lateOf: "<merge month>"` and is discovered by enumeration pass 2
  — and prints the diff against the newest earlier projection file in
  `scripts/wic/projections/<YYYY-MM>/`. Nothing is ever rewritten: each run writes one new
  immutable projection file, and the register (Definitions → Cross-run projection register) is the
  only state carried between runs.
- **Backfill** — `scripts/wic/booked.json` holds `{repo, prNumber, bookedAt, reason}` entries and
  `BOOKING_START` (default `2026-10-01`). It records the one-off owner-supplied pre-`BOOKING_START`
  list; ongoing cross-month state lives in the projection register, not here. Nothing merged
  before `BOOKING_START` books, so the
  March/April 2026 pilot months cannot double-count without a list of their PRs; the owner may
  supply that list later (see Risks).

## 📝 Edge Cases & Failure Scenarios

- **Closed-unmerged PR** → verdict 0 immediately, rule cited. The partner sees why, not a crash.
- **Fetch failure / rate limit** → retries, then hard non-zero exit with the error; no partial
  fact file, no verdict. Never a silent zero (the old fetcher's exit-0-empty-artifact failure).
- **Comment posting fails** (no auth, network) → verdict printed to stdout, non-zero exit,
  instruction to paste manually.
- **Fork PRs** (the partner norm): facts come from the base repo's PR object, so nothing needs
  the fork; `headRepositoryOwner` and `headRefOid` are recorded from it. Head-ref rollup
  exclusion applies to the head *branch name* regardless of fork — a fork's `develop` merged
  into upstream `main` is excluded; the verdict cites the rule and the partner can appeal.
- **Same head SHA reaches two long-lived branches** (release-line backport) → both PRs get
  verdicts; the ledger books one, keyed by `(repo, headRefOid)`, and the verdict note says so.
  Two PRs reusing one branch name have different head SHAs and both book.
- **A PR carries forward someone else's work** → the declaring PR books to the superseded
  author when that PR closed unmerged; the declaring author books nothing for it, and the verdict
  names both PRs.
- **Body edited after merge** → `bodyEditedAfterMerge: true` in the fact file and in the verdict
  notes; if it happens after scoring, the ledger's `bodySha` check flags the entry.
- **Verdict comment edited after ratification** → the ratification is void for that edit; the
  ledger recomputes and flags rather than paying a number nobody ratified.
- **A second verdict on the same PR, or one posted by someone other than the author** → only the
  earliest ratified `(repo, prNumber)` counts; the rest are listed in exceptions. The payee is
  always the PR author from the API.
- **Non-partner runs the skill** → verdict posts fine (it is just a comment); the ledger ignores
  authors who are not in `certified-partners.yml` or whose company entry is missing.
- **PR merged then repo archived/made private later** → verdicts already ratified stand; new
  runs fail the repo gate. The ledger reads ratified comments, not repo state.
- **Rubric ambiguity** → the rubric's tie-break is explicit: take the lower class. The replay
  test (3 identical runs per corpus case) and the corpus agreement measure are the enforcement,
  not trust.

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Model misclassifies the base class, mis-paying a partner | High | Payouts | Proposed-then-ratified for every verdict; ledger recomputes all mechanical fields; corpus of ratified labels; auto-trust only at ≥95% over ≥40 cases; refusal to pay a mismatched verdict | A ratifier approves a wrong class; the corpus measure is the only signal, and it lags by one ratification cycle |
| A ratifier self-deals (partner who is also Core) | High | Payouts | Ratifier set is `@core-team`; PR author and verdict author excluded by login; reactions are public and permanent | An actual Core member can still ratify a peer's inflated verdict; audit is post-hoc via the public ledger |
| Body/title rewritten after merge to inflate the class | Medium | Payouts | `bodySha` pinned and checked by the ledger; `bodyEditedAfterMerge` surfaced; diff excerpts required for 0.5/1.0 | Truncated excerpts can hide intent on very large PRs; hesitation rule biases downward |
| Payout-affecting decisions made silently | High | Governance | Q1, Q2 approved by matgren in-session 2026-09-01; every revision-2 change is listed in the Changelog and needs owner sign-off before Phase 3 ships | A future default could still slip in through a spec edit; the changelog is the control |
| Ledger under-pays a month through a partial fetch | High | Payouts | Same hard-error rules as the fetcher; atomic output; missing-verdict sweep with `--fail-on-missing`; provisional-until-+30-days allows later additions only | A partner who never runs the skill still loses that PR's points until the sweep is acted on |
| Backfill data for March/April 2026 is unavailable | Medium | Payouts | `BOOKING_START` makes pre-2026-10 history non-bookable by default; `booked.json` accepts an owner-supplied list at any time | If the pilot reports surface later, the list must be seeded before the first Phase 3 run that reaches those PRs |
| Replay test proves self-consistency, not correctness | Medium | Scoring | Corpus labels are owner-authored; `baseClass` is compared to the label, not just re-run | Corpus drift as the rubric's examples age; mitigated by ratifications adding cases |
| Blast radius | Low | Repository | Additive: a new skill directory, a rubric doc, a ledger script, comments on merged PRs. No app code, no schema, no existing surface changes. Rollback = delete the directory and stop posting comments; ratified history remains readable | Comments already posted stay on PRs |
| Compatibility | Low | Contracts | No protected surface touched (`BACKWARD_COMPATIBILITY.md` n/a — docs and tooling only) | None identified |

## 📋 Phasing

- **Phase 1 — rubric + per-PR verdict skill** (shippable alone: partners can score and post).
- **Phase 2 — ratification contract + replay corpus** (shippable alone: makes verdicts testable
  and defines the ratification signal; verdicts become *payment-binding* only when the Phase 3
  ledger reads them).
- **Phase 3 — monthly ledger projection** (owner-side summing, cap/dedupe/supersede/sweep;
  depends on verdict comments existing).

## 📋 Implementation Plan

**Phase 1**
1. Write `references/wic-rubric.md` v`2.0-agent` (tables above, tie-break rule, derived levels,
   base-0 bonus suppression, the "title and body are claims" rule, the normative package-unit and
   test-path definitions, one-sentence determinism note). *Test: doc review; every rule has a
   `rubricRow` id.*
2. Implement `scripts/fetch_pr.mjs` (gates, pinned facts, bounded diff excerpts, `bodySha`,
   last-edited check, closing-issue reads incl. body-keyword fallback, supersede parse,
   canonical JSON, hard errors, retries, temp+mv). *Test: fixture run against a real merged PR;
   error paths via revoked-token and bogus-URL runs; no file on failure.*
3. Write `SKILL.md`: workflow fetch → classify → render → post; verdict JSON schema (with
   `model`, `rubricVersion`, `promptVersion`); human-bullets template; posting fallback.
   *Test: end-to-end dry run on one merged PR, `--no-post`.*
4. Add `om-wic-score` to the `analysis` tier in `.ai/skills/tiers.json` and broaden that tier's
   description beyond "Draft accessibility review (WCAG 2.2 AA)". *Test: schema validates; the
   description names both skills.*

**Phase 2**
5. Freeze the bootstrap corpus under `scripts/test/corpus/`: gate cases M1–M5 and M10–M13,
   issue-credit cases M8/M9/R6, rubric cases R1–R5 (see the companion test-case inventory, updated
   with M11 supersede, M12 branch-name reuse across forks and M13 base-0 dependency bump) — each
   fact JSON paired with an expected verdict labeled by the program owner, plus the ledger-layer cases L1–L7. *Test: corpus files are
   canonical fact JSONs with expected verdicts.*
6. Add the mechanical replay test at `scripts/__tests__/wic-score-replay.test.mjs` so
   `yarn test:scripts` picks it up: for each corpus case, three scoring runs must produce
   byte-identical mechanical fields. The test asserts no `baseClass` label match — that comparison
   needs a model and belongs to the owner-run agreement script in step 10 — it only checks that
   `baseClass` is self-consistent across the three runs and well-formed (a rubric row id and a
   points value from the allowed set). *Test: the test itself; seed one deliberate mechanical
   drift to see it fail.*
7. Document the ratification contract in `SKILL.md` (Q5/Q8 rule, the six verification steps) and
   the corpus-growth loop (each ratified verdict may be added as a labeled case). *Test: doc
   review.*

**Phase 3**
8. Implement `scripts/wic/wic_month.mjs` (allowlist + re-validation, the three enumeration passes,
   hard errors, per-verdict recomputation, company payee unit, cap, register-backed head-SHA
   dedupe with the tie-break winner, supersede booking, one-verdict rule, late verdicts via
   `lateOf`, the immutable projection register, sweep, provisional/final). *Test: fixture month
   with a capped small-items pile, a backport pair, a superseded PR, a flagged tampered verdict, a
   late-ratified verdict from an earlier month, a register entry that already booked the same
   `headRefOid`, and one missing verdict; expected totals asserted.*
9. Seed `scripts/wic/booked.json` and `BOOKING_START`; backfill only if the owner supplies the
   March/April 2026 PR list. *Test: re-running the month over pre-`BOOKING_START` PRs books
   nothing.*
10. Measure model-vs-human agreement over the labeled corpus: bootstrap labels plus every ratified
    live verdict appended since (each ratification adds a labeled case). Publish the number in the
    skill README. Auto-trust switch only at ≥95% over at least 40 labeled cases, and only by a
    follow-up decision. The agreement run is a program-owner-run script — no model credential in
    PR CI, so the mechanical replay test stays the only CI gate. *Test: agreement script output
    over the labeled set.*

## ✅ Final Compliance Report

| Requirement | Where |
|---|---|
| Ratification signal is queryable and cannot self-ratify | Q5, Q8, API Contracts → Ratification (6 steps) |
| Ledger cannot pay a number nobody ratified | API Contracts → Verification per verdict comment (comment `updated_at`, recompute, flag) |
| Inputs the model judges are pinned to the merge | Data Models (fact file: `bodySha`, `bodyEditedAfterMerge`, bounded `patchExcerpt`), Rubric ("title and body are claims") |
| Impact bonus is defined and cannot pay a base-0 PR | Definitions (package unit, test path), Q10, Rubric |
| Issue credit cannot be self-dealt or double-counted | Pipeline, Definitions (dedupe), Edge Cases |
| Non-default-branch merges still emit issue credit | Fetcher call list (`issues/{i}` read), `closingIssues[].source` |
| Head dedupe cannot collide across forks or reused branch names | Data Models (`headRepositoryOwner`, `headRefOid`), Definitions (head-SHA dedupe) |
| CI replay test is buildable and CI-runnable | Implementation Plan step 6 (`scripts/__tests__/`), step 10 (owner-run agreement) |
| Required spec sections and risk structure | This section; Risks table with severity/area/mitigation/residual |
| Backfill has a source | API Contracts → Backfill, Implementation Plan step 9 |
| Ledger names its enumeration call, payee unit, one-verdict rule, late verdicts | API Contracts → Ledger CLI (three enumeration passes), Definitions (register, dedupe winner) |
| Cross-run state is executable (late bookings, cross-month dedupe, projection diff) | Definitions → Cross-run projection register; Ledger CLI → Late ratifications, Cross-month dedupe, Provisional vs final |
| English-only companion briefs, no local paths | `briefs/2026-09-01-wic-fix-plan-input.md` translated; `~/Documents/OM` and session ids removed |
| No protected contract surface touched | No code, schema, API, event or generated file changes |

## 📅 Changelog

| Date | Change |
|---|---|
| 2026-09-01 | Initial spec (`wic-verdict-1` shape): per-PR verdict, gates, rubric v2.0, phased ledger |
| 2026-10-22 | Review of head `5e3eb6be`: carried-forward work, develop-merge issue credit, body editability, ratification queryability, post-ratification edits, bonus definition, issue-credit dedupe, head dedupe collisions, ledger enumeration/payee/late verdicts, CI replay placement, missing sections, backfill source |
| 2026-11-14 | Revision 2: Q5 ratification rewritten to the `@core-team` membership check (Q8); ledger verification/recompute and the comment-edit rule; `bodySha`/`bodyEditedAfterMerge`/bounded diff excerpts; package-unit and test-path definitions; base-0 bonus suppression (Q10); issue-credit self-deal and `(repo, issueNumber)` dedupe; `headRepositoryOwner`/`headRefOid` dedupe; supersede booking; ledger enumeration via the repo allowlist (Q11), company payee unit (Q9), one-verdict rule, late verdicts, provisional/final; replay test moved to `scripts/__tests__/`; Overview, Final Compliance Report and this changelog added; Polish companion brief translated |
| 2026-11-17 | Revision 3: append-only monthly projection register (`scripts/wic/projections/<YYYY-MM>/<stamp>.json`) as the ledger's only cross-run state, with a late-ratification enumeration pass, register-backed cross-month head-SHA dedupe and a stated tie-break winner; fetcher call list gains `closingIssuesReferences` as the normative `closing-refs` source; ratification requires `state: "active"` membership and paginated reactions; PR CI replay asserts mechanical fields only while the owner-run agreement script owns the label comparison; Q6 re-cites `om-wcag-guardian` and step 4 broadens the `analysis` tier description; Q9 registry counts refreshed to this base; supersede bookings filter the booked author against the registry |

## 📎 Appendix — Repository allowlist (`scripts/wic/repos.json`)

The Phase 3 ledger reads exactly these repositories. The list is seeded from
`gh repo list open-mercato --json name,isPrivate,isArchived` filtered to public, non-archived,
non-fork repos — snapshot taken 2026-11-14 — and stored as data in `scripts/wic/repos.json`. Every
run re-validates each entry as public and non-archived; a repo that fails is reported and skipped,
never silently dropped. Adding or removing a repo is a one-line data change plus a changelog entry.

| Repository | Default branch | Long-lived bases | License |
|---|---|---|---|
| `open-mercato/open-mercato` | `main` | `main`, `release/v*` | MIT |
| `open-mercato/cezar` | `main` | `main`, `develop` while it lasts | MIT |
| `open-mercato/modules` | `main` | `main` | MIT |
| `open-mercato/skills` | `main` | `main` | MIT |
| `open-mercato/create-mercato-module` | `main` | `main` | MIT |
| `open-mercato/create-mercato-template` | `main` | `main` | MIT |
| `open-mercato/n8n-nodes` | `main` | `main` | MIT |
| `open-mercato/mercato-readiness-scanner` | `main` | `main` | none |
| `open-mercato/api-client-example` | `main` | `main` | MIT |
| `open-mercato/context-scope` | `main` | `main` | none |
| `open-mercato/open-mercato-evals` | `main` | `main` | MIT |
| `open-mercato/aida-ux` | `main` | `main` | none |
| `open-mercato/ready-app-oss-prm` | `main` | `main` | none |
| `open-mercato/open-mercato-infra` | `main` | `main` | none |

Five repos carry no `LICENSE` file. Eligibility is "public and non-archived", not "has a license",
so they stay in the list; the missing licenses are a separate hygiene issue. Two public repos are
excluded because they are archived — `open-mercato/official-modules` and
`open-mercato/ready-apps` — and re-enter automatically once unarchived, since the seeding filter is
the source of truth for the next snapshot.
