# Execution Plan — Railway One-Command Deployment Spec

> **Run type:** docs-only (spec authoring). No application code changes.

## Goal

Author a detailed, implementation-ready specification for adding a fully automated **one-command Railway.com deployment** option to the Open Mercato CLI. The spec must describe how a user — having just run `create-mercato-app` and initialized a git repo — can invoke a single CLI command and receive a live Railway URL back, with no manual dashboard clicks.

## Scope

- **In scope (deliverables of this PR):**
  - One new spec file at `.ai/specs/2026-05-12-railway-one-command-deploy.md` covering CLI design, Railway API integration, scaffolded-template requirements, end-to-end flow, failure handling, security, testing, and rollout phases.
  - A short row added to the root `AGENTS.md` Task Router pointing at the new spec.
  - A short banner update to the existing (outdated) `apps/docs/docs/installation/railway.mdx` flagging that the template referenced there is no longer maintained and pointing readers at the new spec.
- **Out of scope (this PR):**
  - Any application or CLI code changes implementing the spec.
  - The new user-facing `apps/docs/docs/deployment/railway.mdx` doc page — that lands with the implementation PR, not this spec PR. The spec describes its contents.
  - Multi-provider deployment specs (Fly.io, Render, etc.) — separate future specs.
  - Auto-scaling, multi-region, or Enterprise-only Railway features.

## Non-goals

- Removing or rewriting the existing `apps/docs/docs/installation/railway.mdx`. We only annotate it with a "this is outdated" banner; rewriting it is part of the implementation PR.
- Locking in any specific Railway GraphQL schema details that we have not verified — uncertain points must be marked `// VERIFY` in the spec.
- Promising the existence of an Open Mercato Railway "template" — the spec must describe what such a template *would* contain, but treat it as something the implementation PR builds from scratch.

## External References

None — this run was invoked without `--skill-url` arguments. All guidance comes from project `AGENTS.md` files, `.ai/specs/AGENTS.md`, and the `.ai/skills/spec-writing/SKILL.md` skill.

## Implementation Plan

### Phase 1 — Spec authoring

The bulk of the work. One large markdown file under `.ai/specs/` following `.ai/specs/AGENTS.md` conventions: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog. Each subsection below maps to a section of that spec.

- **1.1** Draft TLDR, Overview, Problem Statement, and explicit Non-goals.
- **1.2** Draft CLI command design (command name choice, flags table, credential handling, idempotency contract).
- **1.3** Draft Railway integration approach (GraphQL endpoint, auth, mutations/queries enumerated, fallback to `railway` CLI when API is insufficient — flagged with `// VERIFY` where applicable).
- **1.4** Draft Railway template & project structure (services, env-var matrix, Nixpacks-vs-Dockerfile decision and justification, `start.sh`, healthcheck endpoint, worker/cron services).
- **1.5** Draft the end-to-end flow (10 numbered steps + per-step API calls + per-step persisted state for idempotency).
- **1.6** Draft failure handling, log streaming, retries/timeouts, cleanup semantics.
- **1.7** Draft security & secrets (token storage, file permissions, threat model, scoped tokens).
- **1.8** Draft testing strategy (unit, integration, dry-run mode, what cannot be tested in CI).
- **1.9** Draft documentation deliverables list (new docs page outline, Task Router row, banner on existing outdated doc).
- **1.10** Draft Risks & Impact Review, Migration & Backward Compatibility section, Integration Coverage list, Final Compliance Report, Changelog.

### Phase 2 — Repo wiring for the spec

- **2.1** Add a row to the root `AGENTS.md` Task Router pointing tasks like "deploy a fresh Open Mercato app to Railway" at the new spec file.
- **2.2** Annotate the existing `apps/docs/docs/installation/railway.mdx` with a short admonition flagging that the linked template is unmaintained and pointing at the new spec (informational only — no rewrite).

### Phase 3 — Validation & PR

- **3.1** Re-read the diff end-to-end; verify all `// VERIFY` markers carry concrete context.
- **3.2** Run the docs-minimum gate: `yarn lint`, manual diff re-read, confirm no contract surface change.
- **3.3** Run code-review and BC self-review (docs-only, but verify Task Router row uses correct shape and the banner doesn't break MDX rendering).
- **3.4** Open the PR against `develop`, apply labels (`review`, `feature`, `documentation`, `skip-qa` — docs-only).
- **3.5** Run `auto-review-pr` in autofix mode against the PR; apply any fixes as follow-up commits.
- **3.6** Post the comprehensive summary comment.

## Risks

- **Railway API drift.** We document specific GraphQL operations the spec implementer will use. Railway is allowed to evolve their schema. Mitigation: every operation is marked `// VERIFY` and the spec instructs the implementer to verify against `https://docs.railway.com/reference/public-api` (and a current introspection) before writing code.
- **"Deploy from local source" availability.** Whether `railway up` (local source upload) is reachable via the GraphQL API directly is the single biggest unknown. The spec must call this out as a forking decision point and describe both paths (API-only vs. GitHub-mediated via auto-created repo + `GH_TOKEN`).
- **Outdated existing docs.** The current `installation/railway.mdx` links to a Deploy-on-Railway template (`railway.com/deploy/TKvo95`) we no longer maintain. Risk: users follow that and get a stale stack. Mitigation: small banner update in this PR; full rewrite in the implementation PR.
- **Scope creep into implementation.** Authors are tempted to add code "just to prove it works." Mitigation: enforce docs-only at review time; the plan explicitly lists Phase 2 wiring as the *only* non-spec change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spec authoring

- [ ] 1.1 Draft TLDR, Overview, Problem Statement, Non-goals
- [ ] 1.2 Draft CLI command design section
- [ ] 1.3 Draft Railway integration approach section
- [ ] 1.4 Draft Railway template & project structure section
- [ ] 1.5 Draft end-to-end flow section
- [ ] 1.6 Draft failure handling section
- [ ] 1.7 Draft security & secrets section
- [ ] 1.8 Draft testing strategy section
- [ ] 1.9 Draft documentation deliverables section
- [ ] 1.10 Draft Risks, Migration/BC, Integration Coverage, Compliance, Changelog

### Phase 2: Repo wiring for the spec

- [ ] 2.1 Add Task Router row in root AGENTS.md
- [ ] 2.2 Annotate existing installation/railway.mdx with outdated banner

### Phase 3: Validation & PR

- [ ] 3.1 Diff re-read; verify // VERIFY markers are concrete
- [ ] 3.2 Run docs-minimum gate (yarn lint, manual re-read)
- [ ] 3.3 Self code-review + BC self-review
- [ ] 3.4 Open PR with labels
- [ ] 3.5 Run auto-review-pr autofix pass
- [ ] 3.6 Post comprehensive summary comment

## Changelog

- 2026-05-12 — Plan created (`auto-create-pr` skill, slug `railway-one-command-deploy`).
