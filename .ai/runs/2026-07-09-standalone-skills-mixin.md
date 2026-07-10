# Standalone-app skills mixin (create-app template)

Tracking plan: .ai/runs/2026-07-09-standalone-skills-mixin.md
Status: implemented (validation green; Verdaccio smoke deferred)
Base (stacked on): feat/skills-repo-mixin (PR #4008). Target: develop. Open as DRAFT — rebase + un-draft after #4008 merges.

## Goal
Make scaffolded standalone apps handle skills the SAME mixin way the monorepo now does (PR #4008): install the shared open-mercato/skills collection via `npx skills add` / `npx skills update`, keep only repo-local overrides + standalone-only/local skills, and ship an `install-skills` script + `tiers.json` + `.ai/agentic.config.json` + `.ai/trackers/github.md`. Stop shipping full duplicate copies of skills that now live in the external collection. Consolidate autofix to the single external `om-auto-fix-issue`. Keep the scaffold 100% offline-safe (npx is a separate, user-run `yarn install-skills`, never run during scaffolding).

## Constraints (from packages/create-app/AGENTS.md)
- NEVER break the offline scaffold; scaffolding must stay deterministic + network-free.
- Ready-app imports (`--app`/`--app-url`) MUST NOT get agentic/skills injection.
- Two copy pipelines read from `agentic/` and must stay in sync:
  - `packages/create-app/src/setup/tools/shared.ts` (create-app wizard)
  - `packages/cli/src/lib/agentic-setup.ts` (CLI `agentic:init`)
- Do NOT pull all skills-repo skills — install only the subset the standalone ships today.

## Skill categorization
- REMOVE full duplicates (now external): om-auto-create-pr, om-auto-continue-pr, om-auto-create-pr-loop, om-auto-continue-pr-loop, om-auto-review-pr, om-code-review, om-integration-tests, om-prepare-issue, om-spec-writing. Plus om-auto-fix-github → external om-auto-fix-issue.
- KEEP repo-local OVERRIDE folders (fold STANDALONE.md standalone behavior into a slim override SKILL.md the external skill reads): om-auto-create-pr, om-auto-continue-pr, om-auto-create-pr-loop, om-auto-continue-pr-loop, om-auto-review-pr. (These had STANDALONE.md overlays.) The autofix override folder becomes om-auto-fix-issue (from om-auto-fix-github's STANDALONE.md). om-code-review/om-integration-tests/om-prepare-issue/om-spec-writing had NO overlay → no override folder (config covers them).
- KEEP standalone-only local skills (never external): om-module-scaffold, om-trim-unused-modules, om-system-extension, om-eject-and-customize, om-data-model-design, om-troubleshooter.
- KEEP monorepo-local skills offline: om-help, om-implement-spec, om-backend-ui-design, om-integration-builder (has STANDALONE.md), om-auto-upgrade-0.4.10-to-0.5.0.

## External install list for the standalone (only what it ships now):
om-auto-create-pr, om-auto-continue-pr, om-auto-create-pr-loop, om-auto-continue-pr-loop, om-auto-review-pr, om-code-review, om-integration-tests, om-prepare-issue, om-spec-writing, om-auto-fix-issue

## Progress
### Phase 1: Template mixin assets
- [x] 1.1 Add `agentic/shared/ai/skills/tiers.json` (external block = the 10-skill subset; local tiers = standalone-only + kept-local; overrides registered)
- [x] 1.2 Add `agentic/shared/ai/agentic.config.json` (standalone: baseBranch discovered/`main`, tracker github, standalone validation commands, labels, paths) + `agentic/shared/ai/trackers/github.md` (WITH attach-image-evidence)
- [x] 1.3 Add `agentic/shared/scripts/install-skills.sh` (offline-safe: local per-skill symlinks + OPTIONAL `npx skills add`/`update` of the explicit subset; `--no-external`/OM_SKIP_EXTERNAL_SKILLS)
- [x] 1.4 Wire `"install-skills"` into `template/package.json.template`; add `.gitignore` entries (skills-lock.json, .agents/skills/) to the template

### Phase 2: Overrides + removals
- [x] 2.1 Convert the 5 overlay skills (+ autofix) to slim repo-local OVERRIDE folders (SKILL.md derived from STANDALONE.md, external skill read in place); rename autofix override to om-auto-fix-issue
- [x] 2.2 Delete the 9 duplicate full-copy folders + om-auto-fix-github folder from agentic/shared/ai/skills/

### Phase 3: Copy pipelines
- [x] 3.1 shared.ts: stop copying removed folders; copy override folders + tiers.json/agentic.config.json/trackers/install-skills.sh; rework harness linking from single dir-symlink to per-skill symlinks (mirror monorepo install-skills prepare_harness_dir); keep ready-app-import skip intact
- [x] 3.2 agentic-setup.ts (CLI `agentic:init`): mirror the same changes
- [x] 3.3 build.mjs: confirm agentic/ (incl. new scripts + json) copied to dist/agentic/

### Phase 4: Tests + docs
- [x] 4.1 Update src/lib/agentic-skills-standalone-overlays.test.ts (trim overlay list / convert to override assertions)
- [x] 4.2 Update src/setup/tools/shared.test.ts ESM list if a new .ts template is added (install-skills.sh is POSIX sh, not .ts — likely no change)
- [x] 4.3 Keep green: agentic-skills-require-roles-guard.test.ts, ready-apps.test.ts
- [x] 4.4 Update packages/create-app/AGENTS.md agentic section + template AGENTS.md if needed

### Phase 5: Validation
- [x] 5.1 `cd packages/create-app && yarn typecheck` + `node --import tsx --test src/**/*.test.ts` green
- [x] 5.2 `cd packages/cli && yarn typecheck` green
- [x] 5.3 build.mjs runs; a scaffold smoke (bare, offline, --skip-agentic-setup off) produces per-skill symlinks + tiers.json + install-skills, no npx run during scaffold — verified 2026-07-10: `node build.mjs` green; offline scaffold (`--preset empty --agents claude-code --no-init-git`) produced `.ai/skills/tiers.json`, `.ai/agentic.config.json`, `.ai/trackers/github.md`, `scripts/install-skills.sh`, no `.agents/` (no npx during scaffold); `sh scripts/install-skills.sh --no-external` converted the harness dir symlink into per-skill symlinks (8 core skills) — 739006e01
- [x] 5.4 (deferred/needs Verdaccio) `yarn test:create-app` — documented as not run: needs the Verdaccio registry environment; covered by `packages/create-app` unit suite (9/9 green 2026-07-10) + the offline scaffold smoke in 5.3. Run before a create-app npm release.

### Phase 6: Post-review fixes
- [x] Post-review fix: reference external skills by name in AGENTS.md routing tables instead of hard-coded `.claude/skills/…` paths (harness is user-selectable via `--agents`; addresses @adeptofvoltron review comment on AGENTS.md.template:78) + guard test — 1dd86bc52
- [x] Post-review fix: mirror the monorepo's QA runtime-state gitignore block (`.ai/qa/test-env.json`, `test-env.lock/`, `test-env-boot.log`, `artifacts_*/`, `ephemeral*`) into `template/gitignore` — required after base-branch commit 83c5408a0 (om-prepare-test-env compile-once entrypoints) so scaffolded apps don't track skill-generated runtime state — 739006e01
</content>
