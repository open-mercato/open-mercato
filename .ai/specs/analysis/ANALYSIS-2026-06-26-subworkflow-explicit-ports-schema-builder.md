# Pre-Implementation Analysis: Sub-workflow Explicit Ports + Schema Builder

> Target spec: `.ai/specs/2026-06-26-subworkflow-explicit-ports-schema-builder.md`
> Branch: `feat/subworkflow-contract` · Analyzed: 2026-06-26 · Analysis only — no code/spec modified.

## Executive Summary

The spec is **architecturally sound and largely ready**, and every code-level claim it makes was verified against the actual module (events, routes, entities, resolution logic, DI/CLI, ACL). The design rides on an existing strength: `WorkflowInstance` pins its parent by `definition_id` (row UUID PK), so coexisting versions never disturb in-flight instances. There are **no Critical BC violations**, but **one Critical implementation prerequisite** (audit every `findOne(WorkflowDefinition, { workflowId, tenantId })` upsert/lookup site before relaxing the unique constraint) and **one Warning-level contract-surface change** (dropping the `(workflowId, tenantId)` unique index + changing resolution from "latest enabled" to "latest published") that the spec already documents under Migration & BC. **Recommendation: Ready to implement after the two "Before Implementation" items below are addressed; Phase 1 (no migration) can start immediately.**

---

## Backward Compatibility

All 13 contract-surface categories were checked. Verified facts: `workflows.definition.published` and `workflows.definitions.publish` are **both unused today** (free to add); `admin` already holds `workflows.*` so the new feature auto-grants; DI keys and CLI commands are untouched.

### Violations / Sensitive Changes Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | §8 DB schema (index) | Drop unique `(workflowId, tenantId)` → add `(workflowId, version, tenantId)`. This is a **relaxation** (no existing row becomes invalid), but §8 flags index removal as contract-sensitive. | **Warning** | Keep the change (required for versions to coexist); it's intra-module + behavior-preserving via backfill. Document in `RELEASE_NOTES.md` and the spec's Migration & BC section (present). Add the new GIN index on `definition` in the same migration. |
| 2 | §8 DB schema (resolution behavior) | `find-definition.ts` changes "latest **enabled**" → "latest **published**". | **Warning** | Resolution keeps the `enabled=true` filter **and** adds `lifecycle='published'`; backfill maps existing `enabled=true → published`, `enabled=false → archived`. Net behavior identical for current data — assert with a parity test. |
| 3 | §2/§7 Types & API (additive) | New columns `kind`/`lifecycle`; new response fields on `GET /api/workflows/definitions`; new `definition.io`. | **OK (additive)** | Columns ship with defaults; response fields and `io` are additive. No client breakage. |
| 4 | §10 ACL / §5 Events / §7 routes (additive) | New `workflows.definitions.publish`, `workflows.definition.published`, `POST …/publish`, `GET …/callers`. | **OK (additive)** | Add feature to `setup.ts` + `yarn mercato auth sync-role-acls`; declare event `as const`; export `openApi` + top-level `metadata` on new routes (matches the existing `api/definitions/route.ts` pattern). |
| 5 | §1 validators | Add `io` optional + refinement `kind=component ⇒ no triggers`. | **OK** | Additive: existing payloads default `kind=workflow`, so none become invalid. Do not narrow any existing schema. |

### Missing BC Section
Present and adequate — the spec's **Migration & Compatibility** section covers the constraint swap, backfill, resolution parity, and additive guarantees. **Add one line**: `RELEASE_NOTES.md` entry for the uniqueness relaxation (required by the deprecation protocol for a contract-surface change).

---

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| (none missing) | — | All required sections present: TLDR, Overview (+market ref), Problem, Proposed Solution, Architecture, Data Models, API Contracts, i18n, UI/UX + Frontend Architecture Contract, Migration & BC, Implementation Plan, Risks, Final Compliance Report, Changelog. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Integration Test Coverage | The "Testing Strategy" lists scenarios but not an explicit **per-affected-API + per-key-UI-path** matrix, which root `AGENTS.md` mandates for new features. | Expand into a table: each new/changed route (`definitions` list w/ filters, `…/publish`, `…/callers`, `instances` component-reject) + key UI paths (Schema Builder save, port render, "Otwórz środek", drag-drop) with one integration test each. Self-contained fixtures via API. |
| Data Models | `lifecycle`/`kind` enum **default literals** not specified at the MikroORM level. | Specify plain string defaults (`'workflow'`, `'published'`) — see Risk R5 (pre-quoted defaults break `yarn initialize`). |
| Architecture | Behavior of **code-based (in-memory) definitions** (merged into the list by `backend/definitions/page.tsx`) under `kind`/`lifecycle` not defined. | State the rule: code definitions are treated as `kind=workflow`, `lifecycle=published`, not versioned/publishable. |

---

## AGENTS.md Compliance

### Violations / Watch-items
| Rule | Location | Fix |
|------|----------|-----|
| Wildcard-aware ACL matching (lessons.md + core AGENTS) | Any UI/runtime gating on `workflows.definitions.publish` | Use `hasFeature`/`hasAllFeatures`, never `features.includes(...)`. `admin` holds `workflows.*`, so publish must resolve via wildcard. |
| MikroORM string defaults must be plain values (lessons.md) | `kind`/`lifecycle` columns | `default: 'workflow'` / `'published'` — never `"'workflow'"`. |
| Assign PK before referencing (lessons.md) | Publish mints a new version row | `em.create(WorkflowDefinition, { id: randomUUID(), … })` since the new row's id is referenced in the response/event before flush. |
| Non-`CrudForm` writes via `useGuardedMutation`; `apiCall` only | Publish action + Schema Builder save | Client calls `…/publish` and definition update through `useGuardedMutation`/`apiCall`, never raw `fetch`. |
| `Button`/`IconButton` primitives; DS semantic tokens; `aria-label` (lessons.md + ds-rules) | SubWorkflowNode buttons, two edge colors, breaking-change banner | Edge colours via DS tokens (`--edge-control`/`--edge-data`), not hardcoded green/purple; warning via `<Alert>` status token; dialog `Cmd/Ctrl+Enter` + `Escape`. (Spec already states this — keep enforced in review.) |
| Mutation-guard contract on custom writes (core AGENTS) | `…/publish` route | `validateCrudMutationGuard` before + `runCrudMutationGuardAfterSuccess` after; export `openApi`. |
| Event `as const` (core AGENTS) | `events.ts` | Append `workflows.definition.published` inside the `as const` array. |

**Compliant by design:** tenant scoping on every new query (publish, caller scan); FK-by-id (no cross-module ORM relation); commands/undo modeled (publish = guarded mutation, undo = archive + restore pointer). **Encryption:** N/A — ports/contract carry no PII/credentials (workflow structure metadata only). Confirm authors don't put secrets in port `options`/labels (UI hint, low risk).

---

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R1 — Upsert/lookup by `(workflowId, tenantId)` becomes ambiguous** once multiple versions coexist. Any `findOne(WorkflowDefinition, { workflowId, tenantId })` (definition create/update upsert, setup seeding, customize/reset paths) silently returns/updates the wrong row. | Could corrupt definitions or mis-resolve callers. The uniqueness relaxation removes the guarantee these sites rely on. | **Before migration:** grep all `WorkflowDefinition` lookups by workflowId+tenant; make each version-aware (pin to `draft` for edits, "latest published" for resolution). Treat as the Critical prerequisite. |
| **R2 — Resolution semantics regression** (latest enabled → latest published) changes which version triggers/unpinned calls fire. | Tenant-wide behavior shift for existing workflows. | Backfill `enabled=true→published`; keep `enabled` filter in resolution; parity integration test asserting identical resolution pre/post on current data. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R3 — Runtime validation rejects previously-passing data** (Q5) at the SUB_WORKFLOW boundary when a child gains `definition.io`. | A live caller's loose value now fails coercion → step fails (N2). | Validation gated on contract presence (opt-in by authoring); breaking-change preview surfaces affected callers at publish; failure is a normal compensable step failure. **Verify the saga/compensation path actually fires on a SUB_WORKFLOW input-validation FAILED** (the spec assumes it). |
| **R4 — jsonb `@>` caller scan cost** grows with definition count (no reverse-index table in v1). | Slow publish/preview at scale. | GIN index on `definition`; tenant-scoped; document the denormalized caller-index table as the explicit v1 cutline. |
| **R5 — Pre-quoted enum defaults break `yarn initialize`** (known lesson). | Fresh DB bootstrap fails. | Plain `default: 'workflow'/'published'`; review generated migration SQL + update `.snapshot-open-mercato.json` (do not run `db:migrate`). |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R6 — Version sprawl** from frequent publishes. | Storage growth. | Explicit Publish (not save-as-version) + future `archived` pruning. |
| **R7 — Concurrent publish race** on `version = max+1`. | Duplicate version attempt. | New unique `(workflowId, version, tenantId)` is the backstop; compute next version in the publish transaction, retry on conflict. |
| **R8 — Drag-drop second edge class** complicates the canvas. | Editor regressions. | Derive data edges from `inputMapping` (don't persist as transitions); ship Phase 6 last with the key/value form as fallback. |

---

## Gap Analysis

### Critical Gaps (Block Implementation of Phase 5)
- **G1 — Caller/upsert audit (R1):** enumerate and fix all `WorkflowDefinition` lookups keyed on `workflowId+tenantId` before relaxing the unique constraint. This is the single must-do-first item.

### Important Gaps (Should Address in Spec)
- **G2 — Integration coverage matrix** per affected API + key UI path (root AGENTS mandate).
- **G3 — Compensation behavior** for a SUB_WORKFLOW port-validation FAILED — confirm and document that existing saga compensation covers it (N2).
- **G4 — Code-based (in-memory) definitions** treatment under `kind`/`lifecycle`.
- **G5 — `RELEASE_NOTES.md`** entry for the uniqueness relaxation (deprecation protocol requirement).

### Nice-to-Have Gaps
- **G6 — Cache invalidation** note (if/when workflow definition reads are cached, publish must invalidate). Likely N/A today — confirm.
- **G7 — `enabled` long-term fate** — spec keeps it secondary to `lifecycle`; add a one-minor deprecation note if it will eventually be removed.

---

## Remediation Plan

### Before Implementation (Must Do)
1. **G1/R1 — Upsert audit.** Grep `WorkflowDefinition` lookups by `workflowId+tenantId` across the module (definition CRUD, `setup.ts` seeding, customize/reset, `find-definition.ts`); make each version-aware. Gate the Phase 5 migration on this.
2. **G3/R3 — Confirm compensation** fires for a SUB_WORKFLOW FAILED caused by input-port validation; if not, define the failure path before adopting N2.

### During Implementation (Add to Spec / Code)
1. Add the **Integration Coverage matrix** (G2) and the **code-definition rule** (G4) to the spec.
2. Resolution change keeps `enabled=true AND lifecycle='published'`; add the **parity test** (R2).
3. MikroORM **plain enum defaults** (R5) + **client-side PK** on publish row mint + **GIN index** (R4) in the scoped migration; update `.snapshot-open-mercato.json`; do not run `db:migrate`.
4. New routes export `openApi` + top-level `metadata` and use the **mutation-guard contract**; client uses `useGuardedMutation`/`apiCall`.
5. UI: DS tokens for the two edge classes, `Button`/`IconButton`, `<Alert>` warning, `aria-label`, dialog shortcuts; **wildcard-aware** ACL gating.

### Post-Implementation (Follow Up)
1. `RELEASE_NOTES.md` uniqueness-relaxation entry (G5).
2. Re-evaluate the **denormalized caller-index** if the `@>` scan is slow at scale (R4).
3. Decide `enabled` deprecation timeline (G7).

---

## Recommendation

**Ready to implement — with two gates.** Phases 1–4 carry no migration and can start immediately. **Phase 5 (versioning + breaking-change) must wait on G1 (upsert audit)**, and **N2 must be confirmed against the compensation path (G3)** before relying on validation-failure semantics. No Critical BC violation; the uniqueness/resolution change is a Warning-level, behavior-preserving, well-documented contract-surface change. Adopted defaults **N1** (published-only auto-start) and **N2** (validation-failure fails the step) remain pending user confirmation in review.
