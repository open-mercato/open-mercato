# wic-score-skill — per-PR partner self-scoring of WIC contribution

Source brief: `.ai/specs/briefs/2026-09-01-wic-score-skill.md` (with companion inputs
`2026-09-01-wic-fix-plan-input.md` and `2026-09-01-wic-test-cases-input.md`).
Supersedes the monthly-batch `wic-evaluator` design (commit `6d28c125c`, PR #1703, closed unmerged).

## 📝 TLDR

A certified partner runs one skill against their own **merged** PR and gets a WIC verdict:
score, base classification with a rubric-row citation, and bullets explaining every point and
every zero. The verdict is posted as a comment on the merged PR — human bullets plus a
machine-readable JSON block — and stays **proposed** until Core ratifies it. Fairness comes from
replayability (a merged PR is immutable, so anyone re-running the skill must reproduce the
number) and a public ledger of ratified verdicts, not from trusting the model.

## Resolved assumptions (autonomous defaults)

| # | Question | Chosen answer | Rationale |
|---|---|---|---|
| Q1 | Spec merged in month M, implementation merged in M+1 — book per PR (0.5 + 1.0 = 1.5) or group by spec id and cap at 1.0? | **Per PR, no grouping, no cross-month state.** Spec PR books 0.5, implementation PR books on its own merits. Approved by matgren in-session, 2026-09-01 | Matches the already-decided "unit of record = one merged PR" rule; grouping requires ledger state keyed by spec id and reopens the settled dispute about splitting work. |
| Q2 | `WIC Level` column: delete, or keep as a derived value? | **Keep, derived only** — level is a pure function of base points (1.0 → L4, 0.5 → L3, 0.25 → L1; L2 retired). Never an independent judgment. Approved by matgren in-session, 2026-09-01 (no consumer named) | No in-repo consumer found (`.ai/skills/tiers.json` is skill-install tiers, unrelated). Keeping it derived costs nothing and is reversible; deleting it may break an external consumer we cannot see from the repo. |
| Q3 | One spec or two (per-PR verdict skill vs monthly ledger projection)? | **One spec, phased.** Verdict skill is Phase 1–2; ledger projection is Phase 3. | The ledger is the sole consumer of the verdict JSON schema this spec defines; splitting would put the schema's producer and consumer in different specs. The tooling still ships separately as Phase 3. |
| Q4 | Does the skill post the verdict comment itself, or print it for manual paste? | **Skill posts via the partner's own `gh` auth**; on posting failure it prints the comment body and exits non-zero so the partner can paste manually. | One less manual step, same authorship (the partner's account), graceful degradation. |
| Q5 | What counts as ratification? | A 👍 reaction **or** an approving reply on the verdict comment from a user whose `author_association` is `MEMBER` or `OWNER`. `COLLABORATOR` is excluded — certified partners may hold collaborator access and must not self-ratify. | Mirrors the `/label partner-request` grammar partners already know; queryable via the API. |
| Q6 | Where does the skill live? | `.ai/skills/om-wic-score/` in `open-mercato/open-mercato`, listed in the `analysis` tier of `.ai/skills/tiers.json` — the same home and tier as `om-gap-analysis` (matgren's in-session direction). | Precedent: repo-local analysis skills (`om-gap-analysis`, `om-app-spec-writing`) live under `.ai/skills/` with the `om-` prefix. |
| Q7 | Does issue-reporter credit require the reporter to be a certified partner? | Credit is **emitted** for any reporter, but the monthly ledger only **counts** verdicts and credits for accounts listed in `.github/certified-partners.yml`. | Keeps the per-PR skill mechanical; identity filtering is a ledger concern, one place. |

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

- **Unit of record = merge.** Only a PR merged to a long-lived branch (`develop` where it
  exists, plus the default branch) of a public, non-archived repo in the `open-mercato` org
  books anything. Closed-unmerged scores 0 with the rule cited. No acceptance-signal mining
  from comments, no self-certification.
- **Mechanical gates first**, each able to zero the PR with a reason: org repo public and
  non-archived; base ref long-lived; head ref NOT long-lived (release rollups book nothing);
  PR actually merged.
- **Facts from the PR API, not the search API.** All inputs are immutable after merge, so the
  frozen fixture is just the canonical JSON of one PR and determinism stops being hard. The
  search API — with its 1000-result ceiling and `--paginate` JSON breakage — is not used at all.
- **The only model judgment left: the base class** (1.0 / 0.5 / 0.25 / 0), citing the rubric
  row, conservative on hesitation. Impact bonuses are computed, not judged.
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

## 📝 Architecture

Three layers, deliberately separated by what they can compute:

1. **Per-PR skill** (`.ai/skills/om-wic-score/`) — partner-invoked, one PR per run.
   - `scripts/fetch_pr.mjs` — fetch + gates. Input: PR URL. Output: canonical fact JSON.
   - `references/wic-rubric.md` — rubric v `2.0-agent`, the only scoring source of truth.
   - `SKILL.md` — the agent workflow: run fetcher, apply rubric, render verdict, post comment.
2. **Ratification** — a human signal on the verdict comment (Q5); no code in v1. A GitHub
   Action validating the mechanical parts of posted verdicts is explicitly out of scope.
3. **Ledger projection** (`scripts/wic_month.mjs`, Phase 3) — owner-side monthly sum: query
   merged PRs with verdict comments, filter authors against `certified-partners.yml`, apply the
   month-scoped rules (small-items cap, hotfix dedupe, month = merge month), flag merged
   partner PRs missing verdicts.

What is reused: `gh` CLI auth, `.github/certified-partners.yml`, the partner comment-flow
grammar (comment → check → reaction), `.ai/skills/` layout and tiers. What is deleted relative
to commit `6d28c125c`: the org-wide scan, watermark, date windows, multi-profile input, all
search-API code, the bounty branch (no `bounty` label exists; returns as one paragraph when the
first real bounty does), the 146-line markdown comparator plus its smoke test (canonical JSON +
`diff` replaces it), the fetcher's markdown output branch, and the determinism prose (replaced
by a replay test).

### Scoring pipeline (per run)

```
PR URL
  → gates: org? public? non-archived? merged? base long-lived? head not long-lived?
      any gate fails → verdict: 0, rule cited, stop
  → facts: files, path prefixes, test paths, +/- lines, baseRefName, headRefName,
           mergedAt, closingIssuesReferences, body, author
  → base class (model judgment, rubric row cited): 1.0 | 0.5 | 0.25 | 0
  → impact bonus (computed): +0.25 if ≥3 packages/modules touched, +0.25 if test paths touched
  → issue credits: 0.25 proposed for each closed issue's reporter (booked in merge month;
                   the ONLY path that pays bug reports — never a base class, so a report cannot book twice)
  → verdict JSON → rendered comment → posted on the PR (status: proposed)
```

Maximum score per PR: 1.5 (base 1.0 + impact 0.5).

### Rubric v2 (summary — full text lives in `references/wic-rubric.md`)

| Base points | Level (derived) | Contribution class |
|---:|---|---|
| 1.0 | L4 | Complete core module; new feature with spec + implementation; major working PoC |
| 0.5 | L3 | Comprehensive feature spec on its own; complex bug / deep multi-file refactor |
| 0.25 | L1 | Small hardening, restoration (merged PRs only — bug reports are never a base class; they pay solely through the issue-credit path) |
| 0.0 | — | Routine maintenance (dependency bumps, trivial edits), rollups, anything unmerged |

Rules carried from the fix-plan: levels are derived from points only (L2 retired); impact
thresholds are literal constants; on hesitation between two classes, take the lower; a spec
under `.ai/` books like any other merged PR. Determinism is enforced by a CI replay test, not by prose exhortation: the mechanical
fields (gates, impact, credits, score arithmetic) must be byte-identical across three runs, and
`baseClass` must match the corpus case's expected label in all three runs — self-consistency
alone proves nothing about a judged field.

## 📝 Data Model

No database. Two JSON shapes, both versioned with the rubric:

**Fact file** (fetcher output, canonical, replayable): `schemaVersion`, `repo`, `prNumber`,
`url`, `author`, `mergedAt`, `baseRefName`, `headRefName`, `additions`, `deletions`,
`changedFiles[] {path, additions, deletions}`, `packagesTouched[]` (derived path prefixes),
`touchesTests` (bool), `closingIssues[] {number, reporter, url}`, `title`, `body`.
Deterministic: keys sorted, arrays sorted by stable ids, codepoint string compares, no
timestamps of the run inside the payload (`generatedAt` goes to a sidecar). Written via temp
file + `mv`; on any fetch error nothing is written and the exit code is non-zero (three retries
with backoff on 403/429 first).

**Verdict block** (inside the PR comment, in `<details>`):

```json
{
  "wicVerdict": "2.0-agent",
  "repo": "open-mercato/open-mercato",
  "pr": 1234,
  "author": "partner-login",
  "mergeMonth": "2026-09",
  "gates": {"eligibleRepo": true, "merged": true, "baseLongLived": true, "headNotLongLived": true},
  "baseClass": {"points": 0.5, "level": "L3", "rubricRow": "complex-bug-deep-refactor"},
  "impact": {"packages": 4, "packagesBonus": 0.25, "touchesTests": true, "testsBonus": 0.25},
  "score": 1.0,
  "credits": [{"issue": 987, "reporter": "someone", "points": 0.25}],
  "status": "proposed",
  "notes": ["small-items cap and hotfix dedupe are resolved at the ledger, not here"]
}
```

Sensitive data: none — everything quoted is already public on the PR. The skill never reads
credential stores; `gh` supplies auth.

## 📝 API Contracts

**Fetcher CLI** — `node .ai/skills/om-wic-score/scripts/fetch_pr.mjs <pr-url> [--out <path>]`.
The skill workflow also honors `--no-post` (render the verdict, skip the comment) for dry runs.
Exit 0 with fact JSON only when every fact was fetched; any failure → non-zero exit, no file.
Uses only: `gh api repos/{o}/{r}` (visibility/archived), `gh pr view --json …`,
`gh api repos/{o}/{r}/pulls/{n}/files --paginate`.

**Verdict comment** — one comment, two parts, posted by the partner's account:
- Human bullets: score; base class + rubric-row citation; each bonus granted or not with its
  computed inputs (`4 packages ≥ 3 → +0.25`); each gate that zeroed anything; each issue
  credit; the ledger note.
- Machine block: the verdict JSON above inside `<details><summary>wic-verdict json</summary>`.
  Monthly summing must be a query over these blocks, never archaeology over prose.

**Ratification** (consumed by the ledger): 👍 reaction or approving reply on the verdict
comment by a `MEMBER`/`OWNER`. Edit history of the comment is public; a tampered number fails
replay.

**Ledger CLI** (Phase 3) — `node .ai/skills/om-wic-score/scripts/wic_month.mjs --month 2026-09`:
lists ratified verdicts by certified partners, applies small-items cap (0.25-class entries — small-PR
verdicts and issue credits together — sum to at most 1.0/month per partner, excess listed as
noticed-but-not-paid), hotfix dedupe (same
`(repo, headRefName)` merged to two long-lived branches books once), month = merge month, and
flags merged partner PRs with no verdict comment (the sweep — forgotten runs lose no work).

## 📝 Edge Cases & Failure Scenarios

- **Closed-unmerged PR** → verdict 0 immediately, rule cited. The partner sees why, not a crash.
- **Fetch failure / rate limit** → retries, then hard non-zero exit with the error; no partial
  fact file, no verdict. Never a silent zero (the old fetcher's exit-0-empty-artifact failure).
- **Comment posting fails** (no auth, network) → verdict printed to stdout, non-zero exit,
  instruction to paste manually.
- **Fork PRs** (the partner norm): facts come from the base repo's PR object, so nothing needs
  the fork. Head-ref rollup exclusion applies to the head *branch name* regardless of fork —
  a fork's `develop` merged into upstream `develop` is excluded; the verdict cites the rule and
  the partner can appeal to the program owner. Conservative by design.
- **Same branch merged to `develop` and `main`** (hotfix) → both PRs get verdicts; the ledger
  books one. The verdict note says so.
- **Partner edits the comment number** → edit history is public; replay on the immutable PR
  reproduces the real number; ratification is the paying signal, not the comment's claim.
- **Non-partner runs the skill** → verdict posts fine (it is just a comment); the ledger
  ignores authors not in `certified-partners.yml`.
- **PR merged then repo archived/made private later** → verdicts already ratified stand; new
  runs fail the repo gate. The ledger reads ratified comments, not repo state.
- **Rubric ambiguity** → the rubric's tie-break is explicit: take the lower class. The replay
  test (3 identical runs per corpus case) is the enforcement, not trust.

## 📝 Risks & Impact Review

- **Payout-affecting decisions** were surfaced, not smuggled in: Q1 (cross-month spec+impl)
  and Q2 (WIC Level derived-only) were approved by matgren in-session on 2026-09-01.
- **Model-judgment drift** on the base class is the residual risk. Mitigation: proposed-then-
  ratified for every verdict, corpus built from ratifications, auto-trust only at ≥95%
  measured agreement, and the replay test in CI. Until then the number is advisory.
- **Blast radius**: additive — a new skill directory, a rubric doc, comments on merged PRs.
  No app code, no schema, no existing surface changes. Rollback = delete the directory and
  stop posting comments; ratified history remains readable.
- **History**: March/April 2026 reports under `.ai/runs/wic/` were produced by the 1.0 monthly
  model, are not comparable, and never feed tier decisions. Their PRs enter the ledger as
  already-booked so nothing double-counts.
- **Compatibility**: no protected surfaces touched (`BACKWARD_COMPATIBILITY.md` n/a — docs and
  tooling only).

## 📋 Phasing

- **Phase 1 — rubric + per-PR verdict skill** (shippable alone: partners can score and post).
- **Phase 2 — ratification contract + replay corpus** (shippable alone: makes verdicts
  testable and defines the ratification signal; verdicts become *payment-binding* only when the
  Phase 3 ledger reads them).
- **Phase 3 — monthly ledger projection** (owner-side summing, cap/dedupe/sweep; depends on
  verdict comments existing).

## 📋 Implementation Plan

**Phase 1**
1. Write `references/wic-rubric.md` v`2.0-agent` (tables above, tie-break rule, derived levels,
   one-sentence determinism note). *Test: doc review; every rule has a rubricRow id.*
2. Implement `scripts/fetch_pr.mjs` (gates, facts, canonical JSON, hard errors, retries,
   temp+mv). *Test: fixture run against a real merged PR; error paths via revoked-token and
   bogus-URL runs; no file on failure.*
3. Write `SKILL.md`: workflow fetch → classify → render → post; verdict JSON schema; human-
   bullets template; posting fallback. *Test: end-to-end dry run on one merged PR, `--no-post`.*
4. Add `om-wic-score` to the `analysis` tier in `.ai/skills/tiers.json`. *Test: schema validates.*

**Phase 2**
5. Freeze the bootstrap corpus under `scripts/test/corpus/`: gate cases (rollup,
   direct-to-main, repo without develop, private repo, unmerged), rubric cases (R1–R3 from the
   companion test file), issue-credit cases (M8/M9) — each fact JSON paired with an expected
   verdict labeled by the program owner (owner-authored labels are the seed of the ratified
   corpus). *Test: corpus files are canonical fact JSONs with expected verdicts.*
6. Add the replay test: for each corpus case, three scoring runs — mechanical fields
   byte-identical, `baseClass` equal to the expected label every run. *Test: the test itself;
   seed one deliberate mismatch to see it fail.*
7. Document the ratification contract in `SKILL.md` (Q5 rule) and the corpus-growth loop
   (each ratified verdict may be added as a labeled case). *Test: doc review.*

**Phase 3**
8. Implement `scripts/wic_month.mjs` (query verdict blocks, certified-partner filter, cap,
   dedupe, merge-month assignment, missing-verdict sweep). *Test: fixture month with a capped
   small-items pile, a hotfix pair, and one missing verdict; expected totals asserted.*
9. Backfill the ledger's already-booked list from the March/April 2026 report PRs. *Test:
   re-running the month over them books nothing.*
10. Measure model-vs-human agreement over the labeled corpus: bootstrap labels plus every
    ratified live verdict appended since (each ratification adds a labeled case). Publish the
    number in the skill README. Auto-trust switch only at ≥95% over at least 40 labeled cases,
    and only by a follow-up decision. *Test: agreement script output over the labeled set.*
