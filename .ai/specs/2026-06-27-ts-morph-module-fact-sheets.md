# ts-morph Module Fact-Sheets — Generated Standalone Guides

- **Status:** Proposed (design only — not yet implemented)
- **Date:** 2026-06-27
- **Scope:** OSS — `packages/create-app` agentic guide generation + a reusable `packages/cli` generator
- **Related:** `packages/create-app/build.mjs`, `packages/create-app/src/setup/tools/shared.ts`, `packages/create-app/agentic/shared/AGENTS.md.template`, `BACKWARD_COMPATIBILITY.md`, `packages/cli/src/lib/generators/{entity-ids,module-di,extensions/events}.ts` (existing ts-morph AST infra)

## TLDR

The standalone-app AI guides are hand-written per module and have already rotted (a customers guide documents a `makeCrudRoute` import path that does not exist). Replace the **9 per-module** hand-written guides with: (1) **one** hand-written conceptual guide (`module-system.md`) and (2) **per-module fact-sheets generated from source via ts-morph** that carry only the stable contract surface (entity IDs, events, ACL features, API routes, DI service tokens, searchable entities, table/entity IDs, notifications, CLI). The extractor is a `packages/cli` generator reusing existing AST infra; it is invoked at `create-app` build time (bundling facts for scaffolded apps) **and** in the monorepo `yarn generate` (committing `module-facts.json` for first-party skills + a BC guard). Output is Markdown + a JSON sidecar. First cut targets the same **9 user-facing modules** that have guides today; the other 29 core modules are out of scope. The scaffolded app's `AGENTS.md` Module-Specific Guides table is **generated per app from the enabled module set** (D6) rather than a static "(if available)" list, and `shared.ts` copies only the enabled modules' fact-sheets.

## 1. Problem

Standalone apps scaffolded by `create-mercato-app` ship AI-coding guides under `.ai/guides/`. Today there are **16 hand-written `agentic/standalone-guide.md` files**: **9 module-level** (auth, catalog, currencies, customer_accounts, customers, data_sync, integrations, sales, workflows) and **7 package-level** (cache, core, events, queue, search, shared, ui). `build.mjs` auto-discovers them; `shared.ts` copies them into the app. The model has three structural defects:

1. **They drift from the code.** Hand-written prose is never re-derived from source, so it rots. Confirmed example: `core.customers.md` documents
   ```ts
   makeCrudRoute({ entity, entityId, operations })   // from '@open-mercato/shared/lib/crud/make-crud-route'
   ```
   The import path **does not exist** and the real signature is `makeCrudRoute({ metadata, orm, list, create, update, del, indexer })` from `@open-mercato/shared/lib/crud/factory`. An agent following the guide writes code that does not compile.

2. **Triple duplication of "how a module is structured."** The same prose lives in (a) `agentic/shared/AGENTS.md.template` (Module Anatomy + Mandatory Mechanisms), (b) the package guide `core.md` (Auto-Discovery + Module Files), and (c) each per-module guide. Three copies, each aging independently.

3. **No machine-readable module facts.** An agent in a standalone app consuming `@open-mercato/core` has no authoritative list of the installed modules' **entity IDs, event IDs, ACL features, API routes, DI service tokens, searchable entities, or table/entity IDs**. It must guess or grep compiled `.js` in `node_modules`.

## 2. Goals / Non-Goals

**Goals**
- Replace the **9 per-module** hand-written guides with one hand-written conceptual guide plus **per-module fact-sheets generated from source via ts-morph**.
- Extract only the **stable contract surface** an external module needs to interoperate — nothing more.
- Generated facts **cannot drift from the source they were generated against** — they are re-derived from AST on every run (see Risk R1 for the version-skew bound this does *not* cover).
- The scaffolded app's `AGENTS.md` Task→Context map **routes module topics only at the fact-sheets for modules that app actually enables** (no dead "(if available)" rows for absent modules) — see Decision D6. Generic/conceptual rows (→ `module-system.md` + the retained package guides) stay static.

**Non-Goals**
- Not generating prose/tutorials. Conceptual "how-to" stays hand-written (one file) and in skills.
- Not extracting implementation bodies, business logic, validator internals, or per-field documentation.
- Not changing runtime behaviour of any module — this is a docs/tooling change only.
- The **7 package-level** guides for non-module packages (`cache`, `events`, `queue`, `search`, `shared`, `ui`) stay hand-written and are retained as-is (they are genuinely conceptual). See Deferred (§11) for a possible lighter generated surface later.
- First cut covers the **9 user-facing modules** that have guides today, not all **38** core modules (see Decision D5).

## 3. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Replace vs augment the per-module guides | **Replace** the 9 per-module prose guides with generated facts; keep one hand-written conceptual guide. |
| D2 | Where the extractor runs | **Build-time, in the monorepo**, as part of `create-app/build.mjs` (core module `.ts` sources are present there; standalone installs are compiled). |
| D3 | Output format | **Markdown fact-sheet + JSON sidecar** (`module-facts.json`) for programmatic use (skills, BC tests). |
| D4 | Monorepo emission (resolves former OQ2) | The extractor lives in `packages/cli` and **also runs in the monorepo `yarn generate`**, committing a **versioned** `apps/mercato/src/module-facts.generated.json` for first-party consumers (`om-onboarding`, the BC guard). It MUST NOT be written under `apps/mercato/.mercato/generated/` — that directory is git-ignored and wiped by `yarn clean-generated`, so a committed artifact cannot live there (see [Generated Files: versioned vs ephemeral](.ai/docs/module-development.md#generated-files-versioned-vs-ephemeral)). Same generator, two invocation sites (create-app `dist/` bundle + monorepo versioned file) — does not contradict D2. |
| D5 | Module scope of the first cut (resolves H1) | Generate fact-sheets for the **9 user-facing modules** that have guides today. The module list is an **explicit, configurable allowlist** in the extractor, not "every folder under `src/modules/`". Extending to the other 29 modules is a follow-up. |
| D6 | AGENTS.md module-guide routing (resolves the static-template gap) | The scaffolded `AGENTS.md`'s **Module-Specific Guides** table is **generated per app from the enabled module set**, not the current static 9-row list with "(if available)" hedges. `shared.ts` emits one row — and copies one fact-sheet — **per enabled module that has a fact-sheet**, pointing at `.ai/guides/modules/<module>.md`, with the hedge dropped (presence is guaranteed by construction). The generic/conceptual rows (→ `module-system.md` + the retained package guides `core.md`/`ui.md`/`events.md`/`search.md`/`cache.md`/`queue.md`/`shared.md`) stay **static** — this honors the §2 Non-Goal that keeps the 7 package guides, so "dynamic" is scoped to the genuinely per-module surface only. |

## 4. Architecture — two layers

### Layer 1 — one hand-written conceptual guide: `.ai/guides/module-system.md`
Single source of truth for "how an Open Mercato module is structured and how to build/extend one". Consolidates the prose currently split across `AGENTS.md.template`, `core.md`, and the per-module guides:
- auto-discovery paths (`api/`, `backend/`, `frontend/`, `subscribers/`, `workers/`, `widgets/`)
- module file anatomy + the **Mandatory Mechanisms** table (one canonical helper per concern)
- naming conventions, `withAtomicFlush` / entity-update safety, migration workflow

Hand-written because these are stable concepts requiring human judgement. Small, single, durable.

### Layer 2 — generated per-module fact-sheets: `.ai/guides/modules/<module>.md` (+ `module-facts.json`)
One compact file per **allowlisted** module (D5), containing **only facts extracted from source**. This set is intentionally **1:1 with the contract surfaces in `BACKWARD_COMPATIBILITY.md`** — that is the principled "useful, nothing more" boundary.

| Section | Authoritative source | Why an agent needs it |
|---|---|---|
| **Entities & IDs** — entity ID (`customers:customer_person_profile`) → class, table, user-editable (`updated_at` present), custom-fields enabled | a **3-way join**: the generated `E` registry (`entities.ids.generated.ts`, via the `entity-ids` generator) owns **ID ↔ class** in colon form (`E.customers.customer_person_profile === "customers:customer_person_profile"`); `data/entities.ts` `@Entity` decorators own **class ↔ table** + `updated_at` presence (these are NOT in `E`); `ce.ts` owns the custom-fields flag. **Entity IDs are NOT raw class names, and NOT the dotted friendly aliases** (e.g. `customers.person`) some enrichers use — the canonical interop ID is the `E` colon token. | reference entities by ID, tenant scoping, optimistic-lock awareness |
| **Events** — `id`, `label`, `category`, `entity` | `events.ts` (`createModuleEvents`) | subscribe / workflow triggers |
| **ACL features** | `acl.ts` (`features`) | `requireFeatures` gating |
| **API routes** — path, methods, per-method auth (`requireAuth` / `requireFeatures`) | the generated **module registry** `apis[].metadata` literal (`modules.runtime.generated.ts` / `modules.app.generated.ts`, emitted by `buildApiMetadataLiteral()`), which carries per-method `requireAuth`/`requireFeatures`/`requireRoles` — NOT the lightweight `api-routes.generated.ts` manifest, which only has `{ path, methods }` (see §5 caveat) | call the API, know its authz |
| **DI service tokens** — token name → registration kind, **services only** | `di.ts` — emit only function/class service registrations; **exclude entity-value registrations** (`asValue` on entity classes like `CustomerEntity`) which are not interop tokens | `container.resolve(token)` |
| **Searchable entities** | `search.ts` (`searchConfig.entities` keys) | know what is indexed |
| **Host extension points** — the module's stable `entityId` / `tableId` tokens | `backend/**` `DataTable` `tableId`/`extensionTableId` literals + the registered crud-form injection entity-type (the `E` id) | derive injection spot IDs by convention: `data-table:<tableId>:{columns,row-actions,bulk-actions,filters}`, `crud-form:<entityId>:fields`. (We extract the **tokens**, not a spot list — spot suffixes are framework conventions documented in Layer 1.) **Extraction caveat:** the `CrudForm` `entityId` *prop* on record/detail pages is a runtime record id (e.g. `personId`), NOT a stable type token — target `DataTable` table-id literals (e.g. `customers.people.list`) and the `E` entity id, not arbitrary `entityId=` occurrences. |
| **Notification IDs / CLI commands** | `notifications.ts`, `cli.ts` | notification + command surface |

**Explicitly NOT extracted:** function bodies, business logic, validator internals, prose. They are not needed to consume a module, they bloat context, and they would re-introduce drift.

## 5. Extraction implementation

- **Reuse existing infra.** `ts-morph` is already a `packages/cli` dependency, and the generators (`entity-ids.ts`, `extensions/events.ts`, `module-di.ts`, …) already parse exactly these declarations via AST using the helpers in `packages/cli/src/lib/generators/ast`. The extractor (`packages/cli/src/lib/generators/module-facts.ts`) reuses the same parser — no new dependency, one consistent AST reader. Living in `packages/cli` is what makes the dual invocation in D4 possible.
- **Entity-ID source.** The authoritative `entityId → class` mapping is the generated `E` registry (colon form, e.g. `E.customers.customer_person_profile === "customers:customer_person_profile"`), not raw `@Entity` decorators. The **table name and `updated_at` presence are NOT in `E`** — they come from the `@Entity` decorator + property AST in `data/entities.ts`, so the extractor joins `E` (ID↔class) with that AST (class↔table/`updated_at`). Note `CustomerEntity`/`customer_entities` is the base entity (`customers:customer_entity`), distinct from `customers:customer_person_profile`; and `customers.person` (dotted) is a friendly enricher alias, not an `E` ID. The extractor reuses the `entity-ids` generator's output rather than re-deriving IDs from class names.
- **DI extraction semantics.** `di.ts` registers both **services** (`asFunction`/`asClass`) and **entity values** (`asValue` on entity classes — confirmed in `customers/di.ts`: `CustomerEntity`, `CustomerAddress`, `CustomerInteraction`). Only service registrations are interop tokens; entity-value registrations MUST be filtered out.
- **CRUD route auth caveat.** For `makeCrudRoute` routes the `metadata` is computed by the factory at runtime (in customers it is `export const metadata = routeMetadata`). Re-deriving auth purely from AST is brittle. Resolution: read API-route auth from the **generated module registry** (`apps/mercato/.mercato/generated/modules.runtime.generated.ts`, or the eager `modules.app.generated.ts`), whose `apis[].metadata` literal — emitted by `buildApiMetadataLiteral()` in the module-registry generator — carries per-method `requireAuth`/`requireFeatures`/`requireRoles` after the factory has run (verified shape: `/customers/people` → `{"GET":{"requireAuth":true,"requireFeatures":["customers.people.view"]},"POST":{…"customers.people.manage"]},…}`). The lightweight `api-routes.generated.ts` manifest only carries `{ moduleId, kind, path, methods, load }` and **must not** be used for auth. (This is why the build step must run `generate` first.)
- **Invocation.** `build.mjs` calls the extractor over the D5 allowlist, emitting `dist/agentic/guides/modules/<module>.md` and `dist/agentic/guides/module-facts.json`; `shared.ts` copies them into the app's `.ai/guides/`. The monorepo `yarn generate` (D4) runs the same generator, writing the **versioned** `apps/mercato/src/module-facts.generated.json` for first-party consumers (never under `.mercato/generated/`).

## 6. Output shape

### Markdown (`.ai/guides/modules/customers.md`) — verified real data
```markdown
# customers — module facts (generated, do not edit)
<!-- generated from @open-mercato/core <version> — R1 staleness stamp -->

## Entities
| Entity ID                          | Class                  | Table              | Editable | CustomFields |
|------------------------------------|------------------------|--------------------|----------|--------------|
| customers:customer_person_profile  | CustomerPersonProfile  | customer_people    | yes      | yes          |
| customers:customer_company_profile | CustomerCompanyProfile | customer_companies | yes      | yes          |
| customers:customer_deal            | CustomerDeal           | customer_deals     | yes      | yes          |

## Events  (49)
| ID                       | Category  | Entity |
|--------------------------|-----------|--------|
| customers.person.created | crud      | person |
| customers.deal.won       | lifecycle | deal   |

## ACL features  (21)
customers.people.view · customers.people.manage · customers.companies.view ·
customers.companies.manage · customers.deals.view · customers.deals.manage ·
customers.settings.manage · customers.pipelines.view · customers.interactions.manage · …

## API routes
| Path                  | Methods             | Auth (per-method requireFeatures)                              |
|-----------------------|---------------------|----------------------------------------------------------------|
| /api/customers/people | GET POST PUT DELETE | GET → customers.people.view · POST/PUT/DELETE → customers.people.manage |
```
> Note the **two ID conventions**: entity IDs are **colon** (`customers:customer_person_profile`), event IDs are **dotted** (`customers.person.created`, per the `module.entity.action` rule). The extractor preserves each surface's native format rather than normalising them.

### JSON sidecar (`module-facts.json`) — programmatic source of truth
> This JSON is the **authoritative data contract** (§9 Data Models), populated from verified `customers` source. `diTokens` is empty because `customers/di.ts` registers only `asValue` entity classes (`CustomerEntity`, `CustomerAddress`, `CustomerInteraction`) and zero `asFunction`/`asClass` services — the service-only filter removes them all. `cli` is empty because `customers/cli.ts` ships seed/example data only and registers no commands.
```json
{
  "customers": {
    "coreVersion": "<@open-mercato/core version>",
    "entities": [
      { "id": "customers:customer_person_profile", "class": "CustomerPersonProfile",
        "table": "customer_people", "editable": true, "customFields": true }
    ],
    "events": [
      { "id": "customers.person.created", "category": "crud", "entity": "person" }
    ],
    "aclFeatures": ["customers.people.view", "customers.people.manage"],
    "apiRoutes": [
      { "path": "/api/customers/people", "methods": ["GET","POST","PUT","DELETE"],
        "auth": {
          "GET":  { "requireAuth": true, "requireFeatures": ["customers.people.view"] },
          "POST": { "requireAuth": true, "requireFeatures": ["customers.people.manage"] }
        } }
    ],
    "diTokens": [],
    "searchEntities": ["customers:customer_person_profile", "customers:customer_company_profile",
                       "customers:customer_comment", "customers:customer_deal",
                       "customers:customer_activity", "customers:customer_todo_link"],
    "hostTokens": { "entityIds": ["customers:customer_entity"], "tableIds": ["customers.people.list"] },
    "notifications": ["customers.deal.won", "customers.deal.lost"],
    "cli": []
  }
}
```

## 7. Wiring & backward compatibility

- `build.mjs`: add the extraction step alongside (then replacing) the `standalone-guide.md` discovery loop.
- `shared.ts` (**filtered copy — D6**): copy **only the enabled modules'** `modules/<module>.md` into `.ai/guides/modules/`, not the current blanket `readdirSync` over every bundled fact-sheet, plus the single combined `module-facts.json` at `.ai/guides/module-facts.json`. The package/conceptual guides (`core.md`, `ui.md`, …) are still copied wholesale — they are framework-wide, not per-module.
- `yarn generate` (monorepo, D4): emit the **versioned** `apps/mercato/src/module-facts.generated.json` for first-party consumers (not the git-ignored `.mercato/generated/`).
- `AGENTS.md.template` (**dynamic Module-Specific Guides — D6**): the generic Task→Context rows stay static and route conceptual/framework topics at `.ai/guides/module-system.md` and the retained package guides. The **Module-Specific Guides** subsection stops being a hardcoded 9-row "(if available)" table; `shared.ts` regenerates it from the app's enabled module set, emitting one `.ai/guides/modules/<module>.md` row per enabled module that has a fact-sheet. The block is delimited by marker comments (`<!-- om:module-guides:start -->` / `<!-- om:module-guides:end -->`) — the same marker-injection idiom the Codex generator already uses to patch `AGENTS.md` — so surrounding prose is untouched and `{{PROJECT_NAME}}` substitution is unaffected.
- **Enabled-module source (D6) — resolved mechanism.** `shared.ts` (and the retroactive `mercato agentic:init` path) **AST-parse the `enabledModules` array literal** in `targetDir/src/modules.ts` with ts-morph (already a `packages/cli` dependency), collect each entry's `id` string-literal, and **intersect with the D5 fact-sheet allowlist** — a module produces a row (and gets its fact-sheet copied) **only if it is in BOTH sets**. This file-read is the chosen mechanism **over** threading the set through `AgenticConfig` (today `{ projectName, targetDir }`), because `generateShared` runs from **two** invocation sites — the create-app wizard (`wizard.ts`) and `mercato agentic:init` (`packages/cli`) — and a single file-read keeps them from diverging. **Caveat (intentional):** the read sees only the **static array literal**, not the conditional `.push()` blocks or the `...officialModuleEntries` spread that follow it in `modules.ts`. This is correct here because all nine D5 modules (`auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are **static literal entries**, and a user disables a core module by deleting its literal line — which the AST read detects. Do **not** dynamically import `modules.ts`: at scaffold time the app's deps/env are not yet installed. Ordering is already satisfied — `scaffoldTemplateApp` writes `src/modules.ts` (in `index.ts`) **before** `maybeRunAgenticSetup` runs, and `agentic:init` runs entirely post-scaffold; R5's fallback to the full allowlist remains a belt-and-suspenders guard.
- **Generated-file contract (BC):** the template currently references the **9** `.ai/guides/core.<module>.md` paths. Per `BACKWARD_COMPATIBILITY.md` (generated file contracts), emit those legacy names as thin redirect stubs (`→ see modules/<module>.md`) for ≥1 minor version before removal, and note the deprecation in `RELEASE_NOTES.md`. **Scope clarification (GAP-D6-F):** a **fresh** D6 scaffold references neither the legacy `core.<module>.md` names nor their redirect stubs — the dynamic Module-Specific Guides block links only `modules/<module>.md`. The stubs exist **only** for apps upgrading in place (whose committed `AGENTS.md`/guides still point at the legacy names); confirm `build.mjs` still bundles them even though the D6 block never links them.
- Delete the **9** per-module `agentic/standalone-guide.md` files only after the generated equivalents land and the redirect stubs are in place. The **7** package-level guides are untouched.

## 8. Phasing

1. **Extractor** — `packages/cli/src/lib/generators/module-facts.ts` over the D5 allowlist: entities + events + ACL first (highest value, cleanest AST), then API routes (via manifest), DI services, search, host tokens, notifications/CLI. Wire into `yarn generate` (D4).
2. **Conceptual guide** — author `module-system.md` by consolidating existing prose; delete duplicated sections from `core.md`.
3. **Wiring** — `build.mjs` + `shared.ts` (filtered per-enabled-module copy, D6) + `AGENTS.md.template` (dynamic marker-delimited Module-Specific Guides block fed by the enabled module set, D6); legacy redirect stubs.
4. **Cleanup** — remove the 9 per-module `standalone-guide.md`; `RELEASE_NOTES.md` deprecation note.

## 9. Risks & Impact Review

| ID | Risk / failure scenario | Severity | Affected area | Mitigation | Residual |
|----|--------------------------|----------|---------------|------------|----------|
| R1 | **Version skew.** Facts are baked into create-app at publish time; a user who later upgrades `@open-mercato/core` gets fact-sheets describing the older version. | Medium | scaffolded standalone apps | Stamp each generated file with the `@open-mercato/core` version it was generated from; document the staleness bound. Follow-up: run the same `packages/cli` generator at the app's `yarn generate` over installed modules to regenerate against the actual version (the generator's `packages/cli` home makes this a drop-in). | Until the generate-time path ships, baked facts can lag the installed version by whatever the user upgraded across. Bounded and visible via the version stamp. |
| R2 | **Registry dependency.** API-route auth extraction needs `yarn generate` to have run first; auth comes from `modules.runtime.generated.ts` `apis[].metadata` (NOT the `api-routes.generated.ts` manifest, which lacks auth). A stale/missing registry yields wrong or empty auth. | Low | API routes section | Run `generate` before extraction in `build.mjs`; assert the registry and its `apis[].metadata` are present and fail loudly rather than emitting silent gaps. | Auth column may be incomplete for custom (non-CRUD) routes that lack literal `metadata`. |
| R3 | **Over-extraction noise** (e.g. entity-value DI registrations, all 38 modules). | Low | fact-sheet quality | D5 allowlist + DI service-only filter + explicit "NOT extracted" boundary. | Allowlist must be maintained when a 10th module becomes user-facing. |
| R4 | **AST shape changes** in a module break the parser (e.g. a module declares events without `as const`). | Low | extractor robustness | Reuse the hardened generators' parsing; treat unparseable sections as empty + emit a build warning, never crash the create-app build. | A malformed source silently yields an empty section (with warning). |
| R5 | **Stale/empty module table.** Dynamic generation (D6) reads the wrong enabled-module source — runs before `targetDir/src/modules.ts` exists, or `AgenticConfig` lacks the set — yielding an empty or wrong Module-Specific Guides block. | Low | scaffolded `AGENTS.md` | Order agentic setup after `src/modules.ts` is written; assert the enabled set is non-empty before emitting the marker block; on failure fall back to the full D5 allowlist (today's behavior) with a build warning rather than an empty table. | If the fallback fires the table lists all allowlisted modules (current behavior) — degraded, not broken. |

**Data Models:** the JSON sidecar schema in §6 is the data contract. **API Contracts:** N/A — no runtime HTTP surface is added or changed.

## 10. Integration & Test Coverage

This is a generator: "integration coverage" means unit/snapshot tests in `packages/cli` plus a build-time guard. No HTTP routes or UI flows are added. Tests are split by the package they exercise (GAP-D6-C): the AST/extractor unit + snapshot tests **T1–T4** live in `packages/cli/src/lib/generators/__tests__/` (run under `yarn test`); the build/shared wiring tests **T5–T6** exercise `packages/create-app` (`build.mjs` + `shared.ts`) and live in `packages/create-app` (run via `yarn test:create-app`). Do **not** place T5/T6 under `packages/cli` — they assert create-app behavior, not a cli generator.

| # | Test | Type | Asserts |
|---|------|------|---------|
| T1 | `module-facts.customers.fixture.test.ts` | snapshot | Extracting `customers` yields the **real** facts: entity IDs in colon form (`customers:customer_person_profile`), 21 ACL features, 49 events (each carrying `category`/`entity`), 6 colon-form search entities, 2 notifications (`customers.deal.won`/`customers.deal.lost`), empty `diTokens` (service-only filter), empty `cli`. Locks the §6 contract against silent drift. |
| T2 | `module-facts.auth-source.test.ts` | unit | Per-method auth for `/api/customers/people` is read from module-registry `apis[].metadata` (GET → `customers.people.view`; POST/PUT/DELETE → `customers.people.manage`), and reading `api-routes.generated.ts` alone yields **no** auth — a regression guard for the corrected source (R2). |
| T3 | `module-facts.bc-guard.test.ts` | guard | Every entity ID / event ID / ACL feature / search entity emitted in `module-facts.generated.json` still resolves against the live `E` registry, `events.ts`, `acl.ts`, and `search.ts`. Fails CI when a fact-sheet references a surface that no longer exists. **This is the "BC guard" named in D4.** Also runs in `yarn generate` as a non-fatal warning so monorepo drift surfaces early. |
| T4 | `module-facts.malformed.test.ts` | unit | A module whose `events.ts` lacks `as const` (or any unparseable section) yields an **empty** section + a build warning, never a thrown error (covers R4). |
| T5 | `build.mjs` wiring | smoke | After the `create-app` build, `dist/agentic/guides/modules/customers.md` + `dist/agentic/guides/module-facts.json` exist, and the 9 legacy `core.<module>.md` redirect stubs are present (covers the §7 BC bridge). |
| T6 | `agents-md.module-guides.test.ts` (in `packages/create-app`) | unit | Given an enabled set of `{customers, sales}`, the generated `AGENTS.md` Module-Specific Guides marker block lists exactly those two rows (pointing at `.ai/guides/modules/{customers,sales}.md`), drops the "(if available)" hedge, and omits rows for non-enabled allowlisted modules; `shared.ts` copies only those two fact-sheets into `.ai/guides/modules/`. Additional cases (GAP-D6-E): a module that is **present-but-not-enabled** yields no row; a module that is **enabled but not in the D5 allowlist** yields no row; and a **second generation pass** over an already-generated `AGENTS.md` is **idempotent** (replace strictly between the `<!-- om:module-guides:start/end -->` markers — never append/duplicate). Guards D6. |

## 11. Open questions

_None blocking._ Former OQ2 (monorepo emission) is resolved as **D4**. Former OQ1 (non-module packages) is recorded under Deferred.

## 12. Deferred / Future

- **Generated surface for non-module packages** (`ui`, `shared`, …): a lighter fact-sheet (public import paths + exported symbol names only) could replace parts of the 7 hand-written package guides later. Out of scope until the core-module model is proven.
- **Generate-time regeneration in standalone apps** (R1 fix): promote the extractor into the app's `yarn generate` so facts track the installed package version, not the scaffold-time version.
- **Extending D5 to the remaining 29 core modules** once the 9 user-facing ones are validated.

## 13. Changelog

- **2026-06-27** — Initial draft (design only). Decisions D1–D3 locked from user input.
- **2026-06-27** — Architectural review applied: corrected guide counts (9 module-level / 7 package-level, not "14"); fixed fabricated `customersService` DI token (real `di.ts` registers entity values only) and added a service-only DI filter; corrected the entity-ID source to the generated `E` registry; added Decision D4 (monorepo emission, resolving OQ2) and D5 (9-module allowlist, resolving H1); softened the "impossible to drift" goal and added the version-skew risk R1; added TLDR, Risks & Impact Review, Data Models/API-Contracts notes, and this changelog; clarified that "widget spots" extraction is really host `entityId`/`tableId` tokens.
- **2026-06-27** — Added Decision **D6** (dynamic, per-enabled-module `AGENTS.md` Module-Specific Guides table) plus the matching Goal, §7 wiring (marker-delimited generated block + filtered `shared.ts` copy + enabled-module set plumbed via `AgenticConfig`/`targetDir/src/modules.ts`), Risk **R5** (stale/empty-table fallback to the D5 allowlist), and test **T6**. Resolves the gap where the scaffolded `AGENTS.md` routed at a static 9-row "(if available)" table and `shared.ts` blanket-copied every bundled fact-sheet regardless of which modules the app enables. The 7 package/conceptual guide rows stay static per the §2 Non-Goal.
- **2026-06-30** — Pre-implementation polish ahead of implementation (analysis "During Implementation" items): **GAP-D6-C** — §10 now splits test locations (T1–T4 in `packages/cli`, T5–T6 in `packages/create-app` via `yarn test:create-app`); **GAP-D6-E** — T6 extended with present-but-not-enabled, enabled-but-not-allowlisted, and second-pass-idempotency cases; **GAP-D6-F** — §7 clarifies fresh D6 scaffolds reference neither legacy `core.<module>.md` nor the redirect stubs (stubs are for in-place upgrades only). Must-Do gaps D6-A/B were already applied (prior entry); GAP-D6-D (template intro-copy reword) is an implementation-time change to `AGENTS.md.template`, not a spec edit. Spec is implementation-ready.
- **2026-06-27** — Applied pre-implementation follow-ups **GAP-D6-A/B** (second analysis pass, `.ai/specs/analysis/ANALYSIS-2026-06-27-ts-morph-module-fact-sheets.md`): pinned the D6 enabled-module extraction to an **AST-parse of the `enabledModules` array literal ∩ D5 allowlist** (intentional static-literal caveat documented; dynamic import of `modules.ts` forbidden), and **chose the `targetDir/src/modules.ts` file-read** over extending `AgenticConfig` so both `generateShared` invocation sites (create-app wizard + `mercato agentic:init`) share one mechanism. Verified the scaffold ordering (`scaffoldTemplateApp` before `maybeRunAgenticSetup`) and the Codex marker idiom that D6 reuses.
- **2026-06-27** — Pre-implementation analysis applied (`.ai/specs/analysis/ANALYSIS-2026-06-27-ts-morph-module-fact-sheets.md`): **(1)** corrected the API-route auth source — auth is read from the module registry `apis[].metadata` (`modules.runtime.generated.ts`, via `buildApiMetadataLiteral()`), NOT the `api-routes.generated.ts` manifest, which carries no auth (D4, §4, §5, R2); **(2)** fixed every entity/search ID to the canonical `E` colon form (`customers:customer_person_profile`, not `customers.person`) and documented the dotted-enricher-alias distinction and the entity/event format split; **(3)** resolved the committed-output contradiction — versioned `apps/mercato/src/module-facts.generated.json`, never the git-ignored `.mercato/generated/` (D4, §5, §7); **(4)** replaced fabricated example counts with verified real data (ACL 18→21, events 21→49, search 2→6, notifications empty→2; `diTokens`/`cli` confirmed empty); **(5)** added §10 Integration & Test Coverage incl. the BC guard, and pinned the §6 JSON as the authoritative data contract; added the R1 version stamp to the example output.
