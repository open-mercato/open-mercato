# Standalone Open Mercato App — Agent Rules

Extend this installed Open Mercato app. Route first; load every match.

## Always

- **Route first** — match all three axes; if a routed file is missing, run `yarn mercato agentic:init` and retry.
- **Keep framework packages read-only** — write app code in `src/modules/<id>/`; use `om-framework-context` for exact installed source/instructions.
- **Preserve host scope** — derive trusted `tenantId` + `organizationId` and fail closed. Only an installed contract may declare tenant/system scope (`organizationId: null`); never widen organization data.
- **Use canonical primitives** — commands, `makeCrudRoute`, `CrudForm`/`DataTable`, DI, events, and UMES.
- **Use canonical paths** — entities: `src/modules/<id>/data/entities.ts`; API: `api/**/route.ts` with per-method `metadata` + `openApi`.
- **Lock editable records** — expose `updated_at`/`updatedAt`; custom update/delete clients send the version and surface 409 conflicts.
- **Probe schema** — run `yarn db:generate`, review scoped SQL/snapshot, and ask before applying it.
- **Regenerate discovery** — run `yarn generate` after changing discovered module files, `src/modules.ts`, routes, pages, events, widgets, agents, tools, or workflows.
- **Preserve public IDs** — event/entity IDs, API paths, ACL, DI tokens, widget spots, notifications, AI IDs, CLI names, and generated exports stay stable.
- **Localize/design consistently** — use translations and shared UI/tokens; cover loading, empty, error, conflict, keyboard, and accessibility states.

## Ask First

- Ask before reducing scope, changing architecture/contracts, adding production dependencies, ejecting modules, or replacing canonical primitives.
- Ask before migrations, data resets, database-target changes, live credentials, or real providers in tests.
- Ask before weakening auth/scope, encryption, mutation approval, locking, retries, idempotency, or audit/undo.

## Never

- Never leak tenants, trust payload scope, or treat missing scope as unrestricted.
- Never edit `node_modules`, `.mercato/generated/**`, generated facts, or shipped migrations.
- Never use cross-module ORM relations; use IDs/snapshots, events, enrichers, extensions, or optional DI.
- Never use raw `fetch`/admin `<form>`, ad hoc crypto/Redis/queues, role-name guards, or direct mutation when a canonical helper exists.
- Never hard-code user strings/status colors or expose secrets, credentials, or private transcripts.
- Never guess contracts when generated facts or exact-version source can answer.

## Validation Commands

Choose the smallest relevant set, then expand for broad changes:

```bash
yarn generate
yarn typecheck
yarn lint
yarn test
yarn build
yarn test:integration:ephemeral
```

Record failures honestly. Do not apply a database migration merely to make validation pass.

## Three-Axis Context Assembler

Match every axis; de-duplicate. Examples: notifications = `module-data` + `backend-ui` + `umes`; custom-field round trips add `testing`; lifecycle reactions = `module-data` + `umes`; write/search convergence bugs = `module-data` + `debugging`; bootstrap/registry drift = `architecture` + `module-data` + `debugging` (+ `framework-context` for exact installed contracts). Never collapse to one route.

Route only the requested outcome. `testing` needs explicit tests/coverage; “smallest validation” does not match. Use external `om-integration-tests` only for integration/E2E/browser coverage. `debugging` needs failure, security, or drift. Spec decomposition selects only `spec-pr`. Plan-only module work loads `om-module-scaffold` + architecture/contracts. Do not infer areas from specs/PRs.

### Axis 1 — Area and Ownership

Choose every changed area first.

| Route ID | Area / ownership decision | Add to context |
|---|---|---|
| `architecture` | Installed capabilities, discovery, overrides, upgrades, or ownership choice | `.ai/guides/architecture.md`; facts only for named/changed installed modules |
| `module-data` | New business/domain capability owned by this app | `src/modules/<id>/`; `.ai/guides/architecture.md` and `.ai/guides/contracts.md` |
| `umes` | Additive or supported replacement of installed behavior | App extension and/or `src/modules.ts`; `.ai/guides/extensions.md`; target facts |
| `backend-ui` | Admin, public, portal, form, table, detail, menu, translation, or component | Owning app module; `.ai/guides/backend-ui.md`; host facts when injecting |
| `integration` | Email, shipping, payment, sync, webhook, storage, import/export, or an external-provider boundary (not a workflow `CALL_API` activity) | Owning app module by default; separately published package/repo only for explicitly reusable delivery; `.ai/guides/integrations.md` |
| `ai-workflow` | AI agent/tool/orchestrator or durable workflow | Owning app module; `.ai/guides/ai-workflows.md`; target facts when extending |
| `debugging` | Bug, security issue, generated drift, or runtime inconsistency | Existing owning call site; `.ai/guides/testing-debugging.md`; affected areas |

Defaults: app domains/providers → `src/modules/<id>/`; installed customization → UMES/overrides. Reusable providers are published dependencies, never `packages/*` workspaces; ask before topology/ejection. `node_modules` is read-only.

### Axis 2 — Work Units and Primitives

Split the outcome; match all rows.

| Evaluator route ID | Work unit | Procedure and concept context |
|---|---|---|
| `architecture` | Explain capabilities or choose module vs UMES vs package vs eject | `.ai/guides/architecture.md`; `om-help` only if no direct row resolves ownership |
| `module-data` | Convert a business outcome into a complete vertical slice | `om-module-scaffold`; load its `business-one-shot-blueprints.md`, then union matched rows below |
| `spec-pr` | Split or implement cohesive specification phases | Axis 3's skill; keep every phase deployable |
| `architecture` | Audit an upgrade or disable an unused built-in | `om-troubleshooter` + `om-framework-context`, or `om-trim-unused-modules` |
| `architecture` + `integration` + `framework-context` | Audit a provider phase superseded by installed capability | `om-integration-builder` + `om-framework-context`; add troubleshoot/removal only for a failure or whole-module disable |
| `module-data` | Entity, relation/ID link, validator, migration/snapshot, encryption, lock, or atomic transaction | `om-data-model-design`; `.ai/guides/contracts.md` |
| `module-data` | CRUD/custom API, command/action, OpenAPI, ACL/setup, or mutation contract | `om-module-scaffold`; `.ai/guides/contracts.md` |
| `backend-ui` | DataTable/CrudForm, backend/public/portal page, page middleware, navigation, translation, or UI state | `om-backend-ui-design`; `.ai/guides/backend-ui.md` |
| `module-data` | Search/vector/analytics, event/subscriber, notification/message/inbox, worker/queue/progress, cache, or CLI | `om-module-scaffold`; `.ai/guides/contracts.md` |
| `umes` | Field/entity, response/query enricher, injection, interceptor/guard, sync subscriber, reactive notification handler, DOM bridge, widget event filter, extension, event reaction, toggle, or override | `om-system-extension`; `.ai/guides/extensions.md`; add the UI/data/integration/AI skill when matched |
| `integration` | Provider, credentials/health, webhook, import/export, safe client, reconciliation, packaging, or variant | `om-integration-builder`; `.ai/guides/integrations.md` |
| `ai-workflow` | Agent/tool/orchestrator/attachment/override | `om-create-ai-agent`; `.ai/guides/ai-workflows.md` |
| `ai-workflow` | Workflow/activity/user task/idempotency/output/progress | `om-build-workflow`; `.ai/guides/ai-workflows.md` |
| `testing` | Write/run unit tests, integration/E2E tests, or affected validation | `.ai/guides/testing-debugging.md`; add external `om-integration-tests` for integration/E2E; run the smallest relevant tests first, then escalate |
| `debugging` | Reproduce, root-cause, minimally fix, and add a regression oracle | `om-troubleshooter`; `.ai/guides/testing-debugging.md`; union affected primitives |
| `framework-context` | Facts/guides cannot answer an exact installed signature/behavior | `om-framework-context`, scoped to one package/module/query, only after earlier evidence |
| — | Add a missing recurring use case or fix this routing system | `om-evolve-harness` |

### Axis 3 — SDLC and Delivery

Select delivery independently. These come from pinned `open-mercato/skills` installed by `yarn install-skills`; local task skills do not replace them.

| Route ID | Delivery need | Skill |
|---|---|---|
| `spec-pr` | Write or revise a non-trivial specification | `om-spec-writing` (OMH-005) |
| `spec-pr` | Implement selected approved phases locally | `om-implement-spec` (OMH-006) |
| `spec-pr` | Implement a complete approved spec and ship it | `om-auto-implement-spec` |
| `spec-pr` | One-shot task through a ready PR | `om-auto-create-pr`; resume with `om-auto-continue-pr` |
| `spec-pr` | Tracker issue through verification, root cause, fix, tests, and PR | `om-auto-fix-issue` |
| `spec-pr` | Review or re-review a PR | `om-auto-review-pr` / `om-code-review` |
| `testing` | Integration/E2E coverage or UI QA | `om-integration-tests` / `om-auto-qa-pr`; use `om-prepare-test-env` when required |
| — | No PR/spec workflow requested | Do not load delivery skills |

If the selected skill is absent, run `yarn install-skills` once and retry; do not substitute an invented workflow.

### Token-Efficient Assembly Policy

- Start here; load matched guides once and only branch-specific skill references.
- Facts supply identifiers/surfaces, not teaching.
- For spec lookup, list names and open only a task-specific spec; never read README/template unless doing spec work.
- Inspect app call sites first; use `framework-context` last for one bounded exact target.
- Load `BACKWARD_COMPATIBILITY.md` before altering a public ID/contract, not for an additive change that preserves it.
- Never recursively content-search or preload guide, skill, fact, reference, or source trees; open only routed paths.
- Each unit carries only its area, contract, facts, and delivery workflow.

## Module-Specific Facts

This generator-owned block supplies identifiers/surfaces. Load a fact only for an enabled module being changed, integrated with, or used as a named host; generic words like API/search/events do not match it.

<!-- om:module-guides:start -->
<!-- om:module-guides:end -->

## Working Sequence

1. Inspect `.ai/specs/` for task-specific decisions (ignore README/template); use spec-first work for architectural or three-plus-step requests.
2. Route the request and load only the matched guides/skills and relevant module facts.
3. Inspect current app call sites; invoke `om-framework-context` only for missing exact-version details.
4. Implement the smallest complete vertical slice through real call sites.
5. Run `yarn generate` when discovery changed, then the smallest validation gate and affected integration paths.

## Context Precedence

1. This file governs standalone safety, writable locations, and validation.
2. `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` governs stable public identifiers when agentic context is installed.
3. The nearest installed package/module `AGENTS.md` governs version-specific framework contracts.
4. Generated facts govern discovered module surfaces for the installed version.
5. If sources conflict after version/skew checks, stop and report the contradiction instead of guessing.
