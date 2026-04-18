---
name: auto-sec-report-pr
description: Run a deep OWASP-oriented security review for one unit of work: a PR, a spec file, or a branch diff. Checks both obvious and non-obvious attack paths, writes markdown and HTML findings under `.ai/analysis/`, and surfaces concrete follow-up scopes for similar patterns elsewhere in the codebase. Can run standalone or as the sub-unit used by `auto-sec-report`, and reuses the claim, worktree, and review discipline from `auto-review-pr`.
---

# Auto Security Report — Single Unit

Analyze ONE unit of work — a PR, a spec file, or a branch diff — for
security issues. The analysis is intentionally paranoid: it scans for
obvious OWASP Top 10 categories AND for less-obvious attack vectors that
are easy to miss in a conventional code review. For every finding it
proposes concrete "Next steps — go deeper" follow-up scopes so the next
run of this same skill can drill further.

This skill is the atomic building block used by `auto-sec-report` (the
multi-unit driver). It can also be invoked directly against a single
target when you want a deep read on exactly one thing.

## Arguments

- `{target}` (required) — one of:
  - `pr:{number}` or a bare number (e.g. `1456`) — analyze one pull
    request. Works for merged or open PRs.
  - `spec:{path}` or any path ending in `.md` under `.ai/specs/` or
    `.ai/specs/enterprise/` — analyze one specification.
  - `branch:{name}` — analyze the diff of a branch against the base
    (defaults to `origin/develop`). Works with local branches after a
    `git fetch origin {name}`.
- `--base <branch>` (optional) — base ref for the branch/PR diff.
  Defaults to `origin/develop`.
- `--out-fragment <path>` (optional) — when invoked as a sub-unit by
  `auto-sec-report`, write the markdown section fragment to this path
  instead of creating a standalone artifact + PR. When set, do NOT open
  a PR. Presence of this flag is the only signal that the skill is
  running as a sub-unit.
- `--deep-scan` (optional) — expand the "apply elsewhere" grep sweeps
  to the full repository rather than the modules touched by the unit.
  Slower. Off by default. `auto-sec-report` passes this through when it
  wants aggregated cross-codebase findings.
- `--slug <kebab-case>` (optional) — override the slug used in the plan
  and artifact filenames. Default: derived from the target.
- `--force` (optional) — bypass the claim-conflict check when taking
  over a previously-started run.

## Dependencies on other skills

This skill is a specialization. Do not re-implement what these already
cover — invoke or quote them:

- `.ai/skills/code-review/SKILL.md` and its checklist at
  `.ai/skills/code-review/references/review-checklist.md` are the
  authoritative source for Open Mercato's security baseline
  (tenant scoping, `findWithDecryption`, zod validation, RBAC via
  `acl.ts`, password hashing, no raw `fetch`). Apply them first; only
  add OWASP/paranoid checks on top.
- `.ai/skills/auto-review-pr/SKILL.md` defines the claim/lock/worktree
  pattern used here verbatim (see step 1 below).
- `.ai/skills/spec-writing/references/spec-checklist.md` and
  `spec-writing/references/compliance-review.md` are the authoritative
  sources when the target is a spec (section 3 "Data Integrity &
  Security", compliance matrix fields).
- `.ai/skills/pre-implement-spec/SKILL.md` is the authoritative source
  for backward-compatibility risk (13 contract surfaces). Use it as a
  cross-check when reviewing a spec that is about to be implemented.
- `.ai/skills/auto-sec-report-pr/references/deep-attack-vectors.md` is
  the bundled paranoid checklist loaded during every run.

## Workflow

### 1. Claim and isolate

When `{target}` is `pr:{n}` or a bare PR number, apply the claim
protocol from `.ai/skills/auto-review-pr/SKILL.md` step 0 verbatim
(assignee, `in-progress` label, 🤖 claim comment). Release the lock on
finish via a trap/finally even on failure.

When `{target}` is a spec or a branch, there is no PR to claim. Still
run in an isolated worktree:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-sec-report-pr"
CREATED_WORKTREE=0

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/${SLUG}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  case "$TARGET_KIND" in
    pr)
      gh pr checkout "${TARGET}" --recurse-submodules=no
      git worktree add --detach "$WORKTREE_DIR" HEAD ;;
    branch)
      git fetch origin "${TARGET}"
      git worktree add "$WORKTREE_DIR" "origin/${TARGET}" ;;
    spec)
      git fetch origin develop
      git worktree add --detach "$WORKTREE_DIR" origin/develop ;;
  esac
  CREATED_WORKTREE=1
fi

cd "$WORKTREE_DIR"
yarn install --mode=skip-build
```

Rules:

- Reuse the current linked worktree if already inside one. Never nest
  worktrees. Always clean up the temporary worktree at the end in a
  trap/finally.

### 2. Resolve the unit

Compute the set of changed files and the text to analyze based on the
target kind:

- **pr**: changed files via `gh pr view {n} --json files`; diff via
  `gh pr diff {n} --patch`; body/title/labels via `gh pr view`.
- **branch**: changed files via
  `git diff --name-only ${BASE}..${TARGET}`; diff via
  `git diff ${BASE}..${TARGET}`.
- **spec**: the spec file itself plus any files it references via
  explicit relative links. Do NOT speculatively grep the whole repo for
  spec-adjacent files — only follow links the spec actually cites.

Cap per-file diff reads at ~400 lines of patch. Summarize beyond that;
never paste raw diffs into the final artifact.

### 3. Paranoid security sweep

Run the sweep in two passes.

#### Pass A — Baseline (code-review alignment)

Apply every relevant item in
`.ai/skills/code-review/references/review-checklist.md` to the unit.
Carry forward only items where the unit actually touched the surface.
Record each finding as:

- `severity`: blocker | major | minor | nit | info
- `category`: the closest OWASP Top 10 2021 id (A01–A10) or
  `Out of scope (not OWASP)` when the finding is correctness/quality
  only
- `location`: `file:line` or `spec:section`
- `why`: one sentence
- `fix`: one sentence

#### Pass B — Paranoid deep vectors

Load `.ai/skills/auto-sec-report-pr/references/deep-attack-vectors.md`
and walk every applicable category against the unit. Focus on
non-obvious vectors that conventional code review often misses:

- Time-of-check-time-of-use (TOCTOU) races around stock, payment,
  shipment, quote acceptance.
- Cross-tenant leakage via shared cache keys, SSE channels, event bus
  broadcasts, or in-memory registries that do not include
  `organization_id` / `tenant_id` in the key.
- JWT algorithm confusion (`alg: none`, HS↔RS swap), missing `iss`/
  `aud` checks, loose expiry, token replay after password reset.
- Signed-URL / magic-link expiry, reuse, and scope creep.
- SSRF via redirect chains in outbound fetchers, DNS rebinding, IPv6
  loopback bypass, link-local addresses, metadata endpoints.
- Open redirect via relative URLs, `//evil.com`, unicode/RTL tricks,
  host header confusion.
- Deserialization: `JSON.parse` on attacker-controlled with prototype
  pollution (`__proto__`, `constructor`, `prototype`), `yaml.load`
  without safe schema, `eval`/`Function`/`vm` sinks.
- Path traversal in attachment and spec preview paths, symlink escape
  in worker sandboxes, archive slip (`zip-slip`).
- ReDoS in zod `regex`, email/URL/phone validators, search tokenizers.
- Log forging / log injection via unescaped user input in structured
  logs; PII leakage into logs; stack traces leaking to clients.
- Mass assignment via `z.object({...}).passthrough()` or spreading
  request bodies into entities; missing `.strict()` on zod schemas.
- Rate-limit identifier weaknesses (IP-only when IP is spoofable
  behind proxy; compound identifier missing user id; bucket collision).
- CSRF on state-changing routes that do not check `SameSite`/origin;
  cookie flags (`HttpOnly`, `Secure`, `SameSite=Lax|Strict`), session
  fixation, session rotation on privilege change.
- CORS with `Access-Control-Allow-Origin: *` on authenticated endpoints;
  reflected origin; credentialed CORS with wildcard.
- Clickjacking via missing `X-Frame-Options` / `frame-ancestors`; CSP
  gaps (`unsafe-inline`, `unsafe-eval`, missing `object-src 'none'`).
- Webhook integrity: signature verification, replay protection
  (monotonic timestamps, nonce cache), timing-safe compare,
  signature-scheme downgrade (v2→v1).
- Idempotency on money-moving flows: payments, refunds, shipments,
  returns, credit memos. Double-submission windows. Missing unique
  constraints on (tenant, idempotency_key).
- Access control edge cases: wildcard `__all__` ACL handling for
  non-superadmins, role rename spoofing, feature flag bypass,
  portal/customer auth leaking staff features.
- Encryption defaults: PII fields that should be encrypted but are
  stored plain, `findOne` bypassing `findWithDecryption`, export paths
  that re-emit decrypted data without policy.
- Multi-currency: rounding direction, float use for money,
  cross-currency totals without FX.
- Background jobs: job payload trust, retry amplification of
  side-effects, cancellation-token bypass, worker reading
  cross-tenant data.
- AI tool surfaces: tool injection via chat, tool authorization not
  honoring `acl.ts`, session token reuse after privilege change.
- Supply chain: pinned vs floating dependency, post-install scripts,
  lockfile integrity, Renovate/Dependabot drift, unused but still
  resolvable packages.

For each paranoid finding, cite the exact file/line or spec section and
propose a one-line fix.

### 4. Apply-elsewhere sweep

For every blocker or major finding in Pass A or Pass B, run a targeted
Grep to find other places that exhibit the same pre-fix pattern. Scope
defaults to the modules the unit already touched; `--deep-scan`
expands to the full repo.

Hard rules:

- Every candidate MUST cite a real file path confirmed by Grep. Do not
  invent candidates.
- Cap the list at 10 candidates per finding.
- Distinguish `same pattern, same risk` from `same pattern, different
  context — worth a look`.
- `None found` is a valid and honest answer.

### 5. Next steps — go deeper

At the end of the analysis, produce a **Next steps — go deeper**
section. This is the most important section for iterative review:
it defines concrete follow-up runs of this same skill that the human
reviewer (or `auto-sec-report`) can execute to drill further.

Each "next step" MUST be one of:

- `auto-sec-report-pr pr:{n}` — a specific related PR surfaced by the
  apply-elsewhere sweep.
- `auto-sec-report-pr spec:{path}` — a spec that governs the area and
  may have gaps worth verifying.
- `auto-sec-report-pr branch:{name}` — a branch that is about to land
  and touches the same surface.
- `auto-sec-report-pr pr:{n} --deep-scan` — re-run the same PR with
  full-repo grep if the initial sweep was module-scoped.
- A named follow-up scope (e.g. "audit `packages/core/src/modules/sales/`
  for TOCTOU on quote acceptance") with a one-sentence justification.

Produce 3–10 next steps. Order them by expected security impact,
highest first. Mark the single "recommended next run" so an
autonomous driver can auto-queue it.

### 6. Emit the artifact

Two modes:

#### 6a. Standalone mode (no `--out-fragment`)

Write to `.ai/analysis/auto-sec-report-pr-{target-slug}-{DATE}.md`
using this outline:

```markdown
# Auto Security Report (single unit) — {target caption}

Target: **{pr:123 | spec:.ai/specs/... | branch:feat/...}**
Base:   `{base}`
Date:   {DATE}

## Executive Summary

- {count} findings: {N blocker, M major, L minor, K nit, I info}.
- Top OWASP categories: {A01, A10}.
- Top paranoid vectors surfaced: {TOCTOU, SSRF redirect chain, JWT
  alg confusion, ...}.
- Recommended next run: `auto-sec-report-pr {target}` — {one sentence}.

## Findings

### [Blocker] A01 Broken Access Control — `path/to/file.ts:42`

- **What:** {one sentence}
- **Why:** {one sentence}
- **Fix:** {one sentence}
- **Apply elsewhere:**
  - `path/to/other.ts:88` — {one-line justification}
  - ...

### [Major] A10 SSRF — `path/to/file.ts:120`
... repeat ...

## Paranoid Deep Vectors — What Was Checked

A checklist of non-obvious vectors exercised against this unit, with
a short outcome per vector: `covered`, `risk surfaced`, `not
applicable`, or `inconclusive (next step)`.

| Vector | Outcome | Location or note |
|---|---|---|
| TOCTOU on money-moving flows | risk surfaced | path/to/file.ts:200 |
| Cache-key cross-tenant leakage | covered | organization_id present |
| JWT algorithm confusion | not applicable | no JWT surface changed |
| ... | ... | ... |

## Next Steps — Go Deeper

Ordered highest-impact first. The **recommended next run** is marked.

- **[recommended]** `auto-sec-report-pr pr:1234` — {why this is the
  biggest remaining risk}.
- `auto-sec-report-pr spec:.ai/specs/2026-04-15-foo.md` — {why}.
- `auto-sec-report-pr branch:feat/bar` — {why}.
- Audit `packages/core/src/modules/sales/` for TOCTOU on concurrent
  shipment creation — {why}.
- ...

## Appendix — Inputs

- Changed files: {count} (list first 20, then `...`).
- PR body / spec body excerpt (redacted of secrets): N lines.
- Commits inspected: {list of SHAs when target is a PR/branch}.
```

Also render a stand-alone HTML mirror at
`.ai/analysis/auto-sec-report-pr-{target-slug}-{DATE}.html` following
the same HTML rules documented in `auto-sec-report`:

- Inline `<style>` only; no JS; no remote assets.
- Mirror every section. Preserve every PR/issue/CVE link as `<a>` with
  `rel="noopener noreferrer"`.

After the artifacts exist, follow `.ai/skills/auto-create-pr/SKILL.md`
verbatim to open a docs-only PR against `develop`. PR title:
`docs(analysis): add auto-sec-report-pr for {target caption}`. Labels:
`review`, `documentation`, `security`, `skip-qa`. Never merge from
within this skill.

#### 6b. Sub-unit mode (`--out-fragment` set)

Skip artifact creation, PR creation, labelling, and auto-review.
Instead, write a markdown section fragment to the path given by
`--out-fragment`. The fragment MUST begin with a level-2 heading
(`## {target caption}`) and MUST include:

- Executive summary (as bullets, no subsection heading).
- All Findings as level-3 sections with the same shape as standalone.
- The "Paranoid Deep Vectors" table.
- The "Next Steps — Go Deeper" list.

Do NOT duplicate the report-wide front-matter or appendix — the
driver (`auto-sec-report`) owns those. Fragments are concatenated by
the driver in the order it specifies.

### 7. Validation gate (docs-only)

- `git diff --check` on the artifact files.
- Secret-leak grep on the diff before commit:
  ```bash
  git diff origin/${BASE:-develop}..HEAD | \
    grep -Ei "(aws_secret|password\\s*=|bearer\\s+[A-Za-z0-9._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
  ```
  If matched: stop, redact, recommit.
- Manual re-read of both artifacts; every PR/issue link resolves.

### 8. Self-review and BC review

Apply `.ai/skills/code-review/SKILL.md` to the diff of the artifact
files themselves (not the unit under analysis). Because the change is
docs-only, the contract-surface risk is limited to accidentally
exfiltrating PR-body or spec-body content that contains secrets or
internal URLs. Redact if found.

### 9. Autofix pass

In standalone mode only: invoke
`.ai/skills/auto-review-pr/SKILL.md` against the docs PR in autofix
mode. Apply fixes as new commits. Never rewrite history.

### 10. Summary comment

Post the comprehensive summary comment required by
`.ai/skills/auto-create-pr/SKILL.md` step 12. In the "What can go
wrong" section, be explicit about limits:

- Classification is heuristic. Paranoid findings can be false
  positives; a human reviewer must confirm.
- Apply-elsewhere and Next-steps candidates are suggestions. They
  are not verified vulnerabilities.
- When the target was a spec, findings reflect spec intent only;
  real behavior depends on implementation.

### 11. Release lock and cleanup

When the target was a PR, release the `in-progress` label and post
the completion comment (follow `auto-review-pr` step 11 verbatim).
Always do this in a trap/finally even on failure.

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
git worktree prune
```

### 12. Resumability

If the run cannot finish in a single invocation:

- In standalone mode: leave `Status: in-progress` in the docs PR body
  and post the verbatim hand-off comment
  `🤖 auto-sec-report-pr is not complete. Resume with /auto-continue-pr {prNumber}.`
- In sub-unit mode: write the partial fragment to `--out-fragment`
  and exit with a non-zero status + a one-line stderr message that
  the driver (`auto-sec-report`) can catch.

## Rules

- Always run the claim/lock protocol when the target is a PR.
- Always run in an isolated worktree. Reuse the current linked
  worktree when already inside one. Never nest worktrees.
- Always load the bundled `references/deep-attack-vectors.md` and
  exercise every applicable category. Record each vector's outcome
  even when it was a no-op.
- Every Finding MUST cite a real file path or spec section.
- Every Apply-elsewhere candidate MUST be confirmed by Grep.
- Every Next-step MUST be executable as another run of this skill
  (or a clearly-scoped audit a human can pick up).
- Mark exactly one Next-step as `[recommended]` so a driver can
  auto-queue it.
- Never paste raw diffs, secrets, tokens, `.env` content, credentials,
  internal hostnames, or user PII into the report. Redact to
  `{REDACTED}`.
- Reuse `code-review`, `auto-review-pr`, `spec-writing`, and
  `pre-implement-spec` patterns and checklists. Do not duplicate
  their rules — reference them.
- Never merge any PR created by this skill. Labels:
  `review`, `documentation`, `security`, `skip-qa`. Never `needs-qa`.
- Sub-unit mode (`--out-fragment`) never opens a PR, never applies
  labels, and never runs autofix. The driver owns PR delivery.
