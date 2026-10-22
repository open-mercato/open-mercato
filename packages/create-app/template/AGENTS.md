# Standalone Open Mercato App — Rules

Route first; no unmatched probes.

## Always

- Missing context: `yarn mercato agentic:init --update-harness`.
- Lessons: scan `.ai/lessons.md` tags; open/update one matching record + row.
- App code: `src/modules/<id>/`.
- Derive trusted `tenantId` + `organizationId`; fail closed. Only an installed contract may use system scope (`organizationId: null`).
- Use commands/`makeCrudRoute`/`CrudForm`/`DataTable`, DI/events/UMES; effects stay post-commit.
- Entities: `src/modules/<id>/data/entities.ts`; API per-method `metadata` + `openApi` required.
- Editable records expose `updated_at`/`updatedAt`; custom update/delete clients send the version and surface 409s.
- Run `yarn db:generate`, review scoped SQL/snapshot, and ask before applying it.
- Run `yarn generate` after discovery files/`src/modules.ts`/routes/pages/events/widgets/agents/tools/workflows change.
- Contract-surface changes (route/schema/ID/export/seam/signature/event payload/CLI) MUST read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`; tenant/org scope alone is not a contract.
- Use shared UI/tokens; cover loading/empty/error/conflict/keyboard/a11y.

## Ask First

- Ask before scope/architecture/public contracts/dependencies/ejection/canonical primitives; migrations/resets/DB targets; live credentials/providers; or weakening security/concurrency/retries/idempotency/audit/undo.

## Never

- Never leak tenants, trust payload scope, or treat missing scope as unrestricted.
- Never edit `node_modules`/`.mercato/generated/**`/generated facts/shipped migrations.
- Never use cross-module ORM relations; use IDs/snapshots/events/enrichers/extensions/optional DI.
- Never use raw admin `fetch`/`<form>`, ad hoc crypto/cache/queues, role-name guards, or direct mutations when helpers exist.
- Never hard-code user strings/status colors; expose secrets/transcripts; or guess answerable contracts.

## Checks

Broad: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`; integration: `yarn test:integration:ephemeral`. Never migrate to validate.

## Production

Route production deployment/go-live/operational readiness: `architecture` + `.ai/guides/production-deployment.md`. During routing, do not open `.env*`. Later: checked-in `.env.example` names/comments only; never read or report live `.env` values. Ask before credentials, billable infrastructure, or live deployment.

## Three Axes

Additive axes: ownership=WHO, others=WHAT. Select every match.

A scalar-ID/snapshot fix to persisted records or commands linked to an installed record MUST use `module-data` + `umes` and load `om-data-model-design` + `om-system-extension`.

`debugging` = reported bug/security/drift, not designed failure UI. Installed-host custom fields/entities = `umes` + `module-data` + `om-data-model-design`; editable round trips add `backend-ui`, requested coverage adds `testing`. Never infer work from specs/PRs.

Unified-override audits = `umes` only; unresolved ownership/installed keys add `architecture`/`framework-context`. Durable process/activity/user task = `ai-workflow`; app business persistence/host-state coordination adds `module-data`. Multi-stage waits/cancel/restart are durable; reminders and renewal/batch schedules are `module-data`.

`backend-ui`: replacing/wrapping, prop-transforming, menu-editing, or adding visible feedback adds `backend-ui`; merely hiding/toggling/rewiring installed UI does not.
Staff UI preview/report/bulk = `backend-ui`.
Installed form/table fields/filters/row/bulk actions without app persistence = `umes` + `backend-ui` only: read `crud-surfaces` + `quality-states`; skip contracts/module-scaffold/page/navigation.

`backend-ui`: UI skill `references/quality-states.md`; public/portal/responsive/a11y adds `frontend-and-design-system.md`.

### Axis 1 — Ownership

| Route | Match | Context |
|---|---|---|
| `architecture` | Unresolved capability/ownership/field-vs-history choice; boundary, upgrade, override, or registry failure; routine discovery stays in its area | `.ai/guides/architecture.md` + named facts |
| `module-data` | App-owned domain/data/API | `src/modules/<id>/` + `.ai/guides/contracts.md`; add architecture only when ownership is unresolved |
| `umes` | Extend/replace installed behavior | `.ai/guides/extensions.md` + named facts |
| `backend-ui` | Authored/restyled rendered surface or browser UI state/session bootstrap | `.ai/guides/backend-ui.md` + host facts; host-provided integration credentials/health UI alone does not match |
| `integration` | Provider, spreadsheet/CSV/file I/O, sync/webhook/storage | `.ai/guides/integrations.md`; imports = `integration`; AI consuming files = `ai-workflow`, NEVER `integration` unless transport/storage changes |
| `ai-workflow` | Agent/tool/MCP/orchestrator/durable workflow | `.ai/guides/ai-workflows.md` + facts; schedules/queues/workers/retries/progress alone are `module-data` |
| `debugging` | Bug/security/drift/runtime inconsistency | `.ai/guides/testing-debugging.md` + affected areas |

Installed API/command/record/status/event/UI changes/guards = `umes`; app persistence = `module-data`; installed guard without app persistence = `umes` only, so do not load contracts; read-only behavior/auth/dependents/customization = `framework-context` (alone: no extensions guide; report `installed-version`). Facts do not. Providers are published, never `packages/*`.

### Axis 2 — Units

Match units; skill first

| Route | Work unit | Skill/context |
|---|---|---|
| `architecture` | Scaffold module starter; publish/link an app module | `.ai/guides/module-tool.md`; implementation also loads `om-module-scaffold` |
| `architecture` | Explain/choose module, UMES, package, eject | `om-help` for unresolved/comparative choices among these mechanisms |
| `module-data` | Business slice/multi-seam domain/API/command fix | MUST load `om-module-scaffold` + exact `.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md` key (units, not ownership); ownership/capability outline adds `architecture` |
| `spec-pr` | Author/reuse spec/plan | Axis 3; phases+integration coverage (`integration-coverage`); no domain routes |
| `architecture` | Upgrade audit or disable built-in | troubleshooter + framework context, or trim skill + exact `src/modules.ts`/`package.json` |
| `architecture` + `integration` + `framework-context` | Provider superseded by installed capability | integration builder + exact framework context |
| `module-data` | Business-record design: entity/link/validator/migration/encryption/lock/transaction; not helper reuse/provider metadata | `om-data-model-design` + contracts |
| `module-data` | CRUD/API/command/OpenAPI/ACL/setup/mutation | `om-module-scaffold` + contracts |
| `backend-ui` | Form/table/page/renderer/middleware/nav/i18n/UI states | `om-backend-ui-design` + backend UI |
| `module-data` | Owned search/analytics/event/notification/message/worker/progress/cache/CLI | scaffold + contracts |
| `umes` | Installed-host fields/extension entities; links/enrichers/injection/interceptors/guards/subscribers/DOM/hosts/widgets/toggles/overrides | `om-system-extension` + extensions; choices load `mechanism-selector` + `extension-branches` |
| `integration` | Provider/credentials/health/webhook/files/client/reconciliation/package | `om-integration-builder` + integrations |
| `ai-workflow` | Agent/tool/MCP/OpenCode/Code Mode/orchestrator/AI file or content drafting/attachment/override | `om-create-ai-agent` + AI/workflows; MCP/OpenCode loads `surface-selector` + `ai_assistant` facts |
| `ai-workflow` | Workflow/activity/user task/idempotency/output/progress | `om-build-workflow` + AI/workflows |
| `testing` | REQUEST says test/coverage/prove or exercise API/browser/screen sizes/keyboard/screen-reader; not implicit fix regressions or review/audit/config checks | MUST read `.ai/guides/testing-debugging.md` + external `om-integration-tests` for integration/E2E/app tests |
| `debugging` | Reproduce/root-cause/minimal fix/regression oracle | `om-troubleshooter` |
| `framework-context` | Exact installed contract still unknown | `.ai/guides/framework-contracts.md`, then bounded `om-framework-context`, last |
| `debugging` + `testing` | Add/fix recurring harness case/test | `om-evolve-harness` |

`framework-context`: resolve one named fact first. Bounded source only if the guide leaves current behavior, authorization, dependents, or the safest customization seam unresolved; never for “installed contracts” alone.

### Axis 3 — Delivery

Spec gate before code: new capability/architecture/schema/API contract/cross-module/multi-phase -> spec first (`spec-first`); covering `.ai/specs` match -> reuse and update it (`reuse-spec`); bug fix/minor fix/docs/dependency/isolated refactor -> proceed (`direct`); only the request's explicit words waive a feature spec; workflow-changing ambiguity -> ask once (`ask`). For complete business modules or CRUD slices, `om-module-scaffold` starts at `src/modules/example/README.md`.

Read `.agents/skills/<id>/SKILL.md` AND any `.ai/skills/<id>/SKILL.md` override. Missing skill: `yarn install-skills`. Commit+ready PR MUST add `spec-pr`, read `.ai/skills/om-auto-create-pr/SKILL.md`, and keep task routes (`delivery-route-preserves-task-routes`).

| Route ID | Delivery need | Skill |
|---|---|---|
| `spec-pr` | Write/revise spec | MUST invoke `om-spec-writing` (OMH-005) + `.ai/guides/spec-delivery.md` |
| `spec-pr` | Local phases / whole-spec / PR / issue / review | `om-implement-spec` (OMH-006) / `om-auto-implement-spec` / `om-auto-create-pr` / `om-auto-fix-issue` / `om-auto-review-pr` |
| — | No PR/spec workflow | Do not load delivery skills |

### Budgets

- Matched guides once; needed references/facts only.
- Budgets: guide > skill > references; named subjects only.
- `spec-pr` reads template via spec-delivery.
- App call sites before bounded `framework-context`.
- Additive page/form/table/conflict UI skips it.
- Never bulk-read guides/skills/facts/source.

## Module-Specific Facts

Mechanisms: events/subscribers→events; long operation/progress→progress; provider settings/health/OAuth→integrations; sync/import→data_sync; feature toggle/flag→feature_toggles. Hosts: session/auth→auth; customer/contact/deal/pipeline→customers; product/price/stock/inventory→catalog; warehouse→wms; currency/money→currencies; cart/checkout/shopper→checkout; portal→portal+customer_accounts; quote/order/invoice/sales assistant→sales; notification→notifications; webhook/callback→webhooks; schedule/reminder→scheduler; workflow/activity/user task→workflows; assistant→ai_assistant; maintained query index/reindex→query_index; search convergence→search. staff/employee≠optional staff; audit/record-who≠audit_logs unless extended. App primitives skip api_docs/search/query_index unless changed. Read big facts in sections.

<!-- om:module-guides:start -->
<!-- om:module-guides:end -->

## Workflow

1. Implement smallest complete slice via real calls.
2. Discovery change: `yarn generate`; then minimal gate/integration paths.

Precedence: root→BC→installed `AGENTS.md`→facts; stop on skew/conflict; never guess.
