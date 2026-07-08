# Integrate the shared open-mercato/skills collection (mixin install)

Goal: stop maintaining two copies of the generalized `om-*` pipeline skills. The 20 skills published in [open-mercato/skills](https://github.com/open-mercato/skills) become the single source of truth, installed via `npx skills add`; `.ai/skills/` keeps only repo-specific skills plus slim repo-local overrides that the external skills read.

## Scope

- `scripts/install-skills.sh` — mixin: local tier symlinks + `npx -y skills add open-mercato/skills --skill '*' --agent claude-code --agent codex -y` into `.agents/skills/` (graceful offline fallback, `--no-external`, extended `--clean`).
- `.ai/skills/tiers.json` (+ schema, validator) — new `external` block registering externally-owned skill names; folders matching those names are repo-local overrides, never symlinked.
- Remove the 17 `.ai/skills/` folders duplicated on skills-repo `main`; keep `om-auto-fix-github` (external successor is `om-auto-fix-issue`), the `-loop` variants, `om-prepare-issue`, and all other local-only skills.
- `.ai/agentic.config.json` + `.ai/trackers/github.md` + `.ai/review-checklist.md` — the repo-specific settings the external skills read (validation gate mirroring CI, `develop` base branch, label taxonomy incl. `enterprise`, QA gate, checklist relocated from the old `om-code-review` references).
- Repo-local overrides: `om-code-review` (Docker-runner Step 0, template parity gate, layer taxonomy, severity mapping), `om-auto-review-pr` (GitHub-checks-first validation, stricter verdict rule), `om-integration-tests` (full OM environment specifics retained).
- Docs: root `AGENTS.md` (task router + validation runner), `.ai/skills/README.md`, `UPGRADE_NOTES.md`, `.gitignore` (`skills-lock.json`).

## Risks

- The npx step needs network; devcontainer/CI installs must tolerate failure (script warns and continues — mitigated).
- External skill names drift upstream; `external.skills` in tiers.json is the reviewed registry.
- Behavior parity: validated by dry-run comparisons of `om-code-review` and `om-auto-review-pr` from the old and new paths on PR #3944.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pipeline config

- [x] 1.1 Write `.ai/agentic.config.json` (validation gate, labels, develop base branch, QA gate)
- [x] 1.2 Install `.ai/trackers/github.md` tracker descriptor
- [x] 1.3 Relocate the review checklist to `.ai/review-checklist.md`

### Phase 2: Mixin installer

- [x] 2.1 Remove the 17 duplicated skill folders
- [x] 2.2 Add `external` block to `tiers.json` + schema
- [x] 2.3 Teach `validate-skills-tiers.sh` about external overrides
- [x] 2.4 Add npx external step, `--no-external`, extended `--clean` to `install-skills.sh`
- [x] 2.5 Ignore `skills-lock.json`

### Phase 3: Overrides and docs

- [x] 3.1 Repo-local overrides: `om-code-review`, `om-auto-review-pr`, `om-integration-tests`
- [x] 3.2 Update `AGENTS.md` (task router, external-skills note, validation runner)
- [x] 3.3 Update `.ai/skills/README.md`, `UPGRADE_NOTES.md`, `.ai/lessons.md` paths

### Phase 4: Verification

- [x] 4.1 Tiers validator + `node --test scripts/__tests__/preview-workflows.test.mjs` green
- [x] 4.2 End-to-end install: 20 external + tier symlinks, sweep keeps external links, `--clean` removes all
- [x] 4.3 Parity dry-runs old-vs-new for `om-code-review` and `om-auto-review-pr` on PR #3944
