# Execution plan — standalone auto-skills, route metadata, dev DX

**Date:** 2026-04-22
**Slug:** standalone-auto-skills-and-route-metadata
**Branch:** `fix/standalone-auto-skills-and-route-metadata`
**Base:** `develop`

## Overview

User reported a generator warning (`Route file exports handlers but no metadata — auth will default to required`) emitted by `yarn generate` in a create-mercato-app-scaffolded project at `/home/pkarw/Projects/my-app/src/modules/example/api/blog/[id]/route.ts`. The fix focuses **standalone apps** (the create-mercato-app scaffold and the guidance that ships with it), not the monorepo.

Two additional items landed mid-flight:

- `yarn dev` watches structural module changes but does not always make newly-added modules "feel applied" to the running app — fix the dev watcher so new modules are picked up reliably.
- `yarn dev` should auto-apply new DB migrations (env-toggle, default ON), and must emit a friendly, actionable warning when a user-applied migration collides with the auto-apply step.

## Goal

- Stop re-shipping broken `route.ts` templates in create-mercato-app.
- Make the standalone template enforce the "metadata is required on route files" rule in AGENTS.md, with a clear example.
- Make the four `auto-*` skills (`auto-create-pr`, `auto-continue-pr`, `auto-review-pr`, `auto-fix-github`) ship with create-mercato-app and work inside an end-user standalone repo (default branch probe, optional labels, probe-before-run validation gate, standalone file layout).
- Surface the auto-* skills to users at project creation time (post-install message + template README + AGENTS.md Task Router).
- Fix `yarn dev` so new modules are reliably applied.
- Add an opt-out env-controlled auto-migrate step to `yarn dev` with actionable conflict messaging.
- Add a single-shot migration guidance rule to AGENTS.md (monorepo root + standalone template).

## Scope

- `packages/create-app/template/src/modules/example/api/blog/[id]/route.ts` — legacy `requireAuth`/`requireFeatures` exports → `metadata` object.
- Standalone AGENTS.md surfaces (`packages/create-app/template/AGENTS.md`, `packages/create-app/agentic/shared/AGENTS.md.template`, `packages/create-app/agentic/claude-code/CLAUDE.md.template`).
- `packages/create-app/agentic/shared/ai/skills/auto-*` — new skill folders adapted for standalone.
- Post-install messaging in `packages/create-app/src/**` + `packages/create-app/template/README.md` (if present).
- `apps/mercato/scripts/dev.mjs` + `packages/create-app/template/scripts/dev.mjs` + `packages/create-app/template/scripts/dev-runtime.mjs` — migration auto-apply + watcher reload fix.
- Root `AGENTS.md` + standalone AGENTS.md — single-shot migration rule.

## Non-goals

- Deep overhaul of monorepo AGENTS.md Task Router (user narrowed scope to standalone).
- Renaming any of the four auto-* skills.
- Refactoring the full dev runtime — minimal, targeted change only.
- Auditing every `route.ts` across the whole monorepo.

## External References

- No `--skill-url` arguments supplied by user.

## Implementation Plan

### Phase 1 — Fix the broken route template (blog/[id]/route.ts)

Replace the legacy `requireAuth` / `requireFeatures` individual exports with the expected `metadata` object shape. Keep the route semantics identical.

### Phase 2 — Audit all standalone template `route.ts` files for metadata

Sweep `packages/create-app/template/src/modules/**/route.ts`. Every file that exports an HTTP handler must also export `metadata`. Mostly a sanity pass — the other files already comply, but we confirm by running the generator in Phase 9.

### Phase 3 — Update standalone template AGENTS.md

Add a "Route files MUST export `metadata`" rule with an example and the literal generator warning for grep-ability. Add an "Agent Automation / Auto-Skills" subsection to the Task Router that enumerates the four auto-* skills. Repeat the metadata rule in `packages/create-app/agentic/shared/AGENTS.md.template` so users who re-run `mercato agentic:init` also get it.

### Phase 4 — Port auto-* skills into create-app agentic shared ai/skills

Copy the four skills from `.ai/skills/` into `packages/create-app/agentic/shared/ai/skills/`. Adapt each SKILL.md to work outside the monorepo:

- Base branch: probe `gh repo view --json defaultBranchRef` and fall back to `main`, then `develop`.
- Labels: treat the pipeline labels (`review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`, `needs-qa`, `skip-qa`, `in-progress`) as opt-in. Detect via `gh label list` and skip gracefully with a single-line note when missing. Provide a one-shot `gh label create` helper snippet in the skill's README.
- File layout: recognize both `packages/<pkg>/src/modules/...` (monorepo) and `src/modules/...` (standalone).
- Validation gate: probe `package.json` scripts for `typecheck`, `test`, `lint`, `generate`, `build`; run what's present; warn on missing rather than fail.
- Keep monorepo behaviour intact — standalone is additive.

### Phase 5 — Surface auto-skills in CLI post-install + README

Emit a short, discoverable "AI coding workflow" panel after `create-mercato-app` finishes scaffolding. Bullet list:

- `/auto-create-pr <task>` — delegate an autonomous task as a PR.
- `/auto-continue-pr <PR#>` — resume an in-progress agent PR.
- `/auto-review-pr <PR#>` — review a PR end-to-end.
- `/auto-fix-github <issue#>` — fix an issue and open a PR.

Mirror the same block in the standalone template AGENTS.md / top-level README if present.

### Phase 6 — Confirm copy manifest wiring

Trace `packages/create-app/src/setup/**` and `build.mjs` to confirm the four new skill directories under `agentic/shared/ai/skills/auto-*` actually land in a scaffolded project. Adjust the generator / copy manifest if needed.

### Phase 7 — Fix `yarn dev` module reload for new modules

Instrument the `generate watch` loop (`packages/cli/src/mercato.ts`) to also include:

- `src/modules` and `apps/mercato/src/modules` enumerated recursively (today the tracked set stops at the roots registered in `modules.ts`, so modules that are present on disk but not yet registered can be missed until `modules.ts` is edited).
- The generated files' parent dir (`.mercato/generated`) so a subsequent purge/write also triggers the downstream dev runtime.

Additionally, after a structural regeneration, touch a sentinel file in `.mercato/generated/` so Next.js HMR picks up the change even when the generated content is identical. This is a common failure mode on WSL2/NTFS.

Apply the same fix to both the monorepo (`apps/mercato/scripts/dev.mjs`) and standalone (`packages/create-app/template/scripts/dev-runtime.mjs`) entry points.

### Phase 8 — yarn dev auto-migrate + migration guidance

Add an env-controlled pre-dev step (`OM_DEV_AUTO_MIGRATE=1` by default) that runs `yarn db:migrate` before Next starts. If the migrate step fails because a user already applied the migration out-of-band, the dev runtime captures the failure and prints a multi-line actionable message:

```
⚠ Migration could not be auto-applied.
This usually means you (or another process) already applied a migration that
overlaps the one currently in src/modules/<mod>/migrations/.

To resolve:
  • Re-run:     yarn db:migrate
  • Or roll back the conflicting migration and re-run:
                yarn db:migrate --down
  • Or set OM_DEV_AUTO_MIGRATE=0 and apply migrations manually.
```

Guard the friendly message behind a targeted error match so unrelated migration errors still fail loudly.

Update root `AGENTS.md` + standalone template AGENTS.md + `packages/create-app/agentic/shared/AGENTS.md.template` with a "Single-shot migrations" rule: multi-stage edits to the same migration file are risky because `yarn dev` auto-applies them; always write a migration in one shot. If iteration is unavoidable, either disable auto-migrate or manually roll back between edits.

### Phase 9 — Validation gate

- `yarn generate` on the monorepo — confirm zero `Route file exports handlers but no metadata` warnings.
- `yarn typecheck` (targeted to `@open-mercato/cli`, `@open-mercato/create-app`, and anything touched).
- `yarn test` (targeted to touched packages).
- `yarn build:packages` sanity pass.
- `yarn test:create-app` smoke run if time permits (gates standalone scaffold regression).

### Phase 10 — Open PR, label, auto-review-pr autofix pass

Title: `fix(create-app): route metadata + standalone auto-skills + dev DX`.

Labels: `review`, `needs-qa`, `documentation`, `feature` (via `gh pr edit`).

Post a comment per label per PR workflow. Then run the `auto-review-pr` skill against the resulting PR in autofix mode.

## Risks

- Scope is wider than a typical single run — explicit Progress entries per phase so `auto-continue-pr` can resume without replaying work.
- Shipping skills into create-mercato-app means future edits to the monorepo copy need to be mirrored; add a lint/sync note.
- Auto-migrate touches dev flow — default ON could surprise users; mitigated by env opt-out and clear warning text.
- Dev watcher changes must not break existing tests (`scripts/__tests__/dev-orchestration-log-policy.test.mjs`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix broken route template (blog/[id]/route.ts)

- [x] 1.1 Replace individual exports with `metadata` object — 033b5f46b
- [ ] 1.2 Verify openApi + handlers still compile (typecheck targeted)

### Phase 2: Audit standalone route.ts templates

- [x] 2.1 Confirm every `route.ts` under create-app/template exports `metadata` — all other files compliant
- [x] 2.2 Fix any stragglers found — only blog/[id] needed the fix (covered in Phase 1)

### Phase 3: Update standalone AGENTS.md for metadata rule + auto-skills

- [x] 3.1 Add "Route files MUST export metadata" rule with example — e60515ac0
- [x] 3.2 Add Agent Automation / Auto-Skills section to Task Router — e60515ac0
- [x] 3.3 Mirror in agentic/shared AGENTS.md.template — e60515ac0

### Phase 4: Port auto-* skills into create-app agentic shared ai/skills

- [x] 4.1 Copy auto-create-pr SKILL.md + standalone adaptation — STANDALONE.md added
- [x] 4.2 Copy auto-continue-pr SKILL.md + standalone adaptation
- [x] 4.3 Copy auto-review-pr SKILL.md + standalone adaptation
- [x] 4.4 Copy auto-fix-github SKILL.md + standalone adaptation
- [x] 4.5 Add standalone-specific README / label-setup snippet — inside STANDALONE.md

### Phase 5: Surface auto-skills in CLI post-install + README

- [x] 5.1 Emit post-scaffold banner enumerating the five skills — fd37d52b4
- [x] 5.2 Mirror the info block in template AGENTS.md — e60515ac0 / 1740997e4

### Phase 6: Confirm copy manifest wiring

- [x] 6.1 Trace packages/create-app/src/setup manifest — 6cec00253
- [x] 6.2 Adjust manifest so auto-* + trim-unused-modules ship — 6cec00253 / 1740997e4

### Phase 7: Fix yarn dev module-reload (DEFERRED — needs repro)

- [ ] 7.1 Broaden `generate watch` tracked paths (include src/modules recursive, .mercato/generated sentinel) — DEFERRED: the existing watcher already tracks `src/modules` at the root and `calculateStructureChecksum` walks children; the user's `Module not found: ../../../components/BookCoverField` error points at Next.js's module-resolution cache, not the generator watcher. Needs a minimal reproducible scenario before changing hot-path dev-runtime code.
- [ ] 7.2 Touch sentinel after regeneration to force Next HMR — DEFERRED: same reason; sentinel-touch is speculative without knowing which cache layer is stale.
- [ ] 7.3 Apply same fix to template dev runtime — DEFERRED.

### Phase 8: yarn dev auto-migrate option + single-shot migration guidance

- [ ] 8.1 Add OM_DEV_AUTO_MIGRATE gate + pre-dev db:migrate step (monorepo) — DEFERRED (standalone-only scope per user)
- [x] 8.2 Mirror for standalone dev runtime — b6b92ab06
- [x] 8.3 Add friendly conflict-warning formatter — b6b92ab06
- [x] 8.4 Add "Single-shot migrations" rule to standalone AGENTS.md — e60515ac0
- [x] 8.5 Add rule to standalone template AGENTS.md + agentic template — e60515ac0

### Phase 9: ACL grant rule + apply CLI (NEW scope)

- [x] 9.1 Standalone AGENTS.md rule: new features auto-granted to admin/superadmin — 1740997e4
- [x] 9.2 Agentic shared AGENTS.md.template mirror — 1740997e4
- [x] 9.3 Implement `yarn mercato auth sync-role-acls --all-tenants` CLI — superseded by develop's `sync-role-acls` command (commits a97a011f6, 7431d4a4f). Docs and AGENTS.md updated to point at the canonical command instead of the originally-planned `apply-acl`.
- [x] 9.4 Ensure defaultRoleFeatures is seeded on tenant creation (verify existing behavior) — verified: `setupInitialTenant()` already calls `ensureDefaultRoleAcls` at line 336 of `packages/core/src/modules/auth/lib/setup-app.ts`, so new tenants receive defaults on creation. The `sync-role-acls` CLI reconciles existing tenants.

### Phase 10: Strict Design System enforcement in AGENTS.md (NEW scope)

- [x] 10.1 Standalone template AGENTS.md: strict DS section with quick-reference table — 1740997e4
- [x] 10.2 Agentic shared AGENTS.md.template mirror as CRITICAL rule 9 — 1740997e4

### Phase 11: trim-unused-modules skill (NEW scope)

- [x] 11.1 Create SKILL.md — 1740997e4
- [x] 11.2 Add to Task Router in both AGENTS.md surfaces — 1740997e4
- [x] 11.3 Enumerate in src/setup/tools/shared.ts copy manifest — 1740997e4

### Phase 12: Validation gate (DEFERRED — /auto-continue-pr)

- [ ] 12.1 yarn generate — zero metadata warnings
- [ ] 12.2 Targeted typecheck + unit tests pass
- [ ] 12.3 yarn build:packages passes

### Phase 13: Open PR + labels + auto-review autofix

- [ ] 13.1 Push branch + open PR against develop (in-progress)
- [ ] 13.2 Apply pipeline labels with rationale comments
- [ ] 13.3 Run auto-review-pr autofix pass — DEFERRED

## Changelog

- 2026-04-22: Plan drafted (initial).
