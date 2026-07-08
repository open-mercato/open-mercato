# Agents Guidelines

Leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Always

- Check the Task Router below before research or coding; a single task may match multiple rows, and all relevant guides apply.
- Check `.ai/specs/` and `.ai/specs/enterprise/` for existing specs before modifying a module.
- Enter plan mode for non-trivial tasks with 3+ steps or architectural decisions.
- Identify the reference module (`customers`) when building CRUD features.
- Preserve behavior unless the user or a spec explicitly asks for a behavior change.
- Keep changes minimal, focused, and integrated through real call sites.
- Use the closest package/module `AGENTS.md` for local architecture, imports, and validation commands.
- Follow `BACKWARD_COMPATIBILITY.md` before touching any contract surface.
- Run `yarn generate` after adding or modifying module files that rely on auto-discovery.
- Support optimistic locking on every NEW user-editable entity and edit/delete form (it is **default ON**): give the entity an `updated_at` column, return `updatedAt` in its list/detail API responses, and let `CrudForm` auto-derive the header from `initialValues.updatedAt` (covers update **and** delete) — or, for custom non-`CrudForm` handlers, wrap the mutating call with `withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), …)` and surface conflicts via `surfaceRecordConflict(err, t)`. If a form's `onSubmit` mutates OTHER entities, override the parent header per child with that child's own version (avoid false 409s). Two guards enforce this: `optimistic-lock-editable-entities.test.ts` (editable entities expose `updated_at`) and `optimistic-lock-ui-coverage.test.ts` (new raw mutating UI calls send the header or are allowlisted with a reason). See the Task Router row + `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx`.

## Ask First

- Ask before reducing scope, changing architecture, changing public contracts, adding production dependencies, or touching multiple modules in a way not covered by an existing spec.
- Ask before changing branch/PR automation, pipeline labels, QA flow, release behavior, or external official-module submodule pointers.
- Ask before applying database migrations locally with `yarn db:migrate`; normal PRs should include migration files and snapshots.
- Ask before introducing provider-specific preconfiguration outside the provider package.

## Never

- Never expose cross-tenant data or skip tenant/organization scoping.
- Never edit generated files by hand.
- Never add code directly under `apps/mercato/src/` except committed, typed `*.generated.ts` registries described below.
- Never create direct ORM relationships between modules.
- Never bypass mutation guards, command side effects, encryption helpers, RBAC wildcard matching, or shared UI data-call helpers.
- Never hard-code user-facing strings or design-system status colors.
- Never commit credentials, raw tokens, private keys, local-only ops files, or fork-only infrastructure notes into upstream-friendly branches.

## Validation Commands

Choose the smallest relevant set for the change:

```bash
yarn generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
yarn build:app
```

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to the root `AGENTS.md` Task Router table. A single task often maps to **multiple rows** — for example, "add a new module with search" requires both the Module Development and Search guides. Read **all** matching guides before starting. They contain the imports, patterns, and constraints you need. Only use Explore agents for topics not covered by any existing AGENTS.md.

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new module, scaffolding module files, auto-discovery paths | `packages/core/AGENTS.md` + [`.ai/docs/module-development.md`](.ai/docs/module-development.md). **Standalone apps**: the `om-module-scaffold` skill scaffolds a module end-to-end (routes, pages, DI, ACL, events, search) — great to use here. |
| Working on official modules via the `external/official-modules` submodule, activating them (`yarn official-modules`, `official-modules.json`), committing to the submodule's git | this file → `external/official-modules/` (git submodule) |
| Building CRUD API routes, adding OpenAPI specs, using `makeCrudRoute`, query engine integration | `packages/core/AGENTS.md` → API Routes |
| Adding `setup.ts` for tenant init, declaring role features, syncing new ACL grants to roles, seeding defaults/examples | `packages/core/AGENTS.md` → Module Setup |
| Declaring typed events with `createModuleEvents`, emitting CRUD/lifecycle events, adding event subscribers | `packages/core/AGENTS.md` → Events |
| Adding in-app notifications, subscriber-based alerts, writing notification renderers | `packages/core/AGENTS.md` → Notifications |
| Adding reactive notification handlers (`notifications.handlers.ts`), `useNotificationEffect`, auto side-effects on notification arrival | `packages/core/AGENTS.md` → Notifications + `packages/ui/AGENTS.md` |
| Injecting UI widgets into other modules, defining spot IDs, cross-module UI extensions | `packages/core/AGENTS.md` → Widgets |
| Building headless injection widgets (menu items, columns, fields), using `InjectionPosition`, or `useInjectionDataWidgets` | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` |
| Injecting menu items into main/settings/profile sidebars or topbar/profile dropdown (`useInjectedMenuItems`, `mergeMenuItems`) | `packages/ui/AGENTS.md` |
| Adding API route interceptors (`api/interceptors.ts`, before/after hooks, body/query rewrite contracts) | `packages/core/AGENTS.md` → API Interceptors |
| Adding DataTable extension widgets (columns/row actions/bulk actions/filters) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → DataTable Guidelines |
| Adding bulk operations, DataTable bulk actions, selected-row mutations, or future long-running operations with progress | `packages/core/src/modules/progress/AGENTS.md` + `packages/ui/AGENTS.md` → DataTable Guidelines + `packages/queue/AGENTS.md` |
| Adding CrudForm field injection widgets (`crud-form:<entityId>:fields`) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → CrudForm Guidelines |
| Replacing or wrapping UI components via `widgets/components.ts` (`replace`/`wrapper`/`props`) | `packages/core/AGENTS.md` → Component Replacement + `packages/ui/AGENTS.md` |
| Adding custom fields/entities, using DSL helpers (`defineLink`, `cf.*`), declaring `ce.ts` | `packages/core/AGENTS.md` → Custom Fields |
| Adding entity extensions, cross-module data links, `data/extensions.ts` | `packages/core/AGENTS.md` → Extensions |
| Coupling one module to another (e.g. products-in-deals), choosing the mechanism (events / widget injection + enrichers / FK-id + snapshot / soft-optional `tryResolve`), or depending on an OPTIONAL integration (what happens when it is absent) | `packages/core/AGENTS.md` → Cross-Module Coupling + `module-decoupling` test (`packages/core/src/__tests__/module-decoupling.test.ts`) |
| Configuring RBAC features in `acl.ts`, declarative guards, permission checks | `packages/core/AGENTS.md` → Access Control |
| Fixing wildcard ACL handling in feature-gated runtime helpers (menus, notification handlers, mutation guards, command interceptors, AI tools) | `packages/core/AGENTS.md` → Access Control + `packages/shared/AGENTS.md` + `packages/ui/AGENTS.md` + `packages/core/src/modules/auth/AGENTS.md` (portal: `customer_accounts/AGENTS.md`) |
| Using encrypted queries (`findWithDecryption`), encryption defaults, GDPR fields | `packages/core/AGENTS.md` → Encryption |
| Adding response enrichers to enrich other modules' API responses | `packages/core/AGENTS.md` → Response Enrichers |
| Filtering CRUD list APIs by multiple IDs (`?ids=uuid1,uuid2`), including interceptor-driven ID narrowing | `packages/core/AGENTS.md` → API Interceptors + `packages/shared/AGENTS.md` |
| Preventing silent lost updates on concurrent CRUD edits (optimistic locking via `updated_at`, **default ON** across every `makeCrudRoute` entity, opt out with `OM_OPTIMISTIC_LOCK=off`); structured 409 conflict body and client helpers (`buildOptimisticLockHeader`, `extractOptimisticLockConflict`). For Command-pattern / non-`makeCrudRoute` writes (sales document sub-resources, action endpoints), enforce the same check in the handler with `enforceCommandOptimisticLock` (document-aggregate: guard the parent order/quote) or the DI-overridable `createCommandOptimisticLockGuardService({ resolveExpected? })` (enterprise seam, #2232). Surface the 409 via the unified conflict bar with `surfaceRecordConflict(err, t)` from `@open-mercato/ui/backend/conflicts` (`CrudForm`/`useGuardedMutation` do it automatically) | `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` (§ Protecting command/action endpoints) + `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md` + `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md` + `packages/shared/src/lib/crud/optimistic-lock.ts` + `packages/shared/src/lib/crud/optimistic-lock-command.ts` (command-level + `createCommandOptimisticLockGuardService` seam) + `packages/ui/src/backend/conflicts/` (unified conflict bar) + `packages/shared/src/lib/di/container.ts` (default service) + `packages/core/src/modules/customers/di.ts` (polymorphic-table override) + `packages/core/src/modules/sales/commands/shared.ts` (sales wrapper) |
| Adding DOM Event Bridge (SSE-based real-time events to browser), `useAppEvent`, `useOperationProgress` | `packages/events/AGENTS.md` → DOM Event Bridge |
| Building customer portal pages, portal auth, portal nav injection, portal event bridge | `packages/ui/AGENTS.md` → Portal Extension + `om-backend-ui-design` skill |
| Adding new widget event handlers (`onFieldChange`, `onBeforeNavigate`, transformers) | `packages/ui/AGENTS.md` |
| Building AI agents/tools (`ai-agents.ts`, `ai-tools.ts`, tool packs, mutation approval via `prepareMutation`, attachments, provider/model selection) | `.ai/skills/om-create-ai-agent/SKILL.md` + `packages/ai-assistant/AGENTS.md` + `apps/docs/docs/framework/ai-assistant/*.mdx` |
| AI agent loop controls + overrides (`loop.stopWhen/prepareStep/budget`, per-tenant settings, replacing/disabling agents/tools, module-level `entry.overrides`) | `packages/ai-assistant/AGENTS.md` → Loop controls + How to Override + `.ai/specs/implemented/2026-04-28-ai-agents-agentic-loop-controls.md` + `.ai/specs/implemented/2026-04-30-ai-overrides-and-module-disable.md` + `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` |
| **Specific Modules** | |
| Module-specific work (customers as reference for new CRUD modules, plus sales, catalog, auth, customer_accounts, currencies, workflows, integrations, data_sync, progress) | `packages/core/src/modules/<module>/AGENTS.md` |
| Webhooks (outbound/inbound, Standard Webhooks signing, delivery queues, admin UI) | `packages/webhooks/AGENTS.md` (cross-refs `queue`, `events`, `integrations`, `ui`) |
| Building a new integration provider (adapter, health check, credentials, bundle wiring) | `.ai/skills/om-integration-builder/SKILL.md` + `packages/core/src/modules/integrations/AGENTS.md` + `packages/core/src/modules/data_sync/AGENTS.md` |
| **Packages** | |
| Adding reusable utilities, encryption helpers, i18n translations (`useT`/`resolveTranslations`), boolean parsing, data engine types, request scoping | `packages/shared/AGENTS.md` |
| Structured logging / replacing raw `console.*` with the logging facade (`createLogger`, `child()`, `OM_LOG_LEVEL`), advisory `yarn logger:check-console` | `apps/docs/docs/framework/runtime/logging.mdx` + `.ai/specs/2026-07-02-structured-logging-facade.md` + `packages/shared/AGENTS.md` |
| Building forms (`CrudForm`), data tables (`DataTable`), loading/error states, flash messages, `FormHeader`/`FormFooter`, dialog UX (`Cmd+Enter`/`Escape`) | `packages/ui/AGENTS.md` + `om-backend-ui-design` skill (+ `om-ds-guardian` skill for DS-token compliance) |
| Backend page components, `apiCall` usage, `RowActions` ids, `LoadingMessage`/`ErrorMessage` | `packages/ui/src/backend/AGENTS.md` + `om-backend-ui-design` skill |
| Configuring fulltext/vector/token search, writing `search.ts`, reindexing entities, debugging search, search CLI commands | `packages/search/AGENTS.md` |
| Adding MCP tools (`registerMcpTool`), modifying OpenCode config, debugging AI chat, session tokens, command palette, two-tier auth | `packages/ai-assistant/AGENTS.md` |
| Running generators (`yarn generate`), creating database migrations (`yarn db:generate`), scaffolding modules, build order | `packages/cli/AGENTS.md` |
| Event bus architecture, ephemeral vs persistent subscriptions, queue integration for events, event workers | `packages/events/AGENTS.md` |
| Adding cache to a module, tag-based invalidation, tenant-scoped caching, choosing strategy (memory/SQLite/Redis) | `packages/cache/AGENTS.md` |
| Adding background workers, configuring concurrency (I/O vs CPU-bound), idempotent job processing, queue strategies | `packages/queue/AGENTS.md` |
| Tracking operation progress in the top bar, creating `ProgressJob`s, or emitting client-local progress events | `packages/core/src/modules/progress/AGENTS.md` + `packages/events/AGENTS.md` → DOM Event Bridge |
| Adding onboarding wizard steps, tenant setup hooks (`onTenantCreated`/`seedDefaults`), welcome/invitation emails | `packages/onboarding/AGENTS.md` |
| Adding static content pages (privacy policies, terms, legal pages) | `packages/content/AGENTS.md` |
| Testing standalone apps with Verdaccio, publishing packages, canary releases, template scaffolding | `packages/create-app/AGENTS.md` |
| Deploying a freshly scaffolded Open Mercato app to Railway with `mercato deploy railway` | [`.ai/specs/2026-05-12-railway-one-command-deploy.md`](.ai/specs/2026-05-12-railway-one-command-deploy.md) + [`apps/docs/docs/deployment/railway.mdx`](apps/docs/docs/deployment/railway.mdx) + `packages/cli/AGENTS.md` |
| **Performance** | |
| Profiling dev-mode memory (`yarn dev:profile`), ranking memory hogs, evaluating watcher / Vite-vs-Turbopack tradeoffs | `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` + `scripts/profile-dev-rss.mjs` |
| **Migration** | |
| Migrating custom module code from MikroORM v6 to v7 (decorators, persist/flush, Knex→Kysely, type fixes, ORM config, Jest setup) | `.ai/skills/om-migrate-mikro-orm/SKILL.md` |
| **Testing** | |
| Integration testing, creating/running Playwright tests, converting markdown test cases to TypeScript, CI test pipeline | `.ai/qa/AGENTS.md` + `.ai/skills/om-integration-tests/SKILL.md` |
| **Spec & PR Automation** | |
| Spec lifecycle (pre-implement → implement → write/update), code review, DS review | Browse `.ai/skills/{om-spec-writing,om-pre-implement-spec,om-implement-spec,om-code-review,om-ds-guardian}/SKILL.md` + `.ai/specs/AGENTS.md` + `.ai/ds-rules.md` |
| PR/issue automation (one-shot auto-PR, resumable loop variants, review/merge-buddy, post-merge sync, changelog, UI QA verification). **Default for one-off bug fixes / small features:** `om-auto-create-pr` | Browse `.ai/skills/{om-auto-create-pr,om-auto-continue-pr,om-auto-create-pr-loop,om-auto-continue-pr-loop,om-auto-review-pr,om-merge-buddy,om-review-prs,om-sync-merged-pr-issues,om-auto-update-changelog,om-auto-verify-pr-ui}/SKILL.md` |

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Workflow Orchestration

1.  **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` and `.ai/specs/enterprise/` before coding; create spec files using scope-appropriate naming (`{date}-{title}.md` for OSS and enterprise, with `date` as `YYYY-MM-DD` and `title` as kebab-case). Skip for small fixes.
    -   **Detailed Workflow**: Refer to the **`om-spec-writing` skill** for research, phasing, and architectural review standards (`.ai/skills/om-spec-writing/SKILL.md`).
    -   **Pre-implementation analysis**: Before implementing a complex spec, run the **`om-pre-implement-spec` skill** to audit backward compatibility, identify gaps, and produce a readiness report.
    -   **Implementation**: Use the **`om-implement-spec` skill** to execute spec phases with coordinated subagents, unit tests, progress tracking, and code-review compliance gates.
2.  **Subagent strategy**: Use subagents liberally to keep main context clean. Offload research and parallel analysis. One task per subagent.
3.  **Self-improvement**: After corrections, update `.ai/lessons.md` or relevant AGENTS.md. Write rules that prevent the same mistake.
4.  **Verification**: Run tests, check build, suggest user verification. Ask: "Would a staff engineer approve this?"
5.  **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.
6.  **Autonomous bug fixing**: When given a bug report, just fix it. Point at logs/errors, then resolve. Zero hand-holding.

## PR Workflow

- Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`.
- Category labels are additive: `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`.
- Meta labels are additive: `needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `screenshots`.
- Priority labels are mutually exclusive within their group (only one at a time): `priority-low`, `priority-medium`, `priority-high`, `priority-extreme`. They are applied to issues and PRs to communicate urgency, are additive with respect to category and meta labels, and default to **unset** (treated as `priority-medium`) when no priority label is present. Use `priority-extreme` for production outages or security incidents that require immediate action; `priority-high` for release-blocking issues; `priority-low` for cosmetic, opportunistic, or follow-up cleanup work.
- Treat priority as a first-class signal, not an afterthought. Every issue and every non-draft PR SHOULD carry exactly one priority label; `om-auto-*` skills are expected to set or infer it (see the priority-inference rule below) rather than leave it unset. When a PR inherits from an issue, copy the issue's priority forward unless the change in scope clearly warrants a different one.
- Priority inference (used by auto-skills when no priority label is present): production outage, data loss, or a security incident → `priority-extreme`; security hardening, release-blocking regression, auth/session/tenant-scope/money/event-reliability fixes → `priority-high`; ordinary bug fixes and net-new features → `priority-medium`; cosmetic, docs-only, dependency bumps, opportunistic cleanup, or follow-up chores → `priority-low`. When signals conflict, pick the higher priority and say why in the label comment.
- Risk labels are mutually exclusive within their group (only one at a time): `risk-low`, `risk-medium`, `risk-high`. They are applied to issues and PRs to communicate the **blast radius of the change** — how likely it is to introduce a regression and how wide the impact would be if it does — and are additive with respect to pipeline, category, meta, and priority labels. They default to **unset** (treated as `risk-medium`) when no risk label is present. Risk is orthogonal to priority: priority is *how urgent the work is*, risk is *how dangerous the change is to ship*. A one-line typo fix for a production outage is `priority-extreme` + `risk-low`; a large auth-layer refactor that can wait is `priority-low` + `risk-high`.
- Treat risk as a first-class signal alongside priority. Every non-draft PR SHOULD carry exactly one risk label; `om-auto-*` skills are expected to set or infer it (see the risk-inference rule below) rather than leave it unset. When a PR inherits from an issue, copy the issue's risk forward unless the change in scope clearly warrants a different one.
- Risk inference (used by auto-skills when no risk label is present): changes to auth/session/tenant-scope/money/billing, database migrations or schema, encryption, event reliability, shared contract surfaces (types, signatures, event IDs, widget spot IDs, DI keys, ACL IDs, API routes), or broad cross-module edits → `risk-high`; an ordinary single-module feature or bug fix that ships with tests → `risk-medium`; docs-only, dependency bumps, test-only, comment/typo, or isolated cosmetic cleanup → `risk-low`. When signals conflict, pick the higher risk and say why in the label comment. A `risk-high` PR strengthens the case for `needs-qa` and deeper review even when it would otherwise look routine.
- A ready non-draft PR should carry `review` unless it is already in another pipeline state.
- `auto-review-pr` MUST move approved PRs to `merge-queue`. For a PR that carries `needs-qa` (without `skip-qa`) it keeps `needs-qa` in place, so the QA-approval gate holds the actual merge until a QA reviewer adds `qa-approved`. Auto-skills MUST NOT set the `qa` pipeline label — see the `qa` rule below.
- `auto-review-pr` MUST move review failures to `changes-requested`.
- `qa` (pipeline) means **manual QA is in progress**: a QA reviewer has picked the PR up and is actively testing it. It is applied **manually by a QA reviewer**, never by an `om-auto-*` skill. Auto-skills request QA with the `needs-qa` meta label only; they never set, move to, or remove `qa`. A QA reviewer flips a queued `needs-qa` PR from `merge-queue` to `qa` while testing, then records the outcome with `qa-approved` (pass) or `qa-failed` (fail).
- `needs-qa` is for UI changes, new features, sales or order flows, and other customer-facing behavior that needs manual exercise.
- `skip-qa` is for docs-only, dependency-only, CI-only, test-only, typo-only, or similarly low-risk non-customer-facing changes.
- `qa-approved` records that manual QA passed for a `needs-qa` PR. It is the durable proof that gates the merge; the `merge-queue` pipeline label is the routing state, while `qa-approved` is the evidence that QA actually happened. Set both when QA passes.
- `screenshots` records that UI QA visual evidence was attached to the PR (posted by `om-auto-verify-pr-ui`); it is informational only — it does not gate merge and is orthogonal to `needs-qa`/`qa-approved`.
- **QA-approval merge gate (hard rule): a PR that carries `needs-qa` MUST NOT be merged unless it also carries `qa-approved`, even when every other check is green.** Moving such a PR to `merge-queue` without `qa-approved` is not sufficient — the QA-approval gate blocks it. This is a **label policy enforced by reviewers and the PR-automation tooling** (`om-merge-buddy` classifies it as not-mergeable; `om-approve-merge-pr` and the auto-review/continue skills refuse to merge it); there is no longer a dedicated `merge-gate` CI workflow, so the maintainer is responsible for upholding it (optionally via a branch-protection rule that requires the `qa-approved` label). `skip-qa` is the explicit opt-out: a PR with `skip-qa` does not require `qa-approved`. Never combine `skip-qa` with `needs-qa`/`qa-approved`.
- **Self-QA exception:** the manual QA is normally performed by the dedicated QA reviewers. When they have no capacity to test in time, any engineer may self-QA instead — but only by (1) checking the PR out and running it locally, (2) clicking through the affected flow, and (3) attaching proof to the PR: a screenshot showing it working, or a written confirmation describing what was exercised and the observed result. After that, apply BOTH `qa-approved` (so the gate passes) and `qa-self-verified` (so it is auditable that a non-QA engineer signed off via this exception, not the QA team). Do not apply `qa-approved` via the self-QA path without the attached evidence. Refer to QA reviewers by role, never by GitHub handle — assignments change.
- `qa-failed` is a hard block: a PR carrying it MUST NOT merge until QA re-runs and it is cleared. `do-not-merge` and `blocked` are likewise hard merge blocks. The QA-approval gate (reviewers + PR-automation tooling) treats any of these as not-mergeable.
- Auto-skills that mutate PRs or issues MUST claim them first with all three signals: assignee, `in-progress` label, and a claim comment. They MUST release the `in-progress` label when finished, even on failure.
- When an auto-skill adds or changes a PR pipeline/meta label, it MUST also leave a short PR comment explaining why that label was applied.
- The `qa` pipeline label is driven manually by QA reviewers, not by auto-skills. When a QA reviewer starts testing a queued `needs-qa` PR, they move it from `merge-queue` to `qa` (`gh pr edit <number> --remove-label merge-queue --add-label qa`) to signal QA is in progress. When QA passes, move it back and record approval (`gh pr edit <number> --remove-label qa --add-label merge-queue --add-label qa-approved`); via the self-QA exception add `qa-self-verified` as well. When QA fails, route to `qa-failed` (`gh pr edit <number> --remove-label qa --add-label qa-failed`) and do not add `qa-approved`.

### Documentation and Specifications

- OSS specs live in `.ai/specs/`; commercial/enterprise specs live in `.ai/specs/enterprise/` — see `.ai/specs/AGENTS.md` for naming, structure, and changelog conventions.
- Always check for existing specs before modifying a module. Update specs when implementing significant changes.
- For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths.
- For every new feature, implement the integration tests defined in the spec as part of the same change — see `.ai/qa/AGENTS.md` for the workflow.
- Integration tests MUST be self-contained: create required fixtures in test setup (prefer API fixtures), clean up created records in teardown/finally, and remain stable without relying on seeded/demo data.

## Monorepo Structure

### Apps (`apps/`)

-   **mercato**: Main Next.js app. Put user-created modules in `apps/mercato/src/modules/`.
-   **docs**: Documentation site.

### Packages (`packages/`)

All packages use the `@open-mercato/<package>` naming convention:

| Package | Import | When to use |
|---------|--------|-------------|
| **shared** | `@open-mercato/shared` | When you need cross-cutting utilities, types, DSL helpers, i18n, data engine |
| **ui** | `@open-mercato/ui` | When building UI components, forms, data tables, backend pages |
| **core** | `@open-mercato/core` | When working on core business modules (auth, catalog, customers, sales) |
| **cli** | `@open-mercato/cli` | When adding CLI tooling or generator commands |
| **cache** | `@open-mercato/cache` | When adding caching — resolve via DI, never use raw Redis/SQLite |
| **queue** | `@open-mercato/queue` | When adding background jobs — use worker contract, never custom queues |
| **events** | `@open-mercato/events` | When adding event-driven side effects between modules |
| **search** | `@open-mercato/search` | When configuring search indexing (fulltext, vector, tokens) |
| **ai-assistant** | `@open-mercato/ai-assistant` | When working on AI assistant or MCP server tools |
| **content** | `@open-mercato/content` | When adding static content pages (privacy, terms, legal) |
| **onboarding** | `@open-mercato/onboarding` | When modifying setup wizards or tenant provisioning flows |
| **enterprise** | `@open-mercato/enterprise` | When working on commercial enterprise-only modules and overlays |

### Where to Put Code

- Put core platform features in `packages/<package>/src/modules/<module>/`
- Put every external integration provider in a dedicated npm workspace package under `packages/<provider-package>/` (for example `packages/gateway-stripe`, `packages/carrier-inpost`) — do not add provider modules inside `packages/core/src/modules/`
- Put shared utilities and types in `packages/shared/src/lib/` or `packages/shared/src/modules/`
- Put UI components in `packages/ui/src/`
- Put user/app-specific modules in `apps/mercato/src/modules/<module>/`
- MUST NOT add code directly in `apps/mercato/src/` — it's a boilerplate for user apps. Narrow exception: committed, typed *generated registries* (files matching `*.generated.ts`) consumed by `modules.ts` or other root entry points may live in `apps/mercato/src/` when they must survive `yarn clean-generated` and travel with the repo — see [Generated Files: versioned vs ephemeral](.ai/docs/module-development.md#generated-files-versioned-vs-ephemeral).

### `external/official-modules/` (git submodule)

`external/official-modules/` is a **git submodule** pointing at `open-mercato/official-modules` (a public repo). When present it is real working code — treat it as first-class for search, grep, refactoring, and cross-module reasoning, not as vendored/build output.

- It is **optional and not committed** — `.gitmodules` and the `external/official-modules` checkout are not part of the open-mercato repo. They're created locally by `yarn official-modules add …` (which runs `git submodule add`). A fresh clone has no submodule; `yarn install` and CI are unchanged.
- **Activation is driven by `official-modules.json`** (committed; `activated` is the team default, `available` is auto-filled once the submodule is present) and `official-modules.local.json` (gitignored personal override). Use `yarn official-modules` to inspect/change activation; the `postinstall` worker (`scripts/official-modules-setup.mjs`) — a no-op until the submodule is registered, then it inits/refreshes it — regenerates `apps/mercato/src/official-modules.generated.ts`, which `apps/mercato/src/modules.ts` spreads into `enabledModules`.
- **Module-id convention:** package `@open-mercato/<suffix>` ⇒ module id `<suffix>` with dashes converted to underscores (e.g. `@open-mercato/ai-assistant` ⇒ `ai_assistant`).
- **Edits under `external/official-modules/` commit to the submodule's git, not open-mercato's.** Commit/push from inside `external/official-modules/` on a feature branch; create the changeset there (`yarn changeset`); open the PR against `open-mercato/official-modules`.
- **Never `git add external/official-modules` (pointer bump) unless explicitly asked** — the pointer may lag intentionally. Always check `git diff --staged` before committing in the host repo. The same applies to `apps/mercato/src/official-modules.generated.ts` / `official-modules.json` `available` churn unless you actually intend to change the activation set.
- After activating/deactivating official modules: run `yarn mercato configs cache structural --all-tenants` (and `yarn dev:reset` if Turbopack serves a stale chunk).
- **Cross-cutting changes** (core API + an official module): two coordinated PRs — core in open-mercato first → (prerelease) publish → submodule bumps the peer dep → submodule PR. Explain the merge order to the user. No PR is atomic across the two repos.

### When You Need an Import

Each package's AGENTS.md is the authoritative cheat sheet for its own imports. Look up by topic:

| Topic | Where |
|-------|-------|
| UI primitives, backend utilities (`apiCall`, `CrudForm`), portal hooks | `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md` |
| AI helpers (`defineAiAgent`, `defineAiTool`, `prepareMutation`, model factory, `<AiChat>`) | `packages/ai-assistant/AGENTS.md` |
| Cross-cutting helpers (i18n, commands, encryption, scoped payloads, boolean parsing, data/query engine types, module-level overrides) | `packages/shared/AGENTS.md` |
| Customer/portal auth helpers, custom-field helpers, CRUD/Indexer types | `packages/shared/AGENTS.md` + `packages/core/AGENTS.md` |
| Search, events, queue, cache, webhooks, content, onboarding | matching `packages/<pkg>/AGENTS.md` |

Examples worth memorising (used everywhere): `apiCall` from `@open-mercato/ui/backend/utils/apiCall`, `useT` from `@open-mercato/shared/lib/i18n/context`, `resolveTranslations` from `@open-mercato/shared/lib/i18n/server`, `Spinner` from `@open-mercato/ui/primitives/spinner`.

Import strategy:
- Prefer package-level imports (`@open-mercato/<package>/...`) over deep relative imports (`../../../...`) when crossing module boundaries, referencing shared module internals, or importing from deeply nested files.
- Keep short relative imports for same-folder/local siblings (`./x`, `../x`) where they are clearer than package paths.

## Conventions

- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- **Event IDs**: `module.entity.action` (singular entity, past tense action, e.g., `pos.cart.completed`). use dots as separators.
- `clientBroadcast: true` in EventDefinition bridges events to browser via SSE (DOM Event Bridge)
- `portalBroadcast: true` in EventDefinition bridges events to customer portal via SSE (Portal Event Bridge)
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`.
- UUID PKs, explicit FKs, junction tables for many-to-many.
- Keep code minimal and focused; avoid side effects across modules.
- Keep modules self-contained; re-use common utilities via `src/lib/`.

## Module Development Quick Reference

> Moved to [`.ai/docs/module-development.md`](.ai/docs/module-development.md) to keep this file lean. Read it when scaffolding or editing a module — it covers auto-discovery paths, the optional-files table, module rules, and the versioned-vs-ephemeral generated-files contract. See `packages/core/AGENTS.md` for full details.

## Backward Compatibility Contract

> **Full specification**: [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — MUST be read before modifying any contract surface. It enumerates the 13 contract-surface categories (auto-discovery files, types, signatures, import paths, event IDs, widget spot IDs, API routes, DB schema, DI keys, ACL features, notification IDs, CLI commands, generated files) and their FROZEN / STABLE / ADDITIVE-ONLY classifications.

Third-party module developers depend on stable platform APIs. Any change to a **contract surface** is a breaking change that blocks merge unless the deprecation protocol is followed.

**Deprecation protocol** (summary): (1) never remove in one release, (2) add `@deprecated` JSDoc, (3) provide a bridge (re-export/alias/dual-emit) for ≥1 minor version, (4) document in RELEASE_NOTES.md, (5) reference a spec with "Migration & Backward Compatibility" section.

## Boundary Labels for Agent Rules

Use `Always`, `Ask First`, `Never`, and `Validation Commands` headings when adding or reorganizing agent rules:

- `Always` — required defaults and commands agents should apply without asking.
- `Ask First` — decisions that need maintainer input before changing behavior, scope, dependencies, branch/deploy flow, or contract surfaces.
- `Never` — prohibited actions and unsafe shortcuts.
- `Validation Commands` — short, real commands agents can run to prove the relevant path.

## Architecture, Data, UI, and Code Rules

These are critical project-wide rules. The top-level `Always`, `Ask First`, and `Never` sections summarize their boundaries; this section keeps the detailed requirements.

### Architecture

-   **NO direct ORM relationships between modules** — use foreign key IDs, fetch separately
-   Always filter by `organization_id` for tenant-scoped entities
-   Never expose cross-tenant data from API handlers
-   Use DI (Awilix) to inject services; avoid `new`-ing directly
-   Modules must remain isomorphic and independent
-   When extending another module's data, add a separate extension entity and declare a link in `data/extensions.ts`

### Data & Security

-   Validate all inputs with zod; place validators in `data/validators.ts`
-   Derive TypeScript types from zod via `z.infer<typeof schema>`
-   Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`
-   Default migration workflow: update ORM entities, run `yarn db:generate`, and review the generated SQL plus `migrations/.snapshot-open-mercato.json`
-   Coding-agent exception: if `yarn db:generate` emits unrelated migrations, delete the unrelated output, keep or write only the intended SQL migration for this entity change, and update the affected module's `.snapshot-open-mercato.json`. Never run `yarn db:migrate` just to make the generator quiet.
-   Hash passwords with bcryptjs (cost >=10), never log credentials
-   Return minimal error messages for auth (avoid revealing whether email exists)
-   RBAC: prefer declarative guards (`requireAuth`, `requireFeatures`) in page metadata; avoid `requireRoles` — role names are mutable and can be spoofed; use feature-based guards with immutable IDs from `acl.ts` instead
-   Portal RBAC: use `requireCustomerAuth` and `requireCustomerFeatures` in page metadata for portal pages

### UI & HTTP

-   Use `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
-   If a backend page cannot use `CrudForm`, wrap every write (`POST`/`PUT`/`PATCH`/`DELETE`) in `useGuardedMutation(...).runMutation(...)` and include `retryLastMutation` in the injection context
-   For CRUD forms: `createCrud`/`updateCrud`/`deleteCrud` (auto-handle `raiseCrudError`)
-   For local validation errors: throw `createCrudFormError(message, fieldErrors?)` from `@open-mercato/ui/backend/utils/serverErrors`
-   Read JSON defensively: `readJsonSafe(response, fallback)` — never `.json().catch(() => ...)`
-   Use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`
-   i18n: `useT()` client-side, `resolveTranslations()` server-side
-   Never hard-code user-facing strings — use locale files
-   Prefix purely internal `throw new Error(...)` / `createCrudFormError(...)` / `toast.*(...)` messages with `[internal]` so the i18n hardcoded-string checker treats them as opted out; user-facing variants MUST route through `t('module.errors.<key>')`. Run `yarn i18n:check-hardcoded` (and `yarn i18n:check-values` for non-English coverage) to inspect the surface — both are advisory in Phase 1 of `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`. Use `<module>/i18n/.hardcoded-allowlist.json` for module-scoped exceptions (legal copy, framework chrome).
-   Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel
-   Keep `pageSize` at or below 100

### Code Quality

- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- Prefer functional, data-first utilities over classes
- No one-letter variable names, no inline comments (self-documenting code)
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`
- Confirm project still builds after changes

## Design System Rules

> Foundations (token tables, decision trees, color/spacing/typography rules): `.ai/ds-rules.md`  
> Component reference (variants, sizes, props, examples, MUST rules per primitive): `.ai/ui-components.md`  
> Workflow guidance (CrudForm, DataTable, Loading, Flash, Notifications, Portal): `packages/ui/AGENTS.md`

- NEVER use hardcoded Tailwind status colors (`text-red-*`, `bg-green-*`, `text-amber-*`, etc.) — use `{property}-status-{status}-{role}` tokens
- NEVER use arbitrary values (`text-[13px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`) — use DS scale
- NEVER add `dark:` overrides on semantic/status tokens — they already handle dark mode
- NEVER hardcode hex/rgb in `className` — always use CSS token names
- NEVER use hardcoded Tailwind color shades for borders (`border-gray-300`) — use `border-border`, `border-input`

**Boy Scout Rule**: When touching a file that has hardcoded status colors, arbitrary text sizes, or `dark:` overrides on status colors, migrate at minimum the lines you touched to semantic tokens.

## Key Commands

```bash
yarn dev                  # Start compact dev runtime; press `d` to toggle raw logs
yarn dev:verbose          # Start dev runtime with full raw passthrough logs
yarn dev:reset            # Clear .mercato/next/dev plus legacy .next caches when Turbopack serves stale chunks
yarn dev:app              # Start compact app-only runtime
yarn dev:app:verbose      # Start app-only runtime with raw passthrough logs
yarn build                # Build everything
yarn build:packages       # Build packages only
yarn lint                 # Lint all packages
yarn test                 # Run tests
yarn generate             # Run module generators
yarn db:generate          # Generate database migrations
yarn db:migrate           # Apply database migrations
yarn initialize           # Full project initialization
yarn dev:greenfield       # Fresh compact dev boot with build/generate/reinstall stages
yarn dev:greenfield:verbose  # Greenfield boot with full raw passthrough logs
yarn test:integration     # Run integration tests (Playwright, headless)
yarn test:integration:report  # View HTML test report
```
