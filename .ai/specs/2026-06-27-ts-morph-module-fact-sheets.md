# ts-morph Module Fact-Sheets — Generated Standalone Guides

- **Status:** Proposed (design only — not yet implemented)
- **Date:** 2026-06-27
- **Scope:** OSS — `packages/create-app` agentic guide generation + a reusable `packages/cli` generator
- **Related:** `packages/create-app/build.mjs`, `packages/create-app/src/setup/tools/shared.ts`, `packages/create-app/agentic/shared/AGENTS.md.template`, `BACKWARD_COMPATIBILITY.md`, `packages/cli/src/lib/generators/{entity-ids,module-di,extensions/events}.ts` (existing ts-morph AST infra)

## TLDR

The standalone-app AI guides are hand-written per module and have already rotted (a customers guide documents a `makeCrudRoute` import path that does not exist). Replace the **9 per-module** hand-written guides with: (1) **one** hand-written conceptual guide (`module-system.md`) and (2) **per-module fact-sheets generated from source via ts-morph** that carry only the stable contract surface (entity IDs, events, ACL features, API routes, DI service tokens, searchable entities, table/entity IDs, notifications, CLI). The extractor is a `packages/cli` generator reusing existing AST infra; it is invoked at `create-app` build time (bundling facts for scaffolded apps) **and** in the monorepo `yarn generate` (committing `module-facts.json` for first-party skills + a BC guard). Output is Markdown + a JSON sidecar. First cut targets the same **9 user-facing modules** that have guides today; the other 29 core modules are out of scope.

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
| D4 | Monorepo emission (resolves former OQ2) | The extractor lives in `packages/cli` and **also runs in the monorepo `yarn generate`**, committing `apps/mercato/.mercato/generated/module-facts.json`-style output for first-party consumers (`om-onboarding`, the BC guard). Same generator, two invocation sites — does not contradict D2. |
| D5 | Module scope of the first cut (resolves H1) | Generate fact-sheets for the **9 user-facing modules** that have guides today. The module list is an **explicit, configurable allowlist** in the extractor, not "every folder under `src/modules/`". Extending to the other 29 modules is a follow-up. |

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
| **Entities & IDs** — entity ID (`customers.person`) → class, table, user-editable (`updated_at` present), custom-fields enabled | the generated `E` registry (`entities.ids.generated.ts`, via the `entity-ids` generator) cross-referenced with `data/entities.ts` (`@Entity` table/`updated_at`) and `ce.ts` (custom fields). **Entity IDs are NOT raw class names** — the class↔table↔ID mapping is owned by `E`. | reference entities by ID, tenant scoping, optimistic-lock awareness |
| **Events** — `id`, `label`, `category`, `entity` | `events.ts` (`createModuleEvents`) | subscribe / workflow triggers |
| **ACL features** | `acl.ts` (`features`) | `requireFeatures` gating |
| **API routes** — path, methods, per-method auth (`requireAuth` / `requireFeatures`) | the generated route/registry manifest (see §5 caveat), falling back to AST `metadata` literals for custom routes | call the API, know its authz |
| **DI service tokens** — token name → registration kind, **services only** | `di.ts` — emit only function/class service registrations; **exclude entity-value registrations** (`asValue` on entity classes like `CustomerEntity`) which are not interop tokens | `container.resolve(token)` |
| **Searchable entities** | `search.ts` (`searchConfig.entities` keys) | know what is indexed |
| **Host extension points** — the module's stable `entityId` / `tableId` tokens | `backend/**` `DataTable`/`CrudForm` usages + `data/entities.ts` | derive injection spot IDs by convention: `data-table:<tableId>:{columns,row-actions,bulk-actions,filters}`, `crud-form:<entityId>:fields`. (We extract the **tokens**, not a spot list — spot suffixes are framework conventions documented in Layer 1.) |
| **Notification IDs / CLI commands** | `notifications.ts`, `cli.ts` | notification + command surface |

**Explicitly NOT extracted:** function bodies, business logic, validator internals, prose. They are not needed to consume a module, they bloat context, and they would re-introduce drift.

## 5. Extraction implementation

- **Reuse existing infra.** `ts-morph` is already a `packages/cli` dependency, and the generators (`entity-ids.ts`, `extensions/events.ts`, `module-di.ts`, …) already parse exactly these declarations via AST using the helpers in `packages/cli/src/lib/generators/ast`. The extractor (`packages/cli/src/lib/generators/module-facts.ts`) reuses the same parser — no new dependency, one consistent AST reader. Living in `packages/cli` is what makes the dual invocation in D4 possible.
- **Entity-ID source.** The authoritative `entityId → class/table` mapping is the generated `E` registry, not raw `@Entity` decorators (e.g. `CustomerEntity`/`customer_entities` is the base entity, distinct from the `customers.person` ID). The extractor reuses the `entity-ids` generator's output rather than re-deriving IDs from class names.
- **DI extraction semantics.** `di.ts` registers both **services** (`asFunction`/`asClass`) and **entity values** (`asValue` on entity classes — confirmed in `customers/di.ts`: `CustomerEntity`, `CustomerAddress`, `CustomerInteraction`). Only service registrations are interop tokens; entity-value registrations MUST be filtered out.
- **CRUD route auth caveat.** For `makeCrudRoute` routes the `metadata` is computed by the factory at runtime (in customers it is `export const metadata = routeMetadata`). Re-deriving auth purely from AST is brittle. Resolution: read API-route auth from the **generated route/registry manifest** produced by `yarn generate`, and only fall back to AST `metadata` literals for custom routes. (This is why the build step must run `generate` first.)
- **Invocation.** `build.mjs` calls the extractor over the D5 allowlist, emitting `dist/agentic/guides/modules/<module>.md` and `dist/agentic/guides/module-facts.json`; `shared.ts` copies them into the app's `.ai/guides/`. The monorepo `yarn generate` (D4) runs the same generator, writing the committed JSON for first-party consumers.

## 6. Output shape

### Markdown (`.ai/guides/modules/customers.md`) — verified real data
```markdown
# customers — module facts (generated, do not edit)

## Entities
| Entity ID         | Class                 | Table           | Editable | CustomFields |
|-------------------|-----------------------|-----------------|----------|--------------|
| customers.person  | CustomerPersonProfile | customer_people | yes      | yes          |
| customers.deal    | CustomerDeal          | customer_deals  | yes      | yes          |

## Events  (21)
| ID                       | Category  | Entity |
|--------------------------|-----------|--------|
| customers.person.created | crud      | person |
| customers.deal.won       | lifecycle | deal   |

## ACL features  (18)
customers.people.view · customers.people.manage · customers.deals.view ·
customers.deals.manage · customers.settings.manage · …

## API routes
| Path                  | Methods             | Auth (features)    |
|-----------------------|---------------------|--------------------|
| /api/customers/people | GET POST PUT DELETE | customers.people.* |
```

### JSON sidecar (`module-facts.json`) — programmatic source of truth
> Schema is illustrative; `diTokens` shows the real `customers/di.ts` content (entity-value registrations, which the extractor filters down to services — here none qualify, so `diTokens` is empty for customers).
```json
{
  "customers": {
    "entities": [
      { "id": "customers.person", "class": "CustomerPersonProfile",
        "table": "customer_people", "editable": true, "customFields": true }
    ],
    "events": [
      { "id": "customers.person.created", "category": "crud", "entity": "person" }
    ],
    "aclFeatures": ["customers.people.view", "customers.people.manage"],
    "apiRoutes": [
      { "path": "/api/customers/people", "methods": ["GET","POST","PUT","DELETE"],
        "auth": { "GET": ["customers.people.view"] } }
    ],
    "diTokens": [],
    "searchEntities": ["customers.person", "customers.company"],
    "hostTokens": { "entityIds": ["customers.person"], "tableIds": ["customers.people.list"] },
    "notifications": [],
    "cli": []
  }
}
```

## 7. Wiring & backward compatibility

- `build.mjs`: add the extraction step alongside (then replacing) the `standalone-guide.md` discovery loop.
- `shared.ts`: copy `modules/*.md` + `module-facts.json` into the app's `.ai/guides/` (Markdown under `.ai/guides/modules/`, the single combined JSON at `.ai/guides/module-facts.json`).
- `yarn generate` (monorepo, D4): emit the committed `module-facts.json` for first-party consumers.
- `AGENTS.md.template`: Task→Context map points at `.ai/guides/module-system.md` and `.ai/guides/modules/<module>.md`.
- **Generated-file contract (BC):** the template currently references the **9** `.ai/guides/core.<module>.md` paths. Per `BACKWARD_COMPATIBILITY.md` (generated file contracts), emit those legacy names as thin redirect stubs (`→ see modules/<module>.md`) for ≥1 minor version before removal, and note the deprecation in `RELEASE_NOTES.md`.
- Delete the **9** per-module `agentic/standalone-guide.md` files only after the generated equivalents land and the redirect stubs are in place. The **7** package-level guides are untouched.

## 8. Phasing

1. **Extractor** — `packages/cli/src/lib/generators/module-facts.ts` over the D5 allowlist: entities + events + ACL first (highest value, cleanest AST), then API routes (via manifest), DI services, search, host tokens, notifications/CLI. Wire into `yarn generate` (D4).
2. **Conceptual guide** — author `module-system.md` by consolidating existing prose; delete duplicated sections from `core.md`.
3. **Wiring** — `build.mjs` + `shared.ts` + `AGENTS.md.template`; legacy redirect stubs.
4. **Cleanup** — remove the 9 per-module `standalone-guide.md`; `RELEASE_NOTES.md` deprecation note.

## 9. Risks & Impact Review

| ID | Risk / failure scenario | Severity | Affected area | Mitigation | Residual |
|----|--------------------------|----------|---------------|------------|----------|
| R1 | **Version skew.** Facts are baked into create-app at publish time; a user who later upgrades `@open-mercato/core` gets fact-sheets describing the older version. | Medium | scaffolded standalone apps | Stamp each generated file with the `@open-mercato/core` version it was generated from; document the staleness bound. Follow-up: run the same `packages/cli` generator at the app's `yarn generate` over installed modules to regenerate against the actual version (the generator's `packages/cli` home makes this a drop-in). | Until the generate-time path ships, baked facts can lag the installed version by whatever the user upgraded across. Bounded and visible via the version stamp. |
| R2 | **Manifest dependency.** API-route auth extraction needs `yarn generate` to have run first; a stale/missing manifest yields wrong or empty auth. | Low | API routes section | Run `generate` before extraction in `build.mjs`; fail loudly if the manifest is absent rather than emitting silent gaps. | Auth column may be incomplete for custom (non-CRUD) routes that lack literal `metadata`. |
| R3 | **Over-extraction noise** (e.g. entity-value DI registrations, all 38 modules). | Low | fact-sheet quality | D5 allowlist + DI service-only filter + explicit "NOT extracted" boundary. | Allowlist must be maintained when a 10th module becomes user-facing. |
| R4 | **AST shape changes** in a module break the parser (e.g. a module declares events without `as const`). | Low | extractor robustness | Reuse the hardened generators' parsing; treat unparseable sections as empty + emit a build warning, never crash the create-app build. | A malformed source silently yields an empty section (with warning). |

**Data Models:** the JSON sidecar schema in §6 is the data contract. **API Contracts:** N/A — no runtime HTTP surface is added or changed.

## 10. Open questions

_None blocking._ Former OQ2 (monorepo emission) is resolved as **D4**. Former OQ1 (non-module packages) is recorded under Deferred.

## 11. Deferred / Future

- **Generated surface for non-module packages** (`ui`, `shared`, …): a lighter fact-sheet (public import paths + exported symbol names only) could replace parts of the 7 hand-written package guides later. Out of scope until the core-module model is proven.
- **Generate-time regeneration in standalone apps** (R1 fix): promote the extractor into the app's `yarn generate` so facts track the installed package version, not the scaffold-time version.
- **Extending D5 to the remaining 29 core modules** once the 9 user-facing ones are validated.

## 12. Changelog

- **2026-06-27** — Initial draft (design only). Decisions D1–D3 locked from user input.
- **2026-06-27** — Architectural review applied: corrected guide counts (9 module-level / 7 package-level, not "14"); fixed fabricated `customersService` DI token (real `di.ts` registers entity values only) and added a service-only DI filter; corrected the entity-ID source to the generated `E` registry; added Decision D4 (monorepo emission, resolving OQ2) and D5 (9-module allowlist, resolving H1); softened the "impossible to drift" goal and added the version-skew risk R1; added TLDR, Risks & Impact Review, Data Models/API-Contracts notes, and this changelog; clarified that "widget spots" extraction is really host `entityId`/`tableId` tokens.
