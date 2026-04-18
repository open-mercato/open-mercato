# Step 1.1 checks — skill harness refresh

**Step:** 1.1 Rework auto-create-pr/auto-continue-pr and sibling skills to per-spec run folders.
**Scope:** docs-only — `.ai/skills/auto-create-pr/SKILL.md`, `.ai/skills/auto-continue-pr/SKILL.md`, `.ai/skills/auto-sec-report/SKILL.md`, `.ai/skills/auto-qa-scenarios/SKILL.md`, `.ai/skills/auto-update-changelog/SKILL.md`, `.ai/runs/README.md`.
**Commit:** `bacbc59ec`.

## Verification

- **Typecheck:** N/A — no TypeScript or JavaScript source touched.
- **Unit tests:** N/A — no source touched.
- **i18n checks:** N/A — no locale files or user-facing strings touched.
- **Playwright / screenshots:** N/A — no UI surface.
- **Diff re-read:** performed. All references to the legacy flat-file layout (`.ai/runs/<date>-<slug>.md`) are either updated to the folder layout or explicitly preserved as a documented fallback for resuming legacy PRs.
- **Frontmatter sanity:** both SKILL.md `description` fields updated to reflect the new folder layout + per-commit proofs + 2-subagent cap.
- **Cross-skill consistency:** `auto-sec-report`, `auto-qa-scenarios` migrated to `RUN_DIR` + `PLAN_PATH = ${RUN_DIR}/PLAN.md` + `HANDOFF_PATH` + `NOTIFY_PATH`. `auto-update-changelog` filter unchanged because its `.ai/runs/` prefix-exclusion works for both layouts; clarifying note added.

## Non-verification items intentionally skipped

- No `yarn typecheck`, `yarn test`, `yarn build:*`, `yarn i18n:*` were run because the Step does not change build inputs.
- No Playwright MCP check was run because there is no UI to exercise.
- Per the skill rules, skipping UI verification on a non-UI Step is expected and does not block development.

## Artifacts

- None. Docs-only diff is the artifact; see commit `bacbc59ec`.
