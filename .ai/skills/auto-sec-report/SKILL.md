---
name: auto-sec-report
description: Generate an OWASP-oriented security analysis report for a window of merged pull requests and deliver it as a docs-only PR. Accepts a date (reports PRs merged on or after that date), a PR number floor (reports PRs whose number is >= that value), or defaults to the last 7 days when nothing is specified. For each PR, classifies whether it fixes a security issue, maps it to the relevant OWASP Top 10 2021 category, and calls out other places in the codebase where the same fix or hardening pattern should be applied. Writes both markdown and HTML artifacts under `.ai/analysis/`. Uses the `auto-create-pr` workflow to open a PR against `develop` (never merges), and hands off to `auto-continue-pr` when the run cannot finish in one pass.
---

# Auto Security Report

Produce a security-engineer-facing report that reviews a window of merged
pull requests for OWASP Top 10 risk signals, identifies PRs that
introduced or fixed security issues, and proposes where the same fix or
hardening pattern should be applied elsewhere in the codebase. The final
deliverable is a docs-only PR against `develop` with markdown and HTML
artifacts under `.ai/analysis/`.

This skill is a specialization of `auto-create-pr`. It adopts that skill's
worktree, branch, commit, validation, self-review, and label discipline
verbatim. The sections below describe only the security-specific content
and the few places where the flow deviates from the generic
`auto-create-pr` workflow.

## Arguments

- `{windowSpec}` (optional) — one of:
  - A date in `YYYY-MM-DD` form (e.g. `2026-04-10`). Report covers every
    PR merged on or after that date, up to today (UTC).
  - A PR number (e.g. `1200`). Report covers every PR whose number is
    greater than or equal to the given number and that is merged.
  - Omitted — defaults to the last 7 days (UTC).
- `--base <branch>` (optional) — which base branch to count merges into.
  Defaults to `develop`. Merges into `main` are still reported and
  flagged separately.
- `--include-open` (optional) — also include open non-draft PRs (off by
  default). Open PRs are flagged as "not yet merged" but their diff is
  still analysed for security signal.
- `--deep-scan` (optional) — also sweep the current HEAD for **top OWASP
  issues that match the patterns surfaced by PRs in the window**. Off by
  default; on means the report includes a "Codebase cross-check" section.
- `--slug <kebab-case>` (optional) — override the slug used in the plan
  and artifact filenames. Default: derived from the window.
- `--force` (optional) — bypass the claim-conflict check when a previous
  run left a branch or plan behind.

## OWASP Top 10 taxonomy

Use OWASP Top 10 2021 categories verbatim. Every classified PR MUST cite
exactly one primary category (secondary categories allowed):

- **A01: Broken Access Control** — missing tenant scoping, RBAC bypass,
  IDOR, open redirects, privilege escalation, path traversal, over-scoped
  `__all__`/wildcard ACL handling.
- **A02: Cryptographic Failures** — weak hashing, missing encryption at
  rest for PII, leaked secrets, bad JWT lifetime, `findOne` bypassing
  `findWithDecryption`.
- **A03: Injection** — SQL, NoSQL, command, template, header, CRLF, log
  forging. Includes raw fetch/exec usage and XSS via unescaped HTML.
- **A04: Insecure Design** — missing rate limits, missing idempotency on
  money-moving flows, race conditions (double-shipment, double-credit),
  workflows with no failure visibility.
- **A05: Security Misconfiguration** — CORS, cookies without `SameSite` /
  `HttpOnly` / `Secure`, debug routes in prod, default creds, verbose
  errors, public S3/queue handles.
- **A06: Vulnerable and Outdated Components** — bumped libs, pinned
  versions, `yarn audit` style changes, removed shell-out dependencies.
- **A07: Identification and Authentication Failures** — session rotation,
  missing MFA, rate-limit identifiers, stale session reuse, forgot/reset
  flows, magic-link hardening.
- **A08: Software and Data Integrity Failures** — webhook signature
  verification, replay protection, deserialization, signed URLs,
  code-loading from untrusted sources.
- **A09: Security Logging and Monitoring Failures** — missing audit logs,
  silent failure paths, stack traces sent to clients, unlogged admin
  actions.
- **A10: Server-Side Request Forgery (SSRF)** — outbound HTTP allowlists,
  blocked private/internal URLs in webhooks, avatar fetchers, OAuth
  metadata endpoints, preview generators.

When a PR fixes something outside this taxonomy (e.g. a pure availability
fix), classify it as **Out of scope (not OWASP Top 10)** and still list
it in the appendix.

## Workflow

### 0. Pre-flight and claim

Follow `.ai/skills/auto-create-pr/SKILL.md` step 0 verbatim. Branch name
MUST use the `feat/` prefix:

```bash
DATE=$(date -u +%Y-%m-%d)
SLUG="${SLUG_OVERRIDE:-auto-sec-report-${DATE}}"
PLAN_PATH=".ai/runs/${DATE}-${SLUG}.md"
BRANCH="feat/${SLUG}"
```

### 1. Resolve the PR window

Same as `auto-qa-scenarios` step 1. Paginate until the floor is reached.
Record the resolved window in the plan Overview.

### 2. Gather per-PR evidence

For each PR in the window:

```bash
gh pr view {number} --json number,title,url,author,body,labels,baseRefName,mergeCommit,mergedAt,files,additions,deletions
gh pr diff {number} --patch
```

From each PR extract:

- Title, number, URL, merged date, base branch, labels.
- Changed files (top-level module/package paths).
- Strong signal keywords in title/body: `security`, `fix(security)`,
  `CVE`, `SSRF`, `XSS`, `CSRF`, `IDOR`, `tenant`, `ACL`, `RBAC`,
  `rate-limit`, `session`, `JWT`, `redirect`, `signature`, `encrypt`.
- Diff-level signals:
  - Raw `em.find(` / `em.findOne(` that were replaced with
    `findWithDecryption` / `findOneWithDecryption` (A02).
  - Missing / added `organization_id` or `tenant_id` filters (A01).
  - Added URL allowlist / blocklist in webhook/workflow code (A10).
  - Added signature verification on inbound webhooks (A08).
  - Changed session handling, cookie flags, or JWT TTL (A07).
  - Input validation via zod on previously untyped routes (A03).
  - RBAC metadata additions (`requireFeatures`, `requireAuth`) (A01).
  - Removed open redirect / unsafe redirect handling (A01).

Cap the per-PR diff read at the changed files actually relevant. Never
paste full diffs into the report.

### 3. Classify PRs

For each PR, produce a record:

```json
{
  "number": 1234,
  "title": "...",
  "url": "https://github.com/{owner}/{repo}/pull/1234",
  "mergedAt": "2026-04-12T10:21:00Z",
  "owaspPrimary": "A01",
  "owaspSecondary": ["A07"],
  "classification": "security-fix | security-hardening | security-adjacent | non-security",
  "whatChanged": "one sentence",
  "whyItMatters": "one sentence",
  "riskIfReverted": "one sentence",
  "applyElsewhere": ["module or file path", "..."]
}
```

Classification rules:

- **security-fix** — PR title/body or diff explicitly addresses a
  specific vulnerability (e.g. SSRF in CALL_WEBHOOK, open redirect in
  locale switch, missing tenant scope in public quote endpoints).
- **security-hardening** — PR tightens defences without naming a
  specific vulnerability (e.g. adds rate-limit identifier, rotates
  session tokens on login, enforces signature verification).
- **security-adjacent** — PR touches a sensitive path (auth, tenant
  scope, webhook dispatch) but does not change the security posture.
- **non-security** — PR is docs, tests, DX, tooling, pure UI, or
  refactor without security impact.

### 4. Cross-code audit: "apply the same fix elsewhere"

For every **security-fix** and **security-hardening** PR, try to find
other places in the current codebase that exhibit the same
pre-fix pattern. Use targeted grep sweeps:

```bash
# A02 example: surface leftover raw ORM calls that may bypass decryption
Grep pattern: "em\\.findOne\\(" type=ts
Grep pattern: "em\\.find\\("     type=ts

# A01 example: webhook / public endpoints without organization_id scoping
Grep pattern: "organization_?id" type=ts -B 2 -A 5

# A10 example: outbound HTTP without allowlist helper
Grep pattern: "(fetch|axios|undici)\\(" type=ts
```

Produce a targeted list **per fix** of files/functions that look similar
and should be reviewed. Never claim a file is vulnerable without a
concrete pattern match and a one-line justification.

Hard limits to keep the report honest:

- List at most 10 apply-elsewhere candidates per fix.
- Never recommend a change without citing the exact file path.
- Distinguish "same pattern, same risk" from "same pattern, different
  context — worth a look" in the narrative.

### 5. Draft the execution plan

Follow `.ai/skills/auto-create-pr/SKILL.md` step 3. Required plan
Progress phases:

```markdown
### Phase 1: Data gathering

- [ ] 1.1 Resolve PR window and fetch merged PR metadata
- [ ] 1.2 Enrich PRs with diffs, labels, and linked issue refs

### Phase 2: Classification

- [ ] 2.1 Map each PR to an OWASP Top 10 category and classification
- [ ] 2.2 Build per-fix "apply elsewhere" candidate lists via targeted greps

### Phase 3: Artifact generation

- [ ] 3.1 Write markdown report to `.ai/analysis/auto-sec-report-${DATE}.md`
- [ ] 3.2 Render HTML mirror to `.ai/analysis/auto-sec-report-${DATE}.html`
- [ ] 3.3 Spot-check artifacts render correctly, links resolve, and redactions held

### Phase 4: PR delivery

- [ ] 4.1 Commit artifacts, push branch, open PR against `develop` (do not merge)
- [ ] 4.2 Apply `review`, `documentation`, `security`, and `skip-qa` labels with comments
```

### 6. Isolated worktree, branch, first commit

Follow `.ai/skills/auto-create-pr/SKILL.md` steps 4–5 verbatim.

### 7. Execute the phases

Run steps 1.1 → 3.3 in the worktree. Flip checkboxes and push per phase
exactly like `auto-create-pr` step 6.

#### 7a. Markdown artifact layout

Write to `.ai/analysis/auto-sec-report-${DATE}.md`:

```markdown
# Auto Security Report — {window caption}

Report window: **{start date or PR floor} through {end date}** (base: `{base}`).

## Executive Summary

- Reviewed **{count} merged PRs** in the requested window.
- **{N}** PRs classified as security-fixes, **{M}** as security-hardening.
- Top OWASP categories touched this window: {A01, A08, A10}.
- {one sentence on the single riskiest residual area the reviewer should
  double-check}.

## Risk Heatmap

| OWASP Category | Security-fix PRs | Hardening PRs | Adjacent PRs | Notes |
|---|---|---|---|---|
| A01 Broken Access Control | {n} | {n} | {n} | {one sentence} |
| A02 Cryptographic Failures | {n} | {n} | {n} | {one sentence} |
| ... continue through A10 ... | | | | |
| Out of scope (not OWASP Top 10) | — | — | — | {n} PRs |

## Security-fix PRs

For each security-fix, one subsection.

### [#{n}]({url}) {title}

- **OWASP:** {A01} (secondary: {A07})
- **What changed:** {one sentence}
- **Why it matters:** {one sentence}
- **Risk if reverted:** {one sentence}
- **Apply the same fix elsewhere — candidate list:**
  - `path/to/file.ts` — {one-line justification}
  - `path/to/otherfile.ts` — {one-line justification}
  - {up to 10 entries; "None found" is a valid and honest answer}

### [#{n}]({url}) {title}
... repeat ...

## Security-hardening PRs

{Same structure as security-fix.}

## Security-adjacent PRs

{One-line entries; group by OWASP category.}

## Codebase cross-check  <!-- only if --deep-scan -->

{Targeted grep findings that are not tied to a specific PR in the
window. Same shape as apply-elsewhere, but standalone.}

## Appendix: Full PR Inventory (window)

Each item below is one PR from the requested window with OWASP
classification.

### {YYYY-MM-DD}

- [#{n}]({url}) {title} — OWASP {A01} — {security-fix|hardening|adjacent|non-security}
- ...
```

Rules for the markdown:

- Every apply-elsewhere candidate MUST cite a file path you actually
  confirmed exists via Grep. Do not invent paths.
- If a PR body mentions a CVE, reference the CVE id verbatim; do not
  paste exploit-style details.
- Never paste raw tokens, secrets, `.env` content, credentials, private
  URLs, or internal infrastructure hostnames. Redact to `{REDACTED}`.
- Keep per-fix narrative tight. Push full enumeration to the appendix.

#### 7b. HTML artifact layout

Same rules as `auto-qa-scenarios` step 6b. Write stand-alone HTML at
`.ai/analysis/auto-sec-report-${DATE}.html` with:

- Inline `<style>` only, no JS, no remote assets.
- Mirror every section of the markdown (Executive Summary, Risk
  Heatmap table, Security-fix PRs, Security-hardening PRs,
  Security-adjacent PRs, optional Codebase cross-check, Appendix).
- Every PR, issue, and CVE link as `<a href="..." rel="noopener noreferrer">`.

### 8. Validation gate (docs-only)

Same as `auto-qa-scenarios` step 7:

- `yarn lint` (frontmatter sanity).
- `git diff --check`.
- Manual re-read; spot-check that every PR link resolves.

Add one security-specific check: before committing, grep the diff for
accidental secrets:

```bash
git diff origin/develop..HEAD | \
  grep -Ei "(aws_secret|password\\s*=|bearer\\s+[A-Za-z0-9._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
```

If this matches, stop, redact, recommit, and document in the plan's
Risks section.

### 9. Self-review and BC review

Apply `.ai/skills/code-review/SKILL.md`. This is docs-only, so the
contract-surface risk is low — but the exfiltration risk is real.
Re-read both artifacts and verify no internal URLs, no secrets, and no
user PII from PR bodies leaked into the report.

### 10. Open the PR

Follow `.ai/skills/auto-create-pr/SKILL.md` step 9 with:

- Title: `docs(analysis): add auto-sec-report for {window caption}`.
- Base: `develop`. Never merge directly.
- Body MUST include `Tracking plan: .ai/runs/${DATE}-${SLUG}.md` and the
  correct `Status:` line.
- Body MUST link both artifacts under `.ai/analysis/` and state the
  total PR count, security-fix count, and top OWASP categories touched.

### 11. Labels

Apply in order, each with a short explanatory comment:

- `review` — "PR is ready for code review."
- `documentation` — "docs-only deliverable under `.ai/analysis/`."
- `security` — "security-posture report; merits a security-savvy reviewer."
- `skip-qa` — "docs-only report; no customer-facing behavior."

Never `needs-qa`.

### 12. Auto-review pass

Run `.ai/skills/auto-review-pr/SKILL.md` against the new PR in autofix
mode. Never rewrite history.

### 13. Summary comment

Post the comprehensive summary comment required by
`.ai/skills/auto-create-pr/SKILL.md` step 12. In the **What can go
wrong** section, be honest about report limitations:

- Classification is heuristic. PRs with ambiguous security impact may
  be miscategorised.
- "Apply elsewhere" candidates are suggestions based on grep patterns.
  A human reviewer must confirm before any fix is applied.
- The report is a snapshot of the requested window. It does not replace
  a full security audit.

### 14. Cleanup and resumability

Follow `.ai/skills/auto-create-pr/SKILL.md` step 13.

If the run cannot finish in a single invocation:

1. Leave `Status: in-progress` in the PR body.
2. Ensure the Progress checklist reflects what actually landed, with
   commit SHAs on every completed step.
3. Post a PR comment that says verbatim:
   `🤖 auto-sec-report is not complete. Resume with /auto-continue-pr {prNumber}.`
4. Release any `in-progress` lock per `auto-continue-pr` rules if one
   was claimed during this run.

## Rules

- Always deliver as a PR. Never push the report to `develop` directly.
  Never merge the PR from within this skill.
- Default window is the last 7 days (UTC) when `{windowSpec}` is omitted.
- Artifacts go under `.ai/analysis/` with a dated filename. Both markdown
  and HTML MUST be produced in the same run.
- Every PR listed in the report MUST carry exactly one primary OWASP
  Top 10 2021 category or be marked `Out of scope (not OWASP Top 10)`.
- Apply-elsewhere candidates MUST cite a file path confirmed via Grep.
  `None found` is a valid and honest answer; never fabricate candidates.
- Never paste raw diffs, secrets, tokens, `.env` content, credentials,
  internal hostnames, or user PII into the report. Redact to
  `{REDACTED}` when encountered.
- Classification is heuristic; state that explicitly in the summary
  comment's "What can go wrong" section.
- Reuse `auto-create-pr` for branch/worktree/commit/validation/label
  discipline. Do not reinvent those mechanics.
- On partial completion, leave a `/auto-continue-pr {prNumber}` hand-off
  comment and keep `Status: in-progress` on the PR body.
- Labels on this skill's PR: `review`, `documentation`, `security`,
  `skip-qa`. Never `needs-qa`.
