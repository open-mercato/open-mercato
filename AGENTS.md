# Agents Guidelines

Leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

> **Instruction budget:** this file must stay under **32,768 bytes** (Codex's default
> `project_doc_max_bytes`, shared with the nested `AGENTS.md` files below it) — anything past
> that byte offset never reaches the agent. Keep hard rules and routing here, put long-form
> procedure in `.ai/docs/*`, and run `yarn agents:check-budget`. See
> [`.ai/docs/agent-instructions.md`](.ai/docs/agent-instructions.md).

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
- Support optimistic locking on every NEW user-editable entity and edit/delete form (it is **default ON**): give the entity an `updated_at` column, return `updatedAt` in its list/detail API responses, and let `CrudForm` auto-derive the header from `initialValues.updatedAt` (covers update **and** delete) — or, for custom non-`CrudForm` handlers, wrap the mutating call with `withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), …)` and surface conflicts via `surfaceRecordConflict(err, t)`. When a form's `onSubmit` mutates OTHER entities, override the parent header per child with that child's own version (avoid false 409s). Enforced by `optimistic-lock-editable-entities.test.ts` and `optimistic-lock-ui-coverage.test.ts`. Details: the Task Router row.

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

The full CI-mirroring gate (used by review/automation skills) is the ordered `validation.commands` list in `.ai/agentic.config.json`.

**Where to run them:** decide once per gate sequence — Docker mode when a compose `app` container is running (then `yarn X` becomes `node scripts/docker-exec.mjs X`), otherwise local mode — and record the chosen runner in your output. Probe order and exact rules: [`.ai/docs/agent-instructions.md`](.ai/docs/agent-instructions.md).

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to this table. A single task often maps to **multiple rows** — "add a new module with search" needs both the Module Development and Search guides. Read **all** matching guides first; they carry the imports, patterns and constraints you need. Only use Explore agents for topics no AGENTS.md covers.

Guide shorthand: `<pkg>` = `packages/<pkg>/AGENTS.md` (so `core` = `packages/core/AGENTS.md`, `ui` = `packages/ui/AGENTS.md`), `core:<module>` = `packages/core/src/modules/<module>/AGENTS.md`, `ui:backend` = `packages/ui/src/backend/AGENTS.md`. `→ Section` names the heading to read inside that file.

| Task | Guide |
|------|-------|
| **Module Development** | |
| New module, scaffolding, auto-discovery paths | `core` + [`.ai/docs/module-development.md`](.ai/docs/module-development.md). **Standalone apps**: the `om-module-scaffold` skill scaffolds a module end-to-end |
| Official modules via the `external/official-modules` submodule, activation (`yarn official-modules`, `official-modules.json`), committing to the submodule's git | [`.ai/docs/official-modules.md`](.ai/docs/official-modules.md) |
| CRUD API routes, OpenAPI specs, `makeCrudRoute`, query engine integration | `core` → API Routes |
| `setup.ts` tenant init, role features, syncing ACL grants to roles, seeding defaults/examples | `core` → Module Setup |
| Typed events with `createModuleEvents`, CRUD/lifecycle events, subscribers | `core` → Events |
| In-app notifications, subscriber-based alerts, renderers; reactive handlers (`notifications.handlers.ts`), `useNotificationEffect` | `core` → Notifications + `ui` |
| Injecting UI widgets into other modules, spot IDs, cross-module UI extensions | `core` → Widgets |
| Headless injection widgets (menu items, columns, fields), `InjectionPosition`, `useInjectionDataWidgets`; DataTable extension widgets (columns/row actions/bulk actions/filters); CrudForm field widgets (`crud-form:<entityId>:fields`) | `core` → Widget Injection + `ui` → DataTable / CrudForm Guidelines |
| Menu items into main/settings/profile sidebars or topbar dropdown (`useInjectedMenuItems`, `mergeMenuItems`) | `ui` |
| API route interceptors (`api/interceptors.ts`, before/after hooks, body/query rewrite) | `core` → API Interceptors |
| Bulk operations, DataTable bulk actions, selected-row mutations, long-running operations with progress | `core:progress` + `ui` → DataTable Guidelines + `queue` |
| Replacing/wrapping UI components via `widgets/components.ts` (`replace`/`wrapper`/`props`) | `core` → Component Replacement + `ui` |
| Custom fields/entities, DSL helpers (`defineLink`, `cf.*`), `ce.ts` | `core` → Custom Fields |
| Entity extensions, cross-module data links, `data/extensions.ts` | `core` → Extensions |
| Coupling one module to another (events / widget injection + enrichers / FK-id + snapshot / soft-optional `tryResolve`), depending on an OPTIONAL integration | `core` → Cross-Module Coupling + `packages/core/src/__tests__/module-decoupling.test.ts` |
| RBAC features in `acl.ts`, declarative guards, permission checks | `core` → Access Control |
| Wildcard ACL handling in feature-gated runtime helpers (menus, notification handlers, mutation guards, command interceptors, AI tools) | `core` → Access Control + `shared` + `ui` + `core:auth` (portal: `core:customer_accounts`) |
| Encrypted queries (`findWithDecryption`), encryption defaults, GDPR fields | `core` → Encryption |
| Response enrichers for other modules' API responses | `core` → Response Enrichers |
| Filtering CRUD list APIs by multiple IDs (`?ids=uuid1,uuid2`), interceptor-driven ID narrowing | `core` → API Interceptors + `shared` |
| Optimistic locking / concurrent-edit conflicts: `updated_at` versioning (**default ON** for every `makeCrudRoute` entity, opt out with `OM_OPTIMISTIC_LOCK=off`), the 409 body, client helpers (`buildOptimisticLockHeader`, `extractOptimisticLockConflict`), command-pattern writes (`enforceCommandOptimisticLock`, the DI-overridable `createCommandOptimisticLockGuardService`), the unified conflict bar (`surfaceRecordConflict`) | `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` (§ Protecting command/action endpoints) + `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md` + `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md` + `packages/shared/src/lib/crud/optimistic-lock{,-command}.ts` + `packages/ui/src/backend/conflicts/` |
| DOM Event Bridge (SSE real-time events to browser), `useAppEvent`, `useOperationProgress` | `events` → DOM Event Bridge |
| Customer portal pages, portal auth, portal nav injection, portal event bridge | `ui` → Portal Extension + `om-backend-ui-design` skill |
| Widget event handlers (`onFieldChange`, `onBeforeNavigate`, transformers) | `ui` |
| AI agents/tools (`ai-agents.ts`, `ai-tools.ts`, tool packs, mutation approval via `prepareMutation`, attachments, provider/model selection) | `.ai/skills/om-create-ai-agent/SKILL.md` + `ai-assistant` + `apps/docs/docs/framework/ai-assistant/*.mdx` |
| AI agent loop controls + overrides (`loop.stopWhen/prepareStep/budget`, per-tenant settings, replacing/disabling agents/tools, `entry.overrides`) | `ai-assistant` → Loop controls + How to Override; in `.ai/specs/implemented/`: `2026-04-28-ai-agents-agentic-loop-controls`, `2026-04-30-ai-overrides-and-module-disable`, `2026-05-04-modules-ts-unified-overrides` |
| **Specific Modules** | |
| Module-specific work (customers as CRUD reference, plus sales, catalog, auth, customer_accounts, currencies, workflows, integrations, data_sync, progress) | `packages/core/src/modules/<module>/AGENTS.md` |
| Webhooks (outbound/inbound, Standard Webhooks signing, delivery queues, admin UI) | `webhooks` (cross-refs `queue`, `events`, `core:integrations`, `ui`) |
| New integration provider (adapter, health check, credentials, bundle wiring) | `.ai/skills/om-integration-builder/SKILL.md` + `core:integrations` + `core:data_sync` |
| **Packages** | |
| Reusable utilities, encryption helpers, i18n (`useT`/`resolveTranslations`), boolean parsing, data engine types, request scoping | `shared` |
| Structured logging / replacing raw `console.*` with the facade (`createLogger`, `child()`, `OM_LOG_LEVEL`), advisory `yarn logger:check-console` | `apps/docs/docs/framework/runtime/logging.mdx` + `.ai/specs/2026-07-02-structured-logging-facade.md` + `shared` |
| Forms (`CrudForm`), data tables (`DataTable`), loading/error states, flash messages, `FormHeader`/`FormFooter`, dialog UX | `ui` + `om-backend-ui-design` skill (+ `om-ds-guardian` for DS-token compliance) |
| Reusing backend component families (charts/KPIs, filters, detail sections, schedule, messages, notifications, page scaffolding, banners) — check BEFORE building any from scratch | [`.ai/ui-backend-components.md`](.ai/ui-backend-components.md) + `ui` |
| Backend page components, `apiCall` usage, `RowActions` ids, `LoadingMessage`/`ErrorMessage` | `ui:backend` + `om-backend-ui-design` skill |
| Fulltext/vector/token search, `search.ts`, reindexing entities, debugging search, search CLI | `search` |
| MCP tools (`registerMcpTool`), OpenCode config, AI chat debugging, session tokens, command palette, two-tier auth | `ai-assistant` |
| Generators (`yarn generate`), migrations (`yarn db:generate`), module scaffolding, build order | `cli` |
| Event bus architecture, ephemeral vs persistent subscriptions, queue integration, event workers | `events` |
| Cache in a module, tag-based invalidation, tenant-scoped caching, strategy (memory/SQLite/Redis) | `cache` |
| Background workers, concurrency (I/O vs CPU-bound), idempotent jobs, queue strategies | `queue` |
| Operation progress in the top bar, `ProgressJob`s, client-local progress events | `core:progress` + `events` → DOM Event Bridge |
| Onboarding wizard steps, tenant setup hooks (`onTenantCreated`/`seedDefaults`), welcome/invitation emails | `onboarding` |
| Static content pages (privacy policies, terms, legal pages) | `content` |
| Standalone apps with Verdaccio, publishing packages, canary releases, template scaffolding | `create-app` |
| Editing `apps/mercato/src/app/**` or env vars in `apps/mercato/.env.example` — MUST mirror into the create-app template in the same task | `create-app` → Template Sync Checklist |
| Deploying a scaffolded app to Railway with `mercato deploy railway` | [`.ai/specs/2026-05-12-railway-one-command-deploy.md`](.ai/specs/2026-05-12-railway-one-command-deploy.md) + [`apps/docs/docs/deployment/railway.mdx`](apps/docs/docs/deployment/railway.mdx) + `cli` |
| **Performance** | |
| Profiling dev-mode memory (`yarn dev:profile`), ranking memory hogs, watcher / Vite-vs-Turbopack tradeoffs | `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` + `scripts/profile-dev-rss.mjs` |
| **Migration** | |
| Migrating custom module code from MikroORM v6 to v7 (decorators, persist/flush, Knex→Kysely, ORM config, Jest setup) | `.ai/skills/om-migrate-mikro-orm/SKILL.md` |
| **Testing** | |
| Integration testing, Playwright tests, converting markdown test cases to TypeScript, CI test pipeline | `.ai/qa/AGENTS.md` + `.agents/skills/om-integration-tests/SKILL.md` |
| Refreshing standalone-app AI harness coverage after module, extension-point, contract, generator/discovery, or release changes | `.ai/skills/om-refresh-standalone-harness/SKILL.md` + `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md` |
| **Spec & PR Automation** | |
| Spec lifecycle (pre-implement → implement → write/update), code review, DS review | `.agents/skills/{om-spec-writing,om-code-review}/SKILL.md` + `.ai/skills/{om-pre-implement-spec,om-implement-spec,om-ds-guardian}/SKILL.md` + `.ai/specs/AGENTS.md` + `.ai/ds-rules.md` |
| PR/issue automation (one-shot auto-PR, resumable loop variants, review/merge-buddy, post-merge sync, changelog, UI QA). **Default for one-off bug fixes / small features:** `om-auto-create-pr` | `.agents/skills/{om-auto-create-pr,om-auto-continue-pr,om-auto-create-pr-loop,om-auto-continue-pr-loop,om-auto-review-pr,om-auto-qa-pr,om-merge-buddy,om-review-prs,om-close-fixed-issues,om-auto-update-changelog,om-prepare-issue}/SKILL.md` |
| **Agent harness itself** | |
| Editing this file or a package `AGENTS.md`; the instruction budget and boundary labels | [`.ai/docs/agent-instructions.md`](.ai/docs/agent-instructions.md) + `scripts/check-agents-md-budget.mjs` (`yarn agents:check-budget`) |

Most `om-*` automation skills come from the shared [open-mercato/skills](https://github.com/open-mercato/skills) collection; `yarn install-skills` installs and updates them. Repo-specific settings live in `.ai/agentic.config.json` (+ the tracker descriptor `.ai/trackers/github.md`); a folder under `.ai/skills/` matching an external skill name is a repo-local override those skills follow on top of their built-in workflow, and the remaining `.ai/skills/` folders are repo-local skills installed by tier (`.ai/skills/tiers.json`). Both sources install into **one canonical directory**, `.agents/skills/` (Claude Code cannot read it, so it also gets a symlink layer under `.claude/skills/`). Installer flags: [`.ai/skills/README.md`](.ai/skills/README.md).

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Workflow Orchestration

1.  **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` and `.ai/specs/enterprise/` before coding; name new spec files `{YYYY-MM-DD}-{kebab-case-title}.md`. Skip for small fixes. Skills: `om-spec-writing` (research/phasing), `om-pre-implement-spec` (readiness audit), `om-implement-spec` (execution).
2.  **Subagent strategy**: Use subagents liberally to keep main context clean. Offload research and parallel analysis. One task per subagent.
3.  **Self-improvement**: After corrections, scan `.ai/lessons.md`; update one tagged lesson record + index row or the relevant AGENTS.md. Never bulk-read lessons.
4.  **Verification**: Run tests, check build, suggest user verification. Ask: "Would a staff engineer approve this?"
5.  **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.
6.  **Autonomous bug fixing**: When given a bug report, just fix it. Point at logs/errors, then resolve. Zero hand-holding.

## PR Workflow

Full policy — label taxonomy, priority/risk inference tables, pipeline transitions, the automated-verification exemption, the self-QA exception and the auto-skill claim protocol: [`.ai/docs/pr-workflow.md`](.ai/docs/pr-workflow.md). The boundaries:

- Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`. A ready non-draft PR carries `review` unless it is already in another pipeline state.
- Category (`bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`) and meta (`needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `screenshots`) labels are additive.
- Every non-draft PR carries **exactly one** priority label (`priority-low|medium|high|extreme`, urgency) and **exactly one** risk label (`risk-low|medium|high`, blast radius). They are orthogonal; when signals conflict pick the higher one and say why in the label comment.
- **QA-approval merge gate (hard rule): a PR carrying `needs-qa` MUST NOT be merged unless it also carries `qa-approved`**, even when every other check is green. `skip-qa` is the explicit opt-out; never combine it with `needs-qa`/`qa-approved`. `qa-failed`, `do-not-merge` and `blocked` are likewise hard merge blocks.
- **Automated-verification exemption:** a change touching no UI-rendering file (no `.tsx` outside tests, nothing under `packages/ui/src/` or `**/components/**`) takes `skip-qa` — **but only** with the database structure and API surface unchanged, no `BACKWARD_COMPATIBILITY.md` contract broken, and automated tests for the changed behavior in the same PR; otherwise it keeps `needs-qa`.
- `qa-approved`/`qa-self-verified` are label writes: a `read`-permission contributor posts the QA evidence comment and a maintainer applies the labels; a skill that cannot apply them MUST report it stopped there.
- The `qa` pipeline label means manual QA is **in progress** and is set by QA reviewers only — `om-auto-*` skills request QA with `needs-qa` and never touch `qa`.
- Auto-skills claim a PR/issue with all three signals (assignee, `in-progress` label, claim comment), release `in-progress` even on failure, and comment the rationale whenever they change a pipeline/meta label.

### Documentation and Specifications

- OSS specs live in `.ai/specs/`; commercial/enterprise specs live in `.ai/specs/enterprise/` — see `.ai/specs/AGENTS.md` for naming, structure, and changelog conventions. Always check for existing specs before modifying a module, and update them when implementing significant changes.
- For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths, and those integration tests MUST ship in the same change — see `.ai/qa/AGENTS.md`.
- Integration tests MUST be self-contained: create required fixtures in test setup (prefer API fixtures), clean up created records in teardown/finally, and remain stable without relying on seeded/demo data.

## Monorepo Structure

### Apps (`apps/`)

-   **mercato**: Main Next.js app. Put user-created modules in `apps/mercato/src/modules/`.
-   **docs**: Documentation site.

### Packages (`packages/`)

All packages use the `@open-mercato/<package>` naming convention: **shared** (cross-cutting utilities, types, DSL helpers, i18n, data engine), **ui**, **core** (business modules: auth, catalog, customers, sales), **cli**, **cache** (always via DI, never raw Redis/SQLite), **queue** (background jobs via the worker contract, never custom queues), **events**, **search**, **ai-assistant**, **content**, **onboarding**, **enterprise** (commercial-only modules and overlays).

### Where to Put Code

- Put core platform features in `packages/<package>/src/modules/<module>/`
- Put every external integration provider in a dedicated npm workspace package under `packages/<provider-package>/` (for example `packages/gateway-stripe`, `packages/carrier-inpost`) — do not add provider modules inside `packages/core/src/modules/`
- Put shared utilities and types in `packages/shared/src/lib/` or `packages/shared/src/modules/`
- Put UI components in `packages/ui/src/`
- Put user/app-specific modules in `apps/mercato/src/modules/<module>/`
- MUST NOT add code directly in `apps/mercato/src/` — it's a boilerplate for user apps. Narrow exception: committed, typed *generated registries* (`*.generated.ts`) that must survive `yarn clean-generated` and travel with the repo — see [Generated Files: versioned vs ephemeral](.ai/docs/module-development.md#generated-files-versioned-vs-ephemeral).

### `external/official-modules/` (git submodule)

An optional, uncommitted git submodule. When present it is **real working code** — first-class for search, grep and refactoring, not vendored build output. Edits there commit to the submodule's own git and ship as a separate PR; **never `git add external/official-modules`** (pointer bump) unless explicitly asked. Activation, module-id convention and cross-repo merge order: [`.ai/docs/official-modules.md`](.ai/docs/official-modules.md).

### When You Need an Import

Each package's AGENTS.md is the authoritative cheat sheet for its own imports: UI primitives, backend utilities (`apiCall`, `CrudForm`) and portal hooks → `ui` + `ui:backend`; AI helpers (`defineAiAgent`, `defineAiTool`, `prepareMutation`, `<AiChat>`) → `ai-assistant`; cross-cutting helpers (i18n, commands, encryption, scoped payloads, boolean parsing, data/query engine types, overrides) → `shared`; customer/portal auth helpers, custom-field helpers, CRUD/Indexer types → `shared` + `core`; everything else → the matching package.

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

## Backward Compatibility Contract

> **Full specification**: [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — MUST be read before modifying any contract surface. It enumerates the 13 contract-surface categories (auto-discovery files, types, signatures, import paths, event IDs, widget spot IDs, API routes, DB schema, DI keys, ACL features, notification IDs, CLI commands, generated files) and their FROZEN / STABLE / ADDITIVE-ONLY classification.

Third-party module developers depend on stable platform APIs. Any change to a **contract surface** is a breaking change that blocks merge unless the deprecation protocol is followed.

**Deprecation protocol** (summary): (1) never remove in one release, (2) add `@deprecated` JSDoc, (3) provide a bridge (re-export/alias/dual-emit) for ≥1 minor version, (4) document in UPGRADE_NOTES.md, (5) reference a spec with "Migration & Backward Compatibility" section.

## Boundary Labels for Agent Rules

Use `Always`, `Ask First`, `Never`, and `Validation Commands` headings when adding or reorganizing agent rules — definitions and the instruction-budget contract: [`.ai/docs/agent-instructions.md`](.ai/docs/agent-instructions.md).

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
yarn dev                  # Compact dev runtime; press `d` for raw logs (`:verbose`, `:app`, `:greenfield` variants)
yarn dev:reset            # Clear .mercato/next/dev plus legacy .next caches when Turbopack serves stale chunks
yarn build                # Build everything (`build:packages` / `build:app` for one side)
yarn lint                 # Lint all packages
yarn test                 # Run unit tests (`test:integration` for Playwright, headless)
yarn generate             # Run module generators
yarn db:generate          # Generate database migrations (`db:migrate` applies them — ask first)
yarn initialize           # Full project initialization
yarn agents:check-budget  # Verify AGENTS.md files fit the agent instruction budget
```
