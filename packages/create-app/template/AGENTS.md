# Standalone Open Mercato App — Agent Rules

Extend this app. Route here first; load every match; never probe unmatched context.

## Always

- Route all axes; missing context: `yarn mercato agentic:init --update-harness`.
- App code: `src/modules/<id>/`; framework context only for a named version gap.
- Derive trusted `tenantId` + `organizationId` and fail closed. Only an installed contract may use system scope (`organizationId: null`).
- Use commands, `makeCrudRoute`, `CrudForm`/`DataTable`, DI, events, and UMES on canonical paths.
- Put entities in `src/modules/<id>/data/entities.ts`; API routes need per-method `metadata` + `openApi`.
- Editable records expose `updated_at`/`updatedAt`; custom update/delete clients send the version and surface 409s.
- Run `yarn db:generate`, review scoped SQL/snapshot, and ask before applying it.
- Run `yarn generate` after discovery files, `src/modules.ts`, routes, pages, events, widgets, agents, tools, or workflows change.
- Preserve public event/entity/API/ACL/DI/widget/notification/AI/CLI/generated-export IDs.
- Localize strings; use shared UI/tokens and complete loading, empty, error, conflict, keyboard, and accessibility states.

## Ask First

- Ask before scope/architecture/public-contract/dependency/ejection/canonical-primitive changes; migrations/resets/DB targets; live credentials/providers; or weaker security, concurrency, retries, idempotency, audit, or undo.

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

Report failures; never apply migrations for validation

## Three-Axis Context Assembler

Combine matches: notification/editable custom field = `module-data` + `backend-ui` + `umes`; lifecycle reaction = `module-data` + `umes` (UMES owns it); convergence bug adds `debugging`; registry drift adds `module-data` + `architecture` + `debugging`. Add `testing` only when explicit and `framework-context` only for an unresolved contract.

Business verticals MUST load `om-module-scaffold` + their exact blueprint.

`testing` requires requested tests/coverage/proof, not routine validation; external integration/E2E/browser/live-app uses `om-integration-tests`. `debugging` = failure/security/drift. Specs/delivery phases = `spec-pr` + integration coverage. Capability outlines without delivery phases = `architecture` + `module-data` + blueprint/contracts. Spec-only decomposition reads root + `om-spec-writing` + config; implementation owns domain guides. Custom fields/entities = `umes` + `module-data` + `om-data-model-design`; editable adds `backend-ui`. Never infer work from specs/PRs.

App-owned durable process state, activities, or user tasks select `module-data` + `ai-workflow`; add `umes` for installed-module interception/reaction.

Unified-override audits select only `umes`; add `architecture` or `framework-context` only for unresolved ownership or installed keys.

App-owned page/form/table-only = `backend-ui`; installed host changes add `umes`. Do not load contracts or `module-scaffold` unless changing data/API/command/ACL/setup.

`backend-ui`: UI skill `references/quality-states.md`; public/portal/responsive/a11y adds `references/frontend-and-design-system.md`. Payload text is not UI.

### Axis 1 — Area/Ownership

| Route | Match | Context |
|---|---|---|
| `architecture` | Capability/ownership choice, explicit boundary investigation, upgrade, override, or registry failure; routine discovery stays in its area | `.ai/guides/architecture.md` + named facts |
| `module-data` | App-owned domain/data/API | `src/modules/<id>/` + `.ai/guides/contracts.md`; add architecture only when ownership or mechanism is unresolved |
| `umes` | Extend/replace installed behavior | `.ai/guides/extensions.md` + target facts |
| `backend-ui` | Custom admin/public/portal/form/table/menu/i18n/component | `.ai/guides/backend-ui.md` + host facts; host-provided integration credentials/health UI alone does not match |
| `integration` | External email/shipping/payment/sync/webhook/storage/file/import/export provider | `.ai/guides/integrations.md`; excludes installed-sender use, workflow `CALL_API`, downloads, and AI storage |
| `ai-workflow` | Agent/tool/MCP/OpenCode/Code Mode/orchestrator/durable workflow | `.ai/guides/ai-workflows.md` + facts; schedules/reminders/queues/workers/retries/progress alone are `module-data` |
| `debugging` | Bug/security/drift/runtime inconsistency | `.ai/guides/testing-debugging.md` + affected areas |

App: `src/modules/<id>/`; installed: UMES. Reusable providers are published dependencies, never `packages/*`.

### Axis 2 — Work Units

Match every work-unit row.

| Route | Work unit | Skill/context |
|---|---|---|
| `architecture` | Explain/choose module, UMES, package, eject | architecture; use `om-help` for an unresolved choice or a comparative decision framework across these mechanisms |
| `module-data` | Business outcome or vertical slice | `om-module-scaffold` + `.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md`; its route key resolves ownership and units |
| `spec-pr` | Spec or plan in safe working stages | Axis 3 skill; deployable phases |
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
| `debugging` + `testing` | Add/fix recurring harness case/test | `om-evolve-harness` |

“Installed contract(s)” alone does not select `framework-context`. Use guides/facts and supplied values; read its skill only after selecting the route for one named unresolved exact-version detail.

### Axis 3 — SDLC and Delivery

Select delivery independently from pinned `open-mercato/skills` (`yarn install-skills`).
Read external skills at `.agents/skills/<id>/SKILL.md`; MUST apply a matching `.ai/skills/<id>/SKILL.md` standalone override too.

| Route ID | Delivery need | Skill |
|---|---|---|
| `spec-pr` | Write/revise spec | `om-spec-writing` (OMH-005) + exact `.ai/agentic.config.json` for its specs-directory setting |
| `spec-pr` | Implement approved phases locally | `om-implement-spec` (OMH-006) |
| `spec-pr` | Ship complete approved spec | `om-auto-implement-spec` |
| `spec-pr` | One-shot ready PR | `om-auto-create-pr`; resume `om-auto-continue-pr` |
| `spec-pr` | Tracker issue to tested PR | `om-auto-fix-issue` |
| `spec-pr` | Review PR | `om-auto-review-pr` first; it invokes `om-code-review` |
| `testing` | Integration/E2E/UI QA | `om-integration-tests` / `om-auto-qa-pr`; optionally prepare env |
| — | No PR/spec workflow requested | Do not load delivery skills |

If a skill is absent, run `yarn install-skills` once; never invent a substitute.

### Token-Efficient Assembly Policy

- Load each matched guide once, then only its needed references and facts.
- For specs, list names and open one task match; skip README/template otherwise.
- Inspect app call sites before bounded `framework-context`.
- Read `BACKWARD_COMPATIBILITY.md` only to change a public contract; preserving one through an extension does not select it.
- Never bulk-read guide, skill, fact, or source trees.

## Module-Specific Facts

Facts only for changed/named hosts: customer/contact/deal/pipeline→customers; product/price/stock/inventory→catalog; cart/checkout/shopper→checkout; portal→customer_accounts; quote/order→sales; webhook/callback→webhooks; schedule/reminder→scheduler; progress→progress. Generic staff/employee = actor (not optional `staff`); audit/record-who = command/action log (not `audit_logs`) unless explicitly extended. App primitives skip `api_docs`/`search`/`query_index`/`events` facts unless changing them.

<!-- om:module-guides:start -->
<!-- om:module-guides:end -->

## Working Sequence

1. For `spec-pr`, list `.ai/specs` one level deep and open one non-template match. Do not list specs for plan-only work.
2. Route the request and load only the matched guides/skills and relevant module facts.
3. Inspect current app call sites; invoke `om-framework-context` only for missing exact-version details.
4. Implement the smallest complete vertical slice through real call sites.
5. Run `yarn generate` when discovery changed, then the smallest validation gate and affected integration paths.

## Context Precedence

1. This file governs standalone safety, writes, and validation.
2. `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` governs stable public IDs.
3. The nearest installed package/module `AGENTS.md` governs version-specific contracts.
4. Generated facts govern installed module surfaces.
5. After version/skew checks, stop on conflicts; never guess.
