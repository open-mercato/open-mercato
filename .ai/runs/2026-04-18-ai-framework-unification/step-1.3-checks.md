# Step 1.3 checks — in-progress label discipline in auto-create-pr

**Step:** 1.3 Tighten `in-progress` label discipline in `auto-create-pr` and dogfood on PR #1593.
**Scope:** docs-only — `.ai/skills/auto-create-pr/SKILL.md`.
**Commit:** `98ec6abb2`.

## What changed

- Added section `### 9b. Claim the PR with the three-signal in-progress lock` after PR creation. The skill now assigns the author, applies the `in-progress` label, and posts a `🤖 auto-create-pr started by …` claim comment immediately after `gh pr create`.
- Step 11 (`Run auto-review-pr and apply fixes`) now explicitly releases the `in-progress` label before invoking `auto-review-pr` so the sub-skill can claim cleanly with its own three-signal protocol, then reclaims after `auto-review-pr` returns.
- Step 13 (`Cleanup and lock release`) now releases the `in-progress` label in the same `trap`/finally that cleans up worktrees, so a crash still frees the PR.
- Rules section gained a dedicated bullet stating the three-signal claim + temporary-release + reclaim + final-release discipline, matching the root `AGENTS.md` rule that auto-skills mutating PRs/issues MUST claim with all three signals and MUST release on completion or failure.

## Dogfood on PR #1593

- `gh pr edit 1593 --add-label "in-progress"` — applied.
- Claim comment posted on #1593 with the UTC timestamp.
- Release happened after the Step 1.3 Progress flip commit was pushed.

## Verification

- **Typecheck / unit tests / Playwright / i18n:** N/A — docs-only change to one skill file.
- **Diff re-read:** confirmed the claim happens after `gh pr create` in step 9b, is released in step 11, is reclaimed after `auto-review-pr` in step 11, and is released in the step 13 trap/finally.
- **Cross-skill consistency:** `auto-continue-pr` already claims in step 0 and releases in step 9; no change required. Sibling skills (`auto-sec-report`, `auto-qa-scenarios`) follow `auto-create-pr` step 0 verbatim and inherit the new discipline by reference; their SKILL.md files do not duplicate the claim sequence.
- `auto-review-pr` (not modified in this run) retains its own step 0 claim and step 11 release, which is the contract `auto-create-pr` now depends on.

## Artifacts

- None. Docs-only diff is the artifact; see commit `98ec6abb2`.
