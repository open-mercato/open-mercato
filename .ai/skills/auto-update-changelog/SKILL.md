---
name: auto-update-changelog
description: Draft a new CHANGELOG.md release entry in the house emoji-driven format (✨ Features / 🐛 Fixes / 🔒 Security / 🛠️ Improvements / 🧪 Testing / 📝 Specs & Documentation / 🚀 CI/CD / 👥 Contributors) covering every PR merged since the last release, then delegate the edit to `auto-create-pr` so the bump lands as a docs PR against `develop`. Correctly credits the original author when a merged PR supersedes another contributor's PR (the carry-forward pattern that `auto-review-pr` uses). Use this at release time or when cutting a release candidate.
---

# Auto Update Changelog

Release-engineering skill. Compile a CHANGELOG.md entry for the unreleased window using the project's existing emoji-driven format, then hand the file edit off to `auto-create-pr` so it lands as a normal docs PR against `develop`.

## When to use

- Preparing a release (`0.4.11`, `0.5.0`, a release candidate).
- After a batch of merges at the end of a sprint when the team wants a running changelog.
- Manually invoked by maintainers; NOT intended to run on a schedule — changelog entries benefit from human review of the Highlights paragraph.

## Arguments

- `--version <x.y.z>` (optional) — the release heading. Default: read `version` from the root `package.json`; if it matches the topmost heading already in `CHANGELOG.md`, bump the patch component and ask the user via `AskUserQuestion` whether to use `major.minor.patch+1`, `major.minor+1.0`, or a custom value.
- `--since <value>` (optional) — lower bound for merged PRs. Accepts an ISO date, a git ref, or the literal `last-release` (default). `last-release` resolves to the date in the topmost `# X.Y.Z (YYYY-MM-DD)` heading in `CHANGELOG.md`.
- `--date <YYYY-MM-DD>` (optional) — the date in the heading. Default: today.
- `--dry-run` (optional) — print the drafted entry to stdout; do **not** edit `CHANGELOG.md` and do **not** invoke `auto-create-pr`.
- `--slug <kebab-case>` (optional) — override the slug `auto-create-pr` uses. Default: `changelog-<version>`.

## Workflow

### 0. Resolve the window

```bash
PKG_VERSION=$(node -p "require('./package.json').version")
TOP_HEADING=$(grep -m1 -E '^# [0-9]+\.[0-9]+\.[0-9]+ \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' CHANGELOG.md)
# parse "# 0.4.10 (2026-04-01)" → version=0.4.10, date=2026-04-01
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
TODAY=$(date +%Y-%m-%d)
```

- If `--version` was not passed and `PKG_VERSION` equals the heading version, ask the user which bump type to use before proceeding.
- If `--since last-release` resolves to a date that disagrees with `LAST_TAG`'s tagger date by more than 3 days, ask the user which boundary to use.
- Print `Window: <since> → <date>` and `Version: <version>` before any file edits.

### 1. Enumerate merged PRs

```bash
gh pr list \
  --state merged \
  --search "merged:>=${SINCE_DATE} merged:<=${TODAY}" \
  --json number,title,body,author,labels,mergedAt,url,baseRefName \
  --limit 250
```

Filter to PRs whose `baseRefName` is the default branch (`develop`). Exclude PRs that touched only `.ai/runs/` (these are execution-plan commits, not release work — the prefix matches both the legacy flat-file layout `.ai/runs/<date>-<slug>.md` and the current per-spec folder layout `.ai/runs/<date>-<slug>/`) unless the entire body says `Update CHANGELOG.md for vX.Y.Z` (those are prior runs of this skill — also exclude).

### 2. Categorize each PR

Per-PR category derivation, in priority order:

1. **Labels** — pick the first match:
   - `bug` → `fix`
   - `security` → `security`
   - `feature` → `feat`
   - `refactor` → `refactor`
   - `dependencies` → `chore`
   - `documentation` → `docs`
2. **Conventional-commit prefix in PR title** (`feat:`, `fix:`, `security:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`, `build:`, `perf:`, `style:`). Allow optional scope: `fix(auth):`.
3. Fallback → `chore`.

Map category → section + emoji:

| Category | Section heading | Line emoji |
|----------|----------------|------------|
| `feat` | `## ✨ Features` | `✨` |
| `security` | `## 🔒 Security` | `🔒` |
| `fix` | `## 🐛 Fixes` | `🐛` |
| `refactor`, `perf`, `style`, `chore` | `## 🛠️ Improvements` | `🛠️` |
| `test` | `## 🧪 Testing` | `🧪` |
| `docs` (including spec updates) | `## 📝 Specs & Documentation` | `📝` |
| `ci`, `build` | `## 🚀 CI/CD & Infrastructure` | `🚀` |

For `fix` entries, replace the default `🐛` with a more specific emoji when the PR title clearly indicates one: `🔐` for auth/ACL, `💰` for pricing/orders, `🌍` for i18n/translations, `🖼️` for media, `🔄` for sync/refetch, `📦` for packaging, `🐳` for Docker, `🔧` for core/infrastructure. Match the style already in `CHANGELOG.md`; when unsure, keep `🐛`.

### 3. Resolve the credited author (Supersede Credit Rule)

See the dedicated section below. For every merged PR, compute:

- `primaryAuthor` — the GitHub handle that should appear in `*(@...)*`.
- `viaAuthor` — optional second handle to disclose the carry-forward path when it happened.

### 4. Build the line text

One-liner format matching the existing CHANGELOG style:

```markdown
- <lineEmoji> <normalizedSummary>. (#<prNumber>) *(@<primaryAuthor>)*
```

When `viaAuthor` is present:

```markdown
- <lineEmoji> <normalizedSummary> (supersedes #<oldPrNumber>). (#<prNumber>) *(@<primaryAuthor>, via @<viaAuthor>)*
```

`normalizedSummary` comes from the PR title with the conventional-commit prefix and scope stripped, first letter capitalized, no trailing period before the `(#...)` token. Keep it under 140 chars — truncate with an ellipsis only if absolutely necessary.

Multiple issue references (`fixes #N`) carry through — append ` (fixes #N)` before the PR number when the PR body authoritatively closes an issue (`closingIssuesReferences` non-empty). Match the style on lines like `… (fixes #982). (#1056) *(@mwardon)*` in the current `CHANGELOG.md`.

### 5. Assemble the release entry

Prepend a new block to `CHANGELOG.md` above the topmost `# X.Y.Z (YYYY-MM-DD)` heading, preserving the `---` separator:

```markdown
# {version} ({date})

## Highlights
<!-- TODO: Highlights — auto-update-changelog leaves this blank for the human author to fill in. -->

## ✨ Features
- ✨ ... (#1234) *(@author)*

## 🔒 Security
- 🔒 ... (#1235) *(@author)*

## 🐛 Fixes
- 🐛 ... (#1236) *(@author)*

## 🛠️ Improvements
- 🛠️ ... (#1237) *(@author)*

## 🧪 Testing
- 🧪 ... (#1238) *(@author)*

## 📝 Specs & Documentation
- 📝 ... (#1239) *(@author)*

## 🚀 CI/CD & Infrastructure
- 🚀 ... (#1240) *(@author)*

## 👥 Contributors

- @author1
- @author2

---

# {previous-version} ({previous-date})
...
```

Omit empty sections entirely — the existing changelog does the same. When the entire release has a single dominant theme, optionally add subsection headers (`### 👥 <Area>`) inside `## ✨ Features` or `## 🐛 Fixes` — but prefer flat lists unless there are 5+ PRs in the same module.

### 6. Build the Contributors block

Deduplicated list of every handle that appears in `*(@...)*` lines — both `primaryAuthor` and `viaAuthor`. Order: primary authors first (by first appearance), then any `via` authors that did not already appear as a primary. One handle per line, leading `- @`.

Skip bot accounts: `github-actions[bot]`, `dependabot[bot]`, `copilot`, `renovate[bot]`, etc.

### 7. Delegate to `auto-create-pr`

Stage the `CHANGELOG.md` edit locally, but **do not** commit or push yourself. Instead, invoke `auto-create-pr` with:

- `--slug changelog-{version}`
- A concrete brief:

```text
Update CHANGELOG.md for {version} covering PRs merged between {sinceDate} and {date}.
Only CHANGELOG.md is modified. Do not change any other files.
Apply labels: documentation, skip-qa.
```

Let `auto-create-pr` handle branch creation (`feat/changelog-{version}`), the isolated worktree, the commit, the docs-only validation gate, the PR body, label normalization, the `auto-review-pr` autofix pass, and the comprehensive summary comment.

Important: this skill never runs the full validation gate itself. That is `auto-create-pr`'s job, and a changelog edit is docs-only by definition.

### 8. Dry-run

When `--dry-run` is set:

- Compute the full entry in memory.
- Print it to stdout.
- Print the list of PRs consumed, the credited author for each, and any supersede detections.
- Do **not** edit `CHANGELOG.md`.
- Do **not** call `auto-create-pr`.

### 9. Report

After `auto-create-pr` finishes, print:

```text
auto-update-changelog: {version} ({sinceDate} → {date})
PRs consumed: {count}
Supersede detections: {count}
Contributors: {count}
CHANGELOG entry preview:
  <first 10 lines of the new block>
PR: {auto-create-pr URL}
```

## Supersede Credit Rule

The central problem this skill solves: when `auto-review-pr` carries a fork contributor's PR forward (because the fork author went quiet and the reviewer applied the fixes themselves), the **merged** PR's author field on GitHub is the reviewer, not the original contributor. A naive changelog generator would credit the reviewer. That is wrong — the original contributor did the work. This skill implements three detection paths, in priority order:

### Path A: `Supersedes #N` in the PR body

`auto-review-pr` writes this template when it carries a fork PR forward. Regex (anchored to the first 20 lines of the body, case-insensitive):

```
^Supersedes\s+#(\d+)\b
```

When matched, resolve the superseded PR:

```bash
ORIG_AUTHOR=$(gh pr view {supersededPrNumber} --json author --jq '.author.login')
```

Set `primaryAuthor = ORIG_AUTHOR` and `viaAuthor = mergedPrAuthor`. Emit `(supersedes #M)` in the summary text.

### Path B: `Credit: original implementation by @user` in the PR body

Same template, also written by `auto-review-pr`. Regex:

```
Credit:\s+original\s+implementation\s+by\s+@([A-Za-z0-9][A-Za-z0-9-]{0,38})
```

When matched, set `primaryAuthor` from the captured handle and `viaAuthor = mergedPrAuthor`. No `supersedes #M` suffix unless Path A also fires (it usually does).

### Path C: `Closing in favor of` comment on the superseded PR

When neither body regex on the merged PR matches, `auto-review-pr`'s carry-forward flow still leaves an authoritative trail on the **original** PR via the closing comment template (see `.ai/skills/auto-review-pr/SKILL.md` lines 471–477):

```
Closing in favor of #{newPrNumber} ({newPrUrl}).

Credit to @{originalAuthor} for the original implementation. ...
```

Detection is reversed compared to Paths A and B — you are walking *candidate superseded PRs*, not the merged PR itself. For each closed-unmerged PR in the same window (already enumerated by `sync-merged-pr-issues`), check its comments for a line matching:

```
^Closing in favor of #(\d+)\b
```

When the captured number equals the merged PR currently being credited, treat the merged PR as a carry-forward. Set `primaryAuthor = mergedPrAuthor` of the closed PR (i.e., the original contributor, looked up via `gh pr view {closedPrNumber} --json author`) and `viaAuthor = mergedPrAuthor` of the merged replacement.

Path C is a fallback only — Paths A and B cover the overwhelming majority of cases because `auto-review-pr` writes both the `Supersedes #N` body and the `Credit: original implementation by @user` line on the replacement PR.

### Fallback

If none of A/B/C match, `primaryAuthor = mergedPrAuthor` and `viaAuthor = null` — no supersede. Most PRs fall here.

### Worked example

Given merged PR `#1555` with body:

```markdown
Supersedes #1421

Credit: original implementation by @contributor-a. This follow-up PR carries that work forward with the requested fixes so it can merge without waiting on the original branch.

## Included work
- Original changes from #1421
- Follow-up fixes applied during re-review
```

...and PR author `pkarw` (the reviewer), the changelog entry becomes:

```markdown
- 🐛 Validate event names against module registry (supersedes #1421). (#1555) *(@contributor-a, via @pkarw)*
```

The Contributors block lists `@contributor-a` first (primary author) and `@pkarw` once (only if they did not already appear as a primary author for some other PR in the same release).

## Rules

- Never credit a bot account (`github-actions[bot]`, `dependabot[bot]`, `copilot`, `renovate[bot]`).
- Never credit the merge author when Path A, B, or C detects a supersede — always resolve to the original author.
- Never fabricate a Highlights paragraph. Leave the `<!-- TODO: Highlights -->` marker for the human author to fill in; `auto-create-pr`'s review pass will call it out.
- Never modify files other than `CHANGELOG.md`. If the run needs anything else (e.g., a `package.json` version bump), stop and ask the user — that is out of scope for this skill.
- Never skip the `skip-qa` label on the resulting PR. Changelog edits are docs-only low-risk.
- Never run the full validation gate directly. Delegate to `auto-create-pr` and let it decide.
- Never pass `--force` to `auto-create-pr`. If a changelog PR for the same version already exists, stop and ask the user.
- Respect `--dry-run` absolutely: no file edits and no `auto-create-pr` invocation.
- When multiple PRs share the exact same normalized summary (e.g., repeated "CR fixes"), coalesce them into a single bullet with `(#A, #B, #C)` and merge the contributor credits — matches the style already in `CHANGELOG.md`.
- When a PR body contains `fixes #N` that points to a closed issue, keep the `(fixes #N)` suffix — it helps readers trace history even when the issue is long-closed.
- When resolving a superseded PR author fails (deleted account, private fork), fall back to `mergedPrAuthor` and add a `<!-- supersede author unresolved for #N -->` HTML comment immediately above the entry so a human reviewer can fix it.

## Reporting

On success, output the preview + the `auto-create-pr` URL (see step 9). On `--dry-run`, output the full drafted entry plus a per-PR table:

```markdown
| PR | Category | Line emoji | Primary author | Via | Notes |
|----|----------|-----------|----------------|-----|-------|
| #1555 | fix | 🐛 | @contributor-a | @pkarw | supersedes #1421 |
| #1550 | fix | 🔧 | @pkarw | — | — |
| #1546 | fix | 🐛 | @muhammadusman586 | — | fixes #1290 |
```

## Notes

- Runs well after `sync-merged-pr-issues` — the two skills consume the same window of merged PRs but mutate different surfaces (issue tracker vs CHANGELOG.md).
- The generated entry is intentionally a *draft*. A human maintainer should still fill in the Highlights paragraph, possibly regroup subsections, and adjust the narrative. `auto-create-pr` will open the PR in `review` so a maintainer reviews it before merge.
- Because the work is delegated to `auto-create-pr`, this skill inherits all of its guarantees: isolated worktree, incremental commits, BC self-review, `auto-review-pr` autofix pass, and comprehensive summary comment.
