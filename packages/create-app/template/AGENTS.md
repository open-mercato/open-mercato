# Standalone Open Mercato App — Agent Rules

Extend this installed Open Mercato app. Route first; load every match.

## Always

- Match all three routing axes; if context is missing, run `yarn mercato agentic:init` and retry.
- Write app code in `src/modules/<id>/`; framework packages stay read-only. Use `om-framework-context` for exact installed source.
- Derive trusted `tenantId` + `organizationId` and fail closed. Only an installed contract may use system scope (`organizationId: null`).
- Use commands, `makeCrudRoute`, `CrudForm`/`DataTable`, DI, events, and UMES on canonical paths.
- Put entities in `src/modules/<id>/data/entities.ts`; API routes need per-method `metadata` + `openApi`.
- Editable records expose `updated_at`/`updatedAt`; custom update/delete clients send the version and surface 409s.
- Run `yarn db:generate`, review scoped SQL/snapshot, and ask before applying it.
- Run `yarn generate` after discovery files, `src/modules.ts`, routes, pages, events, widgets, agents, tools, or workflows change.
- Preserve public event/entity/API/ACL/DI/widget/notification/AI/CLI/generated-export IDs.
- Localize strings; use shared UI/tokens and complete loading, empty, error, conflict, keyboard, and accessibility states.

## Ask First

- Ask before reducing scope; changing architecture/contracts; adding production dependencies; ejecting modules; or replacing canonical primitives.
- Ask before applying migrations, resets, database-target changes, live credentials, or real test providers.
- Ask before weakening auth/scope, encryption, mutation approval, locking, retries, idempotency, or audit/undo.

## Never

- Never leak tenants, trust payload scope, or treat missing scope as unrestricted.
- Never edit `node_modules`, `.mercato/generated/**`, generated facts, or shipped migrations.
- Never use cross-module ORM relations; use IDs/snapshots, events, enrichers, extensions, or optional DI.
- Never use raw admin `fetch`/`<form>`, ad hoc crypto/cache/queues, role-name guards, or direct mutations when helpers exist.
- Never hard-code user strings/status colors; expose secrets/transcripts; or guess answerable contracts.

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

Match every axis; de-duplicate. Notifications = `module-data` + `backend-ui` + `umes`; custom-field round trips add `testing`; lifecycle reactions = `module-data` + `umes`; convergence bugs add `debugging`; registry drift = `architecture` + `module-data` + `debugging` (and exact-contract `framework-context`).

Route only the request. `testing` needs explicit tests/coverage; routine validation does not match. Reindex verification and smoke validation do not select `testing`; a request to prove security or isolation behavior does. Use external `om-integration-tests` only when the request explicitly needs integration, E2E, browser, or live-app tests; round-trip coverage alone uses local unit/contract patterns. `debugging` needs failure, security, or drift. Spec decomposition selects only `spec-pr`. A plan-only business module selects `architecture` + `module-data` and only `om-module-scaffold`; load its blueprint plus architecture/contracts, but do not invoke future UI/data/workflow specialists or framework context until implementation. Custom fields/entities always select `umes` + `module-data`; editable display/save/clear round trips also select `backend-ui`, and requested coverage selects `testing`. Do not infer areas from specs/PRs.

### Axis 1 — Area and Ownership

| Route | Match | Context |
|---|---|---|
| `architecture` | Capabilities, discovery, overrides, upgrades, ownership | `.ai/guides/architecture.md` + named facts |
| `module-data` | App-owned domain/data/API | `src/modules/<id>/` + `.ai/guides/contracts.md`; add architecture only when ownership or mechanism is unresolved |
| `umes` | Extend/replace installed behavior | `.ai/guides/extensions.md` + target facts |
| `backend-ui` | Custom admin/public/portal/form/table/menu/i18n/component | `.ai/guides/backend-ui.md` + host facts; host-provided integration credentials/health UI alone does not match |
| `integration` | Email/shipping/payment/sync/webhook/storage/file interchange/provider | `.ai/guides/integrations.md`; not workflow `CALL_API` or ordinary downloads |
| `ai-workflow` | Agent/tool/MCP/OpenCode/Code Mode/orchestrator/durable workflow | `.ai/guides/ai-workflows.md` + target facts |
| `debugging` | Bug/security/drift/runtime inconsistency | `.ai/guides/testing-debugging.md` + affected areas |

App domains/providers live in `src/modules/<id>/`; installed customization uses UMES. Reusable providers are published dependencies, never `packages/*`; ask before topology/ejection.

### Axis 2 — Work Units and Primitives

Split the outcome; match every row.

| Route | Work unit | Skill/context |
|---|---|---|
| `architecture` | Explain/choose module, UMES, package, eject | architecture; use `om-help` for an unresolved choice or a comparative decision framework across these mechanisms |
| `module-data` | Business outcome or vertical slice | `om-module-scaffold` + `business-one-shot-blueprints.md`; its route key resolves ownership and units |
| `spec-pr` | Cohesive spec phases | Axis 3 skill; deployable phases |
| `architecture` | Upgrade audit or disable built-in | troubleshooter + framework context, or trim skill + exact `src/modules.ts` and `package.json` |
| `architecture` + `integration` + `framework-context` | Provider superseded by installed capability | integration builder + exact framework context |
| `module-data` | Entity/link/validator/migration/encryption/lock/transaction | `om-data-model-design` + contracts |
| `module-data` | CRUD/API/command/OpenAPI/ACL/setup/mutation | `om-module-scaffold` + contracts |
| `backend-ui` | Form/table/page/middleware/nav/i18n/UI states | `om-backend-ui-design` + backend UI |
| `module-data` | Search/analytics/event/notification/message/worker/progress/cache/CLI | scaffold + contracts |
| `umes` | Fields/enrichers/injection/interceptors/guards/subscribers/DOM/widgets/toggles/overrides | `om-system-extension` + extensions; add specialists |
| `integration` | Provider/credentials/health/webhook/files/client/reconciliation/package | `om-integration-builder` + integrations |
| `ai-workflow` | Agent/tool/MCP/OpenCode/Code Mode/orchestrator/attachment/override | `om-create-ai-agent` + AI/workflows; MCP/OpenCode loads `ai_assistant` facts |
| `ai-workflow` | Workflow/activity/user task/idempotency/output/progress | `om-build-workflow` + AI/workflows |
| `testing` | Write/run tests or explicit coverage | testing/debugging; external `om-integration-tests` for integration/E2E |
| `debugging` | Reproduce/root-cause/minimal fix/regression oracle | `om-troubleshooter` + testing/debugging + affected units |
| `framework-context` | Exact installed contract still unknown | bounded `om-framework-context`, last |
| — | Add/fix recurring harness case | `om-evolve-harness` |

The request saying “installed contract(s)” or “installed-package contracts” is not enough to select `framework-context`. Use routed guides and facts first. A contract value stated by the request is already resolved; do not invoke the escape hatch merely to reverify it during routing. Invoke it only when one named exact-version detail still cannot be resolved, never as future-phase work.

### Axis 3 — SDLC and Delivery

Select delivery independently from pinned `open-mercato/skills` (`yarn install-skills`).

| Route ID | Delivery need | Skill |
|---|---|---|
| `spec-pr` | Write/revise spec | `om-spec-writing` (OMH-005) + exact `.ai/agentic.config.json` for its specs-directory setting |
| `spec-pr` | Implement approved phases locally | `om-implement-spec` (OMH-006) |
| `spec-pr` | Ship complete approved spec | `om-auto-implement-spec` |
| `spec-pr` | One-shot ready PR | `om-auto-create-pr`; resume `om-auto-continue-pr` |
| `spec-pr` | Tracker issue to tested PR | `om-auto-fix-issue` |
| `spec-pr` | Review PR | `om-auto-review-pr` / `om-code-review` |
| `testing` | Integration/E2E/UI QA | `om-integration-tests` / `om-auto-qa-pr`; optionally prepare env |
| — | No PR/spec workflow requested | Do not load delivery skills |

If the selected skill is absent, run `yarn install-skills` once and retry; do not substitute an invented workflow.

### Token-Efficient Assembly Policy

- Load each matched guide once and only branch-specific references; facts identify surfaces, not teach.
- For specs, list names and open only the task match; never README/template unless doing spec work.
- Inspect app call sites first; use bounded `framework-context` last.
- Read `BACKWARD_COMPATIBILITY.md` before changing a public contract, not for preserving additive work.
- Never bulk-list/read guide, skill, fact, or source trees. Open exact routed paths only.
- Each unit carries only its area, contract, facts, and delivery workflow.

## Module-Specific Facts

Facts supply exact identifiers/surfaces. Load only changed, integrated, or named hosts. Customer/contact/deal/pipeline work maps to `customers`; portal work maps only to `customer_accounts` (not `auth` or a nonexistent `portal` fact); quote/order work maps to `sales`; notifications, workflows, progress, and integrations name their modules. App-module CRUD/API/OpenAPI/search/event primitives do not by themselves load `api_docs`, `search`, or `events` facts. Never preload facts.

<!-- om:module-guides:start -->
<!-- om:module-guides:end -->

## Working Sequence

1. For work routed to `spec-pr`, inspect `.ai/specs/` for task-specific decisions (ignore README/template); use only `find .ai/specs -maxdepth 1 -type f` for the nonrecursive index, then open one exact task match. Do not enumerate specs for plan-only work. Use spec-first work for architectural or three-plus-step implementation requests.
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
