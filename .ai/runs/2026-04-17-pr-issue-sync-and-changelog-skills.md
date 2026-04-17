# 2026-04-17 — PR↔Issue Sync and Auto-Update Changelog Skills

## Overview

Docs-only skill additions. Deliver two new agent skills under `.ai/skills/`:

1. **`sync-merged-pr-issues`** — iterate recently merged pull requests, detect any GitHub issues they address (via `fixes #N` / `closes #N` / `resolves #N` keywords in the PR body, title, or commit messages, plus `gh pr view --json closingIssuesReferences`), and close those issues with a comment linking back to the PR. When the discovered PR is **closed without merge** (superseded or abandoned), leave an informational comment on the issue noting that the PR was closed unmerged and name the superseding PR when one can be inferred — do not close the issue in that case.
2. **`auto-update-changelog`** — compile a CHANGELOG.md entry for the unreleased window using the existing emoji-driven format (`✨ Features`, `🐛 Fixes`, `🛠️ Improvements`, `🔒 Security`, `🧪 Testing`, `📝 Specs & Documentation`, `🚀 CI/CD & Infrastructure`, `👥 Contributors`) and hand it off to `auto-create-pr` so the changelog bump lands as a regular docs PR against `develop`. The skill MUST honor the **supersede credit rule**: when a merged PR was opened by the reviewer as a replacement for another contributor's PR (the pattern `auto-review-pr` uses — PR body starts with `Supersedes #N` and credits the original author), the changelog entry MUST credit the original author of the superseded PR, not the author of the merged replacement PR.

### External References

None — no `--skill-url` arguments were passed with the brief.

## Goal

Automate two agent-friendly release-engineering chores that currently require manual repo archaeology:

- Keep the GitHub issue tracker honest: every merged fix should auto-close its referenced issue; every closed-unmerged attempt should leave a trail on the issue.
- Keep `CHANGELOG.md` in the house style without asking a human to hand-author entries or chase down supersede credit.

## Scope

- Add `.ai/skills/sync-merged-pr-issues/SKILL.md`.
- Add `.ai/skills/auto-update-changelog/SKILL.md`.
- Update `.ai/skills/README.md` — file-tree entry + "Available Skills" table row for each new skill.
- Update the root `AGENTS.md` Task Router with rows pointing maintenance-style tasks at the new skills.

## Non-goals

- Do not implement any runtime code, generators, migrations, or package changes.
- Do not touch existing skills' workflows beyond adding cross-references.
- Do not script the actual execution of the new skills (this PR ships the *skill definitions*, not a scheduled job).
- Do not rewrite past CHANGELOG entries; the skill only writes *new* entries going forward.
- Do not add a new npm workspace, new CLI command, or new GitHub Action.

## Risks

- **Issue auto-close blast radius.** A badly written `sync-merged-pr-issues` skill could close an issue that a PR merely *mentions* but does not actually fix. Mitigation: only act on well-known keywords (`fixes`, `closes`, `resolves`) or the authoritative `closingIssuesReferences` GraphQL field — never on a raw `#N` mention; require explicit confirmation when the PR targets a non-default branch; write a claim/release comment on the issue exactly like `auto-fix-github` does so two runs can't double-close.
- **Wrong author in changelog.** Missing the `Supersedes #N` pattern would credit the wrong contributor. Mitigation: document the detection heuristics explicitly (body regex on `^Supersedes #\d+`, `Credit: original implementation by @user` line, or a labeled comment from `auto-review-pr`), require the skill to resolve the original author via `gh pr view {supersededPr} --json author` before writing the entry, and surface both PR numbers in the changelog line when a merged PR is a carry-forward.
- **Stale release window detection.** The changelog skill needs a reliable "since last release" boundary. Mitigation: derive the lower bound from the topmost `# X.Y.Z (YYYY-MM-DD)` heading in `CHANGELOG.md` and cross-check with the most recent annotated git tag; ask the user when the two disagree.
- **`auto-create-pr` recursion.** `auto-update-changelog` delegates to `auto-create-pr`. Mitigation: pass a concrete brief and slug so `auto-create-pr` does not re-derive one; never pass `--force`; document that the changelog PR is always a docs-only low-risk change that should carry `skip-qa`.

## Implementation Plan

### Phase 1: `sync-merged-pr-issues` skill

Skill file at `.ai/skills/sync-merged-pr-issues/SKILL.md` with the following shape:

- YAML frontmatter (`name`, `description` with strong trigger words: "close referenced issues", "sync PR to issue tracker", "post-merge housekeeping").
- `## Arguments` — optional `--since <git-ref|date>` (default: since last tag / last released CHANGELOG heading / last 7 days), optional `--limit <n>`, optional `--dry-run`.
- `## Workflow`:
  0. Pre-flight: confirm `gh` auth, resolve repo owner/name.
  1. List merged PRs in the window via `gh pr list --state merged --search 'merged:>=<date>' --json number,title,url,mergedAt,author,body,closingIssuesReferences,headRefName,baseRefName`.
  2. Also scan **closed-but-not-merged** PRs in the same window (`--state closed` minus merged).
  3. For each PR, extract referenced issues with this precedence:
     - `closingIssuesReferences` (authoritative — GitHub's own parse).
     - Regex on PR body + title: `\b(fixes|closes|resolves)\s+#(\d+)\b` (case-insensitive).
     - Ignore bare `#NNN` mentions that are not preceded by a close-keyword.
  4. For each `(pr, issue)` pair where the issue is still open:
     - If the PR was **merged into the default branch**: post a claim comment, close the issue with `gh issue close <n> --reason completed --comment "..."`, and leave a short comment linking back to the PR with the merge SHA.
     - If the PR was merged into a non-default branch: post an informational comment on the issue but do **not** close it. Explicitly call this out.
     - If the PR was **closed without merge**: post an informational comment on the issue ("PR #N was closed without merging; this issue remains open") and, when `Supersedes #M` metadata is present on a *different* merged PR, link that successor.
  5. Respect `--dry-run` — print exactly what it would do but call no mutating `gh` commands.
  6. Claim/release protocol — set the assignee, add `in-progress` to the issue before acting, remove `in-progress` after. Same shape as `auto-fix-github` uses.
  7. Never act on an issue already carrying `in-progress`, `do-not-close`, or `blocked`. Skip and log.
- `## Rules` — explicit don't-do list: no bare `#N` heuristics, no acting on draft PRs, no acting on fork PRs that were never merged to the default branch, no closing issues in other repositories, never bypass `--dry-run` when the flag is present.
- `## Reporting` — print a table of what was closed, what was commented on, what was skipped and why.

Progress steps:
- Create the directory.
- Write `SKILL.md` with frontmatter, Arguments, Workflow, Rules, Reporting, and an Examples section showing `--dry-run` output and the two comment templates (merged-closure comment and closed-unmerged informational comment).

### Phase 2: `auto-update-changelog` skill

Skill file at `.ai/skills/auto-update-changelog/SKILL.md` with the following shape:

- YAML frontmatter with triggers: "write changelog entry", "update CHANGELOG.md for unreleased", "release notes with emoji categories".
- `## Arguments` — optional `--version <x.y.z>` (default: derive from `package.json` + last CHANGELOG heading), optional `--since <ref>`, optional `--date <YYYY-MM-DD>` (default: today).
- `## Workflow`:
  0. Pre-flight: determine the window (last CHANGELOG heading date → today; cross-check with the most recent git tag and ask if they disagree).
  1. Gather merged PRs in the window via `gh pr list --state merged --search 'merged:>=<date>' --json number,title,body,author,labels,mergedAt,url`.
  2. For each PR, derive:
     - **Category bucket** — from labels first (`bug` → Fixes, `feature` → Features, `refactor`/`documentation`/`security`/`dependencies`), falling back to conventional-commit prefix in the PR title (`fix:`/`feat:`/`refactor:`/`docs:`/`chore:`/`security:`/`test:`).
     - **Emoji prefix** — from a small built-in map aligned with what is already in `CHANGELOG.md` (e.g. `feat` → `✨`, `fix` → `🐛`, `security` → `🔒`, `docs`/`spec` → `📝`, `test` → `🧪`, `ci`/`build` → `🚀`, `refactor` → `🛠️`). Fall back to `🔧` when unsure.
     - **Credited author** — **supersede credit rule**. Detect supersede with the following heuristics, in order:
       1. PR body contains `^Supersedes #(\d+)` or `^Closes #(\d+) \(supersedes\)` in the first few lines.
       2. PR body contains `Credit: original implementation by @(\w[\w-]*)`.
       3. A PR comment posted by `auto-review-pr` starts with `🤖 \`auto-review-pr\` carried forward #\d+`.
       When matched, resolve the superseded PR via `gh pr view {supersededPrNumber} --json author` and credit *that* author in the changelog line. Also include `(supersedes #M)` in the text so readers can trace the history.
     - **Line format** — `- <emoji> <summary>. (#<pr>) *(@author)*` matching the existing CHANGELOG style. When multiple authors contributed or when supersede applies, use `*(@original-author, via @replacement-author)*`.
  3. Group into sections in this order when non-empty: `## ✨ Features`, `## 🔒 Security`, `## 🐛 Fixes`, `## 🛠️ Improvements`, `## 🧪 Testing`, `## 📝 Specs & Documentation`, `## 🚀 CI/CD & Infrastructure`. Optionally include subheaders (`### 👥 Area`) when enough entries share a clear module. Keep the "Highlights" paragraph blank when unclear, with a `TODO: Highlights` marker for the human author.
  4. Build the `## 👥 Contributors` block as a deduplicated bullet list of every credited author (applying the supersede rule so the original author is listed, not the replacement author — but still list the replacement author separately so both appear).
  5. Prepend the new entry to `CHANGELOG.md` above the topmost `# X.Y.Z (YYYY-MM-DD)` heading, preserving the trailing `---` separator convention.
  6. Hand off to `auto-create-pr` with:
     - `--slug changelog-<version>`
     - a brief of the form: `"Update CHANGELOG.md for <version> covering PRs merged between <sinceDate> and <today>. Do not modify any other files."`
     - and let `auto-create-pr` handle branch, worktree, validation gate (docs-only — lint only), PR body, labels (`documentation`, `skip-qa`), and the summary comment.
  7. Never run the full validation gate itself — that is `auto-create-pr`'s job. Only pre-stage the CHANGELOG edit locally before delegating.
  8. Respect `--dry-run` — print the drafted entry to stdout without editing files or calling `auto-create-pr`.
- `## Supersede Credit Rule` — dedicated section documenting exactly which lines `auto-review-pr` writes and how to resolve the original author, with worked examples for all three detection paths.
- `## Rules` — never credit a bot account; never skip `skip-qa` label on the resulting PR (changelog is always low-risk docs); never write a Highlights paragraph with fabricated content.
- `## Reporting` — print a preview of the entry plus the `auto-create-pr` URL it spawned.

Progress steps:
- Create the directory.
- Write `SKILL.md` with the full workflow, the Supersede Credit Rule section, emoji/category mapping table, rules, reporting, and a complete worked example.

### Phase 3: Index updates

- Update `.ai/skills/README.md`:
  - Insert the two new skill folders in the file-tree block.
  - Add two rows in the "Available Skills" table with the expected trigger language.
- Update root `AGENTS.md` Task Router — add two rows under PR Workflow / maintenance automation:
  - `Syncing merged PRs to their referenced issues, auto-closing issues, commenting on closed-unmerged PRs` → `.ai/skills/sync-merged-pr-issues/SKILL.md`.
  - `Drafting a CHANGELOG.md release entry with emoji categories, crediting supersede authors correctly, and shipping it as a docs PR via auto-create-pr` → `.ai/skills/auto-update-changelog/SKILL.md`.

Progress steps:
- Update README index table.
- Update README file-tree block.
- Add two Task Router rows to root `AGENTS.md`.

### Phase 4: Validation and PR

- Docs-only run. Minimum gate: `yarn lint` if it covers markdown/frontmatter, plus a manual re-read of the diff.
- Self code-review against `.ai/skills/code-review/SKILL.md` (trigger-word quality, examples concrete, no secrets, no destructive defaults).
- BC self-review — no contract surface touched.
- Open PR with title `docs(skills): add sync-merged-pr-issues and auto-update-changelog skills`.
- Labels: `review`, `documentation`, `skip-qa`.
- Run `auto-review-pr` in autofix mode, then post the comprehensive summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: sync-merged-pr-issues skill

- [ ] 1.1 Create `.ai/skills/sync-merged-pr-issues/` directory
- [ ] 1.2 Write `SKILL.md` with frontmatter, workflow, rules, reporting, examples

### Phase 2: auto-update-changelog skill

- [ ] 2.1 Create `.ai/skills/auto-update-changelog/` directory
- [ ] 2.2 Write `SKILL.md` with frontmatter, workflow, Supersede Credit Rule section, rules, worked example

### Phase 3: Index updates

- [ ] 3.1 Update `.ai/skills/README.md` "Available Skills" table
- [ ] 3.2 Update `.ai/skills/README.md` file-tree block
- [ ] 3.3 Add two Task Router rows to root `AGENTS.md`

### Phase 4: Validation and PR

- [ ] 4.1 Run docs-only validation gate
- [ ] 4.2 Self code-review + BC self-review
- [ ] 4.3 Open PR against develop and normalize labels
- [ ] 4.4 Run `auto-review-pr` autofix pass
- [ ] 4.5 Post comprehensive summary comment
