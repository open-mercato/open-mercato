# Lessons

# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

## Standardize record-not-found as a dedicated page state in backend UI

**Context**: Record-backed backend pages evolved with mixed missing-record patterns. Some pages used `ErrorMessage`, some rendered custom centered `<div>` markup with plain text and a button, and some collapsed `notFound` and generic load failures into the same branch.

**Problem**: The UX became inconsistent across products, customers, auth, resources, sales, and similar modules. In some pages the missing-record path still lived too close to the form/detail rendering path, making it easy to keep rendering page chrome or controls when the record was gone.

**Rule**: For any record-backed backend detail or edit page, model `notFound` as a dedicated page state separate from generic `error`. When the requested record does not exist, return early and render a page-level state built on `ErrorMessage`, with a clear recovery action such as "Back to list". Do not render `CrudForm`, detail sections, tabs, or record actions in the not-found branch.

**Applies to**: `packages/ui`, `packages/ui/src/backend`, and any backend `[id]` page in `packages/core/src/modules/**/backend/**`.

## Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

## Flush entity updates before running relation syncs that query

**Context**: `catalog.products.update` mutates scalar fields and then calls `syncOffers` / `syncCategoryAssignments` / `syncProductTags`, which perform `find` queries. MikroORM auto-flush + subscriber logic reset `__originalEntityData`, resulting in no change sets and no UPDATE being issued.

**Problem**: Updates to the main entity silently did not hit the database when relation syncs executed before the flush.

**Rule**: If an update command mutates scalar fields and then performs relation-sync queries, flush the main entity changes *before* those syncs (or split into two UoWs/transactions).

**Applies to**: Commands that update a core record and then call sync helpers that query/modify relations using the same `EntityManager`.

## Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, and related template-only wrapper components.

## Keep standalone template module lists aligned with template package dependencies

**Context**: The standalone app template enabled `{ id: 'webhooks', from: '@open-mercato/webhooks' }` in `packages/create-app/template/src/modules.ts`, but `packages/create-app/template/package.json.template` did not install `@open-mercato/webhooks`.

**Problem**: `yarn install` succeeded, but `mercato generate` failed later because the generator resolved a package-backed module that was never installed in the standalone app.

**Rule**: Any time a package-backed module is added or kept enabled in `packages/create-app/template/src/modules.ts`, verify the matching npm package exists in `packages/create-app/template/package.json.template`. Review the template lockfile in the same change whenever dependency shape changes.

**Applies to**: `packages/create-app/template/src/modules.ts`, `packages/create-app/template/package.json.template`, template lockfiles, and standalone app smoke tests.

## Package builds that publish `dist/` must clear stale artifacts first

**Context**: Standalone parity started failing during `yarn initialize` because `@open-mercato/core` published a deleted migration file that still existed only in `dist/`.

**Problem**: Package build scripts that only overwrite current entry points leave removed files behind. Standalone/Verdaccio installs consume `dist/`, so stale migrations, routes, or generated outputs can execute even after the source file was deleted.

**Rule**: Any package build that publishes from `dist/` must remove existing `dist/*` contents before rebuilding. Do not rely on esbuild output to implicitly prune deleted files.

**Applies to**: Package `build.mjs` scripts, especially packages consumed by standalone apps through npm/Verdaccio.

## Standalone CI runners must mirror webhook-security env from parity scripts

**Context**: Standalone snapshot CI started failing payment-gateway and checkout webhook specs with `401` after the forged-webhook hardening made the mock gateway fail closed in production unless `MOCK_GATEWAY_WEBHOOK_SECRET` is configured.

**Problem**: The dedicated standalone GitHub Actions workflow scaffolded and started the app from its own `.env`, but that path omitted `MOCK_GATEWAY_WEBHOOK_SECRET` even though the local parity runner and ephemeral CLI already injected it. Production-mode standalone apps then rejected every signed mock webhook.

**Rule**: Whenever standalone test runners or CI workflows boot a scaffolded app outside the shared parity scripts, copy the full webhook-related env contract too, including `MOCK_GATEWAY_WEBHOOK_SECRET`. Keep workflow env blocks aligned with `scripts/test-create-app-integration.ts` and the CLI ephemeral test environment.

**Applies to**: `.github/workflows/snapshot.yml`, standalone parity scripts, and any ad hoc scaffolded-app test harnesses.

## Fresh standalone Yarn scaffolds must ship a runnable root workspace lockfile entry

**Context**: `create-mercato-app` advertised `yarn setup` as the first command, but the scaffold only shipped an empty `yarn.lock`.

**Problem**: Yarn 4 resolves package scripts through the lockfile. In a fresh scaffold, `yarn setup` failed before `scripts/setup.mjs` could call `yarn install` with `This package doesn't seem to be present in your lockfile`.

**Rule**: Standalone templates that expect a pre-install Yarn script to run must ship a templated `yarn.lock` containing the root `"{{APP_NAME}}@workspace:."` entry. Keep the standalone smoke test exercising at least one trivial Yarn script before the first install so the regression is caught immediately.

**Applies to**: `packages/create-app/template/yarn.lock.template`, `packages/create-app/src/index.ts`, and `scripts/test-create-app.ts`.

## Generated standalone app installs in CI must opt out of immutable lockfiles

**Context**: Snapshot parity scaffolds a fresh standalone app from `create-mercato-app` and then runs `yarn install` inside that generated directory.

**Problem**: On CI, Yarn enables immutable installs by default. Because the scaffold intentionally ships only a minimal root workspace `yarn.lock`, the first standalone `yarn install` needs to materialize the real lockfile and otherwise fails with `YN0028`.

**Rule**: When CI or smoke tests run the first `yarn install` inside a freshly scaffolded standalone app, set `YARN_ENABLE_IMMUTABLE_INSTALLS=0`. Do this only for the generated app install/add steps, not for the monorepo install.

**Applies to**: `.github/workflows/snapshot.yml`, `scripts/test-create-app.ts`, and `scripts/test-create-app-integration.ts`.

## Keep mirrored dev runtimes aligned with their process registry type

**Context**: The new splash-based dev runtimes track child processes in a `Set`, but shutdown code in the root script, app runtime, and create-app template still used `.filter(...)` as if the registry were an array.

**Problem**: Pressing `Ctrl+C` crashed shutdown with `TypeError: children.filter is not a function`, leaving the runtime to exit noisily instead of terminating child processes cleanly.

**Rule**: When a runtime script stores child processes in a `Set`, all shutdown and cleanup logic must iterate via `Array.from(children)` or direct `for...of`, and the same fix must be mirrored in `apps/mercato` and `packages/create-app/template` copies.

**Applies to**: `scripts/dev.mjs`, `apps/mercato/scripts/dev.mjs`, `packages/create-app/template/scripts/dev.mjs`, and `packages/create-app/template/scripts/dev-runtime.mjs`.

## Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings

**Context**: The compact splash runtime promoted any raw log line containing `failed` or `Error:` into a blocking startup failure.

**Problem**: Non-fatal search/vector warnings such as `[SearchService] Strategy index failed ...` and `[search.customers] Failed to load ...` flipped setup/dev splash screens into a blocking error even after Next had become ready. Once warmup later succeeded, the splash still looked like launch had failed.

**Rule**: Splash startup classification must keep an explicit allowlist for known non-blocking runtime warnings, and once launch is already ready/warmed the splash must not demote the session back to failed because of later raw output. Keep this policy mirrored between the monorepo runtime and the standalone template copy.

**Applies to**: `apps/mercato/scripts/dev.mjs`, `apps/mercato/scripts/dev-runtime-log-policy.mjs`, `packages/create-app/template/scripts/dev-runtime.mjs`, and `packages/create-app/template/scripts/dev-runtime-log-policy.mjs`.

## `dbMigrate` must not write migration snapshots during initialize flows

**Context**: A branch change started passing a custom MikroORM `snapshotName` into `dbMigrate`, while `yarn initialize` always runs `dbMigrate`.

**Problem**: Fresh initialize/reinstall flows began rewriting per-module `.snapshot-*.json` files as a side effect, creating noisy git diffs unrelated to the migration application itself.

**Rule**: Keep stable snapshot naming for `dbGenerate`, but disable migration snapshots for `dbMigrate` (`snapshot: false`) so initialize applies committed migrations without mutating snapshot files.

**Applies to**: `packages/cli/src/lib/db/commands.ts` and any future init/bootstrap flow that calls `dbMigrate`.

## Standalone generators must reuse package-generated entity metadata instead of parsing compiled `dist` files

**Context**: The standalone `create-app` flow generates app-local `.mercato` artifacts while official packages are consumed from `node_modules`.

**Problem**: The entity-id generator parsed exported classes and property declarations from module entity files. That works against monorepo `src` files, but compiled `dist/modules/**/data/entities.js` files do not preserve that source shape, so standalone generation silently dropped package entities like `organization`.

**Rule**: In standalone mode, when building app-level generated entity IDs/field shims for package-backed modules, prefer the package's shipped `generated/entities.ids.generated.ts` and `generated/entities/*/index.ts` artifacts. Do not rely on parsing compiled `dist` entity files for source-level declarations.

**Applies to**: `packages/cli/src/lib/generators/entity-ids.ts` and standalone `create-app` generation paths.

## Standalone scaffolding and generators must not assume monorepo-only paths

**Context**: Separately, the standalone `yarn generate` OpenAPI bundle still looked for `packages/shared`, `apps/mercato`, and `tsconfig.base.json`.

**Problem**: Newly scaffolded apps - `yarn generate` printed noisy OpenAPI bundle resolution errors before falling back.

**Rule**: For standalone app flows, do not hardcode monorepo paths; CLI generators must resolve app/package paths through the shared resolver (`getRootDir()`, `getAppDir()`, `getPackageRoot()`) instead of constructing `packages/*` or `apps/mercato/*` paths directly.

**Applies to**: `packages/create-app/**`, `packages/cli/**`, standalone app smoke tests, and any generator/bundler that runs inside installed npm packages.

## Store global event bus in `globalThis` to survive module duplication in dev

**Context**: `record_locks` notifications stopped while banners still worked. Banner logic uses direct API polling, but notifications depend on `emitRecordLocksEvent()` from `createModuleEvents()` and the global event bus wiring.

**Problem**: In dev (HMR/Turbopack), duplicated module instances can appear. One instance receives `setGlobalEventBus()` during bootstrap, another instance emits events. With module-local singleton only, emitted events can be dropped silently.

**Rule**: For process-wide runtime singletons used across package boundaries (event bus, similar registries), keep canonical reference in `globalThis` and use module-local variable only as fallback.

**Applies to**: `packages/shared/src/modules/events/factory.ts` and any shared runtime singleton relied on by module auto-discovery/subscriber pipelines.

## Feature-gated runtime helpers must use wildcard-aware permission matching

**Context**: ACL wildcard grants like `customer_accounts.*` correctly passed server-side checks, but several shared UI/runtime helpers still gated behavior with exact `includes` or `Set.has` checks.

**Problem**: Navigation, notification handlers, mutation guards, and command interceptors could silently disappear or stop running even though the user had a valid wildcard permission from RBAC.

**Rule**: Any feature-gated helper outside the core RBAC service must use the shared wildcard-aware matcher (`hasFeature` / `hasAllFeatures`) instead of ad hoc exact-match checks such as `features.includes(...)`, `set.has(...)`, or `every(...includes(...))`.

**Additional rule**: Do not assume every `granted` feature array is normalized to exact requested ids. Some flows return exact feature-check responses, while others pass through stored wildcard ACLs or resolved feature snapshots. Runtime helpers must treat all granted-feature arrays as wildcard-capable input.

**Applies to**: Navigation builders, injected menu filtering, notification dispatchers, mutation guards, command interceptors, and similar client/server ACL-driven registries.

## Always propagate structured conflict payload from `onBeforeSave` blockers

**Context**: Conflict handling in record locks had two paths: preflight `onBeforeSave` and real mutation `save` response. UI recovered conflict dialog only from save error path.

**Problem**: When conflict was blocked in preflight, users could hit dead-end loops (`Keep editing` / `Keep my changes`) because the dialog state was not rehydrated with full conflict payload.

**Rule**: Any blocking `onBeforeSave` result must carry machine-readable `details` (code + payload), and `CrudForm` must route it through the same global save-error recovery channel as normal save failures.

**Applies to**: Injection widgets that gate save (`WidgetBeforeSaveResult`) and conflict-capable modules (record locks, future optimistic concurrency widgets).
## MUST use Button and IconButton primitives — never raw `<button>` elements

**Context**: The codebase was refactored to replace all raw `<button>` elements with `Button` and `IconButton` from `@open-mercato/ui/primitives`. This ensures consistent styling, focus rings, disabled states, and dark mode support across the entire application.

**Rules**:

1. **Never use raw `<button>` elements** — always use `Button` or `IconButton` from `@open-mercato/ui`.
2. **Use `IconButton` for icon-only buttons** (no text label, just an icon). Use `Button` for everything else (text-only, icon+text, or any button with visible label content).
3. **Always pass `type="button"` explicitly** unless the button is a form submit (`type="submit"`). Neither `Button` nor `IconButton` sets a default type, so omitting it defaults to `type="submit"` per HTML spec, which can cause accidental form submissions.
4. **Tab-pattern buttons** using `variant="ghost"` with underline indicators MUST include `hover:bg-transparent` in className to suppress the ghost variant's default `hover:bg-accent` background.
5. **For compact inline contexts** (tag chips, toolbar buttons, inline list items), add `h-auto` to className to override the fixed height from size variants.

**Button variants and sizes quick reference**:

| Component | Variants | Sizes | Default |
|-----------|----------|-------|---------|
| `Button` | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | `default` (h-9), `sm` (h-8), `lg` (h-10), `icon` (size-9) | `variant="default"`, `size="default"` |
| `IconButton` | `outline`, `ghost` | `xs` (size-6), `sm` (size-7), `default` (size-8), `lg` (size-9) | `variant="outline"`, `size="default"` |

**Common patterns**:
- Sidebar/nav toggle: `<IconButton variant="outline" size="sm">`
- Close/dismiss: `<IconButton variant="ghost" size="sm">` with `<X />` icon
- Tab navigation: `<Button variant="ghost" size="sm" className="h-auto rounded-none hover:bg-transparent border-b-2 ...">`
- Dropdown menu items: `<Button variant="ghost" size="sm" className="w-full justify-start">`
- Toolbar formatting buttons: `<Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs">`
- Muted section headers: `<Button variant="muted" className="w-full justify-between">`

**Applies to**: All UI components across `packages/ui`, `packages/core`, and `apps/mercato`.

## WeakSet-based circular reference detection drops shared (non-circular) object references

**Context**: The CLI OpenAPI generator (`packages/cli/src/lib/generators/openapi.ts`) used a `WeakSet` in `safeStringify` to detect circular references during JSON serialization. The `zodToJsonSchema` converter uses a `WeakMap` memo cache that returns the same JS object reference for identical Zod schema instances (e.g., `currencyCode` shared between quote and line item schemas).

**Problem**: The `WeakSet` treated shared-but-non-circular references as circular, dropping them on second encounter. This caused properties like `currencyCode` to vanish from nested schemas in the generated `openapi.generated.json`. The line item schema was missing required fields, which misled AI agents and broke API payload construction.

**Rule**: When detecting circular references in JSON serialization, use stack-based ancestor tracking (checking only the current path from root to node) instead of a `WeakSet` (which tracks all previously visited nodes globally). Shared references are legitimate and must be cloned, not dropped.

**Applies to**: Any serialization code that processes object graphs with shared references (common in Zod schema conversions, AST tools, and dependency graphs).

## Tool-scoped regeneration commands must not be blocked by unrelated existing files

**Context**: `yarn mercato agentic:init --tool=<tool>` is meant to support incremental setup of one coding tool at a time, including retroactive setup from the splash screen.

**Problem**: A broad "any agentic file exists" guard causes false positives. Existing `.codex` files should not block adding Cursor, and existing Cursor files should not block adding Claude Code.

**Rule**: When a CLI/setup command supports scoped tool selection, preflight "already configured" checks must be scoped to the selected tool's own files, not the union of all tool outputs.

**Applies to**: `packages/cli/src/lib/agentic-init.ts` and any future tool-scoped bootstrap or regeneration commands.

## Inject TypeScript types into LLM tool descriptions for correct API payloads

**Context**: The AI Code Mode tools (`search` + `execute`) require the LLM to construct API payloads. When the LLM must query a separate tool to discover schema fields and then mentally translate a compact JSON format, it frequently constructs wrong payloads and enters debug spirals (20+ tool calls, 50+ API requests).

**Problem**: Without inline type information, the LLM guesses field names and structures, sends bad payloads, gets 400 errors, then experiments with variations — wasting tokens and user time.

**Rule**: For LLM-facing tools that construct structured API calls, pre-generate compact TypeScript type stubs from the OpenAPI spec at startup and inject them directly into the tool description. This mirrors Cloudflare's `generateTypes()` pattern. The LLM sees the correct types immediately without needing an extra discovery step.

**Applies to**: Any AI tool that requires the LLM to construct structured payloads (API calls, database queries, form submissions).

## Do not rasterize untrusted uploads through sunsetted external converters

**Context**: The attachments module OCR path rasterized uploaded PDFs through `pdf2pic -> gm -> Ghostscript` before sending page images to the LLM.

**Problem**: Deprecated converters and delegate-based document parsers expand the attack surface for untrusted uploads and can introduce host-level RCE chains outside the TypeScript codebase.

**Rule**: For untrusted uploads, do not introduce or keep sunsetted external converter chains (for example `pdf2pic`, `gm`, or Ghostscript delegates) in default request/background pipelines. Prefer native parsers, best-effort text extraction, or isolated sandboxed workers. If the safer path is not ready, disable the risky format-specific processing rather than keeping it enabled.

**Applies to**: `attachments`, document preview/thumbnail pipelines, OCR services, importers, and any future upload-processing worker.

## Format Zod validation errors for LLM consumption

**Context**: When the API returns 400 errors with raw Zod validation output (nested `issues[]` arrays, `fieldErrors` maps, or raw arrays), the LLM struggles to interpret the error structure and extract actionable fix instructions.

**Problem**: The LLM sees verbose JSON like `[{"code":"invalid_type","expected":"string","path":["lines",0,"currencyCode"]}]` and may not correctly identify which field to fix, leading to trial-and-error debugging.

**Rule**: Format validation errors into a concise human-readable string before returning to the LLM. Handle all Zod error formats (v3 `issues[]`, v4 `fieldErrors`/`formErrors`, raw arrays) and produce fix instructions like `"Validation failed — lines[0].currencyCode: expected string. Fix the listed fields and retry."` Fall back to `JSON.stringify` for unrecognized formats.

**Applies to**: Any AI-facing API wrapper that surfaces validation errors to an LLM agent.

## MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing

**Context**: `@PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })` configures PostgreSQL to generate UUIDs at INSERT time. When `em.create(Entity, data)` is called without an explicit `id`, the entity's `id` field is `undefined` until `em.flush()` executes the INSERT.

**Pr…68 tokens truncated…c_akeneo/lib/first-import.ts`, and worker-backed progress UI across the platform.

## Keep standalone agentic content in sync with module conventions

**Context**: `packages/create-app/agentic/` contains purpose-built AI coding tool configurations for standalone Open Mercato apps (AGENTS.md, CLAUDE.md, entity-migration hooks, Cursor rules, Codex enforcement rules). This content is separate from the monorepo's `.ai/` folder.

**Problem**: When module conventions change (entity lifecycle, auto-discovery paths, CLI commands, `yarn generate` behavior), the standalone agentic content can drift, causing AI tools to give incorrect guidance or hooks to miss new patterns.

**Rule**: When changing module conventions that affect standalone app developers — entity/migration workflow, auto-discovery file conventions, CLI commands, `yarn generate` behavior — also update the corresponding content in `packages/create-app/agentic/` (shared AGENTS.md.template, tool-specific rules/hooks).

**Applies to**: `packages/create-app/agentic/shared/`, `packages/create-app/agentic/claude-code/`, `packages/create-app/agentic/codex/`, `packages/create-app/agentic/cursor/`.

## Detail sections must route writes through page-level guarded mutations

**Context**: Customer detail sections introduced canonical interaction writes in local hooks and components while the surrounding backend pages already had mutation-injection context for record locks and retry flows.

**Problem**: Raw `apiCall` or CRUD-helper writes from detail sections bypass `useGuardedMutation`, so lock/conflict hooks never see those saves. Separately, showing flash messages in both the data hook and the section UI produces duplicate toasts for one mutation.

**Rule**: In backend detail pages, the page owns `useGuardedMutation` and passes a guarded mutation runner into child sections. Data hooks should execute the network call and refresh state, while the section or presenter owns user-facing flash messages so each mutation emits one toast.

**Applies to**: `packages/core/src/modules/customers/components/detail/**/*`, customer detail pages, and any future backend section that performs manual writes outside `CrudForm`.

## Workspace packages with backend pages must build and export deep TSX entrypoints

**Context**: The new `@open-mercato/webhooks` workspace package exposed backend pages through generated imports like `@open-mercato/webhooks/modules/webhooks/backend/webhooks/page`, but the package build only compiled `src/**/*.ts` and the export map stopped before the deepest generated paths.

**Problem**: `yarn build:app` failed even though generation succeeded, because the generated app imported real package entrypoints that were neither emitted to `dist/` nor resolvable through `package.json` exports.

**Rule**: Any workspace package that contributes auto-discovered backend/frontend pages must compile both `.ts` and `.tsx` sources into `dist/`, and its export map must cover the deepest generated import paths used by `modules.generated.ts`.

**Applies to**: `packages/webhooks/build.mjs`, `packages/webhooks/package.json`, and future feature packages that expose generated page modules.

## MikroORM string defaults must be plain values, not pre-quoted SQL fragments

**Context**: The webhooks module declared text defaults as `"'pending'"`, `"'POST'"`, and `"'http'"` in entity metadata.

**Problem**: MikroORM treated those values as literal strings and generated migration SQL with doubled quotes like `default ''pending''`, which broke `yarn initialize` when PostgreSQL tried to create the tables.

**Rule**: For `@Property(... default: ...)` on string/text columns, pass the plain value such as `'pending'` or `'POST'`. Use `defaultRaw` only when you intentionally need a database expression.

**Applies to**: `packages/webhooks/src/modules/webhooks/data/entities.ts` and future MikroORM entities with string defaults.

## Client injection hooks must tolerate late registry registration

**Context**: The integrations detail page relied on provider-injected tabs for webhook settings and aggregated logs. In the browser, generated injection tables and widgets were present, but some pages could still render without injected content on the first client pass.

**Problem**: `useInjectionWidgets()` and `useInjectionSpotEvents()` could read the injection registry before client bootstrap finished registering generated tables/widgets, cache an empty result, and never retry. That left valid widgets invisible until a hard refresh or unrelated rerender.

**Rule**: Client-side injection hooks must react to registry registration changes. When bootstrap registers core injection widgets/tables, invalidate loader caches and notify hooks so they reload instead of permanently caching an empty registry snapshot.

**Applies to**: `packages/shared/src/modules/widgets/injection-loader.ts`, `packages/ui/src/backend/injection/InjectionSpot.tsx`, and any future client hook that reads generated registries during hydration.

## New shared deep import paths should get explicit export-map entries

**Context**: A new shared utility under `@open-mercato/shared/lib/events/patterns` built correctly, but sibling workspace tests failed to resolve it through the package name.

**Problem**: Generic wildcard export rules are not always enough for every tool in the workspace, especially test runners resolving package subpaths across linked workspaces. That turns a valid refactor into a package-resolution failure.

**Rule**: When adding a new shared utility intended for cross-package imports, add an explicit `package.json` export entry for the new subpath instead of relying only on broad wildcard export patterns.

**Applies to**: `packages/shared/package.json` and future cross-package utilities added under new `@open-mercato/shared/lib/*` paths.
## Use `safeExtend()` when composing refined Zod object schemas

**Context**: Checkout pay-link validators extended a schema that already contained `superRefine(...)` rules.

**Problem**: Zod v4 throws at runtime when `.extend()` is used on object schemas that contain refinements. This broke both OpenAPI generation and app initialization with `Object schemas containing refinements cannot be extended`.

**Rule**: Any time a Zod object schema has refinements (`refine`, `superRefine`, similar), compose follow-up schemas with `.safeExtend()` instead of `.extend()`.

**Applies to**: Module validators, generated OpenAPI bundling, bootstrap/init code paths, and any schema reuse chain built on refined objects.

## Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist

**Context**: `@open-mercato/checkout` emitted `import "./commands"` into dist because its build post-processing only rewrote `from` and dynamic imports. `@open-mercato/gateway-stripe` declared `"watch": "node watch.mjs"` without a `watch.mjs` file.

**Problem**: Dev boot failed on unsupported directory ESM imports, and `yarn watch:packages` aborted immediately on the missing watch entrypoint.

**Rule**: For package-local build scripts, handle all three relative import forms when fixing ESM output: static `from`, dynamic `import(...)`, and bare side-effect `import "..."`. If a package exposes a `watch` script, keep a real `watch.mjs` entrypoint committed alongside `build.mjs`.

**Applies to**: Workspace packages with custom `build.mjs` / `watch.mjs` tooling and any new ESM package added to the monorepo.

## Use canonical generated entity ids, not shortened ad-hoc aliases

**Context**: Checkout used shortened ids like `checkout:link` and `checkout:transaction`, while the generated canonical ids for its ORM entities are `checkout:checkout_link` and `checkout:checkout_transaction`.

**Problem**: Query/index/search/encryption helpers rely on canonical entity ids to infer table names and registry metadata. The shortened aliases pushed reindexing toward `links` instead of `checkout_links` and silently diverged from the generated contract.

**Rule**: For ORM-backed entities, use the generated canonical entity ids consistently across CRUD indexers, search config, translations, encryption defaults, and custom-entity declarations. Do not invent shorter aliases unless the platform explicitly supports them everywhere.

**Applies to**: Any module that participates in generated entity ids, query index/search, translations, encryption maps, or custom field registration.

## Prefer relative intra-package imports inside package CLI/runtime entrypoints

**Context**: The core entities CLI imported its own package internals through `@open-mercato/core/...` aliases.

**Problem**: Dist-time ESM resolution became brittle in initialization flows and failed to resolve package-internal files that were present locally.

**Rule**: Inside a package's own CLI/runtime entrypoints, prefer local relative imports for same-package modules instead of going back through the package alias, unless that alias path is explicitly part of the public runtime contract.

**Applies to**: `cli.ts`, bootstrap helpers, package-local scripts, and other runtime entrypoints executed directly from dist.

## Global registries in publishable packages must use `globalThis`, not module-local state

**Context**: Standalone `create-mercato-app` loaded `@open-mercato/shared/lib/db/mikro` through multiple server chunk/module instances while the monorepo dev app used a single source-tree instance.

**Problem**: Bootstrap registered ORM entities in one module instance, but `/api/events/stream` created a request container through another instance. Because the entity registry lived in a module-local variable, the second instance saw an empty registry and crashed with `[Bootstrap] ORM entities not registered`.

**Rule**: Any publishable cross-package registry that must be visible across bootstrap, API routes, and request containers must persist via `globalThis` with a stable key. Do not store bootstrap-critical registries only in module-local variables.

**Applies to**: ORM/entity registries, DI registrars, module registries, and other standalone-sensitive bootstrap state in `@open-mercato/*` packages.

## Generator manifests must fall back to source parsing when runtime-importing TS modules is fragile

**Context**: Module registry generation tried to discover subscriber, worker, and API-route metadata by runtime-importing source files. In optimized dev/build flows, those imports can fail because sibling TS-only dependencies are not executable in that context yet.

**Problem**: When metadata import failed, generated manifests silently lost event bindings or route `metadata.path` overrides. That broke query-index subscribers, produced wrong API paths like `/shipping_carriers/...`, and surfaced as dev-time `MODULE_NOT_FOUND` errors from generated registries.

**Rule**: For generator-time metadata discovery, use runtime imports when they work, but always keep a source-level fallback for stable static exports such as `metadata`. Generation must stay deterministic even when the source module itself is not directly executable.

**Applies to**: `packages/cli` generators that inspect module files, especially subscribers, workers, API routes, and other static manifest inputs.

## Standalone module discovery must treat published `src/modules` as canonical over `dist/modules`

**Context**: The standalone CLI scans installed packages under `node_modules/@open-mercato/*`. Published packages include compiled `dist/modules` output and also ship `src/modules`.

**Problem**: Using `dist/modules` as the discovery source pulled in two classes of bad inputs that do not appear in monorepo source mode: helper files compiled from `.ts` to lower-case `.js` under `frontend/` and `backend/`, and stale dist-only artifacts such as legacy API handlers that no longer exist in `src/modules`. That produced bogus generated routes/imports and standalone-only build failures.

**Rule**: In standalone generation, use the package's `src/modules` tree as the canonical discovery mirror when it exists, but keep runtime imports pointed at compiled `dist` files. Do not let dist-only artifacts or extension changes in compiled output redefine what counts as a route, API file, or convention file.

**Applies to**: `packages/cli` module scanning, route/API discovery, standalone create-app flows, and any generator that inspects installed `@open-mercato/*` packages.

## Standalone source-mirror discovery must remap source extensions to runtime files

**Context**: Published packages can ship `src/modules/**/*.ts` alongside compiled `dist/modules/**/*.js`. Generators may discover convention files from the source mirror while runtime bootstrap imports the compiled package exports.

**Problem**: If standalone discovery finds `src/modules/configs/cli.ts` and then validates that exact relative path under `dist/modules`, the check fails because the runtime file is `cli.js`. The module then silently loses CLI/setup/ACL and other convention registrations in `modules.cli.generated.ts`, which breaks bootstrap-only flows like `yarn setup`.

**Rule**: When discovery uses a standalone source mirror, resolve the logical file from `src`, then remap it to the matching compiled file in `dist` by basename, not by keeping the source extension. Discovery and runtime paths must stay logically aligned even when `.ts` becomes `.js`.

**Applies to**: `packages/cli` `resolveModuleFile()`, standalone module registry generation, CLI bootstrap generation, and any future source-mirror-based convention file lookup.

## Auto-discovered DataTable fields must only advertise controls the table can actually honor

**Context**: The customer grids auto-discovered custom fields into the advanced-filter builder and column chooser, but the table pages only registered `listVisible` custom columns. Hidden-but-selectable fields like `cf_executive_notes` appeared in the chooser without a matching TanStack column id.

**Problem**: The chooser could surface legitimate field labels that crashed at toggle time with `Column with id 'cf_executive_notes' does not exist`, because discovery and actual column registration drifted apart.

**Rule**: When a DataTable auto-discovers fields from entity/custom-field metadata, keep the discovery surface aligned with the concrete column registry. If a field should be selectable later, register a real hidden column for it; otherwise keep it out of chooser/filter discovery entirely.

**Applies to**: `DataTable` auto-discovery, custom-field-backed list pages, and any future metadata-driven chooser/filter UI.

## Mixed advanced filters need per-row join state, not one shared logic flag

**Context**: The advanced-filter builder initially stored a single `logic` value for the whole filter state and reused it for every non-first row.

**Problem**: Toggling one row from `And` to `Or` changed every row, making mixed expressions impossible and causing the backend to over-collapse distinct filter rows into one global boolean mode.

**Rule**: For row-based filter builders, store the boolean connector on each non-first condition and keep any old global logic only as backward-compatible fallback when reading legacy URLs or state.

**Applies to**: Shared advanced-filter state, URL serialization/deserialization, and any future query-builder UI that supports multiple rows.

## dnd-kit contexts rendered in SSR need stable ids

**Context**: The advanced datatable uses dnd-kit for header and column-chooser drag-and-drop, and those contexts are rendered during SSR on backend pages.

**Problem**: Letting dnd-kit generate its own accessibility ids caused server/client `aria-describedby` mismatches, which showed up as React hydration errors on customer grid pages even though the table still rendered.

**Rule**: Whenever a dnd-kit `DndContext` can be server-rendered, pass a deterministic `id` derived from stable page/table identity instead of relying on auto-generated ids.

**Applies to**: `DataTable` header drag-and-drop, column chooser drag-and-drop, and any future SSR-rendered dnd-kit surface.

## Lazy provider wrappers must not render provider-dependent children before the provider loads

**Context**: Backend chrome hydration moved the AI assistant header integration behind a client-only lazy wrapper that imported the provider component asynchronously.

**Problem**: The wrapper rendered `children` during the loading state, so provider-dependent descendants like `AiChatHeaderButton` mounted before `CommandPaletteProvider` existed and threw runtime context errors.

**Rule**: When a wrapper lazily imports a context provider or integration shell, render nothing or a provider-safe placeholder until the provider is ready. Never render children early if they may call hooks from that provider.

**Applies to**: Client-only integration shells, lazy provider wrappers, and any async-loaded context boundary in backend or portal chrome.

## Hydrated backend chrome payloads must receive the original request for scope-aware RBAC

**Context**: The backend sidebar/header payload moved from server layout assembly to `/api/auth/admin/nav` + client hydration, while org/tenant scope still depends on request cookies and headers.

**Problem**: If the original request is not forwarded into payload resolution, selected org/tenant scope falls back to account defaults, which can empty `grantedFeatures` for the active scope and remove every `requireFeatures` sidebar route.

**Rule**: Any server helper that resolves scoped backend chrome, navigation, or ACL-derived payloads must receive the original `Request` whenever scope can depend on cookies, forwarded headers, or query params.

**Applies to**: Backend chrome payload builders, scoped sidebar/header APIs, organization-aware RBAC helpers, and any refactor that moves scope-sensitive work behind an API boundary.

## Sidebar hydration must preserve the exact RBAC inclusion semantics of the server layout

**Context**: The server-rendered backend layout previously decided sidebar route visibility by calling `rbac.userHasAllFeatures(...)` per route requirement. A hydration refactor replaced that with local matching against `loadAcl().features`.

**Problem**: Even when the raw ACL snapshot looked sparse or scope-normalized differently, the original per-feature RBAC checks could still grant routes. Replacing that logic caused `requireFeatures` sidebar items to disappear after the refactor.

**Rule**: When moving sidebar/header resolution into a shared payload builder or API, keep route inclusion logic behaviorally identical to the previous RBAC gate. Do not replace `userHasAllFeatures(...)` checks with ad hoc filtering against a cached/raw feature array unless equivalence is proven with regression tests.

**Applies to**: Backend chrome payload builders, nav hydration refactors, sidebar route filtering, and any future optimization that tries to replace RBAC service checks with local feature matching.

## Route-aware backend chrome should use route manifests, not the full module registry

**Context**: The app bootstrap has two generated module manifests: the full `modules.generated.ts` and the lighter `modules.app.generated.ts`, while route-aware consumers already have dedicated generated manifests such as `backend-routes.generated.ts`.

**Problem**: Hydrated sidebar work was refactored to call `getModules()` for route data, which forced bootstrap onto the full module manifest and regressed the original fast-path split between app bootstrap and route manifests.

**Rule**: Backend chrome, breadcrumbs, static settings path discovery, and other route-aware consumers should read `backend-routes.generated.ts` or `getBackendRouteManifests()`. Keep `modules.app.generated.ts` in bootstrap unless the caller truly needs the full module registry beyond route manifests.

**Applies to**: `apps/*/src/bootstrap.ts`, backend layouts, hydrated sidebar/header APIs, route matching helpers, and any future performance optimization around generated registries.

## When a task brief requires Playwright coverage, unit tests are not a substitute

**Context**: `packages/search/src/lib/merger.ts` received new Jest coverage, but the task brief and QA guides explicitly required module-local Playwright integration coverage.

**Problem**: The branch still failed review because the required coverage class was missing even though the low-level tests passed.

**Rule**: When a task brief, review artifact, or QA guide says Playwright or integration coverage is required, add or update a module-local `__integration__/TC-*.spec.ts` in the same change. Treat Jest or other low-level tests as complementary, not a replacement.

**Applies to**: HackOn implementation tasks and any change governed by `.ai/qa/AGENTS.md` or `.ai/skills/integration-tests/SKILL.md`.

## Provider credentials must never control authenticated cross-origin requests

**Context**: The Akeneo client accepted an arbitrary tenant-provided `apiUrl` and also trusted absolute pagination or download URLs returned by the remote API.

**Problem**: A malicious or mistyped host could turn OAuth password-grant login into credential exfiltration, and hostile `next` or media download links could pivot authenticated bearer-token requests to a different origin.

**Rule**: For integration providers, normalize and validate the configured base URL server-side before any network call, restrict it to an operator-owned allowlist plus a safe scheme/origin shape, build OAuth endpoints from fixed paths, and reject any absolute follow-up URL whose origin differs from the validated provider origin.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts`, provider-specific HTTP clients, OAuth/token helpers, pagination cursors, media download helpers, and any future integration that consumes remote absolute URLs.
## Never guard sensitive routes with `requireRoles` on mutable role names

**Context**: Feature toggles routes were guarded with `requireRoles: ['superadmin']`. Since role names are user-editable, a tenant admin with `auth.roles.manage` could create a role named "superadmin" and escalate privileges — even though reserved-name validation blocked the exact attack, the architecture remained fragile.

**Problem**: `requireRoles` checks mutable string names against the auth context. If the reserved name list has a gap or a new privileged name is introduced, the same privilege escalation pattern reappears.

**Rule**: Always use `requireFeatures` with immutable feature IDs (declared in `acl.ts`) instead of `requireRoles` for access control. Reserve `requireRoles` only for truly exceptional, well-documented cases. When adding a new module, declare granular features in `acl.ts` and wire `defaultRoleFeatures` in `setup.ts` — never ship an empty `acl.ts` with `requireRoles` guards.

**Applies to**: All API routes, backend page metadata (`page.meta.ts`), and any runtime access control check.

## Standalone template env examples must mirror security-sensitive app env keys

**Context**: Payment gateway webhook hardening introduced `MOCK_GATEWAY_WEBHOOK_SECRET` as the explicit non-production signing secret for the mock gateway. The monorepo app `.env.example` documented it, but the standalone template `.env.example` did not.

**Problem**: Standalone parity and local generated apps can silently miss required security-sensitive env keys even when the monorepo app documents them, leading to standalone-only regressions that look like product bugs.

**Rule**: When a feature adds a new app-level env var required for local, test, or non-production behavior, update both `apps/mercato/.env.example` and `packages/create-app/template/.env.example` in the same change. If standalone CI/bootstrap scripts synthesize `.env`, set the same var there explicitly too.

**Applies to**: `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, create-app smoke/parity scripts, and any new env-backed local/testing security feature.
