# Test-env skills: prefer the ephemeral runner and ask the user for the run mode

## Overview

**Goal:** Make the test-env skill overrides in both the monorepo and the standalone
create-app template prefer `test:integration:ephemeral` over plain `test:integration`
(the ephemeral variant provisions its own isolated environment — more autonomous and
safer for data), document `test:integration:ephemeral:start` as the reuse path for
small iterative test loops, and have the skills ask the user which run mode they want
when a human is present.

**Scope:**
- Monorepo repo-local skill overrides: `.ai/skills/om-prepare-test-env/SKILL.md`,
  `.ai/skills/om-integration-tests/SKILL.md`.
- Standalone override shipped by create-app:
  `packages/create-app/agentic/shared/ai/skills/om-prepare-test-env/SKILL.md`.
- Standalone template scripts: re-add the cross-platform mercato-CLI aliases
  `test:integration:ephemeral:start[:verbose]` to
  `packages/create-app/template/package.json.template` (they were removed by
  bf38ceb3d together with the sh-based scripts, but they are plain mercato CLI
  wrappers — multiplatform — and the skills need a stable name for the reuse loop).
- Template docs that enumerate these commands: `packages/create-app/template/AGENTS.md`,
  `packages/create-app/agentic/shared/AGENTS.md.template`.
- Guard test: extend `packages/create-app/src/lib/agentic-skills-standalone-overlays.test.ts`
  so the template keeps the start alias wired to the mercato CLI and the standalone
  override keeps documenting the ephemeral-first + ask-the-user contract.

**Non-goals:**
- No changes to the external shared skills in `.agents/skills/` (they come from
  open-mercato/skills; overrides carry the repo-specific deltas).
- No new `om-integration-tests` override folder for the standalone app (the
  standalone contract intentionally ships no override for it; `om-prepare-test-env`
  is the single place the environment policy lives and other skills defer to it).
- No changes to the mercato CLI runner behavior itself.

**Risks:**
- The overlay guard test enumerates the exact override set — extending assertions
  must not break the existing contract.
- Template `package.json.template` has a dependency-pin drift guard (5707c167e);
  script additions do not touch dependency pins.
- Local gate note: `packages/cli/src/lib/__tests__/dev-env-reload.test.ts`
  ("watches generated runtime files when explicitly requested") fails with
  `EMFILE: too many open files, watch` on this machine — reproduced identically
  on untouched `origin/develop`, so it is a pre-existing machine-level watcher
  limit, unrelated to this change (which touches no CLI code). CI is the
  authority for this suite.

## Implementation Plan

### Phase 1: Monorepo skill overrides

- 1.1 `.ai/skills/om-prepare-test-env/SKILL.md`: add a "Choosing the run mode"
  section — always prefer `yarn test:integration:ephemeral` over plain
  `yarn test:integration`; use `yarn test:integration:ephemeral:start` +
  filtered `yarn mercato test:integration <filter>` for small iterative loops
  reusing the running env; ask the user which mode they want when interactive,
  defaulting to fully-managed ephemeral when unattended.
- 1.2 `.ai/skills/om-integration-tests/SKILL.md`: reorder the Quick Reference so
  the ephemeral commands lead, add the run-mode question to the workflow and
  Running Existing Tests sections, and add MUST rules (prefer ephemeral; never
  plain `yarn test:integration` without the runner env block; ask the user for
  the mode when interactive).

### Phase 2: Standalone create-app template

- 2.1 Re-add cross-platform ephemeral start aliases to
  `packages/create-app/template/package.json.template`
  (`test:integration:ephemeral:start`, `test:integration:ephemeral:start:verbose`).
- 2.2 Update `packages/create-app/agentic/shared/ai/skills/om-prepare-test-env/SKILL.md`
  with the same run-mode selection contract using the standalone command names.
- 2.3 Update `packages/create-app/template/AGENTS.md` and
  `packages/create-app/agentic/shared/AGENTS.md.template` to document the start
  alias and the ephemeral-first policy.
- 2.4 Extend `agentic-skills-standalone-overlays.test.ts` to guard the new
  contract (start alias wired to mercato CLI; override documents ephemeral-first
  + run-mode question).

### Phase 3: Validation gate and PR

- 3.1 Run the full validation gate (`validation.commands`) and fix fallout.
- 3.2 Self code-review + breaking-change review, open PR, labels, autofix pass.

## Progress

PR: #4095

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Monorepo skill overrides

- [x] 1.1 Update .ai/skills/om-prepare-test-env/SKILL.md (run-mode choice, ephemeral-first) — 62157f9f7
- [x] 1.2 Update .ai/skills/om-integration-tests/SKILL.md (ephemeral-first quick ref, rules, ask step) — d7a47e2b3

### Phase 2: Standalone create-app template

- [x] 2.1 Re-add test:integration:ephemeral:start aliases to package.json.template — fda2e145c
- [x] 2.2 Update standalone om-prepare-test-env override (run-mode choice, ephemeral-first) — c01437860
- [x] 2.3 Document start alias in template AGENTS.md + AGENTS.md.template — 6eb3f9ca6
- [x] 2.4 Extend agentic-skills-standalone-overlays guard test — ad96cd888

### Phase 3: Validation gate and PR

- [x] 3.1 Full validation gate green (build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test 22/22, build:app)
- [x] 3.2 Self-review, PR #4095, labels, om-auto-review-pr pass (APPROVED — no findings; self-approval blocked by GitHub, report posted as comment review)
