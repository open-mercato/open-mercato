# Frontend Client Boundary RAM Reduction

## TLDR

Open Mercato's generated Next.js frontend currently overuses top-level `"use client"` boundaries and broad global client bootstraps. This inflates the dev dependency graph, increases hydration work, and is a likely contributor to `yarn dev` reaching ~16 GB RAM on generated apps. The target architecture keeps route/page roots server-first, scopes providers and registries to route-local islands, and adds generator/skill guardrails so future generated frontend code does not regress.

## Problem Statement

Generated backend/frontend pages and app-level providers have drifted toward client-first composition. In a Next App Router application this is expensive because a top-level client directive turns the full import tree below that file into browser/client compiler work. The observed symptoms are:

- high RAM in `yarn dev`, reported around 16 GB,
- slow or heavy rebuilds from broad page/client dependency graphs,
- generated CRUD pages carrying table/form/editor/dialog concerns at page root,
- common providers bootstrapping dashboard, injection, notification, message, and payment registries for routes that do not need them.

## Audit Evidence

Static audit of a fresh fork clone found:

- 934 files with top-level `"use client"`.
- 178 of 223 backend `page.tsx` files are client components.
- 11 of 21 frontend `page.tsx` files are client components.
- `apps/mercato/src/components/AppProviders.tsx` is a global client provider boundary wrapping the app with `ClientBootstrapProvider`, `ThemeProvider`, `QueryProvider`, `FrontendLayout`, and notice bars.
- `apps/mercato/src/components/ClientBootstrap.tsx` imports broad generated registries and side-effect files: injection widgets/tables, dashboard widgets, notification handlers, translation fields, messages, and payments.
- Effect hotspots include large client pages and primitives such as sales document detail pages, `CrudForm`, `DataTable`, and backend `AppShell`.
- Heavy browser libraries are present in client graph candidates, including workflow graph, calendar, rich editor, TanStack table, and large icon imports.
- Dev orchestration still exposes high concurrency defaults such as `watch:packages` with `--concurrency=32`.

## Frontend Performance Ownership Model

Frontend performance is a named quality stream in the existing Open Mercato gate model: intake → UX → architecture → task pack → build → review → QA → release. Each role has explicit blocking responsibilities.

### om-architect

Owns the Frontend Architecture Contract in blueprints for Next.js/UI work:

- chooses Server Components vs Client Islands,
- defines data strategy, cache, revalidation, and invalidation,
- defines streaming/loading/error boundaries,
- identifies bundle/runtime risks,
- requires an ADR when caching or rendering strategy changes.

### om-nextjs-senior

Owns Next.js performance correctness:

- Server Components first,
- minimal client islands,
- no global `"use client"` in layouts/page roots without strong justification,
- props serialization boundary correctness,
- forms/server actions where appropriate,
- dynamic imports for heavy browser-only widgets,
- bundle hygiene, hydration risk, and runtime memory risk.

### om-builder

Implements the task pack; does not independently expand the client graph:

- follows accepted Server/Client boundary maps,
- stops work and escalates if broader `"use client"` is needed,
- attaches performance evidence to the result pack.

### om-code-reviewer

Has blocking power for frontend performance regressions. Blocks when:

- server components are converted to client components without accepted justification,
- route/page/layout roots become large client-side blobs,
- bundle/runtime footprint grows without evidence and acceptance,
- interaction, accessibility, loading, or error-state tests are missing.

### om-test-engineer

Plans rendering and performance gates alongside functional tests:

- server-rendered shell tests,
- client-island interaction tests,
- regression E2E for critical flows,
- smoke performance checks when feasible.

### om-qa-preview

Verifies perceived performance in preview:

- screenshots and browser flows,
- Lighthouse/Web Vitals when available,
- cold load and interaction responsiveness,
- mobile viewport smoke.

### om-ux-analyst

Adds UX constraints that support performance:

- progressive disclosure,
- skeleton/loading boundaries,
- avoiding unnecessarily heavy widgets,
- mobile-first states.

## Target Architecture

### Server-first page roots

- Generated `page.tsx`, `layout.tsx`, and route shell files are server components by default.
- A generated page may be client-only only when it has an explicit allowlist entry and justification.
- Data loading, access decisions, route metadata, and static composition stay server-side.
- Interactive widgets become small client leaves mounted by the server page.

### Client leaves and route islands

Allowed client leaves include:

- data table interactions,
- form state/editors,
- dialogs/drawers,
- drag-and-drop or graph/canvas widgets,
- calendar widgets,
- browser-only integration widgets.

These leaves must be local to the route or feature that needs them. They must not be imported by global providers, root layouts, or generated page roots unless explicitly required.

### Scoped provider/bootstrap registries

Global providers should remain minimal:

- i18n/dictionary context if required globally,
- theme bootstrap with a minimal no-hydration script or tiny provider,
- essential error/shell boundaries.

The following should move to route- or feature-specific islands:

- `QueryProvider`, where server components cannot cover data access,
- injection widget/table registration,
- dashboard widget registration,
- notification runtime registration,
- message/payment component registries,
- frontend/backend shell chrome that is not needed by public/auth routes.

### Lazy heavy dependencies

Browser-heavy dependencies must be imported behind local client leaves or `next/dynamic` boundaries:

- graph/canvas libraries,
- rich editors,
- calendars,
- large table tooling,
- browser-only SDKs.

## Generator and Template Changes

1. Update generated backend CRUD templates so page roots are server components.
2. Generate a sibling `*Client.tsx` or `components/*Client.tsx` for interactive table/form/dialog concerns.
3. Add metadata in generated files when a page root truly requires `"use client"`, e.g. an allowlist file or comment consumed by checks.
4. Split generated client bootstrap files by runtime surface:
   - injection widgets,
   - injection tables,
   - dashboards,
   - notifications,
   - messages,
   - payments.
5. Generate import paths so heavy modules are only referenced by their route-local leaves.
6. Add a client-boundary report to generation output that lists new top-level client files and page-root exceptions.

## Skill / Agent Guidance Changes

Agent skills that write specs, implement specs, or generate UI must treat frontend performance as a hard quality stream, not a prose recommendation.

### Frontend Architecture Contract

`om-architect` and spec-writing workflows must require a Frontend Architecture Contract for Next.js/UI work. The contract includes:

- Server/Client boundary map per route/surface.
- A `"use client"` ledger with justification for every new/touched client file.
- A client blob guardrail: no large generated client-side page/root blobs without exception.
- Bundle/RAM/per-route budgets or temporary exceptions with follow-up tasks.
- Provider/bootstrap scope map showing what is global, route-local, or lazy.
- Hydration/interactivity test plan for changed routes.
- Performance evidence required before merge.

### Build / implementation guardrails

- Backend page roots default to server components.
- `"use client"` at a generated page root requires an allowlist/justification.
- Client-only widgets should be isolated as leaves.
- Provider/bootstrap registries should be scoped and lazy.
- Heavy UI libraries should be route-local and dynamic when practical.
- Review output must include client-boundary check output when a change touches `app/**/page.tsx`, generators, `AppProviders`, `ClientBootstrap`, `AppShell`, or generated registries.
- Merge should be blocked or explicitly waived when performance evidence is missing for performance-sensitive UI work.

## Rollout Phases

### Phase A — Guardrails and measurement

- Add a static client-boundary report/check script.
- Add package script entry.
- Document the target architecture and acceptance criteria.
- Establish baseline counts for client page roots and top-level client files.
- Add the Frontend Architecture Contract to the spec-writing skill so architecture blueprints must include boundary maps, `"use client"` ledgers, budgets, hydration/interactivity tests, and performance evidence before merge.

### Phase B — Provider/bootstrap split

- Split `AppProviders` into minimal global providers and route-specific providers.
- Split `ClientBootstrapProvider` into lazy bootstrap components per runtime surface.
- Move backend shell providers out of public/auth routes.

### Phase C — Generator template migration

- Change generated CRUD/list/detail page templates to server roots with client leaves.
- Add allowlist/justification support for rare client page roots.
- Update generated reports to show client-boundary deltas.

### Phase D — Heavy dependency isolation

- Move workflow graph, calendar, rich editor, and similar imports behind route-local client leaves or dynamic imports.
- Validate route-level bundle and dev compiler graph reductions.

### Phase E — Dev memory defaults

- Lower default package watch concurrency for dev.
- Keep high-concurrency mode opt-in for powerful machines.
- Add RSS profiling script for repeatable measurements.

## Acceptance Criteria

- New generated backend `page.tsx` files are server components unless explicitly allowlisted.
- Next.js/UI specs include a Frontend Architecture Contract with Server/Client boundary map, `"use client"` ledger, client blob guardrail, budgets, hydration/interactivity tests, and performance evidence requirements.
- The client-boundary check reports total top-level client files, page-root exceptions, heavy imports, and oversized client roots.
- CI or local verification can fail on unallowlisted generated/backend page-root `"use client"` regressions.
- Global app providers no longer import dashboard/injection/notification/message/payment registries unconditionally.
- Heavy browser-only libraries are not imported by root providers or server page roots.
- `yarn dev` memory profile is captured before/after the provider and generator migrations.

## Measurement Plan

Record process-tree RSS for the dev command at these checkpoints:

1. before Next ready,
2. after ready/idle,
3. after `/login`,
4. after a representative backend list page,
5. after a representative backend detail/form page,
6. after a sales document page,
7. after one representative API request.

Also record static metrics:

- top-level `"use client"` count,
- backend page-root client count,
- frontend page-root client count,
- largest client-root files by line count,
- heavy library import locations.

## Risks

- Moving providers can expose implicit dependency on global query/client context.
- Server/client splits can require careful serialization of props.
- Lazy registries must preserve extension/widget registration order where order is observable.
- Dynamic imports can change loading states and test timing.
- Some page roots may legitimately need client mode during migration; allowlist must stay small and reviewed.

## Non-goals

- This spec does not rewrite all existing generated pages in one patch.
- This spec does not remove React Query, CrudForm, DataTable, or UMES.
- This spec does not claim exact RAM savings until measured profiling is added and run.
- This spec does not change business module behavior.

## Initial Implementation Status

| Phase | Status | Date | Notes |
| --- | --- | --- | --- |
| Phase A — Guardrails and measurement | In Progress | 2026-05-13 | Spec and static check introduced. Runtime RSS profiling remains follow-up. |
| Phase B — Provider/bootstrap split | Not Started | — | Requires code migration. |
| Phase C — Generator template migration | Not Started | — | Requires generator/template updates. |
| Phase D — Heavy dependency isolation | Not Started | — | Requires route-level refactors. |
| Phase E — Dev memory defaults | Not Started | — | Requires measured default tuning. |
