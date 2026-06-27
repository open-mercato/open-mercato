# Pre-Implementation Analysis: ts-morph Module Fact-Sheets — Generated Standalone Guides

- **Spec:** `.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`
- **Analysis date:** 2026-06-27
- **Analyst:** pre-implement-spec
- **Scope reviewed:** create-app guide wiring, cli ts-morph generator infra, customers-module facts (the spec's worked example)

## Executive Summary

The spec's **architecture is sound and its motivating premise is real** — the customers guide's broken `make-crud-route` import was confirmed verbatim, and all the infrastructure the spec proposes to reuse (ts-morph AST helpers, `entity-ids`/`module-di`/`events` generators, the generated `E` registry) exists as described. The approach (replace 9 hand-written per-module guides with one conceptual guide + AST-generated fact-sheets) is the correct response to the drift problem.

However, the spec is **not ready to implement as written** because two of its load-bearing technical claims are factually wrong, and the document presents fabricated example data under the label "verified real data." Specifically: (1) the API-route auth source is misnamed — the named manifest does **not** carry per-method auth; (2) every entity-ID in the spec uses a `customers.person` dotted form that **does not exist** in the authoritative `E` registry (which uses `customers:customer_person_profile` colon form). Both must be corrected before coding, because they define the extractor's two most important outputs. There are also example-count errors, a committed-vs-ephemeral output-location contradiction, and a missing integration-test section.

**Recommendation: Needs spec updates first (no major revision).** The design holds; fix the data contract (§ items BC-1, GAP-1, GAP-2) and re-issue.

---

## Backward Compatibility

This is a docs/tooling change. It adds no runtime types, events, routes, schema, DI keys, ACL features, or notifications. It is read-only AST extraction. BC exposure is limited to **generated-file / import-path-like contracts** and **CLI commands**.

### Violations / Concerns Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| BC-1 | (13) API route URLs / **spec accuracy** | The spec (§4 API-routes row, §5 "CRUD route auth caveat", D4) says per-method auth is read from "the generated route/registry manifest produced by `yarn generate`". The actual manifest `apps/mercato/.mercato/generated/api-routes.generated.ts` carries only `{ moduleId, kind, path, methods, load }` — **no auth**. Per-method `requireAuth`/`requireFeatures`/`requireRoles` live in `modules.runtime.generated.ts` / `modules.app.generated.ts` (`apis[].metadata`, built by `buildApiMetadataLiteral()` in `module-registry.ts`). | **Critical (spec inaccuracy)** | Re-point the auth source to the `apis[].metadata` literal in the runtime/app module registry, not `api-routes.generated.ts`. The data exists; only the named file is wrong. Update §5 and D4. |
| BC-2 | (1)(14) Generated-file/guide filenames | The 9 `.ai/guides/core.<module>.md` filenames are referenced by `AGENTS.md.template` and consumed by scaffolded apps. Removing them is a generated-output contract break. | Warning (already addressed) | **Spec already handles this correctly** (§7): emit legacy `core.<module>.md` as redirect stubs (`→ see modules/<module>.md`) for ≥1 minor version, note in `RELEASE_NOTES.md`, delete the 9 source guides only after stubs land. No change needed beyond keeping the stubs in Phase 3/4. |
| BC-3 | (13) CLI commands | Adds a new `generate` sub-step / generator. | None (additive) | New generator command is additive — OK. Ensure it is wired into `runGeneratorSuite()` additively, not by renaming an existing step. |

### Missing BC Section

The spec has **§7 "Wiring & backward compatibility"** which substantively covers the redirect-stub bridge and RELEASE_NOTES requirement — this satisfies the intent of a "Migration & Backward Compatibility" section. Recommend renaming it to that canonical heading for checklist hygiene, but it is **not** a blocker.

---

## Spec Completeness

The spec is unusually complete for a design doc (TLDR, Problem, Goals/Non-Goals, locked Decisions, Architecture, Extraction impl, Output shapes, Wiring, Phasing, Risks, Open Questions, Deferred, Changelog). Gaps against the spec-content checklist:

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| **Integration / Test Coverage** | AGENTS.md requires every feature to list test coverage. The spec names a "BC guard" (TLDR, D4) but never defines it. A drift-prevention feature with no test will itself silently rot. | Add a test plan: (a) a snapshot/fixture test of `module-facts.json` for `customers` (asserting real IDs/counts), (b) a **BC guard test** that fails if a fact-sheet references an entity ID / event ID / ACL feature absent from the live `E`/`events`/`acl` source, (c) a parser-robustness test (malformed `events.ts` without `as const` → empty section + warning, never crash — covers R4). |
| **Final Compliance Report** | Spec-writing checklist expects it. | Add a short compliance checklist result before merge. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §6 Output shape | JSON sidecar schema labelled "illustrative"; the example data is wrong (see GAP-2). For a *data contract* consumed by skills + a BC guard, "illustrative" is too loose. | Pin the JSON schema as authoritative (it is the stated data contract per §9). Regenerate the example from real extractor output once the ID format is fixed. |
| §4 Entities row | Glosses over the fact that table name + `updated_at` are **not** in `E` (confirmed: `E` carries only ID→class; tables come from `@Entity` decorators, fields from `entities/<entity>/index.ts`). | State the 3-way join explicitly: `E` (ID↔class) × AST `@Entity` (class↔table, `updated_at`) × `ce.ts` (custom fields). |

---

## AGENTS.md Compliance

| Rule | Assessment |
|------|-----------|
| Code placement (generators live in `packages/cli`) | ✓ Spec puts `module-facts.ts` in `packages/cli/src/lib/generators/` — correct. |
| Reuse canonical infra, no new deps | ✓ Reuses `ast/` helpers + `ts-morph` (already a cli dep, `^28.0.0`). Confirmed `ast/{index,imports,source-file,writers}.ts` export the builders the spec relies on. |
| No `any` | ⚠ Implementation-time concern — extractor must emit typed structures (`z.infer` or explicit types), no `any` on AST node handling. |
| Standalone generators must not assume monorepo paths (lessons.md) | ⚠ **Relevant pitfall.** Lessons.md ("Standalone generators must reuse package-generated entity metadata instead of parsing compiled `dist`" and "must not assume monorepo-only paths") directly applies: the create-app build invocation reads monorepo `src`, but the deferred R1 generate-time path (running in a scaffolded app) would hit compiled `dist` + package-shipped `generated/`. Spec should cite these lessons in Phase 1 / R1. |
| Keep standalone agentic content in sync (lessons.md) | ✓ This spec *is* that sync work; aligns with the "Keep standalone agentic content in sync with module conventions" lesson. |
| No UI/DS/i18n/encryption/tenant surface | ✓ N/A — pure static docs extraction. |

---

## Risk Assessment

The spec's own R1–R4 are well-formed. Additions / re-classifications:

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Entity-ID format is mis-specified** (see GAP-2). If the extractor ships the dotted `customers.person` form the spec documents, the IDs won't match the `E` registry (`customers:customer_person_profile`) **or** the search/host token formats agents must actually use. | An agent copying a fact-sheet ID into `getEntityIds()` / a query / an injection spot gets a non-existent ID — re-introducing exactly the "guide tells you to write code that doesn't compile" failure the spec exists to kill. | Resolve which ID the extractor emits (recommend: emit the canonical `E` colon ID **and** note the friendly enricher ID where one exists). Regenerate all §6 examples from real output. |
| **Auth source mis-named** (BC-1). | The entire "Auth (features)" column is empty/wrong if the extractor reads `api-routes.generated.ts`. | Read from runtime/app registry `apis[].metadata`. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Committed output lives in an ephemeral dir** (GAP-3). D4 says commit `apps/mercato/.mercato/generated/module-facts.json`, but that path is **git-ignored** (verified via `git check-ignore`) and wiped by `yarn clean-generated`. | First-party consumers (`om-onboarding`, BC guard) would consume an uncommittable, ephemeral artifact; CI would never see it. | Per module-development.md "versioned vs ephemeral generated files", committed registries live as `*.generated.ts` under `apps/mercato/src/`, not `.mercato/generated/`. Pick a versioned location (e.g. `apps/mercato/src/module-facts.generated.json` or a `.ai/` docs path) for the committed copy; the create-app build copy can stay in `dist/`. |
| **create-app build depends on monorepo `apps/mercato` generated output** (R2 amplified). The extractor at create-app build time needs the runtime registry already generated to read auth. | Stale/missing registry → silent empty auth. | Spec's R2 ("run `generate` first, fail loudly if manifest absent") is correct — extend it to the runtime registry (the real auth source), and assert presence rather than emitting silent gaps. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| R3 over-extraction (DI entity-values, all 38 modules) | fact-sheet noise | Spec's D5 allowlist + service-only DI filter are correct. **Confirmed**: `customers/di.ts` registers only `asValue(CustomerEntity/Address/Interaction)` and zero services, so the service-only filter yields empty `diTokens` for customers — exactly as the spec predicts. |
| R4 AST shape changes | empty section + warning | Spec's "treat unparseable as empty, never crash" is right; cover with the parser-robustness test (GAP-Test). |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **GAP-1 (auth source):** Name the correct generated source for per-method auth (runtime/app registry `apis[].metadata`), not `api-routes.generated.ts`. Without this the API-routes section cannot be built correctly.
- **GAP-2 (entity-ID format):** The spec's "verified real data" is wrong. `E` uses **colon, full-snake** IDs: `customers:customer_person_profile`, `customers:customer_company_profile`, `customers:customer_deal`, `customers:customer_entity`. The dotted `customers.person`/`customers.company`/`customers.deal` do **not** appear in `E`. (A separate friendly `customers.person` token *does* exist on `enrichers: { entityId: ... }` in `api/people/route.ts`, distinct from the `E` ID — the spec conflates the two.) Decide and document which ID the fact-sheet emits, then regenerate every example (Markdown table, JSON sidecar, `searchEntities`, `hostTokens`).

### Important Gaps (Should Address)

- **GAP-3 (committed output location):** Resolve the ephemeral-vs-versioned contradiction in D4 (see Medium risk).
- **GAP-Test (test coverage):** Add the integration/BC-guard/robustness test plan (see Completeness).
- **GAP-4 (example counts):** Correct the spec's example data, all of which the spec labels "verified real data":
  - ACL features: spec says **18**, actual **21**.
  - Events: spec says **21**, actual **49** (and events carry `category`/`entity` as claimed; `customers.person.created` and `customers.deal.won` both exist).
  - Search entities: spec says **2** (`customers.person`, `customers.company`), actual **6** (`customers:customer_person_profile`, `…company_profile`, `…comment`, `…deal`, `…activity`, `…todo_link`).
  - Notifications: spec says **empty**, actual **2** (`customers.deal.won`, `customers.deal.lost`) — so the `notifications` extraction will be non-empty for customers and the example must show it.
  - CLI: spec says **empty**; `customers/cli.ts` exists (~3.2k lines, mostly seed/example data). Verify whether it registers any *commands* before asserting empty; if it only seeds, clarify that the "CLI" surface = declared commands, not seed code.

### Nice-to-Have Gaps

- **GAP-5:** Note the table name comes from the `@Entity` decorator (not `E`), and `updated_at`→"editable" is an AST presence check — make the 3-way join explicit (see Incomplete Sections).
- **GAP-6:** Cross-reference the two relevant lessons (standalone generators must not parse `dist` / assume monorepo paths) in R1/Phase 1.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Fix the auth source (GAP-1/BC-1):** rewrite §5 "CRUD route auth caveat" and D4 to read auth from the runtime/app module-registry `apis[].metadata`, not `api-routes.generated.ts`.
2. **Fix the entity-ID contract (GAP-2):** choose the emitted ID convention (recommend canonical `E` colon ID + optional friendly enricher alias), then regenerate §6 Markdown + JSON from real extractor output.
3. **Resolve committed-output location (GAP-3):** replace the `.mercato/generated/` committed path with a versioned location.

### During Implementation (Add to Spec)

1. **Add Integration/Test Coverage section** with the customers fixture snapshot, the BC-guard test, and the parser-robustness test.
2. **Correct all example counts/data (GAP-4)** so the spec stops mislabeling fabricated numbers as verified.
3. **Make the entity 3-way join explicit (GAP-5)** and pin the JSON schema as authoritative.
4. **Cite the two standalone-generator lessons (GAP-6)** under R1/Phase 1.

### Post-Implementation (Follow Up)

1. Implement the R1 generate-time regeneration path in scaffolded apps (deferred) so facts track installed package versions — reusing the `dist`/package-`generated` source path per lessons.md, not monorepo `src`.
2. Extend D5 allowlist to the remaining 29 modules once the 9 are validated.
3. Consider the lighter generated surface for the 7 package-level guides (Deferred §11).

---

## Recommendation

**Needs spec updates first.** The architecture, decisions (D1–D5), reuse strategy, and BC bridge (redirect stubs) are correct and the motivating drift bug is confirmed real. Two load-bearing data claims are wrong (auth source, entity-ID format) and the worked example is fabricated despite the "verified real data" label. These are **document-accuracy fixes, not architectural changes** — once GAP-1, GAP-2, GAP-3, and the test section land, the spec is ready to implement against the existing `packages/cli` AST infra.
