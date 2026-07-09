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

### Phase 5: Adopt skills-repo PRs from 2026-07-09 (#13 om-prepare-test-env / tracker-optional verify-pr-ui, #14 attach-image-evidence, #15 self-configure)

- [x] 5.1 `tiers.json`: register `om-auto-verify-pr-ui` + `om-prepare-test-env` as external; drop `om-auto-verify-pr-ui` from the `automation` tier and remove its local full-copy folder — 921c46e67
- [x] 5.2 `.ai/agentic.config.json`: add `paths.scripts` (`.ai/scripts`) + `paths.qa` (`.ai/qa`); gitignore the generated `.ai/qa/test-env.json` descriptor and `.ai/qa/artifacts_*/` — 921c46e67
- [x] 5.3 `.ai/trackers/github.md`: add the `attach-image-evidence` operation (now byte-identical to canonical) — 921c46e67
- [x] 5.4 Rewrite the `om-integration-tests` repo-local override to defer environment boot/reuse to `om-prepare-test-env` (attach to the shared `.ai/qa/test-env.json`) instead of duplicating the logic; keep OM env specifics + test-authoring conventions — 2ff696816

### Phase 6: Installer updates external skills on re-run

- [x] 6.1 `install-skills.sh`: after `npx skills add`, run `npx skills update --project` so re-runs refresh external skills to the latest published versions (non-fatal offline); document in usage/header, `AGENTS.md`, `UPGRADE_NOTES.md`, `.ai/skills/README.md` — 5bd3bf2cf, 44e21387f

### Phase 7: Verification (resume)

- [x] 7.1 `sh -n install-skills.sh`, tiers validator (20 local / 25 external), preview-workflows test green — 44e21387f
- [x] 7.2 Repo-local `.ai/trackers/github.md` diff-clean vs canonical; docs references updated (verify-pr-ui external, new external skills) — 44e21387f

### Phase 8: Consolidate autofix to a single skill (user request)

- [x] 8.1 Remove local `om-auto-fix-github` (folder + automation-tier entry); repoint all live refs to the external `om-auto-fix-issue` under `.agents/skills/`; keep `om-auto-verify-and-fix-github` as the distinct browser-first variant — c58930dc0

> Follow-up (separate PR): mirror the mixin (external install with an explicit standalone skill subset + repo-local overrides + `skills update`, single `om-auto-fix-issue`) into the `packages/create-app/agentic/` standalone-app template (both the create-app wizard `shared.ts` and the CLI `agentic:init` `agentic-setup.ts` copy pipelines).
