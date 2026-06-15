# Fix Railway Local Upload Data Ignore

## Goal

Fix fresh `create-mercato-app` Railway local-source deployments so required app module `data/` source folders are uploaded and the remote build can resolve their imports.

## Scope

- Update the standalone template `.railwayignore` rule that currently excludes every directory named `data`.
- Add a create-app regression test proving module `src/modules/*/data` files are not matched by the upload ignore contract.
- Validate the focused create-app tests.

## Non-goals

- Do not change Railway authentication, token handling, resource provisioning, or deploy mode selection.
- Do not change package dependencies or generated files.
- Do not run a live Railway deployment.

## Source Context

- Source spec: `.ai/specs/2026-05-12-railway-one-command-deploy.md`
- Deployment docs: `apps/docs/docs/deployment/railway.mdx`
- Package guide: `packages/create-app/AGENTS.md`
- CLI guide: `packages/cli/AGENTS.md`

## Risks

- The root runtime data directory must remain excluded from local uploads. Anchor only the runtime-state rule, and keep the existing safety preflight entries passing.

## Implementation Plan

### Phase 1: Reproduce and narrow root cause

- Confirm the `@develop` scaffold ships `.railwayignore` with an unanchored `data/` rule.
- Confirm required module source files under `src/modules/*/data` are present locally but matched by that rule.

### Phase 2: Fix template and regression coverage

- Anchor the Railway ignore runtime-state rule to `/data/`.
- Add focused test coverage that fails if app module data source files would be excluded by the template Railway ignore file.

### Phase 3: Validation and PR

- Run focused create-app Railway template tests.
- Run diff hygiene checks and open a PR against `develop`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproduce and narrow root cause

- [x] 1.1 Reproduce scaffold ignore mismatch locally
- [ ] 1.2 Record root-cause evidence in PR summary

### Phase 2: Fix template and regression coverage

- [x] 2.1 Anchor Railway runtime data ignore rule — 5cdd2f7a4
- [x] 2.2 Add regression coverage for module data source files — 5cdd2f7a4

### Phase 3: Validation and PR

- [x] 3.1 Run focused create-app Railway template tests
- [ ] 3.2 Open PR and summarize cause, fix, and workaround
